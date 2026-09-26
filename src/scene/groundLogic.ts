// Surface-aware ground-war helpers: which map a world has, how fast and how
// far units reach on it, who holds each node, paths across terrain, where a
// landing may be made, and where units stand. Pure except for
// settlementTierOf, which reads the static country list and the economy's
// world list (the same kind of read liveBodyValue does).
import { COUNTRIES } from '../data/countryData'
import {
  DROP_EXCLUSION_CELLS,
  DROP_SPREAD_CELLS,
  GROUND_REFERENCE_RADIUS_KM,
  GROUND_SPEED_FACTOR_MAX,
  GROUND_SPEED_FACTOR_MIN,
  GROUND_SPEED_SIZE_EXPONENT,
  TERRAIN,
  UNIT_TYPES,
  type TerrainId,
  type UnitType,
} from '../data/groundData'
import type { AtWarFn } from '../state/diplomacyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import type { Army, GroundUnit } from './armyLogic'
import { bodyGroundInfo, passableFor, surfaceOf, terrainAt, type BodySurface, type SettlementTier } from './planetTerrain'
import { arc, nearestNode, nodePoint, surfaceMesh, type SurfacePoint } from './surfaceMesh'
import type { OwnerMap } from './territory'

// Per body: fine node → the nation holding it, for nodes whose holder differs
// from the body's owner. Sparse by design.
export type NodeHolderMap = Record<string, Record<number, string>>

export function settlementTierOf(bodyName: string, owners: OwnerMap): SettlementTier {
  if (COUNTRIES.some((c) => c.capitalBodyName === bodyName)) return 'capital'
  if (!owners[bodyName]) return 'wild'
  if (worldByName(useEconomyStore.getState().worlds, bodyName)) return 'world'
  return 'outpost'
}

// The planetary map of a body, or null for something without a surface (a
// star).
export function groundSurface(bodyName: string, owners: OwnerMap): BodySurface | null {
  if (!bodyGroundInfo(bodyName)) return null
  return surfaceOf(bodyName, settlementTierOf(bodyName, owners))
}

// --- Scale -------------------------------------------------------------------

export function sizeSpeedFactor(radiusKm: number): number {
  const f = (GROUND_REFERENCE_RADIUS_KM / Math.max(1, radiusKm)) ** GROUND_SPEED_SIZE_EXPONENT
  return Math.max(GROUND_SPEED_FACTOR_MIN, Math.min(GROUND_SPEED_FACTOR_MAX, f))
}

// How much a unit's own traits and the ground slow or speed it here.
export function terrainSpeedFactor(type: UnitType, terrain: TerrainId): number {
  return (UNIT_TYPES[type].terrain[terrain]?.speed ?? 1) / TERRAIN[terrain].moveCost
}

// Radians per day this unit covers on this body, standing on this terrain.
export function unitSpeedRadPerDay(type: UnitType, radiusKm: number, terrain: TerrainId): number {
  return (UNIT_TYPES[type].speedKmPerDayRef / GROUND_REFERENCE_RADIUS_KM) * sizeSpeedFactor(radiusKm) * terrainSpeedFactor(type, terrain)
}

export function unitRangeRad(type: UnitType): number {
  return UNIT_TYPES[type].rangeKmRef / GROUND_REFERENCE_RADIUS_KM
}

// Real kilometres on this body for an angle on its globe (for the UI).
export function radToKm(rad: number, radiusKm: number): number {
  return rad * radiusKm
}

export function cellsToRad(cells: number): number {
  return cells * surfaceMesh().fineSpacingRad
}

// --- Holding nodes -----------------------------------------------------------

export function holderOf(bodyName: string, node: number, owners: OwnerMap, holders: NodeHolderMap): string | undefined {
  return holders[bodyName]?.[node] ?? owners[bodyName]
}

// --- Units on a body ---------------------------------------------------------

export interface LandedUnit {
  army: Army
  unit: GroundUnit
}

