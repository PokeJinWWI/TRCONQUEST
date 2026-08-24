import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { ShipMarker } from './ShipMarker'
import { NavigationLine } from './NavigationLine'
import { ShipOrbitRing } from './ShipOrbitRing'
import { ShipPanel } from './ShipPanel'
import { DeepSpaceClickPlane } from './DeepSpaceClickPlane'
import { PLANETS, SUN_RADIUS_KM, UNITS_PER_AU } from './planetData'
import { getMoonsForPlanet } from './moonData'
import type { InspectableBody } from './inspectableBody'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { getPlanetPosition } from './orbitMath'
import {
  getShipRenderPosition,
  planMove,
  shipSystemId,
  canFollow,
  bodyLivePosition,
  SYSTEM_SHIP_ORBIT_RADIUS,
  SOL_SYSTEM_ID,
} from './shipPhysics'
import { useGameTimeStore, simDaysToYears } from '../state/gameTimeStore'
import { useViewStore } from '../state/viewStore'
import { useShipStore } from '../state/shipStore'
import { ALLEGIANCE_COLORS } from '../data/shipData'
import { InspectPanel } from '../components/InspectPanel'

const MAX_DISTANCE = 32000
const EXIT_DISTANCE = 26000
const FOCUS_ARRIVE_DISTANCE = 1.4
// How close (to the locked-on body) manually zooming in has to get before it
// counts as "entering" satellite view, same idea as Detailed View but driven
// by the player's own zoom instead of the explicit button/fly animation.
const ENTER_SATELLITE_DISTANCE = 3
// How close the "Go To" fly-in to a selected ship needs to get before it
// counts as arrived.
const SHIP_FOCUS_ARRIVE_DISTANCE = 1.2
const SOL_NAME = 'Sol'
const SOL_COLOR = '#ffd27a'
// How far a route line's arrowhead reaches back from its destination, in
// this view's own units (UNITS_PER_AU = 20, so this is ~1.25 AU) — sized
// against typical in-system hop lengths (tens to hundreds of units), not
// against the arena-scale constant CombatPathLine uses, which is metres by
// comparison at this view's zoom.
const NAV_ARROW_LENGTH = 25

// Default starting camera direction/distance for a fresh arrival (fly-in
// from interstellar, breadcrumb) — close enough that the outer planets
// (Neptune's orbit radius is ~600 units, see planetData's UNITS_PER_AU) read
// as individually spaced-out, legible markers rather than a cluttered,
// overlapping knot near the center of frame. Same viewing angle as before,
// just ~4.4x closer — that earlier distance was tuned for a "shrink to a
// dot" feel on *exit*, which turned out to double, unintentionally, as an
// illegible *entry* framing too.
const FAR_START = new Vector3(0, 1440, 1920)
// "Somewhat close" starting distance used instead when returning from
// satellite view via zoom-out, so exiting a body's close-up reads as
// gradually pulling back to a lower level of detail, not jumping to a
// different, distant view.
const NEAR_START_DISTANCE = 18

const ORIGIN = new Vector3(0, 0, 0)

function getBodyPosition(name: string): Vector3 {
  if (name === SOL_NAME) return ORIGIN.clone()
  const data = PLANETS.find((p) => p.name === name)
  if (!data) return ORIGIN.clone()
  return getPlanetPosition(data, simDaysToYears(useGameTimeStore.getState().simDays))
}

