import { wasDrag } from './dragGuard'
import { useStarbaseActivityKey } from '../hooks/useStarbaseActivity'
import { SHIP_ICON_SIZE, ShipIcon, roleOfClass } from './ShipIcon'
import { deselectShipsOnEmptyClick } from './deselect'
import { BattleBadge } from '../components/BattleBadge'
import { KeyboardPan } from './KeyboardPan'
import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { StarData } from '../data/starData'
import { findStar, getStarsForNeighborhood, starScenePosition, STARS } from '../data/starData'
import { jumpRiskLine } from './jumpConfirm'
import { SOLAR_NEIGHBORHOOD_ID } from '../data/galaxyGen'
import { useViewStore } from '../state/viewStore'
import type { ShipInstance, MoveDestination } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { useHyperlaneStore, laneEndpoints, allLanesOf } from '../state/hyperlaneStore'
import { CameraFocusRig } from './CameraFocusRig'
import { CLUSTER_FIT_MARGIN, boundingSphere, cameraAlong, fitDistance, visibleAspect } from './framing'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { DeepSpaceClickPlane } from './DeepSpaceClickPlane'
import { HyperlaneLine } from './HyperlaneLine'
import { ShipMarker } from './ShipMarker'
import { NavigationLine } from './NavigationLine'
import { PendingOrderLine } from './PendingOrderLine'
import { QueuedRouteLine } from './QueuedRouteLine'
import { CommsSignals } from './CommsSignals'
import { ShipPanel } from './ShipPanel'
import { shipSystemId, clusterRestingShipsByFleet } from './shipPhysics'
import { shipClusterId } from './clusters'
import { useShipOrderMenu } from './ShipOrderMenu'
import { orderSelectedFleets, playerShipRenderPosition } from './commsVisual'
import { useGameTimeStore } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'
import { DraggableWindow } from '../components/DraggableWindow'
import { RELATION_COLORS, type ShipRelation } from '../data/shipData'
import { relationOfOwner, useRelationKey } from '../state/shipRelations'
import { useTerritoryStore } from '../state/territoryStore'
import { type SystemClaim } from './territory'
import { ownerInfoOf } from '../data/ownerInfo'
import { UNKNOWN_EMPIRE_ID, shownClaim } from './encroachment'
import { getCountry } from '../data/countryData'
import { usePlayerStore } from '../state/playerStore'
import { canBuildStarbase, starbaseInfluenceCostFor, useStarbaseStore } from '../state/starbaseStore'
import { useResourceStore } from '../state/resourceStore'
import { starbaseActionTitle, starbaseShortReason, withStarbaseCost } from './starbaseNotices'
import { starbaseOwnersOf, starbasesAt } from './starbaseLogic'
import { TerritoryDiscs } from './TerritoryDiscs'
import { ObserverLayer } from './ObserverLayer'
import { useObserverStore } from '../state/observerStore'
import { ContextMenu, type ContextMenuItem } from './StarContextMenu'
import { HoverTip } from '../components/HoverTip'
import { orderSelectedToDoAt, orderSelectedToSurvey } from './shipCommands'
import { hasOwnShipSelected, openInViewFull } from './panelOpen'
import { isNewTabModifierHeld } from './queueModifier'
import { useWorkspaceStore } from '../state/workspaceStore'
import { SURVEY_DAYS_PER_BODY } from '../data/surveyData'
import { isPlayerOwned } from '../state/shipRelations'
import { resolveShipClass } from '../state/shipClassResolver'
import { surveyProgress } from './surveyLogic'
import { useSurveyStore } from '../state/surveyStore'
import { unidentifiedStarbaseStars, usePlayerIntel, visibleClaims } from './intel'

const ENTER_DISTANCE = 6
const UNCLAIMED: SystemClaim = { kind: 'unclaimed' }
const NO_LANES: string[] = []
const NO_SHIPS: ShipInstance[] = []

