// Ship automation, Stellaris-style: a toggle on a ship that lets it find its
// own work.
//  - Science 'survey': when idle, survey the nearest system that isn't fully
//    surveyed and that no allied ship is already surveying (or headed to
//    survey), then the next.
//  - Construction 'build': keep a Starbase kit in the hold (from a Cargo Ship
//    in the same place, else the nearest owned world), and build Starbases at
//    the nearest system it may build in that no allied Construction Ship is
//    already headed for.
//  - Construction 'refill': only keep the hold topped up.
// An automated ship acts on its own, so nothing here waits on comms delay; a
// manual order to it turns automation off (shipStore). Pure planning
// (pickSurveyTarget, pickStarbaseTarget) is separate from the store I/O
// (resolveAutomation, run daily by hooks/useAutomationResolver).
import { STARS } from '../data/starData'
import { STARBASE_COST } from '../data/starbaseData'
import type { ResourceCost } from '../data/shipyardData'
import { resolveShipClass } from '../state/shipClassResolver'
import { useShipStore, type MoveDestination, type ShipInstance } from '../state/shipStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useStarbaseStore, canBuildStarbase } from '../state/starbaseStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { relationOfOwner } from '../state/shipRelations'
import { cargoCovers, cargoSpace, clampToSpace, loadingBody, transferCheck } from './cargoLogic'
import { applyShipCommand } from './shipCommands'
import { planMoveUnchecked, restingDestinationOf } from './shipPhysics'
import { nearestStation, refillWant } from './refill'
import { restingStarId, systemOfShip, unsurveyedBodies, type NationIntel } from './surveyLogic'
import { bodyStarId, systemBodies, type OwnerMap } from './territory'
import { canColonize } from './colonies'
import { orbitedBody } from './armyLogic'

export type Automation = 'survey' | 'build' | 'refill' | 'receive' | 'distribute' | 'settle'

// Which automations a ship's role offers.
export function automationsFor(role: string | undefined): Automation[] {
  if (role === 'science') return ['survey']
  if (role === 'construction') return ['build', 'refill', 'receive']
  if (role === 'cargo') return ['refill', 'distribute']
  if (role === 'colony') return ['settle']
  return []
}

export function has(ship: { automations?: Automation[] | null }, mode: Automation): boolean {
  return !!ship.automations?.includes(mode)
}

export const AUTOMATION_LABELS: Record<Automation, string> = {
  survey: 'Auto-survey',
  build: 'Auto-build Starbases',
  refill: 'Auto-refill',
  receive: 'Receiving',
  distribute: 'Distributing',
  settle: 'Auto-settle',
}

function starPos(starId: string): [number, number, number] {
  return STARS.find((s) => s.id === starId)?.position ?? [0, 0, 0]
}

