// The blackboard: one empire's view of the world for one planning pass,
// derived from a read-only snapshot of every relevant store. Built once per
// pass and shared by every agent, so they all reason from the same facts and
// nobody recomputes fleet power five times.
import type { ResourceId } from '../data/resourceData'
import type { Relation, War } from '../data/diplomacyData'
import type { ShipInstance } from '../state/shipStore'
import { atWarFrom, relationIn, type AtWarFn } from '../state/diplomacyStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { overallHealthFraction, totalHitPoints } from '../scene/combatResolution'
import { armiesAboard, armyCapacityOf, orbitedBody, type ArmyUnit } from '../scene/armyLogic'
import { bodiesOwnedBy, bodyStarId, controllerOf, type OwnerMap } from '../scene/territory'
import type { BodyValueFn } from '../scene/warScore'
import type { NodeHolderMap } from '../scene/groundLogic'

export interface CountryInfo {
  id: string
  capitalStarId: string
  capitalBodyName: string
}

// Everything the AI reads, captured at one instant. Plain data (plus a couple
// of lookups), so a test can hand-build one.
export interface AiSnapshot {
  simDays: number
  playerCountryId: string | null
  countries: CountryInfo[]
  ships: ShipInstance[]
  // Ships currently in a space battle — the AI leaves those to the combat
  // resolver and their stances rather than yanking them out mid-fight.
  engagedShipIds: Set<string>
  armies: ArmyUnit[]
  owners: OwnerMap
  controllers: OwnerMap
  // The planetary maps' front lines (territoryStore.nodeHolders).
  nodeHolders: NodeHolderMap
  relations: Record<string, Relation>
  wars: War[]
  resourcesOf: (countryId: string) => Record<ResourceId, number>
  buildQueueLengthOf: (countryId: string) => number
  valueOf: BodyValueFn
  // Something on the ground (enemy defense batteries) denies this nation the
  // orbit of this body. Optional: absent = nothing does.
  orbitDenied?: (countryId: string, bodyName: string) => boolean
  // Enemy defense installations (any kind) standing on this body, for this
  // nation — the marshal bombards them before landing. Optional: absent = none.
  hostileDefensesAt?: (countryId: string, bodyName: string) => number
  // Nodes an enemy planetary shield covers, for a nation landing here.
  shieldedFor?: (countryId: string, bodyName: string) => (node: number) => boolean
}

export interface Threat {
  bodyName: string
  hostilePower: number
}

export interface Blackboard {
  countryId: string
  capital: CountryInfo
  atWar: AtWarFn
  // Nations this empire is at war with, and those wars.
  enemies: string[]
  wars: War[]
  myWarships: ShipInstance[]
  myTransports: ShipInstance[]
  // Resting (no order), in orbit, not in a battle — free to be tasked.
  idleWarships: ShipInstance[]
  idleTransports: ShipInstance[]
  power: number
  powerOf: (countryId: string) => number
  // Armed power of `countryId`'s ships orbiting `bodyName` (resting or not).
  powerAt: (countryId: string, bodyName: string) => number
  // Armed power of every nation at war with this empire, orbiting `bodyName`.
  hostilePowerAt: (bodyName: string) => number
  // Bodies this empire controls that are under attack — hostile warships in
  // orbit, or hostile armies on the ground.
  threats: Threat[]
  // Systems where this empire owns something: where it lives and fights.
  theatreStars: Set<string>
  // Nations owning bodies in this empire's theatre.
  neighbours: string[]
  opinionOf: (otherId: string) => number
  truceWith: (otherId: string) => boolean
  resources: Record<ResourceId, number>
  buildQueueLength: number
  // Assault armies on the capital, ready to board.
  assaultArmiesHome: ArmyUnit[]
  // All assault armies, wherever they are (including training/aboard).
  assaultArmyCount: number
}

export function shipPower(ship: ShipInstance): number {
  const shipClass = resolveShipClass(ship.classId)
  if (!shipClass || shipClass.combat.weapons.length === 0) return 0
  return totalHitPoints(shipClass.combat) * overallHealthFraction(ship.combat, shipClass.combat)
}