// The risk tip for the riskiest of the selected ships that would hyperdrive to `starId`: the real
// number the order would roll (scene/jumpConfirm.jumpRiskLine), for any star of the cluster on
// screen; null if none would jump.
function jumpRiskText(selected: ShipInstance[], starId: string): string | null {
  if (!findStar(starId)) return null
  return jumpRiskLine(selected, { kind: 'star', starId })
}
const MAX_DISTANCE = 4200
const EXIT_DISTANCE = 3500
// The camera's field of view (the Canvas below) and the closest a fitted opening gets.
const CAMERA_FOV_DEG = 50
const FIT_MIN_DISTANCE = 60
// The two side panels (the nav and the Outliner) cover this much of the canvas's width together.
const SIDE_PANELS_PX = 440
// A fitted opening looks down more steeply than the plain default (a cluster is about as wide as it is
// deep and a good deal flatter): along the default's low angle its stars pile up behind one another.
const FIT_CAMERA_DIRECTION: [number, number, number] = [20, 70, 40]
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

// Where a comms signal sets out from in interstellar view: the capital's star.
function resolveInterstellarSignalOrigin(): Vector3 | null {
  const country = getCountry(usePlayerStore.getState().selectedCountryId ?? '')
  const star = country ? STARS.find((s) => s.id === country.capitalStarId) : undefined
  return star ? new Vector3(...starScenePosition(star)) : null
}

// Where a ship is in interstellar view for a comms signal to head for: its own
// position in deep space, or its star (where its system's badge sits) if it's
// inside a system.
function resolveInterstellarShipPosition(ship: ShipInstance, simDays: number): Vector3 | null {
  const render = playerShipRenderPosition(ship, simDays)
  if (render.space === 'interstellar') return render.position
  const star = render.systemId ? STARS.find((s) => s.id === render.systemId) : undefined
  return star ? new Vector3(...starScenePosition(star)) : null
}

