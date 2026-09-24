// The FTL comms "visual" layer — resolving how stale a player's own view of
// a ship should be, and reconstructing what it looked like that long ago.
// Pure functions plus a couple of thin store-reading helpers, same split
// shipPhysics.ts itself already uses (planMove reads usePlayerStore/
// useTechStore directly rather than taking them as parameters). See
// commsData.ts for the tier/delay-math this builds on, and the plan this
// session wrote for the full "simulation vs visual" design.
//
// Deliberately isolated in its own file/module boundary — every call site
// that opts into this layer does so with a single swapped function call (see
// ShipMarker.tsx, ShipPanel.tsx, etc.), so ripping the whole feature out
// later is deleting this file plus reverting those one-line swaps, not
// untangling anything.
import { Vector3 } from 'three'
import type { ShipInstance, ShipLocation, MoveOrder, MoveDestination, ShipCombatState } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerStore } from '../state/playerStore'
import { useTechStore } from '../state/techStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { getCountry } from '../data/countryData'
import { STARS, UNITS_PER_LY } from '../data/starData'
import { commsDelayDaysForDistanceKm, commsTierFor, type CommsTier } from '../data/commsData'
import {
  bodyLivePosition,
  KM_PER_SYSTEM_UNIT,
  LY_IN_KM,
  planMove,
  type MoveResult,
  type ShipRenderInfo,
} from './shipPhysics'
import { planFleetMove } from './fleetMove'
import { useCombatStore } from '../state/combatStore'
import { findEngagementFor } from './combatResolution'
import { isPlayerOwned } from '../state/shipRelations'
import { getShipRenderPosition } from './shipPhysics'

// Real distance, in km, from the capital to wherever `location` actually is
// right now. Same "compress the intra-system offset against the interstellar
// leg, don't bother combining them precisely" simplification for a
// cross-system ship that the rest of this project already uses for anything
// interstellar-scale (light-years dwarf AU-scale detail) — only computed
// in-system when ship and capital genuinely share a star, where it's the
// whole distance rather than a rounding error.
function distanceFromCapitalKm(
  location: ShipLocation,
  capitalStarId: string,
  capitalBodyName: string,
  simDays: number,
): number {
  const capitalStar = STARS.find((s) => s.id === capitalStarId)
  const capitalStarPosLy = capitalStar ? new Vector3(...capitalStar.position) : new Vector3(0, 0, 0)

  if (location.kind === 'interstellar-point') {
    const shipPosLy = new Vector3(...location.position).divideScalar(UNITS_PER_LY)
    return capitalStarPosLy.distanceTo(shipPosLy) * LY_IN_KM
  }

  const shipStarId = location.kind === 'star' ? location.starId : location.systemId
  const shipStar = STARS.find((s) => s.id === shipStarId)
  const shipStarPosLy = shipStar ? new Vector3(...shipStar.position) : new Vector3(0, 0, 0)
  const interstellarKm = capitalStarPosLy.distanceTo(shipStarPosLy) * LY_IN_KM

  if (shipStarId !== capitalStarId) return interstellarKm

  const shipLocalPos =
    location.kind === 'system-point'
      ? new Vector3(...location.position)
      : location.kind === 'orbiting'
        ? bodyLivePosition(location.bodyName, simDays)
        : new Vector3(0, 0, 0) // resting at the star itself
  const capitalLocalPos = bodyLivePosition(capitalBodyName, simDays)
  return shipLocalPos.distanceTo(capitalLocalPos) * KM_PER_SYSTEM_UNIT
}

// One-way comms delay, in simDays, between a country's capital and a
// RESTING location — the low-level primitive every other helper in this
// file builds on. Only correct for a ship actually AT `location` right now;
// see shipCommsDelayDays below for the ship-aware version that also handles
// one still mid-order.
export function commsDelayToLocation(
  location: ShipLocation,
  capitalStarId: string,
  capitalBodyName: string,
  simDays: number,
  tier: CommsTier,
): number {
  const distanceKm = distanceFromCapitalKm(location, capitalStarId, capitalBodyName, simDays)
  return commsDelayDaysForDistanceKm(distanceKm, tier)
}

