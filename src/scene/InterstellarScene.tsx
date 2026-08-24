import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { StarData } from '../data/starData'
import { STARS, starScenePosition } from '../data/starData'
import { useViewStore } from '../state/viewStore'
import type { ShipInstance } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { useHyperlaneStore, laneEndpoints } from '../state/hyperlaneStore'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { DeepSpaceClickPlane } from './DeepSpaceClickPlane'
import { HyperlaneLine } from './HyperlaneLine'
import { ShipMarker } from './ShipMarker'
import { NavigationLine } from './NavigationLine'
import { ShipPanel } from './ShipPanel'
import { getShipRenderPosition, planMove, shipSystemId, canFollow } from './shipPhysics'
import { useGameTimeStore } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'
import { DraggableWindow } from '../components/DraggableWindow'
import { ALLEGIANCE_COLORS } from '../data/shipData'

const ENTER_DISTANCE = 6
const MAX_DISTANCE = 4200
const EXIT_DISTANCE = 3500
const FOCUS_ARRIVE_DISTANCE = 4
// How close (to the locked-on star) manually zooming in has to get before it
// counts as "entering" its system — mirrors system view's manual
// zoom-to-enter-satellite threshold, same select-first model.
const ENTER_SYSTEM_DISTANCE = 4.5
// How close the "Go To" fly-in to a selected ship needs to get before it
// counts as arrived.
const SHIP_FOCUS_ARRIVE_DISTANCE = 3
// How far a route line's arrowhead reaches back from its destination, in
// this view's own units — interstellar hops span a much wider range than a
// system-view leg (ENTER_DISTANCE=6 up to MAX_DISTANCE=4200), so this picks
// its own constant rather than sharing SolarSystemScene's.
const NAV_ARROW_LENGTH = 12

interface StarNodeProps {
  star: StarData
  selected: boolean
  onSelect: (star: StarData) => void
  /** Right-click — orders the currently-selected ship (if any) here. */
  onOrderTo: (star: StarData) => void
  /** One representative ship per distinct allegiance color currently nested
   * somewhere inside this star's system (e.g. orbiting a planet) — those
   * ships have no position at interstellar scale, so this is the only trace
   * of them here. Deliberately icon-only, no name/count text, but still
   * clicking-to-select the ship it represents (see onSelectFleet) — if
   * several ships share a color, clicking selects whichever one was found
   * first, same simplification the badge's own dedupe-by-color already
   * makes. */
  fleetPresence: ShipInstance[]
  onSelectFleet: (shipId: string) => void
}

