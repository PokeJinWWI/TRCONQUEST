// The terrain battle: the ground war at finer resolution, on real relief (see
// scene/terrainMap.ts for the ground). Pure. When hostile line units come close
// on the planetary map (TERRAIN_TRIGGER_CELLS) the units involved are lifted
// off the coarse sim into a TerrainBattle: the same units, ranges, speeds,
// damage rate, entrenchment and key-node fortification (data/groundData.ts),
// measured in the same fine cells, but on a relief grid — fine terrain under
// every unit, a height advantage for the shooter on the hill, slower going up
// and down steep ground — and with the player able to place and move units
// anywhere on the patch.
//
// Fixed 16 steps a day like the coarse sim, no randomness, so a battle is a
// pure function of its start and the orders given.
import {
  ENTRENCHMENT_DEFENSE,
  ENTRENCH_AFTER_DAYS,
  GROUND_AI_INTERVAL_STEPS,
  GROUND_DAMAGE_RATE,
  GROUND_STEPS_PER_DAY,
  HIGH_GROUND_BONUS,
  HIGH_GROUND_SPAN_M,
  KEY_HOLD_RADIUS_CELLS,
  KEY_NODE_FORTIFICATION,
  MAX_GROUND_STEPS_PER_CALL,
  SLOPE_FULL_M,
  SLOPE_PENALTY,
  TERRAIN,
  TERRAIN_GROUP_CELLS,
  TERRAIN_RELEASE_CELLS,
  TERRAIN_RELEASE_DAYS,
  TERRAIN_TRIGGER_CELLS,
  UNIT_DESTROYED_BELOW,
  UNIT_TYPES,
  type TerrainId,
  type UnitType,
} from '../data/groundData'
import type { AtWarFn } from '../state/diplomacyStore'
import type { GroundUnit } from './armyLogic'
import { MinHeap, holderOf, terrainSpeedFactor, unitRangeRad, unitSpeedRadPerDay, type LandedUnit, type NodeHolderMap } from './groundLogic'
import { TERRAIN_IDS, passableFor, type BodySurface } from './planetTerrain'
import { buildRelief, gridCell, gridPoint, heightAtLocal, makeFrame, terrainAtLocal, toGlobal, toLocal, type TerrainFrame, type TerrainGrid } from './terrainMap'
import { nodePoint, surfaceMesh, type SurfacePoint } from './surfaceMesh'
import type { OwnerMap } from './territory'

const DT = 1 / GROUND_STEPS_PER_DAY

export interface LocalPoint {
  x: number
  y: number
}

export interface TerrainUnit {
  id: string
  ownerId: string
  type: UnitType
  strength: number
  maxStrength: number
  x: number
  y: number
  path: LocalPoint[]
  // The move is a player's order (carried out under fire) rather than the AI's.
  orderedMove: boolean
  targetUnitId: string | null
  firingAtId: string | null
  stillSinceStep?: number
}

// A key node inside the patch, and who held it when the battle began.
export interface TerrainKey {
  x: number
  y: number
  holderId: string | undefined
}

export interface TerrainBattle {
  id: string
  bodyName: string
  radiusKm: number
  frame: TerrainFrame
  grid: TerrainGrid
  keys: TerrainKey[]
  units: TerrainUnit[]
  startedStep: number
  resolvedThroughStep: number
  // The step from which no hostile pair has been within TERRAIN_RELEASE_CELLS.
  quietSinceStep: number | null
}

export interface TerrainLoss {
  ownerId: string
  unitType: UnitType
  maxStrength: number
  killers: string[]
}

export type TerrainEnd = 'eliminated' | 'disengaged'

export interface TerrainStepResult {
  battle: TerrainBattle
  losses: TerrainLoss[]
  ended: TerrainEnd | null
}

export interface TerrainContext {
  atWar: AtWarFn
  isAutonomous: (countryId: string) => boolean
}

// --- Small helpers -----------------------------------------------------------

const dist = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.x - b.x, a.y - b.y)

// A unit's range in fine cells.
export function rangeCells(type: UnitType): number {
  return unitRangeRad(type) / surfaceMesh().fineSpacingRad
}

function unitAttack(type: UnitType, terrain: TerrainId): number {
  return UNIT_TYPES[type].attack * (UNIT_TYPES[type].terrain[terrain]?.attack ?? 1)
}

function unitDefenseBase(type: UnitType, terrain: TerrainId): number {
  return UNIT_TYPES[type].defense * (UNIT_TYPES[type].terrain[terrain]?.defense ?? 1) * TERRAIN[terrain].defense
}