function lyBetween(a: string, b: string): number {
  const p = starPos(a)
  const q = starPos(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

// Nearest charted system (from `fromStarId`) with something left to survey,
// skipping `claimed` (systems allied ships are already surveying).
export function pickSurveyTarget(fromStarId: string, nationId: string, intel: NationIntel | undefined, owners: OwnerMap, claimed: ReadonlySet<string>): string | null {
  const candidates = STARS.filter((s) => s.hasSystemData && systemBodies(s.id).length > 0 && !claimed.has(s.id) && unsurveyedBodies(intel, nationId, s.id, owners).length > 0)
  candidates.sort((a, b) => lyBetween(fromStarId, a.id) - lyBetween(fromStarId, b.id) || a.id.localeCompare(b.id))
  return candidates[0]?.id ?? null
}

// Nearest star where `canBuild` says a Starbase may go, skipping `claimed`.
export function pickStarbaseTarget(fromStarId: string, canBuild: (starId: string) => boolean, claimed: ReadonlySet<string>): string | null {
  const candidates = STARS.filter((s) => s.hasSystemData && !claimed.has(s.id) && canBuild(s.id))
  candidates.sort((a, b) => lyBetween(fromStarId, a.id) - lyBetween(fromStarId, b.id) || a.id.localeCompare(b.id))
  return candidates[0]?.id ?? null
}

// Allied for automation: the same nation, or one the owner counts as allied.
function alliedTo(ship: ShipInstance, other: ShipInstance): boolean {
  return other.ownerId === ship.ownerId || relationOfOwner(other.ownerId, ship.ownerId) === 'allied'
}

// Systems allied science ships are surveying, or flying off to survey.
export function claimedSurveySystems(ship: ShipInstance, ships: ShipInstance[]): Set<string> {
  const out = new Set<string>()
  for (const o of ships) {
    if (o.id === ship.id || !alliedTo(ship, o)) continue
    if (o.surveyJob) out.add(o.surveyJob.starId)
    for (const p of o.pendingCommands ?? []) if (p.command.kind === 'survey' && p.command.starId) out.add(p.command.starId)
  }
  return out
}

// Stars allied Construction Ships are on their way to build at.
function claimedStarbaseStars(ship: ShipInstance, ships: ShipInstance[]): Set<string> {
  const out = new Set<string>()
  for (const o of ships) {
    if (o.id === ship.id || !alliedTo(ship, o)) continue
    if (o.arrivalCommand?.command.kind === 'build-starbase') out.add(o.arrivalCommand.starId)
  }
  return out
}

// Where the ship is, as a star (its system, or the star it rests beside).
function hereStar(ship: ShipInstance): string | null {
  return systemOfShip(ship) ?? restingStarId(ship)
}

// Busy: flying, working, or waiting on an order in flight.
function busy(ship: ShipInstance): boolean {
  return !!ship.order || !!ship.surveyJob || !!ship.arrivalCommand || !!ship.pendingMoveOrder || (ship.pendingCommands?.length ?? 0) > 0 || !!ship.founding
}

// The ship's own move (not an order from the capital): no comms delay, and it
// keeps what it is doing (keepFollowing).
function moveNow(ship: ShipInstance, destination: MoveDestination, simDays: number): boolean {
  const { setShipOrder, setShipLocation, removeShip } = useShipStore.getState()
  const result = planMoveUnchecked(ship, destination, simDays)
  if (result.kind === 'order') {
    setShipOrder(ship.id, result.order, result.warpReadyOverride, true)
    return true
  }
  if (result.kind === 'instant') {
    setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays }, true)
    if (result.hyperlaneEstablished) useHyperlaneStore.getState().addHyperlane(...result.hyperlaneEstablished)
    return true
  }
  if (result.kind === 'lost-in-hyperspace') removeShip(ship.id)
  return false
}

// Tops up the hold toward `want`: from a Cargo Ship resting with it, at an
// owned world where it is, or by flying to the nearest owned world to load
// there. Returns whether it did anything.
function refill(ship: ShipInstance, want: ResourceCost, ships: ShipInstance[], owners: OwnerMap, simDays: number, stay = false): boolean {
  if (Object.keys(want).length === 0) return false
  const capacity = resolveShipClass(ship.classId)?.cargoCapacity ?? 0
  for (const donor of ships) {
    // Only Cargo Ships hand goods to a Construction Ship (never to each other).
    if (donor.id === ship.id || donor.ownerId !== ship.ownerId || resolveShipClass(donor.classId)?.role !== 'cargo' || resolveShipClass(ship.classId)?.role === 'cargo') continue
    if (!transferCheck(donor, ship).ok) continue
    const give = clampToSpace(want, donor.cargo ?? {}, cargoSpace(capacity, ship.cargo))
    if (Object.keys(give).length === 0) continue
    applyShipCommand(donor.id, { kind: 'transfer', toShipId: ship.id, want: give }, simDays)
    return true
  }
  if (loadingBody(ship, owners).ok) {
    applyShipCommand(ship.id, { kind: 'load', want }, simDays)
    return true
  }
  if (stay) return false
  const station = nearestStation(ship, owners, simDays)
  if (!station) return false
  // Remember where it was, to go back after loading (auto-refill's option).
  if (ship.automationReturn && !ship.autoHome) useShipStore.getState().setAutoHome(ship.id, restingDestinationOf(ship.location))
  useShipStore.getState().setArrivalCommand(ship.id, { starId: station.systemId, bodyName: station.bodyName, command: { kind: 'load', want } })
  if (!moveNow(ship, { kind: 'body', systemId: station.systemId, bodyName: station.bodyName }, simDays)) {
    useShipStore.getState().setArrivalCommand(ship.id, null)
    return false
  }
  return true
}