function isArmedShip(ship: ShipInstance): boolean {
  return (resolveShipClass(ship.classId)?.combat.weapons.length ?? 0) > 0
}

export function isIdle(ship: ShipInstance, snap: AiSnapshot): boolean {
  return !ship.order && !ship.pendingHyperdriveJump && !snap.engagedShipIds.has(ship.id) && ship.location.kind === 'orbiting'
}

export function buildBlackboard(countryId: string, snap: AiSnapshot): Blackboard {
  const capital = snap.countries.find((c) => c.id === countryId)!
  const atWar = atWarFrom(snap.relations)
  const wars = snap.wars.filter((w) => w.attackerId === countryId || w.defenderId === countryId)
  const enemies = wars.map((w) => (w.attackerId === countryId ? w.defenderId : w.attackerId))

  const mine = snap.ships.filter((s) => s.ownerId === countryId)
  const myWarships = mine.filter(isArmedShip)
  const myTransports = mine.filter((s) => armyCapacityOf(s) > 0)

  const powerByCountry = new Map<string, number>()
  const powerByCountryBody = new Map<string, number>()
  for (const s of snap.ships) {
    const p = shipPower(s)
    if (p <= 0) continue
    powerByCountry.set(s.ownerId, (powerByCountry.get(s.ownerId) ?? 0) + p)
    const body = orbitedBody(s)
    if (body) powerByCountryBody.set(`${s.ownerId}|${body}`, (powerByCountryBody.get(`${s.ownerId}|${body}`) ?? 0) + p)
  }
  const powerOf = (id: string) => powerByCountry.get(id) ?? 0
  const powerAt = (id: string, body: string) => powerByCountryBody.get(`${id}|${body}`) ?? 0
  const hostilePowerAt = (body: string) => enemies.reduce((sum, e) => sum + powerAt(e, body), 0)

  const theatreStars = new Set<string>()
  for (const body of bodiesOwnedBy(countryId, snap.owners)) {
    const star = bodyStarId(body)
    if (star) theatreStars.add(star)
  }
  const neighbourSet = new Set<string>()
  for (const [body, owner] of Object.entries(snap.owners)) {
    if (owner === countryId) continue
    const star = bodyStarId(body)
    if (star && theatreStars.has(star)) neighbourSet.add(owner)
  }

  const threats: Threat[] = []
  const controlled = new Set(
    Object.keys({ ...snap.owners, ...snap.controllers }).filter((b) => controllerOf(b, snap.owners, snap.controllers) === countryId),
  )
  for (const body of controlled) {
    const hostilePower = hostilePowerAt(body)
    const hostileArmies = snap.armies.some((a) => a.location.kind === 'body' && a.location.bodyName === body && atWar(a.ownerId, countryId))
    if (hostilePower > 0 || hostileArmies) threats.push({ bodyName: body, hostilePower })
  }

  const assault = snap.armies.filter((a) => a.ownerId === countryId && a.kind === 'assault')

  return {
    countryId,
    capital,
    atWar,
    enemies,
    wars,
    myWarships,
    myTransports,
    idleWarships: myWarships.filter((s) => isIdle(s, snap)),
    idleTransports: myTransports.filter((s) => isIdle(s, snap)),
    power: powerOf(countryId),
    powerOf,
    powerAt,
    hostilePowerAt,
    threats,
    theatreStars,
    neighbours: [...neighbourSet].sort(),
    opinionOf: (other) => relationIn(snap.relations, countryId, other).opinion,
    truceWith: (other) => snap.simDays < relationIn(snap.relations, countryId, other).truceUntilSimDays,
    resources: snap.resourcesOf(countryId),
    buildQueueLength: snap.buildQueueLengthOf(countryId),
    assaultArmiesHome: assault.filter((a) => a.location.kind === 'body' && a.location.bodyName === capital.capitalBodyName),
    assaultArmyCount: assault.length,
  }
}

// Cargo currently aboard one of this empire's transports.
export function cargoOf(transport: ShipInstance, snap: AiSnapshot): ArmyUnit[] {
  return armiesAboard(snap.armies, transport.id)
}