// The shooter's advantage from height over its target, from -1 (all uphill) to
// 1 (all downhill), as the damage multiplier.
export function heightFactor(shooterM: number, targetM: number): number {
  const adv = Math.max(-1, Math.min(1, (shooterM - targetM) / HIGH_GROUND_SPAN_M))
  return 1 + HIGH_GROUND_BONUS * adv
}

// How much a step from one height to another slows a unit (1 = not at all).
export function slopeFactor(fromM: number, toM: number): number {
  const share = Math.min(1, Math.abs(toM - fromM) / SLOPE_FULL_M)
  return 1 / (1 + SLOPE_PENALTY * share)
}

// --- Paths -------------------------------------------------------------------

// Cheapest walk across the relief grid (A*, eight neighbours, terrain and slope
// costs) from a spot to a spot, for this kind of unit. Waypoints are grid
// points, ending exactly on `to`. Null when the goal can't be stood on or
// reached.
export function findLocalPath(grid: TerrainGrid, type: UnitType, from: LocalPoint, to: LocalPoint): LocalPoint[] | null {
  const n = grid.n
  const start = gridCell(grid, from.x, from.y)
  const goal = gridCell(grid, to.x, to.y)
  const s = start.j * n + start.i
  const g = goal.j * n + goal.i
  if (!passableFor(TERRAIN_IDS[grid.terrain[g]], type)) return null
  if (s === g) return [to]
  const cost = new Float64Array(n * n).fill(Infinity)
  const came = new Int32Array(n * n).fill(-1)
  const closed = new Uint8Array(n * n)
  const heap = new MinHeap()
  const gp = gridPoint(grid, goal.i, goal.j)
  const speed = (idx: number) => terrainSpeedFactor(type, TERRAIN_IDS[grid.terrain[idx]])
  cost[s] = 0
  heap.push(s, dist(gridPoint(grid, start.i, start.j), gp))
  while (heap.size > 0) {
    const cur = heap.pop()
    if (cur === g) break
    if (closed[cur]) continue
    closed[cur] = 1
    const ci = cur % n
    const cj = (cur - ci) / n
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue
        const ni = ci + di
        const nj = cj + dj
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue
        const nx = nj * n + ni
        if (closed[nx] || !passableFor(TERRAIN_IDS[grid.terrain[nx]], type)) continue
        const step = (Math.hypot(di, dj) / grid.perCell) * (0.5 / speed(cur) + 0.5 / speed(nx)) / slopeFactor(grid.height[cur], grid.height[nx])
        const c = cost[cur] + step
        if (c < cost[nx]) {
          cost[nx] = c
          came[nx] = cur
          const p = gridPoint(grid, ni, nj)
          heap.push(nx, c + dist(p, gp))
        }
      }
    }
  }
  if (came[g] === -1) return null
  const out: LocalPoint[] = [to]
  for (let cur = came[g]; cur !== -1 && cur !== s; cur = came[cur]) {
    const i = cur % n
    out.push(gridPoint(grid, i, (cur - i) / n))
  }
  return out.reverse()
}

// Walks `budget` cells along a path.
function walk(pos: LocalPoint, path: LocalPoint[], budget: number): { pos: LocalPoint; path: LocalPoint[] } {
  let p = pos
  let left = budget
  let i = 0
  while (i < path.length && left > 0) {
    const d = dist(p, path[i])
    if (d <= left) {
      left -= d
      p = path[i]
      i++
    } else {
      const t = left / d
      p = { x: p.x + (path[i].x - p.x) * t, y: p.y + (path[i].y - p.y) * t }
      left = 0
    }
  }
  return { pos: p, path: path.slice(i) }
}

// --- Stepping ----------------------------------------------------------------

function hostilePairWithin(units: TerrainUnit[], atWar: AtWarFn, cells: number): boolean {
  for (let a = 0; a < units.length; a++) {
    for (let b = a + 1; b < units.length; b++) {
      if (atWar(units[a].ownerId, units[b].ownerId) && dist(units[a], units[b]) <= cells) return true
    }
  }
  return false
}