// Construction Ships in receiving mode that could take more goods, and that no
// other Cargo Ship is already bringing goods to.
function receiversNeedingGoods(cargoShip: ShipInstance, ships: ShipInstance[]): ShipInstance[] {
  const served = new Set(ships.filter((o) => o.arrivalCommand?.command.kind === 'transfer').map((o) => (o.arrivalCommand!.command as { toShipId: string }).toShipId))
  return ships.filter((o) => {
    if (o.ownerId !== cargoShip.ownerId || !has(o, 'receive') || served.has(o.id)) return false
    if (o.order || o.location.kind === 'interstellar-point' || o.location.kind === 'system-point') return false
    return Object.keys(refillWant(o.cargo, resolveShipClass(o.classId)?.cargoCapacity ?? 0)).length > 0
  })
}

// Distribution mode: bring goods to the nearest receiving Construction Ship
// that needs them; empty-handed, go load at the nearest world first.
function distribute(ship: ShipInstance, ships: ShipInstance[], owners: OwnerMap, simDays: number): boolean {
  const receivers = receiversNeedingGoods(ship, ships)
  if (receivers.length === 0) return false
  const carrying = Object.values(ship.cargo ?? {}).some((n) => (n ?? 0) > 0)
  if (!carrying) {
    return refill(ship, refillWant(ship.cargo, resolveShipClass(ship.classId)?.cargoCapacity ?? 0), ships, owners, simDays)
  }
  const from = hereStar(ship)
  if (!from) return false
  const target = receivers.filter((r) => hereStar(r)).sort((a, b) => lyBetween(from, hereStar(a)!) - lyBetween(from, hereStar(b)!) || a.id.localeCompare(b.id))[0]
  if (!target) return false
  const want = refillWant(target.cargo, resolveShipClass(target.classId)?.cargoCapacity ?? 0)
  const loc = target.location
  const starId = hereStar(target)!
  const dest: MoveDestination = loc.kind === 'orbiting' ? { kind: 'body', systemId: loc.systemId, bodyName: loc.bodyName } : { kind: 'star', starId }
  const command = { kind: 'transfer' as const, toShipId: target.id, want }
  // Already there: hand it over now.
  if (transferCheck(ship, target).ok) {
    applyShipCommand(ship.id, command, simDays)
    return true
  }
  useShipStore.getState().setArrivalCommand(ship.id, { starId, ...(loc.kind === 'orbiting' ? { bodyName: loc.bodyName } : {}), command })
  if (!moveNow(ship, dest, simDays)) {
    useShipStore.getState().setArrivalCommand(ship.id, null)
    return false
  }
  return true
}

// Auto-settle: found a colony on the cheapest world it may (a surveyed, unowned
// world with land, in a system of its nation's Starbase) that no other Colony
// Ship is already headed for.
function settle(ship: ShipInstance, ships: ShipInstance[], simDays: number): boolean {
  if ((ship.settlers ?? 0) <= 0) return false
  const claimed = new Set<string>()
  for (const o of ships) {
    if (o.id === ship.id) continue
    if (o.founding) claimed.add(o.founding.bodyName)
    if (o.arrivalCommand?.command.kind === 'colonize') claimed.add(o.arrivalCommand.command.bodyName)
  }
  let best: { body: string; cost: number } | null = null
  for (const body of useSurveyStore.getState().discovered[ship.ownerId]?.surveyed ?? []) {
    if (claimed.has(body)) continue
    const check = canColonize(ship, body, { anywhere: true })
    if (check.ok && (!best || check.cost < best.cost || (check.cost === best.cost && body < best.body))) best = { body, cost: check.cost }
  }
  const systemId = best ? bodyStarId(best.body) : undefined
  if (!best || !systemId) return false
  if (orbitedBody(ship) === best.body) {
    applyShipCommand(ship.id, { kind: 'colonize', bodyName: best.body }, simDays)
    return true
  }
  useShipStore.getState().setArrivalCommand(ship.id, { starId: systemId, bodyName: best.body, command: { kind: 'colonize', bodyName: best.body } })
  if (!moveNow(ship, { kind: 'body', systemId, bodyName: best.body }, simDays)) {
    useShipStore.getState().setArrivalCommand(ship.id, null)
    return false
  }
  return true
}

