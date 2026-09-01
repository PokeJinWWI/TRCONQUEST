import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { HologramBody } from './HologramBody'
import { FocusableMarker } from './FocusableMarker'
import { Moon } from './Moon'
import { MoonDetailScene } from './MoonDetailScene'
import { SatelliteShipMarker } from './SatelliteShipMarker'
import { ShipPanel } from './ShipPanel'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { getMoonPosition } from './orbitMath'
import { getPlanetsForStar, SUN_RADIUS_KM, UNITS_PER_AU, satelliteVisualRadius } from './planetData'
import { getMoonsForPlanet } from './moonData'
import type { MoonData } from './moonData'
import type { InspectableBody } from './inspectableBody'
import { OrbitRing } from './OrbitRing'
import { getSystemStars } from '../data/starData'
import { planMove, satelliteOrbitLocalPosition, canFollow, oppositeMoonSyncOrbit } from './shipPhysics'
import { useGameTimeStore, simDaysToYears } from '../state/gameTimeStore'
import { useViewStore } from '../state/viewStore'
import { useShipStore } from '../state/shipStore'
import { InspectPanel } from '../components/InspectPanel'

interface SatelliteViewSceneProps {
  bodyName: string
}

// Real-radius fallback for the pathological case where a body name resolves
// to neither the star nor a known planet — shouldn't happen, matches the
// same defensive fallback combatArena.arenaBodyRadius uses.
const EARTH_RADIUS_KM_FALLBACK = 6371
// Tuned so the body has visibly shrunk to a small, distant shape before
// handing back to system view — matches the "shrink to a dot" treatment
// used for the other view-level transitions.
const MAX_DISTANCE = 160
const EXIT_DISTANCE = 130
// Moons are tiny relative to the primary body's visual scale, so a much
// tighter arrive distance than the system view's planet fly-in reads right.
const MOON_FOCUS_ARRIVE_DISTANCE = 1
// How close (to a locked-on moon) manually zooming in has to get before it
// counts as "entering" that moon's detail view — same idea as system view's
// manual zoom-to-enter-satellite, just an additional path alongside the
// explicit "Detailed View" button. Must clear OrbitControls' minDistance
// (primaryVisualRadius + 1, ~4 for Earth) so it's actually reachable by scrolling in.
const ENTER_MOON_DISTANCE = 4.5
// How close the "Go To" fly-in to a selected ship needs to get before it
// counts as arrived — ships are small, similar scale to moons.
const SHIP_FOCUS_ARRIVE_DISTANCE = 0.8
const SOL_COLOR = '#ffd27a'
const SOL_NAME = 'Sol'
// The primary body always sits at the origin in this view — the pan-back
// target once no moon is selected (deselecting, or clicking the primary
// body's own marker/hologram after having a moon focused).
const ORIGIN = new Vector3(0, 0, 0)