export function landedUnits(armies: Army[], bodyName: string): LandedUnit[] {
  const out: LandedUnit[] = []
  for (const army of armies) {
    if (army.location.kind !== 'body' || army.location.bodyName !== bodyName) continue
    for (const unit of army.units) if (unit.position) out.push({ army, unit })
  }
  return out
}

// Units of any nation at war with `ownerId` within `radiusRad` of `point`.
export function hostilesWithin(point: SurfacePoint, radiusRad: number, ownerId: string, units: LandedUnit[], atWar: AtWarFn): LandedUnit[] {
  return units.filter((u) => atWar(u.army.ownerId, ownerId) && arc(u.unit.position!, point) <= radiusRad)
}

// Is any unit of this army within fighting range of an enemy?
export function armyInContact(army: Army, armies: Army[], atWar: AtWarFn): boolean {
  if (army.location.kind !== 'body') return false
  const here = landedUnits(armies, army.location.bodyName)
  return army.units.some(
    (u) => !!u.position && hostilesWithin(u.position, Math.max(unitRangeRad(u.type), unitRangeRad('infantry')), army.ownerId, here, atWar).length > 0,
  )
}

// --- Paths -------------------------------------------------------------------

// Cheapest walk (A* on the FINE grid, whatever density the click was made at
// — a coarse edge can span a strait, the fine grid can't) from `from` to
// `toNode` for this kind of unit. Waypoints are node positions; null when
// the goal can't be reached.
export function findPath(surface: BodySurface, from: SurfacePoint, toNode: number, type: UnitType): SurfacePoint[] | null {
  const mesh = surfaceMesh()
  const start = nearestNode(from, 'fine')
  if (!passableFor(terrainAt(surface, toNode), type)) return null
  if (start === toNode) return [nodePoint(toNode)]
  const n = mesh.count.fine
  const g = new Float64Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const goal = nodePoint(toNode)
  const heap = new MinHeap()
  g[start] = 0
  heap.push(start, arc(nodePoint(start), goal))
  const stepCost = (i: number, j: number) => {
    const ti = terrainAt(surface, i)
    const tj = terrainAt(surface, j)
    return arc(nodePoint(i), nodePoint(j)) * (0.5 / terrainSpeedFactor(type, ti) + 0.5 / terrainSpeedFactor(type, tj))
  }
  while (heap.size > 0) {
    const i = heap.pop()
    if (i === toNode) break
    if (closed[i]) continue
    closed[i] = 1
    for (const j of mesh.neighbors.fine[i]) {
      if (closed[j] || !passableFor(terrainAt(surface, j), type)) continue
      const cost = g[i] + stepCost(i, j)
      if (cost < g[j]) {
        g[j] = cost
        came[j] = i
        heap.push(j, cost + arc(nodePoint(j), goal))
      }
    }
  }
  if (came[toNode] === -1) return null
  const nodes: number[] = []
  for (let v = toNode; v !== start && v !== -1; v = came[v]) nodes.push(v)
  return nodes.reverse().map(nodePoint)
}

export class MinHeap {
  private items: number[] = []
  private keys: number[] = []
  get size(): number {
    return this.items.length
  }
  push(item: number, key: number): void {
    this.items.push(item)
    this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      this.swap(i, p)
      i = p
    }
  }
  pop(): number {
    const top = this.items[0]
    const lastItem = this.items.pop()!
    const lastKey = this.keys.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && this.keys[l] < this.keys[m]) m = l
        if (r < this.items.length && this.keys[r] < this.keys[m]) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
  private swap(a: number, b: number): void {
    ;[this.items[a], this.items[b]] = [this.items[b], this.items[a]]
    ;[this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]
  }
}

// --- Landing and placement ---------------------------------------------------

export type DropResult = { ok: true } | { ok: false; reason: string }