export function SolarSystemScene() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const enterSatellite = useViewStore((s) => s.enterSatellite)
  const enterInterstellar = useViewStore((s) => s.enterInterstellar)
  const selectedName = useViewStore((s) => s.inViewSelection)
  const selectInView = useViewStore((s) => s.selectInView)
  const lockOnEnabled = useViewStore((s) => s.lockOnEnabled)
  const ships = useShipStore((s) => s.ships)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const setShipOrder = useShipStore((s) => s.setShipOrder)
  const setFtlCharge = useShipStore((s) => s.setFtlCharge)
  const setFollowing = useShipStore((s) => s.setFollowing)
  const systemShips = useMemo(() => ships.filter((ship) => shipSystemId(ship) === SOL_SYSTEM_ID), [ships])
  // Every resting-orbiting ship's position among the others sharing its
  // exact body — lets ShipMarker stack their markers/labels instead of
  // letting them overlap into an unreadable pile (most likely once one ship
  // is following another there — see ShipInstance.followingShipId).
  const shipStackInfo = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const ship of systemShips) {
      if (ship.order || ship.location.kind !== 'orbiting') continue
      const arr = groups.get(ship.location.bodyName) ?? []
      arr.push(ship.id)
      groups.set(ship.location.bodyName, arr)
    }
    const info = new Map<string, { index: number; count: number }>()
    for (const ids of groups.values()) ids.forEach((id, index) => info.set(id, { index, count: ids.length }))
    return info
  }, [systemShips])
  // One ring per distinct (body, inclination) pair with at least one
  // resting orbiting ship — every ship sharing both traces the identical
  // circle (radius is a shared per-view constant, not per-ship state), so
  // there's no reason to render more than one ring for them collectively.
  const shipOrbitRings = useMemo(() => {
    const seen = new Map<string, { bodyName: string; inclinationDeg: number }>()
    for (const ship of systemShips) {
      if (ship.order || ship.location.kind !== 'orbiting') continue
      const key = `${ship.location.bodyName}::${ship.location.inclinationDeg}`
      if (!seen.has(key)) seen.set(key, { bodyName: ship.location.bodyName, inclinationDeg: ship.location.inclinationDeg })
    }
    return Array.from(seen.values())
  }, [systemShips])
  // Only track a selected ship for the camera lock while it's actually
  // present in this scene — same "focusing logic like planets" idea, but a
  // planet is always here to lock onto while a ship might have travelled
  // elsewhere since being selected.
  const trackedShip = useMemo(
    () => (selectedShipId ? systemShips.find((s) => s.id === selectedShipId) ?? null : null),
    [selectedShipId, systemShips],
  )

  // If we're arriving here because the player zoomed out of a body's
  // satellite view, selectedBodyName is still set (see exitSatelliteToSystem)
  // — used once, at mount, purely to start the camera nearby instead of at
  // the far default (see initialCameraPosition below). A fresh arrival
  // (breadcrumb, interstellar fly-in) has selectedBodyName cleared, so this
  // is a no-op in that case. Body *selection* itself (as opposed to camera
  // framing) is viewStore's inViewSelection, above — exitSatelliteToSystem
  // and enterSystem both seed it directly, so this ref doesn't need to.
  const continuityBodyRef = useRef(useViewStore.getState().selectedBodyName)

  // Selecting a body locks the camera onto it immediately (see
  // SelectionTracker) — `selectedName` doubles as "what's tracked" except
  // while flying to a Detailed View, when CameraFocusRig takes over instead.
  const [flyingToName, setFlyingToName] = useState<string | null>(null)
  // Set by ShipPanel's "Go To" button — separate from flyingToName since,
  // unlike a planet's Detailed View, arriving doesn't transition to a
  // deeper view level. Independent of lockOnEnabled (a one-time fly, not
  // continuous follow).
  const [flyingToShip, setFlyingToShip] = useState(false)

  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    if (!continuityBodyRef.current) return [FAR_START.x, FAR_START.y, FAR_START.z]
    const target = getBodyPosition(continuityBodyRef.current)
    const dir = FAR_START.clone().normalize().multiplyScalar(NEAR_START_DISTANCE)
    const pos = target.add(dir)
    return [pos.x, pos.y, pos.z]
    // Computed once, at mount, from whatever the state was at that moment —
    // deliberately not reactive to later selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedPlanetData = useMemo(
    () => (selectedName && selectedName !== SOL_NAME ? PLANETS.find((p) => p.name === selectedName) : undefined),
    [selectedName],
  )
  const selectedBody: InspectableBody | null = useMemo(() => {
    if (!selectedName) return null
    if (selectedName === SOL_NAME) return { name: SOL_NAME, kind: 'star', color: SOL_COLOR, radiusKm: SUN_RADIUS_KM }
    if (!selectedPlanetData) return null
    return {
      name: selectedPlanetData.name,
      kind: 'planet',
      color: selectedPlanetData.color,
      radiusKm: selectedPlanetData.radiusKm,
      orbitAU: selectedPlanetData.orbitRadius / UNITS_PER_AU,
      orbitPeriodYears: selectedPlanetData.orbitPeriodYears,
      moonCount: getMoonsForPlanet(selectedPlanetData.name).totalCount,
    }
  }, [selectedName, selectedPlanetData])
  const flyingPlanetData = useMemo(
    () => (flyingToName && flyingToName !== SOL_NAME ? PLANETS.find((p) => p.name === flyingToName) : undefined),
    [flyingToName],
  )

  const handleSelect = (name: string) => {
    selectInView(name)
    setFlyingToName(null)
    selectShip(null)
  }

  // r3f's onPointerMissed fires for any click inside the canvas's shared
  // event container that doesn't hit a 3D object — which includes clicks on
  // our HTML marker overlays (they share that container so drei's Html can
  // render above the canvas). Without this guard, selecting a planet and the
  // "miss" firing for that same click race in the same tick and the miss
  // wins, silently undoing the selection. Ignore misses that actually landed
  // on a marker; the marker's own onClick already handled them.
  const handleUnfocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.planet-marker, .ship-marker')) return
    selectInView(null)
  }

  const handleDetailedView = () => {
    if (!selectedName) return
    setFlyingToName(selectedName)
  }

  // Right-clicking a body orders the currently-selected ship (if any) to go
  // orbit it — reaction drive or warp, whichever the ship has (hyperdrive
  // doesn't apply within a system, see shipPhysics.planMove).
  const handleOrderToBody = (bodyName: string) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    const result = planMove(ship, { kind: 'body', systemId: SOL_SYSTEM_ID, bodyName }, useGameTimeStore.getState().simDays)
    if (result.kind === 'order') setShipOrder(ship.id, result.order, result.warpReadyOverride)
    // Pinned in a firefight: the destination becomes an FTL escape charge
    // instead of a move order (see planMove's 'engaged' result).
    else if (result.kind === 'engaged' && result.charge) setFtlCharge(ship.id, result.charge)
  }

  const handleOrderToPoint = (point: [number, number, number]) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    const result = planMove(ship, { kind: 'point', systemId: SOL_SYSTEM_ID, position: point }, useGameTimeStore.getState().simDays)
    if (result.kind === 'order') setShipOrder(ship.id, result.order, result.warpReadyOverride)
    // Pinned in a firefight: the destination becomes an FTL escape charge
    // instead of a move order (see planMove's 'engaged' result).
    else if (result.kind === 'engaged' && result.charge) setFtlCharge(ship.id, result.charge)
  }

  // Right-clicking another ship while one is selected orders the selected
  // ship to follow it, instead of a normal move order — see
  // ShipInstance.followingShipId.
  const handleFollowShip = (targetShipId: string) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship || !canFollow(ship, targetShipId)) return
    setFollowing(ship.id, targetShipId)
  }

  return (
    <div className="solar-system-wrapper">
      <Canvas
        camera={{ position: initialCameraPosition, fov: 50, near: 0.02, far: 40000 }}
        onPointerMissed={handleUnfocus}
      >
        <color attach="background" args={['#020409']} />
        <ambientLight intensity={0.15} />
        <Stars radius={40000} depth={8000} count={6000} factor={4} fade speed={0.3} />

        <DeepSpaceClickPlane onDeselect={() => selectInView(null)} onOrderTo={handleOrderToPoint} />

        <Sun selected={selectedName === SOL_NAME} onSelect={() => handleSelect(SOL_NAME)} onOrderTo={() => handleOrderToBody(SOL_NAME)} />
        {PLANETS.map((planet) => (
          <Planet
            key={planet.name}
            data={planet}
            selected={selectedName === planet.name}
            onSelect={handleSelect}
            onOrderTo={handleOrderToBody}
          />
        ))}

        {shipOrbitRings.map((g) => (
          <ShipOrbitRing
            key={`${g.bodyName}::${g.inclinationDeg}`}
            radius={SYSTEM_SHIP_ORBIT_RADIUS}
            inclinationDeg={g.inclinationDeg}
            getCenterPosition={(simDays) => bodyLivePosition(g.bodyName, simDays)}
          />
        ))}

        {systemShips.map((ship) => (
          <ShipMarker
            key={ship.id}
            ship={ship}
            onOrderFollow={handleFollowShip}
            stackIndex={shipStackInfo.get(ship.id)?.index ?? 0}
            stackCount={shipStackInfo.get(ship.id)?.count ?? 1}
          />
        ))}

        {/* Committed orders for the player's own and allied ships only —
            same information-hiding rule as combat's route lines (see
            CombatViewScene): hostiles still travel exactly as before, this
            just doesn't hand the player a readout of where they're headed. */}
        {systemShips
          .filter((ship) => ship.order && (ship.allegiance === 'player' || ship.allegiance === 'friendly'))
          .map((ship) => (
            <NavigationLine key={`nav-${ship.id}`} ship={ship} color={ALLEGIANCE_COLORS[ship.allegiance]} arrowLength={NAV_ARROW_LENGTH} />
          ))}

        {flyingToName && (
          <CameraFocusRig
            key={flyingToName}
            controlsRef={controlsRef}
            arriveDistance={FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() =>
              flyingPlanetData
                ? getPlanetPosition(flyingPlanetData, simDaysToYears(useGameTimeStore.getState().simDays))
                : ORIGIN
            }
            onArrive={() => enterSatellite(flyingToName)}
          />
        )}

        {/* "Go To" — a one-time fly to the selected ship's live position,
            independent of lockOnEnabled. */}
        {flyingToShip && trackedShip && (
          <CameraFocusRig
            key={trackedShip.id}
            controlsRef={controlsRef}
            arriveDistance={SHIP_FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() => getShipRenderPosition(trackedShip, useGameTimeStore.getState().simDays).position}
            onArrive={() => setFlyingToShip(false)}
          />
        )}

        {/* Always tracking, not just while something's selected — falls back
            to Sol (ORIGIN) so deselecting eases the camera back to the
            system's main body instead of leaving it wherever it last
            pointed. That fallback stays active regardless of lockOnEnabled
            (it's navigation plumbing, not "following a selection" — see
            viewStore.lockOnEnabled) — only the "chase whatever's actually
            selected" branch is gated on it, same as a planet or a ship. */}
        {!flyingToName && !flyingToShip && (
          <SelectionTracker
            controlsRef={controlsRef}
            getPosition={() => {
              if (lockOnEnabled) {
                if (trackedShip) return getShipRenderPosition(trackedShip, useGameTimeStore.getState().simDays).position
                if (selectedPlanetData) return getPlanetPosition(selectedPlanetData, simDaysToYears(useGameTimeStore.getState().simDays))
              }
              return ORIGIN
            }}
          />
        )}

        {!flyingToName && !flyingToShip && (
          <DistanceThresholdWatcher
            mode="max"
            threshold={EXIT_DISTANCE}
            onTrigger={enterInterstellar}
            controlsRef={controlsRef}
          />
        )}

        {/* Gated on lockOnEnabled too — this measures distance from the
            tracked target, which only actually sits near the selected body
            while lock-on is engaging it above; with lock-on off the target
            stays parked at Sol, so this would otherwise misfire off zooming
            into Sol instead of the actually-selected planet. Also gated on
            !selectedShipId — a real bug: selecting a ship doesn't clear
            selectedName (body selection is deliberately independent, see
            handleSelect vs. a ship marker's own onClick), so a stale body
            selection from *before* the ship was selected could still be
            sitting here. Without this guard, a "Go To" fly-in to a ship
            resting near that stale body — Sol, say — would leave the camera
            within ENTER_SATELLITE_DISTANCE the instant flyingToShip clears,
            immediately (and wrongly) entering that stale body's satellite
            view right after the flight, with no zoom-in gesture from the
            player at all. */}
        {selectedName && !selectedShipId && !flyingToName && !flyingToShip && lockOnEnabled && (
          <DistanceThresholdWatcher
            mode="min"
            threshold={ENTER_SATELLITE_DISTANCE}
            onTrigger={() => enterSatellite(selectedName)}
            controlsRef={controlsRef}
          />
        )}

        <OrbitControls
          ref={controlsRef}
          enabled={!flyingToName && !flyingToShip}
          enablePan
          enableDamping
          dampingFactor={0.08}
          minDistance={0.2}
          maxDistance={MAX_DISTANCE}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />
      </Canvas>

      {selectedShipId ? (
        <ShipPanel onGoTo={trackedShip ? () => setFlyingToShip(true) : undefined} goToPending={flyingToShip} />
      ) : (
        selectedBody && (
          <InspectPanel
            body={selectedBody}
            onClose={() => selectInView(null)}
            action={{
              label: 'Detailed View',
              pendingLabel: 'Entering orbit…',
              pending: !!flyingToName,
              onClick: handleDetailedView,
            }}
          />
        )
      )}
    </div>
  )
}
