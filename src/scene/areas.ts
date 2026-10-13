// Areas, pure: the places of a world as the map shows them. Every developed district grows from its own seed (a development site,
// scene/footprint.ts); an AREA is a connected patch of ground of ONE district kind: seeds of the same kind whose footprints touch are
// one place (two towns that grow into each other become one city), touching ground of different kinds stays separate places. An
// area takes its id, name and node from its primary seed (capital first, then a city the map already has, then the oldest id), so
// renaming an area renames that seed and the name survives saves; seeds keep their own ids underneath, so the economy's ledgers are
// untouched and a city that is cut in two splits back into its seeds' areas.
import type { LocationKind } from '../data/locationData'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'

export interface AreaSeed {
  id: string
  kind: LocationKind
  node: number | null
  // Lower = the better primary (capital 0, a map city 1, anything else 2).
  rank: number
}

export interface Area {
  // The primary seed's id.
  id: string
  kind: LocationKind
  node: number | null
  seedIds: string[]
  cells: number[]
}

// Groups seeds into areas. `footprints` are the cells each seed covers now; `neighbors[cell]` the cells next to it. A seed with no
// footprint (nothing drawn yet) is an area of its own. Deterministic: areas come out sorted by kind, then primary rank and id.
export function groupAreas(
  seeds: readonly AreaSeed[],
  footprints: readonly { siteId: string; cells: readonly number[] }[],
  neighbors: ArrayLike<ArrayLike<number>>,
): Area[] {
  const index = new Map(seeds.map((s, i) => [s.id, i]))
  const parent = seeds.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  const cellsOf = new Map<number, number[]>()
  const owner = new Map<number, number>()
  for (const f of footprints) {
    const i = index.get(f.siteId)
    if (i === undefined) continue
    cellsOf.set(i, [...f.cells])
    for (const c of f.cells) owner.set(c, i)
  }
  for (const [i, cells] of cellsOf) {
    for (const c of cells) {
      const ns = neighbors[c]
      if (!ns) continue
      for (let k = 0; k < ns.length; k++) {
        const j = owner.get(ns[k])
        if (j !== undefined && j !== i && seeds[j].kind === seeds[i].kind) union(i, j)
      }
    }
  }
  const groups = new Map<number, number[]>()
  seeds.forEach((_, i) => {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(i)
    else groups.set(r, [i])
  })
  const better = (a: AreaSeed, b: AreaSeed) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const out: Area[] = [...groups.values()].map((members) => {
    const ordered = members.map((i) => seeds[i]).sort(better)
    const primary = ordered[0]
    return { id: primary.id, kind: primary.kind, node: primary.node, seedIds: ordered.map((s) => s.id), cells: members.flatMap((i) => cellsOf.get(i) ?? []) }
  })
  return out.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || better(seeds[index.get(a.id)!], seeds[index.get(b.id)!]))
}

// The area a seed belongs to.
export function areaOfSeed(areas: readonly Area[], seedId: string): Area | undefined {
  return areas.find((a) => a.seedIds.includes(seedId))
}

// The area a map node is in: one whose ground covers it, else an urban area whose centre is within `nearCells` cells.
export function areaAtNode(areas: readonly Area[], node: number, nearCells = 1): Area | undefined {
  const covering = areas.find((a) => a.cells.includes(node))
  if (covering) return covering
  const p = nodePoint(node)
  const cell = surfaceMesh().fineSpacingRad
  return areas.find((a) => a.kind === 'settlement' && a.node !== null && arc(nodePoint(a.node), p) / cell <= nearCells)
}