// Advances a battle to `toStep` (whole ground steps). Never mutates its input.
export function stepTerrainBattle(input: TerrainBattle, ctx: TerrainContext, toStep: number): TerrainStepResult {
  const losses: TerrainLoss[] = []
  if (toStep <= input.resolvedThroughStep) return { battle: input, losses, ended: null }
  const { grid, keys } = input
  const perCellRad = surfaceMesh().fineSpacingRad
  let units = input.units.map((u) => ({ ...u, path: [...u.path] }))
  let quietSince = input.quietSinceStep
  let k = input.resolvedThroughStep
  let guard = 0
  let ended: TerrainEnd | null = null
  const keyRad = KEY_HOLD_RADIUS_CELLS

  while (k < toStep && guard < MAX_GROUND_STEPS_PER_CALL) {
    units.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const height = (u: TerrainUnit) => heightAtLocal(grid, u.x, u.y)
    const terrainOf = (u: TerrainUnit) => terrainAtLocal(grid, u.x, u.y)

    // 1. The AI: advance on the nearest enemy (not militia, not an ordered move).
    if (k % GROUND_AI_INTERVAL_STEPS === 0) {
      for (const u of units) {
        if (!ctx.isAutonomous(u.ownerId) || UNIT_TYPES[u.type].holdsPosition || u.orderedMove) continue
        const foes = units.filter((v) => ctx.atWar(v.ownerId, u.ownerId))
        if (foes.length === 0) continue
        const nearest = foes.reduce((best, v) => (dist(v, u) < dist(best, u) ? v : best), foes[0])
        u.path = dist(nearest, u) <= rangeCells(u.type) ? [] : findLocalPath(grid, u.type, u, nearest) ?? []
      }
    }

    // 2. Targets: the focus-fire target if in range, else the nearest in range.
    const byId = new Map(units.map((u) => [u.id, u]))
    const shooters = new Map<string, string[]>()
    for (const u of units) {
      const range = rangeCells(u.type)
      const inRange = units.filter((v) => ctx.atWar(v.ownerId, u.ownerId) && dist(v, u) <= range)
      let target: TerrainUnit | undefined
      if (u.targetUnitId) target = inRange.find((v) => v.id === u.targetUnitId)
      if (!target) target = inRange.sort((a, b) => dist(a, u) - dist(b, u) || (a.id < b.id ? -1 : 1))[0]
      u.firingAtId = target?.id ?? null
      if (target) shooters.set(target.id, [...(shooters.get(target.id) ?? []), u.ownerId])
    }

    // 3. Damage, summed then applied.
    const fortified = (u: TerrainUnit) => keys.some((key) => key.holderId === u.ownerId && dist(u, key) <= keyRad)
    const damage = new Map<string, number>()
    for (const u of units) {
      if (!u.firingAtId) continue
      const v = byId.get(u.firingAtId)!
      const entrenched = v.stillSinceStep !== undefined && v.path.length === 0 && k - v.stillSinceStep >= ENTRENCH_AFTER_DAYS * GROUND_STEPS_PER_DAY
      const defense = unitDefenseBase(v.type, terrainOf(v)) * (fortified(v) ? KEY_NODE_FORTIFICATION : 1) * (entrenched ? ENTRENCHMENT_DEFENSE : 1)
      const dealt = ((u.strength * unitAttack(u.type, terrainOf(u)) * GROUND_DAMAGE_RATE * DT) / defense) * heightFactor(height(u), height(v))
      damage.set(v.id, (damage.get(v.id) ?? 0) + dealt)
    }

    // 4. Movement: slower on rough ground and up or down steep slopes.
    for (const u of units) {
      if (u.path.length === 0) continue
      if (u.firingAtId && !u.orderedMove) continue
      const speedRad = unitSpeedRadPerDay(u.type, input.radiusKm, terrainOf(u))
      const next = u.path[0]
      const budget = ((speedRad / perCellRad) * DT) * slopeFactor(height(u), heightAtLocal(grid, next.x, next.y))
      const moved = walk(u, u.path, budget)
      u.x = moved.pos.x
      u.y = moved.pos.y
      u.path = moved.path
      u.stillSinceStep = undefined
      if (u.path.length === 0) {
        u.orderedMove = false
        u.stillSinceStep = k
      }
    }

    // 5. Casualties.
    for (const [id, dmg] of damage) byId.get(id)!.strength -= dmg
    const dead = units.filter((u) => u.strength <= UNIT_DESTROYED_BELOW)
    if (dead.length > 0) {
      for (const u of dead) losses.push({ ownerId: u.ownerId, unitType: u.type, maxStrength: u.maxStrength, killers: [...new Set(shooters.get(u.id) ?? [])] })
      const deadIds = new Set(dead.map((u) => u.id))
      units = units.filter((u) => !deadIds.has(u.id))
      for (const u of units) if (u.firingAtId && deadIds.has(u.firingAtId)) u.firingAtId = null
    }

    k += 1
    guard += 1

    // 6. Is it over?
    if (!units.some((a) => units.some((b) => ctx.atWar(a.ownerId, b.ownerId)))) {
      ended = 'eliminated'
      break
    }
    if (hostilePairWithin(units, ctx.atWar, TERRAIN_RELEASE_CELLS)) quietSince = null
    else {
      if (quietSince === null) quietSince = k
      if (k - quietSince >= TERRAIN_RELEASE_DAYS * GROUND_STEPS_PER_DAY) {
        ended = 'disengaged'
        break
      }
    }
  }

  return { battle: { ...input, units, resolvedThroughStep: k, quietSinceStep: quietSince }, losses, ended }
}

