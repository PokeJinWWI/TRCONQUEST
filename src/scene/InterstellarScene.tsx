import { BattleBadge } from '../components/BattleBadge'
import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { StarData } from '../data/starData'
import { getStarsForNeighborhood, starScenePosition, STARS } from '../data/starData'
import { useViewStore } from '../state/viewStore'
import type { ShipInstance, MoveDestination } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { useHyperlaneStore, laneEndpoints } from '../state/hyperlaneStore'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { DeepSpaceClickPlane } from './DeepSpaceClickPlane'
import { HyperlaneLine } from './HyperlaneLine'
import { ShipMarker } from './ShipMarker'
import { NavigationLine } from './NavigationLine'
import { PendingOrderLine } from './PendingOrderLine'
import { ShipPanel } from './ShipPanel'
import { shipSystemId, canFollow, clusterRestingShipsByFleet } from './shipPhysics'
import { orderSelectedFleets, playerVisualShipRenderPosition } from './commsVisual'
import { useGameTimeStore } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'
import { DraggableWindow } from '../components/DraggableWindow'
import { RELATION_COLORS, type ShipRelation } from '../data/shipData'
import { relationOfOwner, useRelationKey } from '../state/shipRelations'
import { useTerritoryStore } from '../state/territoryStore'
import { systemClaim, type SystemClaim } from './territory'
import { getCountry } from '../data/countryData'
import { usePlayerStore } from '../state/playerStore'

const ENTER_DISTANCE = 6
const UNCLAIMED: SystemClaim = { kind: 'unclaimed' }
const MAX_DISTANCE = 4200
const EXIT_DISTANCE = 3500
// The plain "just arrived, nothing selected" camera position — used both as
// the far-view starting position AND, translated to sit next to whichever
// star a continuity arrival is returning to (see continuityStarPosition
// below), as the near-view one too. Same offset either way, just anchored at
// a different origin, so a continuity arrival gets exactly the framing a
// fresh one would have if that star were the graph's origin.
const DEFAULT_CAMERA_OFFSET: [number, number, number] = [20, 30, 55]
const FOCUS_ARRIVE_DISTANCE = 4
// How close (to the locked-on star) manually zooming in has to get before it
// counts as "entering" its system — mirrors system view's manual
// zoom-to-enter-satellite threshold, same select-first model.
const ENTER_SYSTEM_DISTANCE = 4.5
// How close the "Go To" fly-in to a selected ship needs to get before it
// counts as arrived.
const SHIP_FOCUS_ARRIVE_DISTANCE = 3
// How big a route line's arrowhead reads on screen, in CSS pixels — see
// SolarSystemScene's identical constant for the full reasoning
// (routeArrow.pixelsToWorldSize). Same value works here too now that it's
// screen-space rather than world-unit — interstellar's much wider range of
// real distances is exactly what this was for.
const NAV_ARROW_LENGTH = 16
// Dash/gap for a comms-delayed command still in transit (see
// PendingOrderLine) — same screen-space units as NAV_ARROW_LENGTH above.
const PENDING_DASH_SIZE = 6
const PENDING_GAP_SIZE = 4

// PendingOrderLine's resolveTarget for THIS view's own frame (interstellar,
// ly-scale scene units, Sol at origin) — a 'star' or 'interstellar-point'
// destination is directly representable here; a same-system 'body'/'point'
// one isn't (this view has no coordinate for anywhere inside a system), but
// that combination can't actually arise from this UI anyway — a ship only
// ever gets a system-local destination while already shown in system view.
function resolveInterstellarDestinationPosition(destination: MoveDestination): Vector3 | null {
  if (destination.kind === 'star') {
    const star = STARS.find((s) => s.id === destination.starId)
    return star ? new Vector3(...starScenePosition(star)) : null
  }
  if (destination.kind === 'interstellar-point') return new Vector3(...destination.position)
  return null
}

