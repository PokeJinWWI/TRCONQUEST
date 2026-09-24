// The ground war simulation: units on every world's planetary map moving,
// fighting what's in range, taking ground node by node, and taking the world
// itself by holding every key node. Pure — hooks/useGroundCombatResolver.ts
// reads the stores, calls stepGroundWar, and writes the result back (the same
// split as combatResolution vs useCombatResolver). Tuning is in
// data/groundData.ts.
//
// The clock is an integer step count (GROUND_STEPS_PER_DAY per sim-day), so
// every step is the same size and the result is bit-identical however the
// real clock was chopped up. Only whole steps run; a call that ends between
// steps stops short and the next call resumes from resolvedThroughStep.
// Stretches where nothing is happening anywhere are skipped in one jump.
//
// Each step, on every world where something is going on (hostile units on
// the ground, or units on the move), in name order:
//   1. The ground AI plans (once a sim-day).
//   2. Every unit picks a target: a manual one if still valid, otherwise the
//      nearest enemy within its range.
//   3. Damage is summed for everyone first, then applied together, so the
//      order units are listed in doesn't matter. Terrain, a held key node,
//      and being dug in all reduce it.
//   4. Units move along their paths — except that a unit under fire holds
//      its ground unless the player ordered the move.
//   5. Units at or below UNIT_DESTROYED_BELOW are destroyed.
//   6. Each unit takes the nodes around it for its nation, where nothing
//      hostile contests them.
//   7. If one nation at war with the world's holder holds every key node,
//      with no enemy units on any of them, the world is theirs (or liberated,
//      if it's their own).
//   8. Units resting on ground their nation holds recover strength.
import {
  ENTRENCH_AFTER_DAYS,
  ENTRENCHMENT_DEFENSE,
  GROUND_AI_INTERVAL_STEPS,
  GROUND_DAMAGE_RATE,
  GROUND_STEPS_PER_DAY,
  KEY_HOLD_RADIUS_CELLS,
  KEY_NODE_FORTIFICATION,
  MAX_GROUND_STEPS_PER_CALL,
  TERRAIN,
  UNIT_DESTROYED_BELOW,
  UNIT_REGEN_PER_DAY,
  UNIT_TYPES,
  CAPTURE_RADIUS_CELLS,
  type UnitType,
  type TerrainId,
} from '../data/groundData'
import type { AtWarFn } from '../state/diplomacyStore'
import type { Army, GroundUnit } from './armyLogic'
import { planAutonomous } from './groundAI'
import {
  cellsToRad,
  defaultDropNode,
  holderOf,
  hostilesWithin,
  landedUnits,
  musterNode,
  placeUnits,
  unitRangeRad,
  unitSpeedRadPerDay,
  type LandedUnit,
  type NodeHolderMap,
} from './groundLogic'
import { terrainAt, type BodySurface } from './planetTerrain'
import { arc, moveAlong, nearestNode, nodePoint, surfaceMesh } from './surfaceMesh'
import { controllerOf, type OwnerMap } from './territory'

export interface GroundWorld {
  armies: Army[]
  owners: OwnerMap
  controllers: OwnerMap
  nodeHolders: NodeHolderMap
  atWar: AtWarFn
  // Nations whose units the ground AI drives (everyone but the player).
  isAutonomous: (countryId: string) => boolean
  surfaceOf: (bodyName: string) => BodySurface | null
}

export interface Occupation {
  bodyName: string
  countryId: string
  simDays: number
}

export interface GroundLoss {
  ownerId: string
  bodyName: string
  unitType: UnitType
  maxStrength: number
  // Nations whose units were firing on it when it fell.
  killers: string[]
}

export interface GroundStepResult {
  armies: Army[]
  occupations: Occupation[]
  losses: GroundLoss[]
  // Per body: node → new holder, or null for "back to its owner".
  paints: Record<string, Record<number, string | null>>
  resolvedThroughStep: number
}

export function simDaysToGroundStep(simDays: number): number {
  return Math.floor(simDays * GROUND_STEPS_PER_DAY + 1e-9)
}