// Same distance math as distanceFromCapitalKm, but starting from an already-
// resolved ShipRenderInfo (see shipPhysics.getShipRenderPosition) instead of
// a resting ShipLocation — the piece that makes shipCommsDelayDays correct
// for a ship currently mid-order, whose `location` field is frozen at
// wherever it DEPARTED from and says nothing about where it actually is now.
function distanceFromRenderInfoKm(
  render: ShipRenderInfo,
  capitalStarId: string,
  capitalBodyName: string,
  simDays: number,
): number {
  const capitalStar = STARS.find((s) => s.id === capitalStarId)
  const capitalStarPosLy = capitalStar ? new Vector3(...capitalStar.position) : new Vector3(0, 0, 0)

  if (render.space === 'interstellar') {
    const shipPosLy = render.position.clone().divideScalar(UNITS_PER_LY)
    return capitalStarPosLy.distanceTo(shipPosLy) * LY_IN_KM
  }

  const shipStarId = render.systemId ?? capitalStarId
  const shipStar = STARS.find((s) => s.id === shipStarId)
  const shipStarPosLy = shipStar ? new Vector3(...shipStar.position) : new Vector3(0, 0, 0)
  const interstellarKm = capitalStarPosLy.distanceTo(shipStarPosLy) * LY_IN_KM
  if (shipStarId !== capitalStarId) return interstellarKm

  const capitalLocalPos = bodyLivePosition(capitalBodyName, simDays)
  return render.position.distanceTo(capitalLocalPos) * KM_PER_SYSTEM_UNIT
}

// The ship-aware version every real call site should use (see
// playerCommsDelayToShip below) — `ship.location` is only trustworthy while
// the ship is actually AT REST there; the moment it's under an order,
// `location` stays frozen at the DEPARTURE point until the order completes
// (see setShipOrder — it never touches `location`), so computing delay from
// it directly would understate the distance for the entire trip and only
// snap to correct once the ship arrives. Resolving through
// getShipRenderPosition (the same pure function every marker already uses
// to draw it) fixes that: mid-order, this reflects wherever the ship
// currently, actually is.
export function shipCommsDelayDays(
  ship: ShipInstance,
  capitalStarId: string,
  capitalBodyName: string,
  simDays: number,
  tier: CommsTier,
): number {
  if (!ship.order) return commsDelayToLocation(ship.location, capitalStarId, capitalBodyName, simDays, tier)
  const render = getShipRenderPosition(ship, simDays)
  const distanceKm = distanceFromRenderInfoKm(render, capitalStarId, capitalBodyName, simDays)
  return commsDelayDaysForDistanceKm(distanceKm, tier)
}

// Convenience wrapping the above with "whichever country the player is
// currently playing" — the only viewer that matters for either the order
// queue or the visual layer: it's the player's OWN comms network that's
// stale, for both their own and any other visible fleet, not a per-faction
// thing modeled separately for each country.
export function playerCommsDelayToShip(ship: ShipInstance, simDays: number): number {
  const countryId = usePlayerStore.getState().selectedCountryId
  if (!countryId) return 0
  const country = getCountry(countryId)
  if (!country) return 0
  const researched = useTechStore.getState().stateFor(countryId).researched
  const tier = commsTierFor(researched)
  return shipCommsDelayDays(ship, country.capitalStarId, country.capitalBodyName, simDays, tier)
}

// delayDays <= 0 (only really possible at the 'hyper' tier, or a location
// exactly at the capital) — treated as "real-time contact." Used to gate
// manual combat micromanagement (see CombatPanel.tsx).
export function commsInstantContact(delayDays: number): boolean {
  return delayDays <= 1e-9
}