interface StarNodeProps {
  star: StarData
  selected: boolean
  onSelect: (star: StarData) => void
  /** Right-click — orders the currently-selected ship (if any) here. */
  onOrderTo: (star: StarData) => void
  /** One representative ship per distinct relation (yours / neutral /
   * hostile) currently nested
   * somewhere inside this star's system (e.g. orbiting a planet) — those
   * ships have no position at interstellar scale, so this is the only trace
   * of them here. Deliberately icon-only, no name/count text, but still
   * clicking-to-select the ship it represents (see onSelectFleet) — if
   * several ships share a color, clicking selects whichever one was found
   * first, same simplification the badge's own dedupe-by-color already
   * makes. */
  fleetPresence: { ship: ShipInstance; relation: ShipRelation }[]
  onSelectFleet: (shipId: string) => void
  /** The whole system's territorial claim (see scene/territory.ts) — drawn
   * as a ring in the owner's color, or a split ring when contested. */
  claim: SystemClaim
}

// The border ring's colors for a claim: one color all the way round for an
// owned system, the claimants' colors split around the ring for a contested
// one (top/right/bottom/left, cycling), nothing for an unclaimed one.
function claimRingStyle(claim: SystemClaim): React.CSSProperties | null {
  if (claim.kind === 'unclaimed') return null
  if (claim.kind === 'owned') return { borderColor: getCountry(claim.countryId)?.color ?? '#888' }
  const colors = claim.countryIds.map((id) => getCountry(id)?.color ?? '#888')
  const at = (i: number) => colors[i % colors.length]
  return { borderTopColor: at(0), borderRightColor: at(1), borderBottomColor: at(2), borderLeftColor: at(3) }
}

