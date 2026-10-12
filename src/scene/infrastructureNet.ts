// The surface route network, pure: roads and railways between development sites, what
// they cost, and how freight reaches a hub (a spaceport or a city). Nothing here touches a
// store; scene/infrastructureOrders.ts feeds it and applies the result.
//
// Three different things are kept apart on purpose (docs/territorial-design.md section 6):
//   CAPACITY  what a route can carry, set by its kind. This is the only effect routes have on
//             production: a placed building cut off from its hub runs at a share of its output.
//   BUILD     goods spent once, from the capital stockpile (Complex) or the strategic pool
//             (Simple), the same dual payment the shipyard uses.
//   UPKEEP    goods spent each month by whoever runs the route; unpaid, it falls into disrepair.
// The `transportation` GOOD and the world-wide infrastructure number of economy/transport.ts are
// not touched: they stay what they were (the base grid and the transport buildings), and a route
// adds only WHERE freight can go, so nothing is charged twice.
import { DISREPAIR_FACTOR, ISOLATION_FACTOR, LOCAL_ACCESS_CELLS, ROUTE_DIFFICULTY, ROUTE_SPECS, type RouteKind } from '../data/infrastructureData'
import type { GoodCost, ResourceCost } from '../data/shipyardData'
import { surfaceOf, terrainAt } from './planetTerrain'
import { arc, nearestNode, nodePoint, slerpToward, surfaceMesh } from './surfaceMesh'

export interface Route {
  id: string
  bodyName: string
  a: string
  b: string
  kind: RouteKind
  // Who built it and runs it (pays the upkeep).
  ownerId: string
  // Other countries allowed to use it.
  users: string[]
  // A public route: anyone's freight may use it.
  open: boolean
  cells: number
  builtSimDays: number
  // Working from this simDays on (absolute deadline).
  readySimDays: number
  // Upkeep unpaid: it carries less.
  disrepair?: boolean
}

export interface RouteSurvey {
  cells: number
  difficulty: number
  // Why it cannot be built (water, lava in the way), else null.
  blocked: string | null
}

// Surveys the ground between two nodes of a body: its length in cells, how hard it is on average, and whether
// something impassable lies across it. Pure of state; reads the body's own terrain.
export function surveyRoute(bodyName: string, nodeA: number, nodeB: number): RouteSurvey {
  const mesh = surfaceMesh()
  const surface = surfaceOf(bodyName, 'wild')
  const pa = nodePoint(nodeA)
  const pb = nodePoint(nodeB)
  const total = arc(pa, pb)
  const cells = Math.max(1, Math.ceil(total / mesh.fineSpacingRad))
  let sum = 0
  let hint = nodeA
  for (let i = 0; i <= cells; i++) {
    const node = i === 0 ? nodeA : i === cells ? nodeB : (hint = nearestNode(slerpToward(pa, pb, (total * i) / cells), 'fine', hint))
    const terrain = terrainAt(surface, node)
    const d = ROUTE_DIFFICULTY[terrain]
    if (!Number.isFinite(d) || surface.landComponent[node] < 0) return { cells, difficulty: Infinity, blocked: terrain === 'lava' ? 'lava lies across the way' : terrain === 'cloud' ? 'open sky lies across the way' : 'water lies across the way' }
    sum += d
  }
  return { cells, difficulty: sum / (cells + 1), blocked: null }
}

export interface RouteQuote {
  goods: GoodCost
  resources: ResourceCost
  days: number
}

const scale = <T extends Record<string, number | undefined>>(cost: T, k: number): T =>
  Object.fromEntries(Object.entries(cost).map(([id, n]) => [id, Math.round((n ?? 0) * k * 100) / 100])) as T

export function quoteRoute(kind: RouteKind, cells: number, difficulty: number): RouteQuote {
  const spec = ROUTE_SPECS[kind]
  const k = cells * difficulty
  return { goods: scale(spec.build.goods, k), resources: scale(spec.build.resources, k), days: Math.ceil(spec.daysPerCell * k) }
}

