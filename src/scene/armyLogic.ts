// Ground war: armies and their units, transports, and the rules for getting
// onto and off a world. Pure functions over plain army lists and territory
// maps. The fighting itself is scene/groundResolution.ts (stepped by
// hooks/useGroundCombatResolver.ts); the surface-aware helpers (paths, drop
// sites, contact) are scene/groundLogic.ts.
//
// The model:
//   - An army is a formation of typed units (data/armyData.ts). It lives ON
//     a body (its units then have positions on the planetary map), is
//     embarked on a transport, or is still being recruited.
//   - A transport in orbit of an enemy world can land its armies (invade)
//     only once its nation holds orbital superiority there: no armed ship of
//     a nation at war with it is orbiting that body. The player picks the
//     drop site; it must be walkable for every unit aboard and clear of
//     enemy units.
//   - On the ground, units only fight what's within their range on the map.
//     A world changes hands when one nation at war with its holder holds
//     every key node (capital, cities, spaceport or outpost) with no enemy
//     units standing on them (see groundResolution.ts).
//   - A transport destroyed with armies aboard takes them down with it.
import { ARMY_KINDS, type ArmyKind } from '../data/armyData'
import { UNIT_TYPES, type UnitType } from '../data/groundData'
import type { ShipInstance } from '../state/shipStore'
import type { AtWarFn } from '../state/diplomacyStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { controllerOf, type OwnerMap } from './territory'
import type { SurfacePoint } from './surfaceMesh'

export type ArmyLocation =
  | { kind: 'body'; bodyName: string }
  | { kind: 'embarked'; shipId: string }
  | { kind: 'recruiting'; bodyName: string; readySimDays: number }

// One unit on the planetary map — a battalion, brigade or regiment, standing
// for many people (see UNIT_TYPES[type].personnel).
export interface GroundUnit {
  id: string
  type: UnitType
  strength: number
  maxStrength: number
  // Where it stands (a unit vector on the body's globe). Set whenever its
  // army is on a body; absent aboard a transport or in training.
  position?: SurfacePoint
  // Remaining waypoints of its current move.
  path?: SurfacePoint[]
  // The move is a player's order (it's carried out even under fire) rather
  // than the ground AI's plan (which halts to fight).
  orderedMove?: boolean
  // A manual focus-fire target, if one is set and still valid.
  targetUnitId?: string | null
  // Who it fired at last step (derived, for fire lines and "engaged").
  firingAtId?: string | null
  // The ground AI's current goal (a fine node), autonomous units only.
  objectiveNode?: number | null
  // Cache of its nearest fine node — never authoritative.
  nodeHint?: number
  // The ground step it last came to a stop (for entrenchment).
  stillSinceStep?: number
}

export interface Army {
  id: string
  ownerId: string
  kind: ArmyKind
  units: GroundUnit[]
  location: ArmyLocation
}

// Kept as a name for the formation type across the codebase.
export type ArmyUnit = Army

export function armyStrength(army: Army): { strength: number; max: number } {
  let strength = 0
  let max = 0
  for (const u of army.units) {
    strength += u.strength
    max += u.maxStrength
  }
  return { strength, max }
}

// Personnel still standing in a unit (its full complement scaled by strength).
export function unitPersonnel(unit: GroundUnit): number {
  return Math.round((UNIT_TYPES[unit.type].personnel * unit.strength) / unit.maxStrength)
}

let unitCounter = 0

// A fresh formation's units, at `strengthFraction` of full strength.
export function makeUnits(kind: ArmyKind, strengthFraction = 1): GroundUnit[] {
  return ARMY_KINDS[kind].units.map((type) => {
    unitCounter += 1
    const max = UNIT_TYPES[type].maxStrength
    return { id: `unit-${Date.now().toString(36)}-${unitCounter}`, type, strength: max * strengthFraction, maxStrength: max }
  })
}

type ShipLike = Pick<ShipInstance, 'id' | 'ownerId' | 'classId' | 'location'>

export function armyCapacityOf(ship: Pick<ShipInstance, 'classId'>): number {
  return resolveShipClass(ship.classId)?.armyCapacity ?? 0
}

export function isArmed(ship: Pick<ShipInstance, 'classId'>): boolean {
  return (resolveShipClass(ship.classId)?.combat.weapons.length ?? 0) > 0
}

export function orbitedBody(ship: Pick<ShipInstance, 'location'>): string | null {
  return ship.location.kind === 'orbiting' ? ship.location.bodyName : null
}

export function armiesOnBody(armies: Army[], bodyName: string): Army[] {
  return armies.filter((a) => a.location.kind === 'body' && a.location.bodyName === bodyName)
}

export function armiesAboard(armies: Army[], shipId: string): Army[] {
  return armies.filter((a) => a.location.kind === 'embarked' && a.location.shipId === shipId)
}

// Armed ships of any nation at war with `countryId`, orbiting `bodyName`.
// These are what deny orbital superiority. Unarmed hulls, including the
// enemy's own transports, don't count.
export function hostileWarshipsAt(countryId: string, bodyName: string, ships: ShipLike[], atWarFn: AtWarFn): ShipLike[] {
  return ships.filter((s) => orbitedBody(s) === bodyName && atWarFn(countryId, s.ownerId) && isArmed(s))
}

export function hasOrbitalSuperiority(countryId: string, bodyName: string, ships: ShipLike[], atWarFn: AtWarFn): boolean {
  return hostileWarshipsAt(countryId, bodyName, ships, atWarFn).length === 0
}

