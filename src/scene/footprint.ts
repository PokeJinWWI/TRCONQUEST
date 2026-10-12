// District footprints, pure: the ground a developed site covers on the map, growing with what stands there. A site grows outward
// from its own node along a fixed ORDER of cells (a seeded, cost-weighted flood over walkable ground of the same landmass), so a
// footprint of n cells is always the first n of the footprint of n+1: a city only grows, it never reshuffles. Sites claim cells in
// a fixed priority (settlements first, then by id), skip ground another site holds, and never take another site's own node.
import { CELLS_PER_BUILDING, CELLS_PER_LEVEL, CELLS_PER_MILLION_PEOPLE, FOOTPRINT_PRIORITY, FOOTPRINT_TERRAIN, GROWTH_COST, GROWTH_ORDER_CELLS, MAX_FOOTPRINT_CELLS } from '../data/footprintData'
import { TERRAIN, type TerrainId } from '../data/groundData'
import type { LocationKind } from '../data/locationData'
import { TERRAIN_IDS, terrainAt, type BodySurface } from './planetTerrain'
import { surfaceMesh } from './surfaceMesh'

export interface FootprintSite {
  id: string
  kind: LocationKind
  node: number
  // Cells it should cover (see `footprintSize`).
  size: number
}

export interface Footprint {
  siteId: string
  kind: LocationKind
  cells: number[]
}

// How many cells a site covers: its developed levels and buildings, plus for a settlement the people living there.
export function footprintSize(kind: LocationKind, levels: number, buildings: number, populationMillions = 0): number {
  const perLevel = CELLS_PER_LEVEL[kind]
  if (perLevel === undefined) return 0
  const raw = levels * perLevel + buildings * (CELLS_PER_BUILDING[kind] ?? 0) + (kind === 'settlement' ? populationMillions * CELLS_PER_MILLION_PEOPLE : 0)
  if (levels + buildings <= 0 && populationMillions <= 0) return 0
  return Math.min(MAX_FOOTPRINT_CELLS, Math.max(1, Math.round(raw)))
}

// A small deterministic hash to [0, 1) (so the order is the same on every load and every machine).
function noise(node: number, salt: number): number {
  let h = (Math.imul(node + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

const orderCache = new WeakMap<BodySurface, Map<number, number[]>>()

// The cells a site grows over, nearest first, starting with its own node (up to GROWTH_ORDER_CELLS). Walkable ground of the
// node's own landmass only: water, lava and other islands never become part of it. Cached per surface and node.
export function growthOrder(surface: BodySurface, node: number): number[] {
  let byNode = orderCache.get(surface)
  if (!byNode) orderCache.set(surface, (byNode = new Map()))
  const hit = byNode.get(node)
  if (hit) return hit
  const mesh = surfaceMesh()
  const component = surface.landComponent[node]
  const out: number[] = []
  if (component >= 0) {
    // Dijkstra with a simple binary heap on (cost, node); the cost of entering a cell is its terrain's plus a little seeded noise.
    const heap: [number, number][] = [[0, node]]
    const best = new Map<number, number>([[node, 0]])
    const done = new Set<number>()
    const push = (item: [number, number]) => {
      heap.push(item)
      let i = heap.length - 1
      while (i > 0) {
        const p = (i - 1) >> 1
        if (heap[p][0] <= heap[i][0]) break
        ;[heap[p], heap[i]] = [heap[i], heap[p]]
        i = p
      }
    }
    const pop = (): [number, number] => {
      const top = heap[0]
      const last = heap.pop()!
      if (heap.length > 0) {
        heap[0] = last
        let i = 0
        for (;;) {
          const l = 2 * i + 1
          const r = l + 1
          let m = i
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[m], heap[i]] = [heap[i], heap[m]]
          i = m
        }
      }
      return top
    }
    while (heap.length > 0 && out.length < GROWTH_ORDER_CELLS) {
      const [cost, cell] = pop()
      if (done.has(cell)) continue
      done.add(cell)
      out.push(cell)
      for (const next of mesh.neighbors.fine[cell]) {
        if (done.has(next) || surface.landComponent[next] !== component) continue
        const terrain = terrainAt(surface, next)
        if (TERRAIN[terrain].passable !== 'all') continue
        const c = cost + (GROWTH_COST[terrain] ?? 1) * (0.7 + 0.6 * noise(next, node))
        if (c < (best.get(next) ?? Infinity)) {
          best.set(next, c)
          push([c, next])
        }
      }
    }
  }
  byNode.set(node, out)
  return out
}

// Every site's footprint, claimed in priority order. `base` supplies the ground (walkability, the original terrain). A site with a
// zone of its own (scene/zoning) grows only inside it.
export function claimFootprints(base: BodySurface, sites: readonly FootprintSite[], zones: Readonly<Record<string, ReadonlySet<number>>> = {}, blocked?: ReadonlySet<number>): Footprint[] {
  const rank = (k: LocationKind) => {
    const i = FOOTPRINT_PRIORITY.indexOf(k)
    return i < 0 ? FOOTPRINT_PRIORITY.length : i
  }
  const sized = sites.filter((s) => s.size > 0 && FOOTPRINT_TERRAIN[s.kind] !== undefined).sort((a, b) => rank(a.kind) - rank(b.kind) || (a.id < b.id ? -1 : 1))
  // A site's own node is its own: nobody else grows over it.
  const owned = new Set<number>(sized.map((s) => s.node))
  const taken = new Set<number>()
  const out: Footprint[] = []
  for (const site of sized) {
    const cells: number[] = []
    const zone = zones[site.id]
    for (const cell of growthOrder(base, site.node)) {
      if (cells.length >= site.size) break
      if (zone && !zone.has(cell)) continue
      // Kept wild on purpose (a nature reserve): no district grows over it.
      if (blocked?.has(cell) && cell !== site.node) continue
      if (taken.has(cell) || (cell !== site.node && owned.has(cell))) continue
      // Only settlements spread over a city's ground; everything else leaves it alone.
      if (site.kind !== 'settlement' && terrainAt(base, cell) === 'urban') continue
      cells.push(cell)
      taken.add(cell)
    }
    if (cells.length > 0) out.push({ siteId: site.id, kind: site.kind, cells })
  }
  return out
}

// The surface with the footprints drawn onto it: a site's cells become its district's terrain. Everything else about the
// surface (key nodes, land components, relief) is shared with `base`.
export function applyFootprints(base: BodySurface, footprints: readonly Footprint[]): BodySurface {
  if (footprints.length === 0) return base
  const terrain = base.terrain.slice()
  const index = (t: TerrainId) => TERRAIN_IDS.indexOf(t)
  for (const fp of footprints) {
    const t = FOOTPRINT_TERRAIN[fp.kind]
    if (!t) continue
    const i = index(t)
    for (const cell of fp.cells) terrain[cell] = i
  }
  return { ...base, terrain }
}
