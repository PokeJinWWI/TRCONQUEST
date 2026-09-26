// The Marshal: this empire's ground war. It keeps transports loaded at the
// capital, and once the Admiral's navy holds orbital superiority over the
// target it brings the transports in and lands them together, next to the
// enemy's weakest-held key node — but only when an estimate of the ground
// fight (wouldTakeBody) says the armies aboard would win. Otherwise they wait
// in orbit for reinforcements. Once down, the units are driven by the ground
// AI (scene/groundAI.ts). Empty transports go home to reload; with no invasion
// under way, loaded ones wait at home too.
import { AI_INVASION_POWER_RATIO } from '../data/aiData'
import { KEY_NODE_FORTIFICATION, TERRAIN, UNIT_TYPES, type UnitType } from '../data/groundData'
import type { ShipInstance } from '../state/shipStore'
import {
  embarkableArmies,
  armyCapacityOf,
  hasOrbitalSuperiority,
  makeUnits,
  orbitedBody,
  type Army,
} from '../scene/armyLogic'
import { armyInContact, defaultDropNode, groundSurface, landedUnits } from '../scene/groundLogic'
import { bodyStarId } from '../scene/territory'
import { cargoOf, type AiSnapshot, type Blackboard } from './blackboard'
import type { AgentOutput, AiMemory, Intent } from './types'

// Lanchester-style fighting value of a force: total attack × total defense.
// Defenders standing on their key nodes count their fortification and the
// city ground those sit on (militia hold the key nodes).
function fightingValue(units: { type: UnitType; strength: number }[], defending: boolean): number {
  let attack = 0
  let defense = 0
  for (const u of units) {
    const spec = UNIT_TYPES[u.type]
    attack += u.strength * spec.attack
    const dug = defending && spec.holdsPosition ? KEY_NODE_FORTIFICATION * TERRAIN.urban.defense * (spec.terrain.urban?.defense ?? 1) : 1
    defense += u.strength * spec.defense * dug
  }
  return attack * defense
}

// Would these armies, landed on `bodyName` now, take it? An instant estimate
// (the real fight is spatial — see groundResolution.ts — and far too costly
// to simulate every planning pass): their fighting value against that of
// every unit on the ground at war with them.
export function wouldTakeBody(countryId: string, bodyName: string, cargo: Army[], snap: AiSnapshot, atWar: (a: string, b: string) => boolean): boolean {
  if (cargo.length === 0) return false
  const defenders = landedUnits(snap.armies, bodyName).filter((u) => atWar(u.army.ownerId, countryId)).map((u) => u.unit)
  if (defenders.length === 0) return true
  const attackers = cargo.flatMap((a) => a.units)
  return fightingValue(attackers, false) >= AI_INVASION_POWER_RATIO * fightingValue(defenders, true)
}

// How many fresh assault armies it would take to capture `bodyName` as it
// stands (up to `max`; null if even that many wouldn't do it).
export function armiesNeededToTake(countryId: string, bodyName: string, snap: AiSnapshot, atWar: (a: string, b: string) => boolean, max = 16): number | null {
  for (let n = 1; n <= max; n++) {
    const force: Army[] = Array.from({ length: n }, (_, i) => ({
      id: `probe-${i}`,
      ownerId: countryId,
      kind: 'assault',
      units: makeUnits('assault'),
      location: { kind: 'body', bodyName },
    }))
    if (wouldTakeBody(countryId, bodyName, force, snap, atWar)) return n
  }
  return null
}

// Where to put an invasion down: as close as the rules allow to the enemy's
// weakest-held key node.
export function chooseDropNode(countryId: string, bodyName: string, cargo: Army[], snap: AiSnapshot, atWar: (a: string, b: string) => boolean): number | null {
  const surface = groundSurface(bodyName, snap.owners)
  if (!surface) return null
  const types = cargo.flatMap((a) => a.units.map((u) => u.type))
  return defaultDropNode(surface, types, countryId, snap.armies, snap.owners, snap.nodeHolders, atWar, snap.shieldedFor?.(countryId, bodyName))
}

