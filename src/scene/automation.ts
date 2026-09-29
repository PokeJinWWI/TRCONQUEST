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
import { planMoveUnchecked } from './shipPhysics'
import { nearestStation, refillWant } from './refill'
import { restingStarId, systemOfShip, unsurveyedBodies, type NationIntel } from './surveyLogic'
import { systemBodies, type OwnerMap } from './territory'

export type Automation = 'survey' | 'build' | 'refill'

// Which automations a ship's role offers.
export function automationsFor(role: string | undefined): Automation[] {
  if (role === 'science') return ['survey']
  if (role === 'construction') return ['build', 'refill']
  return []
}

export const AUTOMATION_LABELS: Record<Automation, string> = {
  survey: 'Auto-survey',
  build: 'Auto-build Starbases',
  refill: 'Auto-refill',
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
function refill(ship: ShipInstance, want: ResourceCost, ships: ShipInstance[], owners: OwnerMap, simDays: number): boolean {
  if (Object.keys(want).length === 0) return false
  const capacity = resolveShipClass(ship.classId)?.cargoCapacity ?? 0
  for (const donor of ships) {
    if (donor.id === ship.id || donor.ownerId !== ship.ownerId || resolveShipClass(donor.classId)?.role !== 'cargo') continue
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
  const station = nearestStation(ship, owners, simDays)
  if (!station) return false
  useShipStore.getState().setArrivalCommand(ship.id, { starId: station.systemId, bodyName: station.bodyName, command: { kind: 'load', want } })
  if (!moveNow(ship, { kind: 'body', systemId: station.systemId, bodyName: station.bodyName }, simDays)) {
    useShipStore.getState().setArrivalCommand(ship.id, null)
    return false
  }
  return true
}

// One pass over every automated ship.
export function resolveAutomation(simDays: number): void {
  const owners = useTerritoryStore.getState().bodyOwner
  for (const snapshot of useShipStore.getState().ships) {
    if (!snapshot.automation) continue
    const ship = useShipStore.getState().ships.find((s) => s.id === snapshot.id)
    if (!ship || busy(ship)) continue
    const ships = useShipStore.getState().ships
    const from = hereStar(ship)
    if (!from) continue
    if (ship.automation === 'survey') {
      const intel = useSurveyStore.getState().discovered[ship.ownerId]
      const target = pickSurveyTarget(from, ship.ownerId, intel, owners, claimedSurveySystems(ship, ships))
      if (target) applyShipCommand(ship.id, { kind: 'survey', starId: target }, simDays)
      continue
    }
    const capacity = resolveShipClass(ship.classId)?.cargoCapacity ?? 0
    if (ship.automation === 'refill') {
      refill(ship, refillWant(ship.cargo, capacity), ships, owners, simDays)
      continue
    }
    if (ship.automation === 'build') {
      if (!cargoCovers(ship.cargo, STARBASE_COST)) {
        refill(ship, refillWant(ship.cargo, capacity), ships, owners, simDays)
        continue
      }
      const starbases = useStarbaseStore.getState().starbases
      const target = pickStarbaseTarget(from, (starId) => canBuildStarbase(ship.ownerId, starId, starbases, ship.id, { anywhere: true }).ok, claimedStarbaseStars(ship, ships))
      if (!target) continue
      if (restingStarId(ship) === target) {
        applyShipCommand(ship.id, { kind: 'build-starbase' }, simDays)
        continue
      }
      useShipStore.getState().setArrivalCommand(ship.id, { starId: target, command: { kind: 'build-starbase' } })
      if (!moveNow(ship, { kind: 'star', starId: target }, simDays)) useShipStore.getState().setArrivalCommand(ship.id, null)
    }
  }
}