export function upkeepOf(route: Route): { goods: GoodCost; resources: ResourceCost } {
  const spec = ROUTE_SPECS[route.kind]
  return { goods: scale(spec.upkeep.goods, route.cells), resources: scale(spec.upkeep.resources, route.cells) }
}

export const isWorking = (r: Route, simDays: number): boolean => simDays >= r.readySimDays
export const usableBy = (r: Route, nationId: string): boolean => r.open || r.ownerId === nationId || r.users.includes(nationId)
export const capacityOf = (r: Route): number => ROUTE_SPECS[r.kind].capacity * (r.disrepair ? DISREPAIR_FACTOR : 1)

export interface AccessInput {
  bodyName: string
  // The body's site ids with their nodes.
  sites: { id: string; node: number }[]
  // Working routes this nation may use on the body.
  routes: Route[]
  // Established settlement / spaceport sites: where freight is going.
  hubs: string[]
  // Freight a site sends each month.
  demand: (siteId: string) => number
  cellsBetween: (a: number, b: number) => number
}

// For every site of the body, the share (ISOLATION_FACTOR..1) of its output that can get to a hub.
// A site beside a hub needs no route. Otherwise freight takes the shortest working route to a hub and
// every route on the way carries the freight of everything behind it: where that is more than
// the route's capacity, all of it gets the same share (capacity / freight), never less than
// ISOLATION_FACTOR, which is what no route at all gives.
export function siteAccess(input: AccessInput): Record<string, number> {
  const { sites, routes, hubs, demand, cellsBetween } = input
  const out: Record<string, number> = {}
  if (hubs.length === 0) {
    for (const s of sites) out[s.id] = 1
    return out
  }
  const nodeOf = new Map(sites.map((s) => [s.id, s.node]))
  const hubNodes = hubs.map((h) => nodeOf.get(h)).filter((n): n is number => n !== undefined)
  const sources = new Set(sites.filter((s) => hubs.includes(s.id) || hubNodes.some((hn) => cellsBetween(s.node, hn) <= LOCAL_ACCESS_CELLS)).map((s) => s.id))
  // Shortest route tree from the sources (Dijkstra, ties broken by id so it is deterministic).
  const dist = new Map<string, number>()
  const via = new Map<string, Route>()
  const parent = new Map<string, string>()
  for (const s of sources) dist.set(s, 0)
  const open = new Set(sites.map((s) => s.id))
  while (open.size > 0) {
    let best: string | null = null
    for (const id of open) if (dist.has(id) && (best === null || dist.get(id)! < dist.get(best)! || (dist.get(id) === dist.get(best) && id < best))) best = id
    if (best === null) break
    open.delete(best)
    for (const r of routes) {
      const next = r.a === best ? r.b : r.b === best ? r.a : null
      if (next === null || !open.has(next)) continue
      const d = dist.get(best)! + r.cells
      if (!dist.has(next) || d < dist.get(next)! || (d === dist.get(next) && best < (parent.get(next) ?? '~'))) {
        dist.set(next, d)
        parent.set(next, best)
        via.set(next, r)
      }
    }
  }
  // Freight on each tree route: everything behind it.
  const flow = new Map<string, number>()
  for (const s of sites) {
    if (sources.has(s.id) || !dist.has(s.id)) continue
    for (let at = s.id; parent.has(at); at = parent.get(at)!) flow.set(via.get(at)!.id, (flow.get(via.get(at)!.id) ?? 0) + demand(s.id))
  }
  for (const s of sites) {
    if (sources.has(s.id)) out[s.id] = 1
    else if (!dist.has(s.id)) out[s.id] = ISOLATION_FACTOR
    else {
      let f = 1
      for (let at = s.id; parent.has(at); at = parent.get(at)!) {
        const r = via.get(at)!
        const load = flow.get(r.id) ?? 0
        if (load > 1e-9) f = Math.min(f, capacityOf(r) / load)
      }
      out[s.id] = Math.max(ISOLATION_FACTOR, Math.min(1, f))
    }
  }
  return out
}