// Is a ground war going on at this body — units of a nation at war with its
// holder on the ground?
export function isBodyContested(bodyName: string, armies: Army[], owners: OwnerMap, controllers: OwnerMap, atWarFn: AtWarFn): boolean {
  const controller = controllerOf(bodyName, owners, controllers)
  if (!controller) return false
  return armiesOnBody(armies, bodyName).some((a) => atWarFn(a.ownerId, controller))
}

export type Check = { ok: true } | { ok: false; reason: string }

// Can these armies board this transport? They must be the transport's
// nation's field armies, on the body it's orbiting, with none of their
// units in contact with the enemy, and there must be room aboard.
export function canEmbark(armyIds: string[], transport: ShipLike, armies: Army[], inContact: (army: Army) => boolean): Check {
  const capacity = armyCapacityOf(transport)
  if (capacity <= 0) return { ok: false, reason: 'Not a troop transport' }
  const body = orbitedBody(transport)
  if (!body) return { ok: false, reason: 'Transport must be in orbit' }
  const aboard = armiesAboard(armies, transport.id).length
  if (aboard + armyIds.length > capacity) return { ok: false, reason: `Room for ${capacity - aboard} more` }
  for (const id of armyIds) {
    const army = armies.find((a) => a.id === id)
    if (!army) return { ok: false, reason: 'Unknown army' }
    if (army.ownerId !== transport.ownerId) return { ok: false, reason: 'Not your army' }
    if (!ARMY_KINDS[army.kind].canEmbark) return { ok: false, reason: `${ARMY_KINDS[army.kind].name}s can't embark` }
    if (army.location.kind !== 'body' || army.location.bodyName !== body) return { ok: false, reason: 'Army is not on this body' }
    if (inContact(army)) return { ok: false, reason: `${ARMY_KINDS[army.kind].name} is in contact with the enemy` }
  }
  return { ok: true }
}

// Which of the transport's nation's armies could board it right now.
export function embarkableArmies(transport: ShipLike, armies: Army[], inContact: (army: Army) => boolean = () => false): Army[] {
  const body = orbitedBody(transport)
  if (!body) return []
  return armiesOnBody(armies, body).filter((a) => a.ownerId === transport.ownerId && ARMY_KINDS[a.kind].canEmbark && !inContact(a))
}

export type LandingKind = 'invade' | 'disembark'

// Can this transport put its armies down on the body it's orbiting, and is
// that an invasion or just unloading at home? Unloading needs the body to be
// controlled by the transport's nation. Anything else is an invasion, and
// needs war with the controller and orbital superiority (retaking your own
// occupied world is an invasion too). Where on the surface is checked
// separately (groundLogic.dropCheck).
export function landingCheck(
  transport: ShipLike,
  armies: Army[],
  ships: ShipLike[],
  owners: OwnerMap,
  controllers: OwnerMap,
  atWarFn: AtWarFn,
): { ok: true; kind: LandingKind; bodyName: string } | { ok: false; reason: string } {
  const body = orbitedBody(transport)
  if (!body) return { ok: false, reason: 'Transport must be in orbit' }
  if (armiesAboard(armies, transport.id).length === 0) return { ok: false, reason: 'No armies aboard' }
  const controller = controllerOf(body, owners, controllers)
  const me = transport.ownerId
  if (controller === me) return { ok: true, kind: 'disembark', bodyName: body }
  if (!controller) return { ok: false, reason: 'Nobody holds this body to invade' }
  if (!atWarFn(me, controller)) return { ok: false, reason: 'Not at war with its holder' }
  if (!hasOrbitalSuperiority(me, body, ships, atWarFn)) return { ok: false, reason: 'Enemy warships hold the orbit' }
  return { ok: true, kind: 'invade', bodyName: body }
}

// Every ground war going on right now, for the UI: the holder's forces
// against everyone on the ground at war with it.
export interface GroundBattle {
  bodyName: string
  defenderId: string
  attackerIds: string[]
  defenderStrength: number
  defenderMaxStrength: number
  attackerStrength: number
  attackerMaxStrength: number
}

export function groundBattles(armies: Army[], owners: OwnerMap, controllers: OwnerMap, atWarFn: AtWarFn): GroundBattle[] {
  const bodies = new Set<string>()
  for (const a of armies) if (a.location.kind === 'body') bodies.add(a.location.bodyName)
  const battles: GroundBattle[] = []
  for (const body of bodies) {
    const controller = controllerOf(body, owners, controllers)
    if (!controller) continue
    const here = armiesOnBody(armies, body)
    const attackers = here.filter((a) => atWarFn(a.ownerId, controller))
    if (attackers.length === 0) continue
    const defenders = here.filter((a) => a.ownerId === controller)
    const total = (list: Army[]) => list.reduce((acc, a) => {
      const s = armyStrength(a)
      return { strength: acc.strength + s.strength, max: acc.max + s.max }
    }, { strength: 0, max: 0 })
    const d = total(defenders)
    const at = total(attackers)
    battles.push({
      bodyName: body,
      defenderId: controller,
      attackerIds: [...new Set(attackers.map((a) => a.ownerId))].sort(),
      defenderStrength: d.strength,
      defenderMaxStrength: d.max,
      attackerStrength: at.strength,
      attackerMaxStrength: at.max,
    })
  }
  return battles.sort((a, b) => a.bodyName.localeCompare(b.bodyName))
}

// Armies aboard ships that no longer exist are lost with them.
export function reapLostCargo(armies: Army[], liveShipIds: Set<string>): Army[] {
  const kept = armies.filter((a) => a.location.kind !== 'embarked' || liveShipIds.has(a.location.shipId))
  return kept.length === armies.length ? armies : kept
}