// Reconstructs what a ship's location/order/combat looked like `delayDays`
// ago, from its own trailing history log (see ShipInstance.history) — the
// "visual" layer's core operation. Falls back to the ship's live current
// fields when contact is effectively instant or there's no history yet (a
// freshly spawned/scenario-loaded ship: showing its own brand-new live state
// is exactly correct at the instant it was created), and to the OLDEST
// history entry still held when the requested lookback exceeds how far back
// the log actually goes — closer to what stale comms would show than
// jumping forward to omniscient current truth would be.
export function visualShipSnapshot(
  ship: ShipInstance,
  delayDays: number,
  simDays: number,
): { location: ShipLocation; order: MoveOrder | null; combat: ShipCombatState } {
  if (delayDays <= 0) return { location: ship.location, order: ship.order, combat: ship.combat }
  const history = ship.history
  if (!history || history.length === 0) return { location: ship.location, order: ship.order, combat: ship.combat }

  const asOf = simDays - delayDays
  let chosen = history[0]
  for (const entry of history) {
    if (entry.simDays > asOf) break
    chosen = entry
  }
  return { location: chosen.location, order: chosen.order, combat: chosen.combat }
}

// One-line convenience for the many marker/line components that just want
// "where should this render, accounting for comms delay" — wraps
// visualShipSnapshot + the existing getShipRenderPosition (shipPhysics.ts),
// itself completely untouched by this feature.
export function visualShipRenderPosition(ship: ShipInstance, delayDays: number, simDays: number): ShipRenderInfo {
  if (delayDays <= 0) return getShipRenderPosition(ship, simDays)
  const snap = visualShipSnapshot(ship, delayDays, simDays)
  const asOf = simDays - delayDays
  return getShipRenderPosition({ ...ship, location: snap.location, order: snap.order }, asOf)
}

// The actual one-line swap every marker/camera-tracking call site uses in
// place of a plain getShipRenderPosition(ship, simDays) — resolves the
// player's own comms delay to `ship`'s current location and folds it in,
// so a caller never has to plumb playerCommsDelayToShip itself.
export function playerVisualShipRenderPosition(ship: ShipInstance, simDays: number): ShipRenderInfo {
  return visualShipRenderPosition(ship, playerCommsDelayToShip(ship, simDays), simDays)
}

// --- Command latency -----------------------------------------------------
//
// Strategic orders (move, hyperdrive jump, stance change) issued to a ship
// outside instant comms contact don't apply immediately — they queue and
// fire once the signal would actually have arrived. Move/hyperdrive
// destinations are kept RAW (a MoveDestination/starId), not pre-computed
// into a MoveOrder at issue time — the same reasoning ShipInstance.
// pendingHyperdriveJump already used before this feature existed: real
// travel timing can only be computed from the ship's true state once the
// command actually arrives, not from whatever was true when the player
// clicked. useCommsResolver re-runs planMove at that point, exactly the way
// useShipOrderSettler already does for a plain "jump when ready" queue.

// Applies a move destination immediately — the shared "no comms delay in the
// way" path used both by queueMoveOrder (delay ~0) and useCommsResolver
// (a queued order whose delay has finally elapsed). Mirrors exactly what
// each scene's own handleOrderToStar/handleOrderToBody/handleOrderToPoint
// already did with planMove's result before this feature existed — a `star`
// destination can still land on 'on-cooldown' (queues the EXISTING
// pendingHyperdriveJump mechanism, unrelated to comms — the ship received
// the order, its drive just isn't ready yet) or 'lost-in-hyperspace'.
// `planner` defaults to the player-gated planMove; the strategic AI passes
// planMoveUnchecked (it only ever moves its own nation's ships, and has no
// comms delay) so both go through this one result-applying path.
export function applyMoveDestination(
  ship: ShipInstance,
  destination: MoveDestination,
  simDays: number,
  planner: typeof planMove = planMove,
): void {
  applyMoveResult(ship, destination, planner(ship, destination, simDays))
}

// Applies one planner result to one ship — the handling every order shares.
export function applyMoveResult(ship: ShipInstance, destination: MoveDestination, result: MoveResult): void {
  const { setShipOrder, setShipLocation, setFtlCharge, setPendingHyperdriveJump, removeShip } = useShipStore.getState()
  const { addHyperlane } = useHyperlaneStore.getState()
  if (result.kind === 'order') {
    setShipOrder(ship.id, result.order, result.warpReadyOverride)
  } else if (result.kind === 'instant') {
    setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays })
    if (result.hyperlaneEstablished) addHyperlane(...result.hyperlaneEstablished)
  } else if (result.kind === 'on-cooldown' || result.kind === 'paused') {
    if (destination.kind === 'star') setPendingHyperdriveJump(ship.id, destination.starId)
  } else if (result.kind === 'lost-in-hyperspace') {
    removeShip(ship.id)
  } else if (result.kind === 'engaged' && result.charge) {
    setFtlCharge(ship.id, result.charge)
  }
  // 'unknown-class'/'not-owned': silently ignored — genuinely nothing to do,
  // same as every existing planMove caller already leaves them.
}