// Stars are just labels here, same as planets in system view — no 3D sphere
// model, just a fixed-size marker anchored at the star's true position.
function StarNode({ star, selected, onSelect, onOrderTo, fleetPresence, onSelectFleet, claim }: StarNodeProps) {
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
          {claimRingStyle(claim) && <span className={`owner-ring${claim.kind === 'contested' ? ' contested' : ''}`} style={claimRingStyle(claim)!} />}
          <span className="marker-dot" style={{ borderColor: star.color }} />
          <span className="marker-label">{star.name}</span>
          <BattleBadge scope={{ star: star.id }} />
          {fleetPresence.map(({ ship, relation }) => (
            <span
              key={ship.id}
              className="fleet-presence-icon"
              style={{ borderBottomColor: RELATION_COLORS[relation] }}
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
  const exitInterstellarToGalactic = useViewStore((s) => s.exitInterstellarToGalactic)
  const selectedNeighborhoodId = useViewStore((s) => s.selectedNeighborhoodId)
  const selectedId = useViewStore((s) => s.inViewSelection)
  const selectInView = useViewStore((s) => s.selectInView)
  const lockOnEnabled = useViewStore((s) => s.lockOnEnabled)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // Set by ShipPanel's "Go To" button — separate from focusedId since,
  // unlike flying to a star, arriving doesn't transition to system view.
  // Independent of lockOnEnabled (a one-time fly, not continuous follow).
  const [flyingToShip, setFlyingToShip] = useState(false)
  // Which neighborhood's stars this view is currently showing — see
  // starData's getStarsForNeighborhood for why only one neighborhood
  // actually resolves to real data today.
  const STARS = useMemo(() => getStarsForNeighborhood(selectedNeighborhoodId), [selectedNeighborhoodId])
  const selectedStar = useMemo(() => STARS.find((s) => s.id === selectedId) ?? null, [STARS, selectedId])
  const focusedStar = useMemo(() => STARS.find((s) => s.id === focusedId) ?? null, [STARS, focusedId])

  // If we're arriving here because the player zoomed out of a star's system
  // view, inViewSelection is already seeded to that star (see
  // exitSystemToInterstellar) — used once, at mount, purely to start the
  // camera framed on it directly. Captured via a ref (not read reactively,
  // same reasoning as SolarSystemScene's continuityBodyRef) so a later
  // in-scene click doesn't retroactively move where the camera STARTED.
  const continuityStarIdRef = useRef(useViewStore.getState().inViewSelection)
  const continuityStarPosition = useMemo<[number, number, number] | null>(() => {
    const starId = continuityStarIdRef.current
    if (!starId) return null
    const star = STARS.find((s) => s.id === starId)
    return star ? starScenePosition(star) : null
    // Computed once, at mount, from whatever the state was at that moment —
    // deliberately not reactive to later selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Without also seeding the initial camera position AND OrbitControls'
  // target together (not just `selectedId`), SelectionTracker's per-frame
  // easing (see its own header comment) still has to visibly sweep the
  // target from the default (0,0,0) — which is Sol's own position — all the
  // way out to wherever the returning star actually is, reading exactly like
  // "changing focus from Sol to the star" even though Sol was never
  // genuinely selected. Both are memoized with an empty dep array (mount
  // only) — a fresh array/object literal passed to a three.js prop every
  // render is a real, previously-hit bug in this project (see
  // CombatViewScene's own camera-prop memoization note), not just a style
  // preference.
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    if (!continuityStarPosition) return DEFAULT_CAMERA_OFFSET
    return [
      continuityStarPosition[0] + DEFAULT_CAMERA_OFFSET[0],
      continuityStarPosition[1] + DEFAULT_CAMERA_OFFSET[1],
      continuityStarPosition[2] + DEFAULT_CAMERA_OFFSET[2],
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const initialTarget = useMemo<[number, number, number]>(() => continuityStarPosition ?? [0, 0, 0], [continuityStarPosition])

  const ships = useShipStore((s) => s.ships)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const setFollowing = useShipStore((s) => s.setFollowing)
  const lanes = useHyperlaneStore((s) => s.lanes)
  const interstellarShips = useMemo(
    () => ships.filter((ship) => isShipInInterstellarSpace(ship.order, ship.location.kind)),
    [ships],
  )
  // One marker per fleet resting together, not per ship — see
  // shipPhysics.clusterRestingShipsByFleet.
  const interstellarClusters = useMemo(() => clusterRestingShipsByFleet(interstellarShips), [interstellarShips])
  // Only track a selected ship for the camera lock while it's actually
  // present in interstellar space — same "focusing logic like a star" idea,
  // but a star is always here to lock onto while a ship might currently be
  // nested inside a system instead (see fleetPresenceByStar below).
  const trackedShip = useMemo(
    () => (selectedShipId ? interstellarShips.find((s) => s.id === selectedShipId) ?? null : null),
    [selectedShipId, interstellarShips],
  )
  // One representative ship per distinct relation to the player (yours /
  // neutral / hostile) present in each star's system, for the no-text
  // presence badges — the complementary set to interstellarShips above (a
  // ship is either out in interstellar space, rendered directly, or nested
  // inside exactly one system, rendered only as a badge here). Recomputed
  // when any war starts or ends, since that changes who's hostile.
  const playerCountryId = usePlayerStore((s) => s.selectedCountryId)
  const relationKey = useRelationKey()
  // Each star system's territorial claim, from live ownership — recomputed
  // only when a body changes hands (a peace cession), not every render.
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  const claimsByStar = useMemo(() => new Map(STARS.map((star) => [star.id, systemClaim(star.id, bodyOwner)])), [STARS, bodyOwner])
  const fleetPresenceByStar = useMemo(() => {
    const map = new Map<string, { ship: ShipInstance; relation: ShipRelation }[]>()
    for (const ship of ships) {
      const systemId = shipSystemId(ship)
      if (!systemId) continue
      const relation = relationOfOwner(ship.ownerId, playerCountryId)
      const existing = map.get(systemId)
      if (existing) {
        if (!existing.some((entry) => entry.relation === relation)) existing.push({ ship, relation })
      } else {
        map.set(systemId, [{ ship, relation }])
      }
    }
    return map
    // relationKey stands in for the diplomacy state relationOfOwner reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ships, playerCountryId, relationKey])

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
    // Goes through orderSelectedFleets (every selected fleet, each moving
    // together) rather than planMove/setShipOrder directly
    // — under FTL comms delay (see commsVisual.ts), the jump doesn't even
    // begin resolving (cooldown, risk, the works) until the signal would
    // actually reach the ship. Instant contact behaves exactly as before,
    // 'on-cooldown'/'lost-in-hyperspace'/etc. included.
    orderSelectedFleets({ kind: 'star', starId: star.id })
  }

  const handleOrderToPoint = (point: [number, number, number]) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    orderSelectedFleets({ kind: 'interstellar-point', position: point })
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
      <Canvas camera={{ position: initialCameraPosition, fov: 50, near: 0.05, far: 5000 }} onPointerMissed={handleUnfocus}>
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
            claim={claimsByStar.get(star.id) ?? UNCLAIMED}
          />
        ))}

        {interstellarClusters.map((cluster) => (
          <ShipMarker key={cluster.key} ships={cluster.ships} onOrderFollow={handleFollowShip} />
        ))}

        {/* Committed orders for the player's own ships only — same
            information-hiding rule as combat's route lines (see
            CombatViewScene): other nations' ships still travel exactly as
            before, this just doesn't hand the player a readout of where
            they're headed. */}
        {interstellarShips
          .filter((ship) => ship.order && ship.ownerId === playerCountryId)
          .map((ship) => (
            <NavigationLine key={`nav-${ship.id}`} ship={ship} color={RELATION_COLORS.own} arrowLength={NAV_ARROW_LENGTH} />
          ))}

        {/* Commands still queued behind FTL comms delay (see
            commsVisual.ts) — dashed, distinct from the solid committed-order
            line above, which the ship may well still be flying while this
            one waits to arrive (see PendingOrderLine's own comment). Same
            own-ships-only visibility rule. */}
        {interstellarShips
          .filter((ship) => ship.pendingMoveOrder && ship.ownerId === playerCountryId)
          .map((ship) => (
            <PendingOrderLine
              key={`pending-${ship.id}`}
              ship={ship}
              color={RELATION_COLORS.own}
              arrowLength={NAV_ARROW_LENGTH}
              dashSize={PENDING_DASH_SIZE}
              gapSize={PENDING_GAP_SIZE}
              resolveTarget={resolveInterstellarDestinationPosition}
            />
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
            getTargetPosition={() => playerVisualShipRenderPosition(trackedShip, useGameTimeStore.getState().simDays).position}
            onArrive={() => setFlyingToShip(false)}
          />
        )}

        {(selectedStar || trackedShip) && !focusedStar && !flyingToShip && lockOnEnabled && (
          <SelectionTracker
            controlsRef={controlsRef}
            getPosition={() =>
              trackedShip
                ? playerVisualShipRenderPosition(trackedShip, useGameTimeStore.getState().simDays).position
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
            {/* Only the Solar Neighborhood has a 'sol' star to zoom into —
                every other neighborhood is uncharted (see
                getStarsForNeighborhood), so this shortcut doesn't apply
                there; a populated neighborhood would need its own primary
                star, not necessarily named 'sol'. */}
            {selectedNeighborhoodId === 'solar-neighborhood' && (
              <DistanceThresholdWatcher mode="min" threshold={ENTER_DISTANCE} onTrigger={() => enterSystem('sol', 'Sol')} />
            )}
            <DistanceThresholdWatcher mode="max" threshold={EXIT_DISTANCE} onTrigger={exitInterstellarToGalactic} controlsRef={controlsRef} />
          </>
        )}

        <OrbitControls
          ref={controlsRef}
          target={initialTarget}
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
            {(() => {
              const claim = claimsByStar.get(selectedStar.id) ?? UNCLAIMED
              if (claim.kind === 'unclaimed') {
                return (
                  <div className="inspect-row">
                    <span className="inspect-label">Owner</span>
                    <span className="inspect-value">Unclaimed</span>
                  </div>
                )
              }
              if (claim.kind === 'owned') {
                const country = getCountry(claim.countryId)
                return (
                  <div className="inspect-row">
                    <span className="inspect-label">Owner</span>
                    <span className="inspect-value" style={{ color: country?.color }}>
                      {country?.name ?? claim.countryId}
                    </span>
                  </div>
                )
              }
              return (
                <div className="inspect-row">
                  <span className="inspect-label">Contested by</span>
                  <span className="inspect-value">
                    {claim.countryIds.map((id, i) => (
                      <span key={id} style={{ color: getCountry(id)?.color }}>
                        {i > 0 ? ', ' : ''}
                        {getCountry(id)?.name ?? id}
                      </span>
                    ))}
                  </span>
                </div>
              )
            })()}
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