// --- Orders ------------------------------------------------------------------

// Sends units to a spot on the patch (Shift: after their current route).
export function orderUnitsTo(battle: TerrainBattle, unitIds: string[], to: LocalPoint, queue: boolean, step: number): { battle: TerrainBattle; ok: boolean; reason?: string } {
  const half = battle.grid.half
  const target = { x: Math.max(-half, Math.min(half, to.x)), y: Math.max(-half, Math.min(half, to.y)) }
  let anyOk = false
  let reason: string | undefined
  const units = battle.units.map((u) => {
    if (!unitIds.includes(u.id) || UNIT_TYPES[u.type].holdsPosition) return u
    const from = queue && u.path.length > 0 ? u.path[u.path.length - 1] : u
    const route = findLocalPath(battle.grid, u.type, from, target)
    if (!route) {
      reason = `${UNIT_TYPES[u.type].name} can't get there`
      return u
    }
    anyOk = true
    void step
    return { ...u, path: queue ? [...u.path, ...route] : route, orderedMove: true, stillSinceStep: undefined }
  })
  return anyOk ? { battle: { ...battle, units }, ok: true } : { battle, ok: false, reason: reason ?? 'Nothing to move' }
}

export function targetUnits(battle: TerrainBattle, unitIds: string[], targetUnitId: string | null): TerrainBattle {
  return { ...battle, units: battle.units.map((u) => (unitIds.includes(u.id) ? { ...u, targetUnitId } : u)) }
}

export function haltUnits(battle: TerrainBattle, unitIds: string[], step: number): TerrainBattle {
  return { ...battle, units: battle.units.map((u) => (unitIds.includes(u.id) ? { ...u, path: [], orderedMove: false, stillSinceStep: step } : u)) }
}

// --- Beginning, joining, leaving ----------------------------------------------

// A group of units that should fight it out on a terrain map.
export interface EngagementGroup {
  unitIds: string[]
  center: SurfacePoint
}

const cellsBetween = (a: SurfacePoint, b: SurfacePoint) => {
  const cx = a.y * b.z - a.z * b.y
  const cy = a.z * b.x - a.x * b.z
  const cz = a.x * b.y - a.y * b.x
  return Math.atan2(Math.hypot(cx, cy, cz), a.x * b.x + a.y * b.y + a.z * b.z) / surfaceMesh().fineSpacingRad
}

function centroid(points: SurfacePoint[]): SurfacePoint {
  const sum = points.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y, z: s.z + p.z }), { x: 0, y: 0, z: 0 })
  const l = Math.hypot(sum.x, sum.y, sum.z) || 1
  return { x: sum.x / l, y: sum.y / l, z: sum.z / l }
}