// Moves a whole fleet together, at its slowest ship's pace (see
// fleetMove.ts for how each member is planned).
export function applyFleetMove(
  ships: ShipInstance[],
  destination: MoveDestination,
  simDays: number,
  planner: typeof planMove = planMove,
): void {
  const engagements = useCombatStore.getState().engagements
  const plan = planFleetMove(ships, destination, simDays, planner, (s) => !!findEngagementFor(engagements, s.id))
  const store = useShipStore.getState()
  for (const { shipId, order, warpReadyOverride } of plan.orders) store.setShipOrder(shipId, order, warpReadyOverride)
  for (const { ship, result } of plan.individual) applyMoveResult(ship, destination, result)
  for (const { shipId, starId, atSimDays } of plan.deferredJumps) {
    useShipStore.getState().setPendingHyperdriveJump(shipId, starId, atSimDays)
  }
}

// Every ship in the same fleet as `ship` (including it).
export function fleetMembersOf(ship: ShipInstance, ships: ShipInstance[] = useShipStore.getState().ships): ShipInstance[] {
  return ships.filter((s) => s.fleetId === ship.fleetId)
}

// The player's map orders: every fleet that has a selected ship in it moves,
// each at its own slowest ship's pace. Only the player's own fleets; others
// are ignored (selecting an enemy is just looking at it).
export function orderSelectedFleets(destination: MoveDestination): void {
  const { ships, selectedShipIds } = useShipStore.getState()
  const fleetIds = new Set(ships.filter((s) => selectedShipIds.includes(s.id) && isPlayerOwned(s)).map((s) => s.fleetId))
  for (const fleetId of fleetIds) {
    const members = ships.filter((s) => s.fleetId === fleetId)
    if (members.length > 0) queueFleetMoveOrder(members, destination)
  }
}

// The single entry point scenes call instead of setShipOrder/
// setPendingHyperdriveJump directly for a right-click order (move OR a jump
// to a star — both are just a MoveDestination) — computes the player's own
// comms delay to the ship's CURRENT location and either applies the
// destination right away (instant contact) or stores it as a pending
// command that useCommsResolver fires once the signal arrives.
// A fleet's order: the comms delay is measured to its lead ship (the fleet
// is together), and every member either moves now or gets the same pending
// deadline, so useCommsResolver later fires it as one fleet again.
export function queueFleetMoveOrder(ships: ShipInstance[], destination: MoveDestination): void {
  if (ships.length === 0) return
  const simDays = useGameTimeStore.getState().simDays
  const delay = playerCommsDelayToShip(ships[0], simDays)
  if (commsInstantContact(delay)) {
    applyFleetMove(ships, destination, simDays)
    return
  }
  for (const ship of ships) useShipStore.getState().setPendingMoveOrder(ship.id, { destination, arrivesSimDays: simDays + delay })
}

export function queueMoveOrder(ship: ShipInstance, destination: MoveDestination): void {
  const simDays = useGameTimeStore.getState().simDays
  const delay = playerCommsDelayToShip(ship, simDays)
  if (commsInstantContact(delay)) {
    applyMoveDestination(ship, destination, simDays)
    return
  }
  useShipStore.getState().setPendingMoveOrder(ship.id, { destination, arrivesSimDays: simDays + delay })
}

// Same idea for a stance change — trivial enough to just carry the value
// directly rather than needing planMove-style re-resolution at arrival.
export function queueStance(ship: ShipInstance, stance: ShipInstance['stance']): void {
  const simDays = useGameTimeStore.getState().simDays
  const delay = playerCommsDelayToShip(ship, simDays)
  if (commsInstantContact(delay)) {
    useShipStore.getState().setStance(ship.id, stance)
    return
  }
  useShipStore.getState().setPendingStance(ship.id, { stance, arrivesSimDays: simDays + delay })
}