const DT = 1 / GROUND_STEPS_PER_DAY

function unitAttack(type: UnitType, terrain: TerrainId): number {
  return UNIT_TYPES[type].attack * (UNIT_TYPES[type].terrain[terrain]?.attack ?? 1)
}

function unitDefenseBase(type: UnitType, terrain: TerrainId): number {
  return UNIT_TYPES[type].defense * (UNIT_TYPES[type].terrain[terrain]?.defense ?? 1) * TERRAIN[terrain].defense
}

export function stepGroundWar(world: GroundWorld, fromStep: number, toSimDays: number): GroundStepResult {
  const toStep = simDaysToGroundStep(toSimDays)
  const occupations: Occupation[] = []
  const losses: GroundLoss[] = []
  const paints: Record<string, Record<number, string | null>> = {}
  if (toStep <= fromStep) return { armies: world.armies, occupations, losses, paints, resolvedThroughStep: fromStep }

  const { owners, atWar } = world
  const controllers = { ...world.controllers }
  // Copy-on-write node holders, per body.
  const holders: NodeHolderMap = { ...world.nodeHolders }
  const touchedHolders = new Set<string>()
  const setHolder = (body: string, node: number, countryId: string) => {
    if (!touchedHolders.has(body)) {
      holders[body] = { ...(holders[body] ?? {}) }
      touchedHolders.add(body)
    }
    const value = owners[body] === countryId ? null : countryId
    if (value === null) delete holders[body][node]
    else holders[body][node] = value
    ;(paints[body] ??= {})[node] = value
  }

  // Clone once, lazily, the first time anything changes.
  let armies = world.armies
  let cloned = false
  const mutable = () => {
    if (!cloned) {
      armies = armies.map((a) => ({ ...a, units: a.units.map((u) => ({ ...u })) }))
      cloned = true
    }
    return armies
  }

  const mesh = surfaceMesh()
  const keyRad = cellsToRad(KEY_HOLD_RADIUS_CELLS)
  const captureRad = cellsToRad(CAPTURE_RADIUS_CELLS)
  let k = fromStep
  let guard = 0

  while (k < toStep && guard < MAX_GROUND_STEPS_PER_CALL) {
    const t = k / GROUND_STEPS_PER_DAY

    // 1. Muster finished recruits, and put down any landed army whose units
    // have no position yet (spawned onto a body without a site).
    for (const army of armies) {
      const ready = army.location.kind === 'recruiting' && army.location.readySimDays <= t
      const unplaced = army.location.kind === 'body' && army.units.some((u) => !u.position)
      if (!ready && !unplaced) continue
      const list = mutable()
      const idx = list.findIndex((a) => a.id === army.id)
      const bodyName = army.location.kind === 'recruiting' || army.location.kind === 'body' ? army.location.bodyName : ''
      const surface = world.surfaceOf(bodyName)
      if (!surface) continue
      const holdsIt = controllerOf(bodyName, owners, controllers) === army.ownerId
      const anchor = holdsIt
        ? musterNode(surface)
        : defaultDropNode(surface, army.units.map((u) => u.type), army.ownerId, list, owners, holders, atWar) ?? musterNode(surface)
      list[idx] = { ...list[idx], location: { kind: 'body', bodyName }, units: placeUnits(surface, list[idx].units, anchor, k) }
    }

    // 2. Where is anything happening?
    const bodies = [...new Set(armies.filter((a) => a.location.kind === 'body').map((a) => (a.location as { bodyName: string }).bodyName))].sort()
    const active = bodies.filter((body) => {
      const here = landedUnits(armies, body)
      const holder = controllerOf(body, owners, controllers)
      if (here.some((u) => (u.unit.path?.length ?? 0) > 0)) return true
      if (holder && here.some((u) => atWar(u.army.ownerId, holder))) return true
      const owners_ = [...new Set(here.map((u) => u.army.ownerId))]
      return owners_.some((a) => owners_.some((b) => a < b && atWar(a, b)))
    })

    if (active.length === 0) {
      // Nothing moving or fighting anywhere: recover strength and jump to the
      // next recruit's muster (or the end).
      let next = toStep
      for (const a of armies) {
        if (a.location.kind === 'recruiting') next = Math.min(next, Math.max(k + 1, Math.ceil(a.location.readySimDays * GROUND_STEPS_PER_DAY - 1e-9)))
      }
      const days = (next - k) / GROUND_STEPS_PER_DAY
      regenIdle(days)
      guard += 1
      k = next
      continue
    }

    for (const body of active) stepBody(body)
    k += 1
    guard += 1
  }

  return {
    armies: cloned ? armies.filter((a) => a.units.length > 0) : armies,
    occupations,
    losses,
    paints,
    resolvedThroughStep: k,
  }

  function regenIdle(days: number) {
    if (days <= 0) return
    for (const army of armies) {
      if (army.location.kind !== 'body') continue
      const body = army.location.bodyName
      for (const unit of army.units) {
        if (!unit.position || unit.strength >= unit.maxStrength) continue
        const node = nearestNode(unit.position, 'fine', unit.nodeHint)
        if (holderOf(body, node, owners, holders) !== army.ownerId) continue
        const list = mutable()
        const target = list.find((a) => a.id === army.id)!.units.find((u) => u.id === unit.id)!
        target.strength = Math.min(target.maxStrength, target.strength + target.maxStrength * UNIT_REGEN_PER_DAY * days)
      }
    }
  }

  function stepBody(body: string) {
    const surface = world.surfaceOf(body)
    if (!surface) return
    mutable()
    const units: LandedUnit[] = landedUnits(armies, body).sort((a, b) => (a.unit.id < b.unit.id ? -1 : a.unit.id > b.unit.id ? 1 : 0))
    const radiusKm = surface.radiusKm

    // 1. Ground AI.
    if (k % GROUND_AI_INTERVAL_STEPS === 0) planAutonomous(surface, units, owners, holders, atWar, world.isAutonomous)

    // Where everyone stands.
    const nodeOf = new Map<string, number>()
    for (const { unit } of units) {
      const node = nearestNode(unit.position!, 'fine', unit.nodeHint)
      unit.nodeHint = node
      nodeOf.set(unit.id, node)
    }
    const terrainOf = (u: GroundUnit) => terrainAt(surface, nodeOf.get(u.id)!)
    const keys = surface.keySlots.map((s) => s.node)
    const fortified = (lu: LandedUnit) =>
      keys.some((key) => holderOf(body, key, owners, holders) === lu.army.ownerId && arc(lu.unit.position!, nodePoint(key)) <= keyRad)

    // 2. Targets.
    const byId = new Map(units.map((u) => [u.unit.id, u]))
    const shooters = new Map<string, string[]>()
    for (const lu of units) {
      const range = unitRangeRad(lu.unit.type)
      const inRange = units.filter((v) => atWar(v.army.ownerId, lu.army.ownerId) && arc(v.unit.position!, lu.unit.position!) <= range)
      let target: LandedUnit | undefined
      if (lu.unit.targetUnitId) target = inRange.find((v) => v.unit.id === lu.unit.targetUnitId)
      if (!target) {
        target = inRange.sort(
          (a, b) => arc(a.unit.position!, lu.unit.position!) - arc(b.unit.position!, lu.unit.position!) || (a.unit.id < b.unit.id ? -1 : 1),
        )[0]
      }
      lu.unit.firingAtId = target?.unit.id ?? null
      if (target) shooters.set(target.unit.id, [...(shooters.get(target.unit.id) ?? []), lu.army.ownerId])
    }

    // 3. Damage, summed then applied.
    const damage = new Map<string, number>()
    for (const lu of units) {
      if (!lu.unit.firingAtId) continue
      const v = byId.get(lu.unit.firingAtId)!
      const tv = terrainOf(v.unit)
      const entrenched =
        v.unit.stillSinceStep !== undefined && !(v.unit.path?.length) && k - v.unit.stillSinceStep >= ENTRENCH_AFTER_DAYS * GROUND_STEPS_PER_DAY
      const defense =
        unitDefenseBase(v.unit.type, tv) * (fortified(v) ? KEY_NODE_FORTIFICATION : 1) * (entrenched ? ENTRENCHMENT_DEFENSE : 1)
      const dealt = (lu.unit.strength * unitAttack(lu.unit.type, terrainOf(lu.unit)) * GROUND_DAMAGE_RATE * DT) / defense
      damage.set(v.unit.id, (damage.get(v.unit.id) ?? 0) + dealt)
    }

    // 4. Movement.
    for (const { unit } of units) {
      if (!unit.path || unit.path.length === 0) continue
      if (unit.firingAtId && !unit.orderedMove) continue
      const budget = unitSpeedRadPerDay(unit.type, radiusKm, terrainOf(unit)) * DT
      const moved = moveAlong(unit.position!, unit.path, budget)
      unit.position = moved.position
      unit.path = moved.path
      unit.stillSinceStep = undefined
      if (moved.path.length === 0) {
        unit.orderedMove = false
        unit.stillSinceStep = k
      }
    }

    // 5. Casualties.
    for (const [id, dmg] of damage) {
      const lu = byId.get(id)!
      lu.unit.strength -= dmg
    }
    const dead = new Set(units.filter((lu) => lu.unit.strength <= UNIT_DESTROYED_BELOW).map((lu) => lu.unit.id))
    if (dead.size > 0) {
      for (const lu of units) {
        if (!dead.has(lu.unit.id)) continue
        losses.push({
          ownerId: lu.army.ownerId,
          bodyName: body,
          unitType: lu.unit.type,
          maxStrength: lu.unit.maxStrength,
          killers: [...new Set(shooters.get(lu.unit.id) ?? [])],
        })
      }
      for (const army of armies) {
        if (army.location.kind === 'body' && army.location.bodyName === body) army.units = army.units.filter((u) => !dead.has(u.id))
      }
    }
    const alive = units.filter((lu) => !dead.has(lu.unit.id))
    for (const lu of alive) {
      if (lu.unit.firingAtId && dead.has(lu.unit.firingAtId)) lu.unit.firingAtId = null
    }

    // 6. Taking ground.
    for (const lu of alive) {
      const here = nearestNode(lu.unit.position!, 'fine', lu.unit.nodeHint)
      for (const node of [here, ...mesh.neighbors.fine[here]]) {
        const point = nodePoint(node)
        if (arc(point, lu.unit.position!) > captureRad) continue
        if (!TERRAIN[terrainAt(surface, node)].paintable) continue
        const h = holderOf(body, node, owners, holders)
        if (!h || h === lu.army.ownerId || !atWar(h, lu.army.ownerId)) continue
        if (hostilesWithin(point, captureRad, lu.army.ownerId, alive, atWar).length > 0) continue
        setHolder(body, node, lu.army.ownerId)
      }
    }

    // 7. The key-node rule.
    const controller = controllerOf(body, owners, controllers)
    if (keys.length > 0 && controller) {
      const keyHolders = keys.map((key) => holderOf(body, key, owners, holders))
      const x = keyHolders[0]
      const uncontested = !!x && keys.every((key) => hostilesWithin(nodePoint(key), keyRad, x, alive, atWar).length === 0)
      if (x && x !== controller && keyHolders.every((h) => h === x) && atWar(x, controller) && uncontested) {
        if (owners[body] === x) delete controllers[body]
        else controllers[body] = x
        occupations.push({ bodyName: body, countryId: x, simDays: (k + 1) / GROUND_STEPS_PER_DAY })
      }
    }

    // 8. Recovery for units resting on their own ground.
    for (const lu of alive) {
      const u = lu.unit
      if (u.firingAtId || (u.path?.length ?? 0) > 0 || u.strength >= u.maxStrength) continue
      const node = nearestNode(u.position!, 'fine', u.nodeHint)
      if (holderOf(body, node, owners, holders) !== lu.army.ownerId) continue
      u.strength = Math.min(u.maxStrength, u.strength + u.maxStrength * UNIT_REGEN_PER_DAY * DT)
    }
  }
}