// Can these unit types be put down at this node? Walkable for all of them,
// and not right on top of the enemy.
export function dropCheck(surface: BodySurface, node: number, types: UnitType[], ownerId: string, armies: Army[], atWar: AtWarFn): DropResult {
  const terrain = terrainAt(surface, node)
  const blocked = types.filter((t) => !passableFor(terrain, t))
  if (blocked.length > 0) return { ok: false, reason: `${TERRAIN[terrain].name} — ${UNIT_TYPES[blocked[0]].name} can't land there` }
  const here = landedUnits(armies, surface.bodyName)
  if (hostilesWithin(nodePoint(node), cellsToRad(DROP_EXCLUSION_CELLS), ownerId, here, atWar).length > 0) {
    return { ok: false, reason: 'Too close to enemy units' }
  }
  return { ok: true }
}

// Where a nation's own new units report: its spaceport, else its first key
// node, else anywhere on the mainland.
export function musterNode(surface: BodySurface): number {
  const port = surface.keySlots.find((k) => k.kind === 'spaceport')
  if (port) return port.node
  if (surface.keySlots.length > 0) return surface.keySlots[0].node
  const landIdx = Array.from(surface.landComponent).findIndex((c) => c === surface.mainland)
  return Math.max(0, landIdx)
}

// A sensible landing site for an invasion: as close as the rules allow to
// the enemy's weakest-held key node (or to the muster node when landing on a
// world of your own).
export function defaultDropNode(
  surface: BodySurface,
  types: UnitType[],
  ownerId: string,
  armies: Army[],
  owners: OwnerMap,
  holders: NodeHolderMap,
  atWar: AtWarFn,
): number | null {
  const here = landedUnits(armies, surface.bodyName)
  const enemyKeys = surface.keySlots.filter((k) => {
    const h = holderOf(surface.bodyName, k.node, owners, holders)
    return !!h && atWar(h, ownerId)
  })
  const nearStrength = (node: number) =>
    hostilesWithin(nodePoint(node), cellsToRad(2), ownerId, here, atWar).reduce((s, u) => s + u.unit.strength, 0)
  const target = enemyKeys.length > 0
    ? [...enemyKeys].sort((a, b) => nearStrength(a.node) - nearStrength(b.node) || a.node - b.node)[0].node
    : musterNode(surface)
  const goal = nodePoint(target)
  const mesh = surfaceMesh()
  const candidates = Array.from({ length: mesh.count.fine }, (_, i) => i)
    // Walkable for everyone aboard, and on the mainland (where the key nodes
    // are) unless every unit can cross water anyway.
    .filter(
      (i) =>
        types.every((t) => passableFor(terrainAt(surface, i), t)) &&
        (surface.landComponent[i] === surface.mainland || types.every((t) => UNIT_TYPES[t].amphibious)),
    )
    .sort((a, b) => arc(nodePoint(a), goal) - arc(nodePoint(b), goal) || a - b)
  for (const node of candidates) {
    if (dropCheck(surface, node, types, ownerId, armies, atWar).ok) return node
  }
  return null
}

// Puts an army's units down around `anchorNode`: the anchor and its nearby
// neighbours, each unit on ground it can stand on.
export function placeUnits(surface: BodySurface, units: GroundUnit[], anchorNode: number, step = 0): GroundUnit[] {
  const mesh = surfaceMesh()
  const anchor = nodePoint(anchorNode)
  const spread = cellsToRad(DROP_SPREAD_CELLS) * 1.05
  const ring = [anchorNode, ...mesh.neighbors.fine[anchorNode]].filter((i) => arc(nodePoint(i), anchor) <= spread)
  return units.map((u, i) => {
    const spots = ring.filter((node) => passableFor(terrainAt(surface, node), u.type))
    const node = spots.length > 0 ? spots[i % spots.length] : anchorNode
    return { ...u, position: nodePoint(node), path: [], orderedMove: false, nodeHint: node, stillSinceStep: step, objectiveNode: null, firingAtId: null }
  })
}