// Stars are just labels here, same as planets in system view — no 3D sphere
// model, just a fixed-size marker anchored at the star's true position.
function StarNode({ star, selected, onSelect, onOrderTo, fleetPresence, onSelectFleet }: StarNodeProps) {
  const [hovered, setHovered] = useState(false)
  const pos = starScenePosition(star)

  return (
    <group position={pos}>
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
        <div
          className={`planet-marker star-node${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={() => onSelect(star)}
          onContextMenu={(e) => {
            e.preventDefault()
            onOrderTo(star)
          }}
          onWheel={forwardWheelToCanvas}
        >
          <span className="marker-dot" style={{ borderColor: star.color }} />
          <span className="marker-label">{star.name}</span>
          {fleetPresence.map((ship) => (
            <span
              key={ship.id}
              className="fleet-presence-icon"
              style={{ borderBottomColor: ALLEGIANCE_COLORS[ship.allegiance] }}
              onClick={(e) => {
                // Otherwise this bubbles to the marker's own onClick above,
                // selecting the star instead of (or as well as) the fleet.
                e.stopPropagation()
                onSelectFleet(ship.id)
              }}
            />
          ))}
        </div>
      </Html>
    </group>
  )
}

// Only ships whose order/location currently puts them in interstellar space
// belong here — see shipPhysics.ts and Context.md for why this membership
// check doesn't need to poll every frame (it only changes at order-issue/
// order-complete, both discrete store writes).
function isShipInInterstellarSpace(order: { space: 'system' | 'interstellar' } | null, locationKind: string): boolean {
  if (order) return order.space === 'interstellar'
  return locationKind === 'star' || locationKind === 'interstellar-point'
}

export function InterstellarScene() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const enterSystem = useViewStore((s) => s.enterSystem)
  const enterGalactic = useViewStore((s) => s.enterGalactic)
  const selectedId = useViewStore((s) => s.inViewSelection)
  const selectInView = useViewStore((s) => s.selectInView)
  const lockOnEnabled = useViewStore((s) => s.lockOnEnabled)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // Set by ShipPanel's "Go To" button — separate from focusedId since,
  // unlike flying to a star, arriving doesn't transition to system view.
  // Independent of lockOnEnabled (a one-time fly, not continuous follow).
  const [flyingToShip, setFlyingToShip] = useState(false)
  const selectedStar = useMemo(() => STARS.find((s) => s.id === selectedId) ?? null, [selectedId])
  const focusedStar = useMemo(() => STARS.find((s) => s.id === focusedId) ?? null, [focusedId])

  const ships = useShipStore((s) => s.ships)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const setShipOrder = useShipStore((s) => s.setShipOrder)
  const setFtlCharge = useShipStore((s) => s.setFtlCharge)
  const setShipLocation = useShipStore((s) => s.setShipLocation)
  const setPendingHyperdriveJump = useShipStore((s) => s.setPendingHyperdriveJump)
  const setFollowing = useShipStore((s) => s.setFollowing)
  const removeShip = useShipStore((s) => s.removeShip)
  const lanes = useHyperlaneStore((s) => s.lanes)
  const addHyperlane = useHyperlaneStore((s) => s.addHyperlane)
  const interstellarShips = useMemo(
    () => ships.filter((ship) => isShipInInterstellarSpace(ship.order, ship.location.kind)),
    [ships],
  )
  // Only track a selected ship for the camera lock while it's actually
  // present in interstellar space — same "focusing logic like a star" idea,
  // but a star is always here to lock onto while a ship might currently be
  // nested inside a system instead (see fleetPresenceByStar below).
  const trackedShip = useMemo(
    () => (selectedShipId ? interstellarShips.find((s) => s.id === selectedShipId) ?? null : null),
    [selectedShipId, interstellarShips],
  )
  // One representative ship per distinct allegiance present in each star's
  // system, for the no-text presence badges — the complementary set to
  // interstellarShips above (a ship is either out in interstellar space,
  // rendered directly, or nested inside exactly one system, rendered only as
  // a badge here).
  const fleetPresenceByStar = useMemo(() => {
    const map = new Map<string, ShipInstance[]>()
    for (const ship of ships) {
      const systemId = shipSystemId(ship)
      if (!systemId) continue
      const existing = map.get(systemId)
      if (existing) {
        if (!existing.some((s) => s.allegiance === ship.allegiance)) existing.push(ship)
      } else {
        map.set(systemId, [ship])
      }
    }
    return map
  }, [ships])

  // Select-first, same as system view: clicking a star just locks the
  // camera onto it (SelectionTracker, smooth eased pan) — flying all the way
  // in (CameraFocusRig) only starts once "Enter System" is pressed, or the
  // player manually zooms in close enough on their own.
  const handleSelect = (star: StarData) => {
    selectInView(star.id)
    selectShip(null)
  }

  const handleEnterSystem = () => {
    if (selectedStar?.hasSystemData) setFocusedId(selectedStar.id)
  }

  // Right-clicking a star orders the selected ship there (warp/hyperdrive,
  // whichever the ship has) — no-op if no ship is selected. A hyperdrive
  // still on cooldown, or the game being paused, doesn't just drop the order
  // — "jump when ready" queues it to fire automatically once the drive is
  // off cooldown *and* time is unpaused (see useShipOrderSettler), rather
  // than silently doing nothing. A hyperdrive
  // jump that actually fires carries real risk (see planMove/
  // hyperdriveLossChance) — 'lost-in-hyperspace' means the ship is simply
  // gone, deselected if it was selected (its ShipPanel closes on its own
  // once the ship no longer exists); a successful jump instead records the
  // hyperlane it just charted (hyperlaneEstablished), same "physics layer
  // computes it, caller applies it" split every other MoveResult already
  // follows.
  const handleOrderToStar = (star: StarData) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    const result = planMove(ship, { kind: 'star', starId: star.id }, useGameTimeStore.getState().simDays)
    if (result.kind === 'order') setShipOrder(ship.id, result.order, result.warpReadyOverride)
    else if (result.kind === 'instant') {
      setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays })
      if (result.hyperlaneEstablished) addHyperlane(...result.hyperlaneEstablished)
    } else if (result.kind === 'on-cooldown' || result.kind === 'paused') setPendingHyperdriveJump(ship.id, star.id)
    else if (result.kind === 'lost-in-hyperspace') removeShip(ship.id)
    // Pinned in a firefight: the jump becomes an FTL escape charge instead of
    // firing immediately (see planMove's 'engaged' result).
    else if (result.kind === 'engaged' && result.charge) setFtlCharge(ship.id, result.charge)
    // 'unknown-class'/'not-owned': silently ignored — genuinely nothing to do.
  }

  const handleOrderToPoint = (point: [number, number, number]) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    const result = planMove(ship, { kind: 'interstellar-point', position: point }, useGameTimeStore.getState().simDays)
    if (result.kind === 'order') setShipOrder(ship.id, result.order, result.warpReadyOverride)
    // Pinned in a firefight: the destination becomes an FTL escape charge
    // instead of a move order (see planMove's 'engaged' result).
    else if (result.kind === 'engaged' && result.charge) setFtlCharge(ship.id, result.charge)
  }

  // Right-clicking another ship while one is selected orders the selected
  // ship to follow it, instead of a normal move order — see
  // ShipInstance.followingShipId. Selection itself never changes (matches
  // every other right-click-to-order in this project: it commands whatever
  // was already selected, it doesn't reselect).
  const handleFollowShip = (targetShipId: string) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship || !canFollow(ship, targetShipId)) return
    setFollowing(ship.id, targetShipId)
  }

  // Same race as system view: r3f's onPointerMissed fires for any click that
  // doesn't raycast-hit a 3D object, including clicks on our HTML star
  // markers (they share the canvas's event container). Ignore misses that
  // actually landed on a marker so its own onClick isn't immediately undone.
  const handleUnfocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.planet-marker, .ship-marker')) return
    selectInView(null)
  }

  return (
    <div className="interstellar-wrapper">
      <Canvas camera={{ position: [20, 30, 55], fov: 50, near: 0.05, far: 5000 }} onPointerMissed={handleUnfocus}>
        <color attach="background" args={['#020409']} />
        <ambientLight intensity={0.3} />
        <Stars radius={800} depth={200} count={5000} factor={3} fade speed={0.2} />

        <DeepSpaceClickPlane onDeselect={() => selectInView(null)} onOrderTo={handleOrderToPoint} />

        {/* Charted hyperlanes — established automatically the first time a
            hyperdrive jump between two stars succeeds (see planMove/
            hyperdriveLossChance), not drawn by the player. A separate,
            future "plot a route" feature may let the player draw their own
            lines here too; this is unrelated to that. */}
        {lanes.map((key) => {
          const [aId, bId] = laneEndpoints(key)
          const a = STARS.find((s) => s.id === aId)
          const b = STARS.find((s) => s.id === bId)
          if (!a || !b) return null
          return <HyperlaneLine key={key} from={starScenePosition(a)} to={starScenePosition(b)} />
        })}

        {STARS.map((star) => (
          <StarNode
            key={star.id}
            star={star}
            selected={star.id === selectedId}
            onSelect={handleSelect}
            onOrderTo={handleOrderToStar}
            fleetPresence={fleetPresenceByStar.get(star.id) ?? []}
            onSelectFleet={selectShip}
          />
        ))}

        {interstellarShips.map((ship) => (
          <ShipMarker key={ship.id} ship={ship} onOrderFollow={handleFollowShip} />
        ))}

        {/* Committed orders for the player's own and allied ships only —
            same information-hiding rule as combat's route lines (see
            CombatViewScene): hostiles still travel exactly as before, this
            just doesn't hand the player a readout of where they're headed. */}
        {interstellarShips
          .filter((ship) => ship.order && (ship.allegiance === 'player' || ship.allegiance === 'friendly'))
          .map((ship) => (
            <NavigationLine key={`nav-${ship.id}`} ship={ship} color={ALLEGIANCE_COLORS[ship.allegiance]} arrowLength={NAV_ARROW_LENGTH} />
          ))}

        {focusedStar && (
          <CameraFocusRig
            key={focusedStar.id}
            controlsRef={controlsRef}
            arriveDistance={FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() => new Vector3(...starScenePosition(focusedStar))}
            onArrive={() => enterSystem(focusedStar.id, focusedStar.name)}
          />
        )}

        {/* "Go To" — a one-time fly to the selected ship's live position,
            independent of lockOnEnabled. Only reachable when the ship is
            actually out in interstellar space (trackedShip) — a ship nested
            inside a system has no interstellar-scale position to fly to. */}
        {flyingToShip && trackedShip && (
          <CameraFocusRig
            key={trackedShip.id}
            controlsRef={controlsRef}
            arriveDistance={SHIP_FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() => getShipRenderPosition(trackedShip, useGameTimeStore.getState().simDays).position}
            onArrive={() => setFlyingToShip(false)}
          />
        )}

        {(selectedStar || trackedShip) && !focusedStar && !flyingToShip && lockOnEnabled && (
          <SelectionTracker
            controlsRef={controlsRef}
            getPosition={() =>
              trackedShip
                ? getShipRenderPosition(trackedShip, useGameTimeStore.getState().simDays).position
                : new Vector3(...starScenePosition(selectedStar!))
            }
          />
        )}

        {/* Gated on lockOnEnabled too — this measures distance from the
            tracked target, which only actually sits near the selected star
            while lock-on is engaging it above; with lock-on off the target
            just stays wherever it last was, so this would otherwise misfire
            off zooming in on whatever the camera happens to be near. Also
            gated on !selectedShipId — see SolarSystemScene's identical guard
            for the bug this prevents: selecting a ship doesn't clear a stale
            selectedStar, so a "Go To" fly-in to a ship resting near that
            stale star could otherwise auto-trigger entering its system right
            after the flight, with no zoom gesture from the player. */}
        {selectedStar?.hasSystemData && !selectedShipId && !focusedStar && !flyingToShip && lockOnEnabled && (
          <DistanceThresholdWatcher
            mode="min"
            threshold={ENTER_SYSTEM_DISTANCE}
            onTrigger={handleEnterSystem}
            controlsRef={controlsRef}
          />
        )}

        {!focusedStar && !flyingToShip && (
          <>
            <DistanceThresholdWatcher mode="min" threshold={ENTER_DISTANCE} onTrigger={() => enterSystem('sol', 'Sol')} />
            <DistanceThresholdWatcher mode="max" threshold={EXIT_DISTANCE} onTrigger={enterGalactic} controlsRef={controlsRef} />
          </>
        )}

        <OrbitControls
          ref={controlsRef}
          enabled={!focusedStar && !flyingToShip}
          enablePan
          enableDamping
          dampingFactor={0.08}
          minDistance={1}
          maxDistance={MAX_DISTANCE}
        />
      </Canvas>

      {selectedShipId ? (
        <ShipPanel onGoTo={trackedShip ? () => setFlyingToShip(true) : undefined} goToPending={flyingToShip} />
      ) : (
        selectedStar && (
          <DraggableWindow title={selectedStar.name} onClose={() => selectInView(null)}>
            <div className="inspect-row">
              <span className="inspect-label">Distance</span>
              <span className="inspect-value">{selectedStar.distanceLy.toFixed(2)} ly from Sol</span>
            </div>
            <div className="inspect-divider" />
            {selectedStar.hasSystemData ? (
              focusedStar ? (
                <div className="inspect-status ok">Entering system…</div>
              ) : (
                <button type="button" className="detail-view-btn" onClick={handleEnterSystem}>
                  Enter System
                </button>
              )
            ) : (
              <div className="inspect-status">No system data available</div>
            )}
          </DraggableWindow>
        )
      )}
    </div>
  )
}