export function SatelliteViewScene({ bodyName }: SatelliteViewSceneProps) {
  const exitSatelliteToSystem = useViewStore((s) => s.exitSatelliteToSystem)
  const inViewSelection = useViewStore((s) => s.inViewSelection)
  const selectInView = useViewStore((s) => s.selectInView)
  const lockOnEnabled = useViewStore((s) => s.lockOnEnabled)
  const selectedStarId = useViewStore((s) => s.selectedStarId)
  // The component star this satellite view is showing, if the body is one of
  // the system's stars (Sol, or Rigil Kentaurus / Sirius A / ... in a
  // multi-star system). getSystemStars covers single- and multi-star systems.
  const currentStar = useMemo(
    () => getSystemStars(selectedStarId).find((c) => c.name === bodyName),
    [selectedStarId, bodyName],
  )
  const PLANETS = useMemo(() => getPlanetsForStar(selectedStarId), [selectedStarId])
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const [flyingToMoon, setFlyingToMoon] = useState<MoonData | null>(null)
  // Set once CameraFocusRig arrives at a moon — swaps this scene over to
  // MoonDetailScene until the player zooms back out.
  const [focusedMoon, setFocusedMoon] = useState<MoonData | null>(null)
  // Set by ShipPanel's "Go To" button — a one-time fly-to, independent of
  // lockOnEnabled (which only governs *continuous* follow via
  // SelectionTracker below). Useful even when lock-on is off, or just to
  // recenter after panning away.
  const [flyingToShip, setFlyingToShip] = useState(false)

  const ships = useShipStore((s) => s.ships)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const setShipOrder = useShipStore((s) => s.setShipOrder)
  const setFtlCharge = useShipStore((s) => s.setFtlCharge)
  const setFollowing = useShipStore((s) => s.setFollowing)
  // Ships resting in orbit around this exact body — the "correct
  // corresponding view" a move order here should actually be visible in, not
  // just an abstract system-AU point only system view could ever render. A
  // ship still mid-order (even one destined here) isn't resting yet, so it
  // doesn't show until it actually arrives.
  const orbitingShips = useMemo(
    () =>
      ships.filter(
        (ship) =>
          !ship.order &&
          ship.location.kind === 'orbiting' &&
          ship.location.systemId === selectedStarId &&
          ship.location.bodyName === bodyName,
      ),
    [ships, bodyName, selectedStarId],
  )
  // Only track a selected ship for the camera lock while it's actually
  // rendered here (an orbitingShips member) — same "focusing logic like a
  // moon/the primary body" idea as the other scenes.
  const trackedShip = useMemo(
    () => (selectedShipId ? orbitingShips.find((s) => s.id === selectedShipId) ?? null : null),
    [selectedShipId, orbitingShips],
  )
  // orbitingShips is already filtered to location.kind === 'orbiting', but
  // TypeScript can't see that through .find() — narrow it once here instead
  // of re-checking at every call site below.
  const trackedShipLocation = trackedShip && trackedShip.location.kind === 'orbiting' ? trackedShip.location : null
  // Every ship here already shares one body by construction (see
  // orbitingShips above) — stacking just needs each one's position within
  // this same array (see ShipMarker's identical system-view version, which
  // needs the extra per-body grouping this view doesn't).
  const shipStackInfo = useMemo(() => {
    const info = new Map<string, { index: number; count: number }>()
    orbitingShips.forEach((ship, index) => info.set(ship.id, { index, count: orbitingShips.length }))
    return info
  }, [orbitingShips])
  // One ring per distinct inclination present (almost always just one, 0° —
  // see ShipMarker's system-view version for why rings are deduped instead
  // of one-per-ship: everyone at the same inclination traces the same
  // circle).
  const shipOrbitInclinations = useMemo(() => {
    const set = new Set<number>()
    for (const ship of orbitingShips) if (ship.location.kind === 'orbiting') set.add(ship.location.inclinationDeg)
    return Array.from(set)
  }, [orbitingShips])

  // If the Outliner (or anything else driving inViewSelection) points
  // somewhere other than the moon currently focused — e.g. the player is
  // inside Luna's MoonDetailScene and clicks "Earth" — pop back out to this
  // scene's own primary view so that selection can actually take effect.
  // A no-op whenever the selection still matches (including re-clicking the
  // same focused moon), so it doesn't fight the zoom-in transition either.
  useEffect(() => {
    if (focusedMoon && inViewSelection !== focusedMoon.name) setFocusedMoon(null)
  }, [inViewSelection, focusedMoon])

  const isStar = !!currentStar
  const planetData = useMemo(() => (!isStar ? PLANETS.find((p) => p.name === bodyName) : undefined), [bodyName, isStar, PLANETS])
  const color = isStar ? currentStar?.color ?? SOL_COLOR : planetData?.color ?? '#ffffff'
  // Real body radius, compressed but no longer flattened to one constant —
  // see satelliteVisualRadius: Sol and Earth used to render at the exact
  // same size purely because nothing compared them.
  const primaryVisualRadius = useMemo(
    () => satelliteVisualRadius(isStar ? currentStar?.radiusKm ?? SUN_RADIUS_KM : planetData?.radiusKm ?? EARTH_RADIUS_KM_FALLBACK),
    [isStar, planetData, currentStar],
  )
  const orbitAU = planetData ? planetData.orbitRadius / UNITS_PER_AU : undefined
  const moonInfo = useMemo(() => (!isStar ? getMoonsForPlanet(bodyName) : { totalCount: 0, moons: [] }), [bodyName, isStar])

  const primaryBody: InspectableBody = useMemo(() => {
    if (isStar) {
      return { name: currentStar?.name ?? SOL_NAME, kind: 'star', color, radiusKm: currentStar?.radiusKm ?? SUN_RADIUS_KM }
    }
    return {
      name: planetData?.name ?? bodyName,
      kind: 'planet',
      color,
      radiusKm: planetData?.radiusKm ?? 0,
      orbitAU,
      orbitPeriodYears: planetData?.orbitPeriodYears,
      moonCount: moonInfo.totalCount,
      planetClass: planetData?.planetClass,
    }
  }, [isStar, planetData, color, orbitAU, moonInfo, bodyName, currentStar])

  // The moon currently selected, if any — derived from viewStore's
  // inViewSelection so the Outliner can drive it exactly like clicking the
  // moon's own marker/hologram would (see InterstellarScene/SolarSystemScene
  // for the same pattern).
  const selectedMoon = useMemo(
    () => moonInfo.moons.find((m) => m.name === inViewSelection) ?? null,
    [inViewSelection, moonInfo],
  )
  // What the inspect window shows — either the selected moon or, when the
  // selection points at this view's own subject, the primary body itself.
  const inspected: InspectableBody | null = useMemo(() => {
    if (selectedMoon) {
      return {
        name: selectedMoon.name,
        kind: 'moon',
        color: selectedMoon.color,
        radiusKm: selectedMoon.radiusKm,
        orbitPeriodDays: selectedMoon.periodDays,
        orbitAU,
      }
    }
    return inViewSelection === primaryBody.name ? primaryBody : null
  }, [selectedMoon, inViewSelection, primaryBody, orbitAU])

  const handleSelectMoon = (moon: MoonData) => {
    selectShip(null)
    selectInView(moon.name)
  }
  const handleSelectPrimary = () => {
    selectShip(null)
    selectInView(primaryBody.name)
  }

  // Right-clicking the primary body orders the currently-selected ship (if
  // any) to go orbit it — the same order system view's own right-click on
  // this exact body already issues (this scene's `bodyName` prop is that
  // body's name), previously not wired up at all here. Doesn't apply to
  // moons (isStar's the star case; moons have no onOrderTo handler on their
  // own marker) since a moon isn't a valid move-order target yet.
  const handleOrderToPrimary = () => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    const result = planMove(ship, { kind: 'body', systemId: selectedStarId, bodyName }, useGameTimeStore.getState().simDays)
    if (result.kind === 'order') setShipOrder(ship.id, result.order, result.warpReadyOverride)
    // Pinned in a firefight: the destination becomes an FTL escape charge
    // instead of a move order (see planMove's 'engaged' result).
    else if (result.kind === 'engaged' && result.charge) setFtlCharge(ship.id, result.charge)
  }

  // Right-clicking a moon orders the currently-selected ship into orbit
  // around *this scene's own primary body* — not the moon itself, a moon
  // still isn't a valid destination on its own — but synced to match that
  // moon's exact period/phase/inclination, offset 180° (see
  // shipPhysics.oppositeMoonSyncOrbit). Matching period is what makes
  // "opposite" hold forever rather than just at the moment of arrival: a
  // ship on its own default (much faster, unrelated) orbit would drift in
  // and out of alignment with the moon continuously.
  const handleOrderToMoonOrbit = (moon: MoonData) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    const result = planMove(
      ship,
      { kind: 'body', systemId: selectedStarId, bodyName, syncOrbit: oppositeMoonSyncOrbit(moon) },
      useGameTimeStore.getState().simDays,
    )
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

  // Same onPointerMissed/marker-click race as every other view — ignore
  // misses that actually landed on a marker, the prominent focused label, or
  // a ship marker.
  const handleUnfocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.planet-marker, .focused-label, .ship-marker')) return
    selectInView(null)
  }

  const handleDetailedView = () => {
    if (selectedMoon) setFlyingToMoon(selectedMoon)
  }

  if (focusedMoon) {
    return (
      <div key={`moon:${focusedMoon.name}`} className="view-transition">
        <MoonDetailScene moon={focusedMoon} parentOrbitAU={orbitAU} onExit={() => setFocusedMoon(null)} />
      </div>
    )
  }

  return (
    <div key="primary" className="view-transition">
      <div className="satellite-view-wrapper">
        {/* Deliberately a FIXED camera position — not scaled to each body's
            own radius the way minDistance below is. Sol and Earth are now
            genuinely different sizes (satelliteVisualRadius), and that's the
            whole point: a camera that re-framed proportionally per body would
            make every body fill the same fraction of the screen regardless
            of its real size, which would hide the exact difference this was
            built to show. Sized against the largest clamped body
            (SATELLITE_MAX_VISUAL_RADIUS = 9, i.e. Sol) so nothing ever opens
            cropped; smaller bodies correspondingly — and visibly — read as
            smaller within that same fixed frame. Same direction ratio the
            single old constant [0, 2, 9] used, just scaled up (2, 9 -> 6, 27)
            so a radius-9 body gets the same quality of framing the old
            radius-3 constant gave a radius-3 body. */}
        <Canvas camera={{ position: [0, 6, 27], fov: 50, near: 0.05, far: 2000 }} onPointerMissed={handleUnfocus}>
          <color attach="background" args={['#020409']} />
          <ambientLight intensity={0.25} />
          {!isStar && <directionalLight position={[8, 4, 6]} intensity={2.2} color="#fff4d6" />}
          <Stars radius={300} depth={80} count={3000} factor={2} fade speed={0.2} />

          <HologramBody
            color={color}
            radius={primaryVisualRadius}
            variant={isStar ? 'star' : 'planet'}
            onSelect={handleSelectPrimary}
            onOrderTo={handleOrderToPrimary}
          />
          <FocusableMarker
            name={primaryBody.name}
            radius={primaryVisualRadius}
            onSelect={handleSelectPrimary}
            onOrderTo={handleOrderToPrimary}
          />

          {moonInfo.moons.map((moon) => (
            <Moon
              key={moon.name}
              moon={moon}
              selected={inspected?.name === moon.name}
              onSelect={handleSelectMoon}
              onOrderTo={handleOrderToMoonOrbit}
            />
          ))}

          {shipOrbitInclinations.map((incl) => (
            <OrbitRing key={incl} radius={primaryVisualRadius + 1.2} inclinationDeg={incl} />
          ))}

          {orbitingShips.map((ship, index) => (
            <SatelliteShipMarker
              key={ship.id}
              ship={ship}
              primaryVisualRadius={primaryVisualRadius}
              onOrderFollow={handleFollowShip}
              stackIndex={shipStackInfo.get(ship.id)?.index ?? index}
              stackCount={orbitingShips.length}
            />
          ))}

          {flyingToMoon && (
            <CameraFocusRig
              key={flyingToMoon.name}
              controlsRef={controlsRef}
              arriveDistance={MOON_FOCUS_ARRIVE_DISTANCE}
              getTargetPosition={() => getMoonPosition(flyingToMoon, simDaysToYears(useGameTimeStore.getState().simDays))}
              onArrive={() => {
                setFocusedMoon(flyingToMoon)
                setFlyingToMoon(null)
              }}
            />
          )}

          {/* "Go To" — a one-time fly to the selected ship's live (orbiting)
              position, independent of lockOnEnabled. */}
          {flyingToShip && trackedShip && trackedShipLocation && (
            <CameraFocusRig
              key={trackedShip.id}
              controlsRef={controlsRef}
              arriveDistance={SHIP_FOCUS_ARRIVE_DISTANCE}
              getTargetPosition={() =>
                new Vector3(
                  ...satelliteOrbitLocalPosition(
                    trackedShipLocation,
                    primaryVisualRadius,
                    useGameTimeStore.getState().simDays,
                  ),
                )
              }
              onArrive={() => setFlyingToShip(false)}
            />
          )}

          {/* Always tracking, not just while a moon's selected — falls back
              to the primary body (ORIGIN) so deselecting, or clicking the
              primary body itself after a moon was focused, eases the camera
              back to it instead of leaving it wherever it last pointed. That
              fallback stays active regardless of lockOnEnabled (navigation
              plumbing, not "following a selection") — only the "chase
              whatever's actually selected" branch is gated on it. */}
          {!flyingToMoon && !flyingToShip && (
            <SelectionTracker
              controlsRef={controlsRef}
              getPosition={() => {
                if (lockOnEnabled) {
                  if (trackedShipLocation)
                    return new Vector3(
                      ...satelliteOrbitLocalPosition(trackedShipLocation, primaryVisualRadius, useGameTimeStore.getState().simDays),
                    )
                  if (selectedMoon) return getMoonPosition(selectedMoon, simDaysToYears(useGameTimeStore.getState().simDays))
                }
                return ORIGIN
              }}
            />
          )}

          {/* Gated on lockOnEnabled too — this measures distance from the
              tracked target, which only actually sits near the selected moon
              while lock-on is engaging it above; with lock-on off the target
              stays parked at the primary body, so this would otherwise
              misfire off zooming into the primary body instead. Also gated
              on !selectedShipId — see SolarSystemScene's identical guard for
              the bug this prevents: selecting a ship doesn't clear a stale
              selectedMoon, so a "Go To" fly-in to a ship could otherwise
              auto-trigger entering that stale moon's detail view right after
              the flight, with no zoom gesture from the player. */}
          {selectedMoon && !selectedShipId && !flyingToMoon && !flyingToShip && lockOnEnabled && (
            <DistanceThresholdWatcher
              mode="min"
              threshold={ENTER_MOON_DISTANCE}
              onTrigger={() => setFlyingToMoon(selectedMoon)}
              controlsRef={controlsRef}
            />
          )}

          {!flyingToMoon && !flyingToShip && (
            <DistanceThresholdWatcher
              mode="max"
              threshold={EXIT_DISTANCE}
              onTrigger={exitSatelliteToSystem}
              controlsRef={controlsRef}
            />
          )}

          <OrbitControls
            ref={controlsRef}
            enabled={!flyingToMoon && !flyingToShip}
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            minDistance={primaryVisualRadius + 1}
            maxDistance={MAX_DISTANCE}
          />
        </Canvas>

        {selectedShipId ? (
          <ShipPanel onGoTo={trackedShip ? () => setFlyingToShip(true) : undefined} goToPending={flyingToShip} />
        ) : (
          inspected && (
            <InspectPanel
              body={inspected}
              onClose={() => selectInView(null)}
              action={
                selectedMoon
                  ? {
                      label: 'Detailed View',
                      pendingLabel: 'Entering orbit…',
                      pending: !!flyingToMoon,
                      onClick: handleDetailedView,
                    }
                  : undefined
              }
            />
          )
        )}
      </div>
    </div>
  )
}