// One pass over every automated ship.
export function resolveAutomation(simDays: number): void {
  const owners = useTerritoryStore.getState().bodyOwner
  for (const snapshot of useShipStore.getState().ships) {
    if (!(snapshot.automations?.length)) continue
    const ship = useShipStore.getState().ships.find((s) => s.id === snapshot.id)
    if (!ship || busy(ship)) continue
    const ships = useShipStore.getState().ships
    const from = hereStar(ship)
    if (!from) continue
    // Modes in priority order; the first one with something to do acts.
    for (const mode of MODE_PRIORITY) {
      if (has(ship, mode) && runMode(mode, ship, ships, owners, from, simDays)) break
    }
  }
}

const MODE_PRIORITY: Automation[] = ['survey', 'settle', 'distribute', 'build', 'refill']

// Whether this mode found something to do (and did it).
function runMode(mode: Automation, ship: ShipInstance, ships: ShipInstance[], owners: OwnerMap, from: string, simDays: number): boolean {
  const capacity = resolveShipClass(ship.classId)?.cargoCapacity ?? 0
  // A receiving Construction Ship waits for a distributing Cargo Ship instead of
  // flying to load itself, when it has one.
  const stay = has(ship, 'receive') && ships.some((o) => o.ownerId === ship.ownerId && has(o, 'distribute'))
  if (mode === 'survey') {
    const intel = useSurveyStore.getState().discovered[ship.ownerId]
    const target = pickSurveyTarget(from, ship.ownerId, intel, owners, claimedSurveySystems(ship, ships))
    if (!target) return false
    applyShipCommand(ship.id, { kind: 'survey', starId: target }, simDays)
    return true
  }
  if (mode === 'settle') return settle(ship, ships, simDays)
  if (mode === 'distribute') return distribute(ship, ships, owners, simDays)
  if (mode === 'refill') {
    if (Object.keys(refillWant(ship.cargo, capacity)).length === 0) {
      if (!ship.autoHome) return false
      // Full again: back to where it was.
      const home = ship.autoHome
      useShipStore.getState().setAutoHome(ship.id, null)
      if (ship.automationReturn) moveNow(ship, home, simDays)
      return true
    }
    return refill(ship, refillWant(ship.cargo, capacity), ships, owners, simDays, stay) || stay
  }
  if (mode === 'build') {
    // At a world of its own it tops the hold up whenever it isn't full, not
    // only when a kit is missing.
    const wantMore = Object.keys(refillWant(ship.cargo, capacity)).length > 0
    if (!cargoCovers(ship.cargo, STARBASE_COST) || (wantMore && loadingBody(ship, owners).ok)) {
      refill(ship, refillWant(ship.cargo, capacity), ships, owners, simDays, stay)
      return true
    }
    const starbases = useStarbaseStore.getState().starbases
    const target = pickStarbaseTarget(from, (starId) => canBuildStarbase(ship.ownerId, starId, starbases, ship.id, { anywhere: true }).ok, claimedStarbaseStars(ship, ships))
    if (!target) return false
    if (restingStarId(ship) === target) {
      applyShipCommand(ship.id, { kind: 'build-starbase' }, simDays)
      return true
    }
    useShipStore.getState().setArrivalCommand(ship.id, { starId: target, command: { kind: 'build-starbase' } })
    if (!moveNow(ship, { kind: 'star', starId: target }, simDays)) useShipStore.getState().setArrivalCommand(ship.id, null)
    return true
  }
  return false
}
