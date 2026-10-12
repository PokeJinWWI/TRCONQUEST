// Rural life, pure: the homesteads and farmsteads that stand on rural land (ground in no district) in proportion to the people living
// in the countryside. They are derived, never placed or stored: more rural people, more marks; a zone that grows over them absorbs
// them. The order they appear in is fixed per surface (a seeded hash, lowered near the sea and good farmland), so marks accumulate
// in the same places and never shuffle.
import { MAX_RURAL_MARKS, MILLION_PEOPLE_PER_MARK, RURAL_BASE_SHARE, RURAL_FARMING_SHARE, RURAL_MAX_SHARE } from '../data/ruralData'
import { terrainAt, type BodySurface } from './planetTerrain'
import { surfaceMesh } from './surfaceMesh'

// People (millions) living in the countryside of a world of `population`, given how much of its developed land farms.
export function ruralPopulation(population: number, farmingShare: number): number {
  const share = Math.min(RURAL_MAX_SHARE, RURAL_BASE_SHARE + RURAL_FARMING_SHARE * Math.max(0, Math.min(1, farmingShare)))
  return Math.max(0, population) * share
}

export const markCount = (ruralMillions: number): number => Math.min(MAX_RURAL_MARKS, Math.round(ruralMillions / MILLION_PEOPLE_PER_MARK))

function noise(cell: number, salt: number): number {
  let h = (Math.imul(cell + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

const orderCache = new WeakMap<BodySurface, number[]>()

// Every buildable cell of the body, best-for-a-homestead first: near the water and on or beside farmland, then by a seeded hash.
function preferenceOrder(base: BodySurface): number[] {
  const hit = orderCache.get(base)
  if (hit) return hit
  const mesh = surfaceMesh()
  const scored: [number, number][] = []
  for (let i = 0; i < base.terrain.length; i++) {
    if (base.landComponent[i] < 0) continue
    const t = terrainAt(base, i)
    if (t === 'mountains' || t === 'urban') continue
    let score = noise(i, base.bodyName.length * 31)
    for (const n of mesh.neighbors.fine[i]) {
      if (base.landComponent[n] < 0) score -= 0.15
    }
    if (t === 'farmland' || t === 'plains' || t === 'forest') score -= 0.2
    scored.push([score, i])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out = scored.map(([, i]) => i)
  orderCache.set(base, out)
  return out
}

// The cells that hold a homestead mark: the first `count` cells of the preference order that are rural (and not a nature reserve's
// wild, where nobody settles).
export function homesteadCells(base: BodySurface, rural: ReadonlySet<number>, count: number, reserved: ReadonlySet<number> = new Set()): number[] {
  if (count <= 0) return []
  const out: number[] = []
  for (const cell of preferenceOrder(base)) {
    if (!rural.has(cell) || reserved.has(cell)) continue
    out.push(cell)
    if (out.length >= count) break
  }
  return out
}