interface StarNodeProps {
  /** A live Starbase stands here but the system is unexplored to the player. */
  unidentifiedBase?: boolean
  /** Whether the player has explored this system (its information shows). */
  explored?: boolean
  star: StarData
  selected: boolean
  onSelect: (star: StarData) => void
  /** Right-click — orders the currently-selected ship (if any) here. */
  onOrderTo: (star: StarData, at: { x: number; y: number }) => void
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
// one (top/right/bottom/left, cycling), nothing for an unclaimed one. Reused
// one level out by GalacticViewScene for the neighbourhood-level indicator.
export function claimRingStyle(claim: SystemClaim): React.CSSProperties | null {
  if (claim.kind === 'unclaimed') return null
  if (claim.kind === 'owned') return { borderColor: ownerInfoOf(claim.countryId)?.color ?? '#888' }
  const colors = claim.countryIds.map((id) => ownerInfoOf(id)?.color ?? '#888')
  const at = (i: number) => colors[i % colors.length]
  return { borderTopColor: at(0), borderRightColor: at(1), borderBottomColor: at(2), borderLeftColor: at(3) }
}

// Stars are just labels here, same as planets in system view — no 3D sphere
// model, just a fixed-size marker anchored at the star's true position.
function StarNode({ star, selected, onSelect, onOrderTo, fleetPresence, onSelectFleet, claim, unidentifiedBase, explored }: StarNodeProps) {
  const [hovered, setHovered] = useState(false)
  const pos = starScenePosition(star)
  const [riskTip, setRiskTip] = useState<string | null>(null)

  return (
    <group position={pos}>
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
        <div
          className={`planet-marker star-node${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          // With ships selected that would hyperdrive here: what this jump risks.
          title={riskTip ?? undefined}
          onPointerEnter={() => {
            setHovered(true)
            const store = useShipStore.getState()
            setRiskTip(jumpRiskText(store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s)), star.id))
          }}
          onPointerLeave={() => setHovered(false)}
          onClick={() => onSelect(star)}
          onContextMenu={(e) => {
            e.preventDefault()
            onOrderTo(star, { x: e.clientX, y: e.clientY })
          }}
          onWheel={forwardWheelToCanvas}
        >
          {claimRingStyle(claim) && <span className={`owner-ring${claim.kind === 'contested' ? ' contested' : ''}`} style={claimRingStyle(claim)!} />}
          <span className="marker-dot" style={{ borderColor: star.color }} />
          <span className="marker-label">{star.name}{explored === false ? ' (unexplored)' : ''}</span>
          {unidentifiedBase && <span className="unidentified-base" title="A Starbase: owner unknown until you explore this system" />}
          <BattleBadge scope={{ star: star.id }} />
          {fleetPresence.map(({ ship, relation }) => (
            <ShipIcon
              key={ship.id}
              inline
              role={roleOfClass(ship.classId)}
              color={RELATION_COLORS[relation]}
              size={SHIP_ICON_SIZE.interstellar}
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
function isShipInInterstellarSpace(order: { space: 'system' | 'interstellar' | 'galactic' } | null, locationKind: string): boolean {
  if (order) return order.space === 'interstellar'
  return locationKind === 'star' || locationKind === 'interstellar-point'
}

// The one place in this view that needs the live clock (the build countdown), so
// only this row re-renders with it, and only while a star's window is open.
function OwnStarbaseRow({ starbase }: { starbase: { readySimDays: number; integrity: number } }) {
  const simDays = useGameTimeStore((s) => Math.floor(s.simDays))
  const building = simDays < starbase.readySimDays
  return (
    <div className="inspect-row">
      <span className="inspect-label">Your Starbase</span>
      <span className="inspect-value">{building ? `Building (${Math.ceil(starbase.readySimDays - simDays)}d left)` : `Holding — ${Math.round(starbase.integrity)} integrity`}</span>
    </div>
  )
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
  // Which neighborhood's stars this view is currently showing: ours, or a
  // generated one (starData.getStarsForNeighborhood).
  // Every cluster has its own interstellar map (positions in light-years from
  // its centre: scene/clusters.ts). The view shows the ships, orders and charted
  // lanes of the cluster on screen, and orders given here go to its stars.
  const home = selectedNeighborhoodId === SOLAR_NEIGHBORHOOD_ID
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
  // Zoomed in from the galaxy: start far out over the cluster's middle, just
  // inside the distance that zooms back out (EXIT_DISTANCE), the mirror of
  // leaving. Read once at mount, like the continuity star.
  const fromGalaxyRef = useRef(useViewStore.getState().interstellarFromGalaxy && !continuityStarIdRef.current)
  // A cluster's map opens FITTED to its stars (scene/framing.ts), not far out: the
  // galaxy's own arrival (and any arrival at another cluster) looks at the middle of
  // its stars from just far enough to hold them all. The Solar Neighbourhood reached
  // some other way keeps its plain near default.
  const fitCluster = (fromGalaxyRef.current || !home) && !continuityStarIdRef.current
  const clusterFrame = useMemo(() => boundingSphere(STARS.map(starScenePosition)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [])
  const clusterCentre = clusterFrame.centre
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    if (fitCluster) {
      const aspect = Math.min(visibleAspect(window.innerWidth, window.innerHeight, SIDE_PANELS_PX), 1.2)
      const distance = Math.max(fitDistance(clusterFrame.radius, CAMERA_FOV_DEG, aspect, CLUSTER_FIT_MARGIN), FIT_MIN_DISTANCE)
      return cameraAlong(clusterCentre, FIT_CAMERA_DIRECTION, distance)
    }
    if (!continuityStarPosition) return DEFAULT_CAMERA_OFFSET
    return [
      continuityStarPosition[0] + DEFAULT_CAMERA_OFFSET[0],
      continuityStarPosition[1] + DEFAULT_CAMERA_OFFSET[1],
      continuityStarPosition[2] + DEFAULT_CAMERA_OFFSET[2],
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const initialTarget = useMemo<[number, number, number]>(
    () => (fitCluster ? clusterCentre : (continuityStarPosition ?? [0, 0, 0])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [continuityStarPosition, clusterCentre],
  )

  const ships = useShipStore((s) => s.ships)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const shipMenu = useShipOrderMenu()
  // Lanes are each nation's own: the map shows the player's, and Observer mode
  // (below) every nation's.
  const lanesByNation = useHyperlaneStore((s) => s.lanes)
  const lanePlayerId = usePlayerStore((s) => s.selectedCountryId)
  // (A lane whose stars are not on this map, another cluster's or a cluster lane, draws nothing.)
  const lanes = lanePlayerId ? lanesByNation[lanePlayerId] ?? NO_LANES : NO_LANES
  const allLanes = useMemo(() => allLanesOf(lanesByNation), [lanesByNation])
  const interstellarShips = useMemo(
    () => ships.filter((ship) => isShipInInterstellarSpace(ship.order, ship.location.kind) && shipClusterId(ship) === selectedNeighborhoodId),
    [ships, selectedNeighborhoodId],
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
  // A selected ship nested inside a system has no interstellar position of its
  // own, so the camera pans to its star instead — the view never changes.
  const nestedShipStarId = useMemo(() => {
    if (!selectedShipId || trackedShip) return null
    const ship = ships.find((s) => s.id === selectedShipId)
    return ship ? shipSystemId(ship) : null
  }, [selectedShipId, trackedShip, ships])
  const nestedShipStar = useMemo(() => (nestedShipStarId ? STARS.find((s) => s.id === nestedShipStarId) ?? null : null), [nestedShipStarId])
  const shipFocus = trackedShip ?? nestedShipStar
  const shipFocusPosition = (): Vector3 =>
    trackedShip ? playerShipRenderPosition(trackedShip, useGameTimeStore.getState().simDays).position : new Vector3(...starScenePosition(nestedShipStar!))
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
  const starbases = useStarbaseStore((s) => s.starbases)
  // Not the clock itself: subscribing this whole scene to it re-rendered every
  // star, border and marker each frame. Claims change only when a Starbase finishes.
  const starbaseActivity = useStarbaseActivityKey()
  // Only what the player has explored: an unexplored system shows no owner or
  // border (scene/intel.ts), and a Starbase there is just an unidentified mark.
  const intel = usePlayerIntel()
  const [starMenu, setStarMenu] = useState<{ x: number; y: number; star: StarData } | null>(null)
  const knownSurvey = useSurveyStore((s) => (playerCountryId ? s.known[playerCountryId] : undefined))
  // Observer mode (a Debug Console cheat) shows every owner and the empires, whatever
  // has been explored: a view override, it changes nothing the player knows.
  const observer = useObserverStore((s) => s.on)
  const claimsByStar = useMemo(
    () => {
      const simDays = useGameTimeStore.getState().simDays
      // Body owners and live Starbases, plus the empire that owns the star: by name in
      // Observer mode, as "Unknown empire" otherwise (scene/encroachment.shownClaim).
      const all = new Map(STARS.map((star) => [star.id, shownClaim(star.id, bodyOwner, starbaseOwnersOf(star.id, starbases, simDays), observer)]))
      if (observer) return all
      return visibleClaims(all, intel.known)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [STARS, bodyOwner, starbases, starbaseActivity, intel.known, observer],
  )
  const unidentifiedBaseStars = useMemo(
    () => new Set(unidentifiedStarbaseStars(starbases, intel.known, useGameTimeStore.getState().simDays)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [starbases, intel.known, starbaseActivity],
  )
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
    if (isNewTabModifierHeld()) return useWorkspaceStore.getState().openInNewTab({ inViewSelection: star.id, selectedShipId: null })
    selectInView(star.id)
    selectShip(null)
  }

  const handleEnterSystem = () => {
    if (selectedStar?.hasSystemData && intel.known(selectedStar.id)) setFocusedId(selectedStar.id)
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
  const handleOrderToStar = (star: StarData, at: { x: number; y: number }) => {
    if (isNewTabModifierHeld()) return useWorkspaceStore.getState().openInNewTab({ inViewSelection: star.id, selectedShipId: null })
    // With none of your ships selected, a right click opens the star's panel full screen.
    if (!hasOwnShipSelected()) return openInViewFull(star.id, 'star')
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    // With a science or construction ship selected the right-click offers what
    // it can do there (explore, survey, build a Starbase); otherwise it is just
    // the move order.
    const roles = new Set(
      useShipStore.getState().ships.filter((s) => useShipStore.getState().selectedShipIds.includes(s.id) && isPlayerOwned(s)).map((s) => resolveShipClass(s.classId)?.role),
    )
    if (roles.has('science') || roles.has('construction')) {
      setStarMenu({ x: at.x, y: at.y, star })
      return
    }
    // Goes through orderSelectedFleets (every selected fleet, each moving
    // together) rather than planMove/setShipOrder directly
    // — under FTL comms delay (see commsVisual.ts), the jump doesn't even
    // begin resolving (cooldown, risk, the works) until the signal would
    // actually reach the ship. Instant contact behaves exactly as before,
    // 'on-cooldown'/'lost-in-hyperspace'/etc. included.
    orderSelectedFleets({ kind: 'star', starId: star.id })
  }

  // What the right-click menu offers for this star, given the selected ships.
  // Exploring IS moving to an unexplored system (entering it explores it), so
  // "Move to" is for systems already explored; Build Starbase is greyed out,
  // with the reason, unless a selected Construction Ship could build there.
  const starMenuItems = (star: StarData): ContextMenuItem[] => {
    const store = useShipStore.getState()
    const selected = store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s))
    const ofRole = (role: string) => selected.filter((s) => resolveShipClass(s.classId)?.role === role)
    const science = ofRole('science')
    const builders = ofRole('construction')
    const explored = intel.known(star.id)
    const items: ContextMenuItem[] = []
    // Entering a system explores it, so "Explore" is just the move.
    const risk = jumpRiskText(selected, star.id)
    items.push(
      explored
        ? { label: `Move to ${star.name}`, title: risk ?? undefined, onClick: () => orderSelectedFleets({ kind: 'star', starId: star.id }) }
        : {
            label: 'Explore system',
            title: `Fly there: entering the system reveals its owner, borders and worlds${risk ? `. ${risk}` : ''}`,
            onClick: () => orderSelectedFleets({ kind: 'star', starId: star.id }),
          },
    )
    if (science.length > 0) {
      items.push({ label: 'Survey system', title: `Fly to each body in turn and survey it (${SURVEY_DAYS_PER_BODY} days each, plus the flights)`, onClick: () => orderSelectedToSurvey(star.id) })
    }
    if (builders.length > 0) {
      const checks = builders.map((b) => canBuildStarbase(b.ownerId, star.id, useStarbaseStore.getState().starbases, b.id, { anywhere: true }))
      const ok = checks.some((c) => c.ok)
      const firstReason = checks.find((c) => !c.ok)
      const cost = starbaseInfluenceCostFor(builders[0].ownerId, star.id, useStarbaseStore.getState().starbases)
      const short = starbaseShortReason(cost, useResourceStore.getState().stateFor(builders[0].ownerId).amounts.influence ?? 0)
      items.push({
        label: withStarbaseCost('Build Starbase', cost),
        disabled: !ok,
        title: starbaseActionTitle(ok, firstReason && !firstReason.ok ? firstReason.reason : null, short, cost, 'Fly there and build a Starbase from the hold'),
        onClick: () => orderSelectedToDoAt(star.id, { kind: 'build-starbase' }),
      })
    }
    return items
  }

  const handleOrderToPoint = (point: [number, number, number]) => {
    if (!selectedShipId) return
    const ship = ships.find((s) => s.id === selectedShipId)
    if (!ship) return
    // A point of THIS cluster's map (absent = the Solar Neighbourhood's).
    orderSelectedFleets(home ? { kind: 'interstellar-point', position: point } : { kind: 'interstellar-point', position: point, clusterId: selectedNeighborhoodId })
  }

  // Right-clicking another ship while one is selected opens a menu: Move
  // (follow it, ShipInstance.followingShipId) or Attack (scene/ShipOrderMenu.tsx).
  const handleFollowShip = (targetShipId: string) => {
    if (!selectedShipId || selectedShipId === targetShipId) return
    shipMenu.open(targetShipId)
  }

  // Same race as system view: r3f's onPointerMissed fires for any click that
  // doesn't raycast-hit a 3D object, including clicks on our HTML star
  // markers (they share the canvas's event container). Ignore misses that
  // actually landed on a marker so its own onClick isn't immediately undone.
  const handleUnfocus = (event: MouseEvent) => {
    // A right-click on empty space is an order, not a deselect.
    if (event.type === 'contextmenu' || wasDrag(event)) return
    if (event.target instanceof Element && event.target.closest('.planet-marker, .ship-marker')) return
    deselectShipsOnEmptyClick(event)
    selectInView(null)
  }

  return (
    <div className="interstellar-wrapper">
      <Canvas camera={{ position: initialCameraPosition, fov: CAMERA_FOV_DEG, near: 0.05, far: 5000 }} onPointerMissed={handleUnfocus}>
        <color attach="background" args={['#020409']} />
        <KeyboardPan controlsRef={controlsRef} />
        <ambientLight intensity={0.3} />
        <Stars radius={800} depth={200} count={5000} factor={3} fade speed={0.2} />

        <DeepSpaceClickPlane onDeselect={() => selectInView(null)} onOrderTo={handleOrderToPoint} />

        {/* Charted hyperlanes — established automatically the first time a
            hyperdrive jump between two stars succeeds (see planMove/
            hyperdriveLossChance), not drawn by the player. A separate,
            future "plot a route" feature may let the player draw their own
            lines here too; this is unrelated to that. */}
        {!observer && lanes.map((key) => {
          const [aId, bId] = laneEndpoints(key)
          const a = STARS.find((s) => s.id === aId)
          const b = STARS.find((s) => s.id === bId)
          if (!a || !b) return null
          return <HyperlaneLine key={key} from={starScenePosition(a)} to={starScenePosition(b)} />
        })}

        <TerritoryDiscs claimsByStar={claimsByStar} stars={STARS} />
        {observer && <ObserverLayer stars={STARS} lanes={allLanes} />}

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
            unidentifiedBase={unidentifiedBaseStars.has(star.id)}
            explored={intel.known(star.id)}
          />
        ))}

        {interstellarClusters.map((cluster) => (
          <ShipMarker key={cluster.key} ships={cluster.ships} onOrderFollow={handleFollowShip} iconSize={SHIP_ICON_SIZE.interstellar} />
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

        {/* Orders queued behind the current one (Shift + right-click). */}
        {interstellarShips
          .filter((ship) => (ship.orderQueue?.length ?? 0) > 0 && ship.ownerId === playerCountryId)
          .map((ship) => (
            <QueuedRouteLine
              key={`queue-${ship.id}`}
              ship={ship}
              color={RELATION_COLORS.own}
              arrowLength={NAV_ARROW_LENGTH}
              dashSize={PENDING_DASH_SIZE}
              gapSize={PENDING_GAP_SIZE}
              resolveTarget={resolveInterstellarDestinationPosition}
            />
          ))}

        {/* Signals crossing comms delay, from the capital's star to the ship. */}
        <CommsSignals
          ships={home ? ships.filter((ship) => ship.ownerId === playerCountryId) : NO_SHIPS}
          resolveOrigin={resolveInterstellarSignalOrigin}
          resolveShipPosition={resolveInterstellarShipPosition}
        />

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
        {flyingToShip && shipFocus && (
          <CameraFocusRig
            key={selectedShipId ?? 'ship'}
            controlsRef={controlsRef}
            arriveDistance={SHIP_FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={shipFocusPosition}
            onArrive={() => setFlyingToShip(false)}
          />
        )}

        {(selectedStar || shipFocus) && !focusedStar && !flyingToShip && lockOnEnabled && (
          <SelectionTracker
            controlsRef={controlsRef}
            getPosition={() => (shipFocus ? shipFocusPosition() : new Vector3(...starScenePosition(selectedStar!)))}
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
            {selectedNeighborhoodId === 'solar-neighborhood' && intel.known('sol') && (
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

      <HoverTip />

      {shipMenu.element}
      {starMenu && <ContextMenu x={starMenu.x} y={starMenu.y} title={starMenu.star.name} items={starMenuItems(starMenu.star)} onClose={() => setStarMenu(null)} />}

      {selectedShipId ? (
        <ShipPanel onGoTo={shipFocus ? () => setFlyingToShip(true) : undefined} goToPending={flyingToShip} />
      ) : (
        selectedStar && (
          <DraggableWindow title={selectedStar.name} memoryKey="star" onClose={() => selectInView(null)}>
            {/* The same compact layout as a star in the system view: type, radius, then the door in. */}
            <div className="inspect-row">
              <span className="inspect-label">Type</span>
              <span className="inspect-value">Star</span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Radius</span>
              <span className="inspect-value">{Math.round(selectedStar.radiusKm).toLocaleString()} km</span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Distance</span>
              <span className="inspect-value">
                {selectedStar.distanceLy.toFixed(2)} ly from {home ? 'Sol' : "the neighborhood's centre"}
              </span>
            </div>
            {(() => {
              const claim = claimsByStar.get(selectedStar.id) ?? UNCLAIMED
              if (!intel.known(selectedStar.id)) {
                return (
                  <>
                    <div className="inspect-row">
                      <span className="inspect-label">System</span>
                      <span className="inspect-value">Unexplored: send a ship there</span>
                    </div>
                    {unidentifiedBaseStars.has(selectedStar.id) && (
                      <div className="inspect-row">
                        <span className="inspect-label">Starbase</span>
                        <span className="inspect-value">Detected — owner unknown</span>
                      </div>
                    )}
                  </>
                )
              }
              if (claim.kind === 'unclaimed') {
                return (
                  <div className="inspect-row">
                    <span className="inspect-label">Owner</span>
                    <span className="inspect-value">Unclaimed</span>
                  </div>
                )
              }
              if (claim.kind === 'owned') {
                const country = ownerInfoOf(claim.countryId)
                return (
                  <div className="inspect-row">
                    <span className="inspect-label">{claim.countryId === UNKNOWN_EMPIRE_ID ? 'Claimed by' : 'Owner'}</span>
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
                      <span key={id} style={{ color: ownerInfoOf(id)?.color }}>
                        {i > 0 ? ', ' : ''}
                        {ownerInfoOf(id)?.name ?? id}
                      </span>
                    ))}
                  </span>
                </div>
              )
            })()}
            {playerCountryId && (() => {
              const progress = surveyProgress(knownSurvey, playerCountryId, selectedStar.id, bodyOwner)
              // Surveying needs no exploring, so bodies can be surveyed in a
              // system whose owner and worlds are still unknown.
              if (!intel.known(selectedStar.id) && progress.done === 0) return null
              return (
                <div className="inspect-row">
                  <span className="inspect-label">Survey</span>
                  <span className="inspect-value">
                    {progress.total > 0 && progress.done === progress.total ? `Fully surveyed (${progress.total} bodies)` : `${progress.done} / ${progress.total} bodies`}
                  </span>
                </div>
              )
            })()}
            <div className="inspect-divider" />
            {selectedStar.hasSystemData ? (
              focusedStar ? (
                <div className="inspect-status ok">Entering system…</div>
              ) : (
                <button
                  type="button"
                  className="detail-view-btn"
                  onClick={handleEnterSystem}
                  disabled={!intel.known(selectedStar.id)}
                  title={intel.known(selectedStar.id) ? undefined : 'Unexplored: one of your ships has to enter it first'}
                >
                  Detailed View
                </button>
              )
            ) : (
              <div className="inspect-status">No system data available</div>
            )}
            <div className="inspect-divider" />
            {(() => {
              const mine = starbasesAt(selectedStar.id, starbases).find((sb) => sb.ownerId === playerCountryId)
              return mine ? <OwnStarbaseRow starbase={mine} /> : null
            })()}
          </DraggableWindow>
        )
      )}
    </div>
  )
}