// The fights that should move onto a terrain map: groups of units (on one body,
// not already in a battle) linked within TERRAIN_GROUP_CELLS of each other that
// hold a hostile pair within TERRAIN_TRIGGER_CELLS — at least one of the pair a
// line unit, so an artillery duel across the map never opens one.
export function findEngagements(units: LandedUnit[], atWar: AtWarFn): EngagementGroup[] {
  const isLine = (u: LandedUnit) => u.unit.type !== 'artillery'
  const triggers: [number, number][] = []
  for (let a = 0; a < units.length; a++) {
    for (let b = a + 1; b < units.length; b++) {
      const ua = units[a]
      const ub = units[b]
      if (!atWar(ua.army.ownerId, ub.army.ownerId) || (!isLine(ua) && !isLine(ub))) continue
      if (cellsBetween(ua.unit.position!, ub.unit.position!) <= TERRAIN_TRIGGER_CELLS) triggers.push([a, b])
    }
  }
  if (triggers.length === 0) return []
  // Grow each trigger into the connected cluster around it.
  const seen = new Set<number>()
  const groups: EngagementGroup[] = []
  for (const [a] of triggers) {
    if (seen.has(a)) continue
    const stack = [a]
    const members: number[] = []
    seen.add(a)
    while (stack.length) {
      const i = stack.pop()!
      members.push(i)
      for (let j = 0; j < units.length; j++) {
        if (seen.has(j) || cellsBetween(units[i].unit.position!, units[j].unit.position!) > TERRAIN_GROUP_CELLS) continue
        seen.add(j)
        stack.push(j)
      }
    }
    members.sort((x, y) => x - y)
    groups.push({ unitIds: members.map((i) => units[i].unit.id), center: centroid(members.map((i) => units[i].unit.position!)) })
  }
  return groups
}

// Whether a unit that is not in a battle should be drawn into this one: it is
// on the patch and within TERRAIN_GROUP_CELLS of a unit already fighting.
export function shouldJoin(battle: TerrainBattle, position: SurfacePoint): boolean {
  const local = toLocal(battle.frame, position)
  const margin = battle.grid.half - 0.5
  if (Math.abs(local.x) > margin || Math.abs(local.y) > margin) return false
  return battle.units.some((u) => dist(u, local) <= TERRAIN_GROUP_CELLS)
}

// Starts a battle from these units.
export function createBattle(
  id: string,
  surface: BodySurface,
  units: LandedUnit[],
  center: SurfacePoint,
  step: number,
  owners: OwnerMap,
  holders: NodeHolderMap,
): TerrainBattle {
  const frame = makeFrame(center)
  const grid = buildRelief(surface, frame)
  const keys: TerrainKey[] = []
  for (const slot of surface.keySlots) {
    const p = toLocal(frame, nodePoint(slot.node))
    if (Math.abs(p.x) <= grid.half && Math.abs(p.y) <= grid.half) keys.push({ x: p.x, y: p.y, holderId: holderOf(surface.bodyName, slot.node, owners, holders) })
  }
  const battle: TerrainBattle = { id, bodyName: surface.bodyName, radiusKm: surface.radiusKm, frame, grid, keys, units: [], startedStep: step, resolvedThroughStep: step, quietSinceStep: null }
  return addUnits(battle, units, step)
}

// Adds units (from the coarse map) to a battle, at the spots they stand on.
export function addUnits(battle: TerrainBattle, landed: LandedUnit[], step: number): TerrainBattle {
  const added: TerrainUnit[] = landed.map(({ army, unit }) => {
    const local = toLocal(battle.frame, unit.position!)
    const path = (unit.path ?? []).map((p) => toLocal(battle.frame, p))
    return {
      id: unit.id,
      ownerId: army.ownerId,
      type: unit.type,
      strength: unit.strength,
      maxStrength: unit.maxStrength,
      x: local.x,
      y: local.y,
      path,
      orderedMove: !!unit.orderedMove,
      targetUnitId: unit.targetUnitId ?? null,
      firingAtId: null,
      stillSinceStep: unit.stillSinceStep ?? step,
    }
  })
  return { ...battle, units: [...battle.units, ...added] }
}

// A battle's unit as it stands back on the coarse map.
export function unitToGlobal(battle: TerrainBattle, u: TerrainUnit): { position: SurfacePoint; path: SurfacePoint[] } {
  return { position: toGlobal(battle.frame, u.x, u.y), path: u.path.map((p) => toGlobal(battle.frame, p.x, p.y)) }
}

// Copies a battle's state onto the coarse units it came from (strength, place,
// fire, route) — every resolve, so the planetary map and the panels stay
// current. Units the battle has lost are for the caller to drop.
export function applyBattleToUnit(unit: GroundUnit, battle: TerrainBattle, tu: TerrainUnit): GroundUnit {
  const g = unitToGlobal(battle, tu)
  return {
    ...unit,
    strength: tu.strength,
    position: g.position,
    path: g.path,
    orderedMove: tu.orderedMove,
    targetUnitId: tu.targetUnitId,
    firingAtId: tu.firingAtId,
    stillSinceStep: tu.stillSinceStep,
    nodeHint: undefined,
    // The ground AI plans a route only when its objective changes, so a unit
    // that has walked off it in a battle must plan afresh afterwards.
    objectiveNode: null,
  }
}