function move(ship: ShipInstance, bodyName: string): Intent[] {
  const systemId = bodyStarId(bodyName)
  if (!systemId || orbitedBody(ship) === bodyName) return []
  return [{ kind: 'move-ship', shipId: ship.id, systemId, bodyName }]
}

export function marshal(bb: Blackboard, snap: AiSnapshot, memory: AiMemory): AgentOutput {
  const intents: Intent[] = []
  const home = bb.capital.capitalBodyName
  const target = memory.targetBody
  const transports = bb.idleTransports

  // Transports keep to their own fleet — fleets travel as one, and an
  // invasion convoy mustn't drag the battle fleet (or be dragged by it).
  const mixed = new Map<string, string[]>()
  for (const t of bb.myTransports) {
    if (snap.ships.some((s) => s.fleetId === t.fleetId && armyCapacityOf(s) === 0)) {
      mixed.set(t.fleetId, [...(mixed.get(t.fleetId) ?? []), t.id])
    }
  }
  for (const shipIds of mixed.values()) intents.push({ kind: 'split-fleet', shipIds })

  // Load whatever's waiting at home.
  for (const t of transports) {
    if (orbitedBody(t) !== home) continue
    const room = armyCapacityOf(t) - cargoOf(t, snap).length
    const boarding = embarkableArmies(t, snap.armies, (a) => armyInContact(a, snap.armies, bb.atWar))
      .filter((a) => !intents.some((i) => i.kind === 'embark' && i.armyIds.includes(a.id)))
      .slice(0, Math.max(0, room))
    if (boarding.length > 0) intents.push({ kind: 'embark', shipId: t.id, armyIds: boarding.map((a) => a.id) })
  }

  // Empty transports go home to pick up the next wave.
  for (const t of transports) if (cargoOf(t, snap).length === 0) intents.push(...move(t, home))

  // Warships holding the target's orbit bombard it while enemy defenses stand
  // there (batteries deny the landing; fortresses and shields make it bloody),
  // and stop once they're gone.
  if (target) {
    const overhead = bb.idleWarships.filter((s) => orbitedBody(s) === target)
    const defended = (snap.hostileDefensesAt?.(bb.countryId, target) ?? 0) > 0 && hasOrbitalSuperiority(bb.countryId, target, snap.ships, bb.atWar)
    for (const s of overhead) {
      const want = defended ? 'limited' : 'off'
      if ((s.bombardStance ?? 'off') !== want) intents.push({ kind: 'set-bombard', shipId: s.id, stance: want })
    }
  }

  const orbitSecured =
    !!target && bb.idleWarships.some((s) => orbitedBody(s) === target) && hasOrbitalSuperiority(bb.countryId, target, snap.ships, bb.atWar, snap.orbitDenied)

  if (target && orbitSecured) {
    const loaded = transports.filter((t) => cargoOf(t, snap).length > 0)
    const atTarget = loaded.filter((t) => orbitedBody(t) === target)
    const cargoAtTarget = atTarget.flatMap((t) => cargoOf(t, snap))
    if (atTarget.length > 0 && wouldTakeBody(bb.countryId, target, cargoAtTarget, snap, bb.atWar)) {
      // Every transport lands at the same site, so the invasion stays
      // concentrated.
      const dropNode = chooseDropNode(bb.countryId, target, cargoAtTarget, snap, bb.atWar)
      if (dropNode !== null) for (const t of atTarget) intents.push({ kind: 'land', shipId: t.id, dropNode })
    }
    for (const t of loaded) intents.push(...move(t, target))
    return { intents }
  }

  // No invasion under way: loaded transports wait at home, safe.
  if (!target) {
    for (const t of transports) if (cargoOf(t, snap).length > 0) intents.push(...move(t, home))
  }
  return { intents }
}
