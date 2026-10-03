// Where a world's spaceports stand on its ground map (pure). A world has as
// many spaceports as its economy runs (state/nationEconomy.spaceportSitesOf);
// the first is the terrain's own spaceport key slot, the rest are placed here:
// mostly at low latitude on a fast-spinning world (an equatorial launch gets
// the planet's spin for free; a slow or tidally locked world gives none, so
// there they cluster by the cities), near the cities, on low ground — plus a
// few strategic outliers (a coast, a high plateau, far from the rest).
// Every spaceport is a full key node (a nation must hold them all to hold the
// world), so this also decides what an invader has to take.

import { equatorialPull } from '../data/bodyRotation'
import { TERRAIN } from '../data/groundData'
import { lonLatOf } from './mapProjection'
import { TERRAIN_IDS, terrainAt, type BodySurface, type KeySlot } from './planetTerrain'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'

export interface SpaceportSite {
  operator: string // who runs it: 'state', or a company id
  operatorName: string // for display ("the state", "Tenkū Kōro")
}

const SITE_SEPARATION_CELLS = 2 // from any other key node
const OUTLIER_SEPARATION_CELLS = 3
const NEAR_CITY_CELLS = 4
const OUTLIER_SHARE = 0.2 // about one in five…
const OUTLIER_MIN_SITES = 4 // …once a world has this many

function hash(n: number, seed: number): number {
  let h = (n * 374761393 + seed * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function seedOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// Nodes for `count` spaceports in all (the terrain's own first, if it has one).
// Returns the ADDITIONAL nodes, each marked regular or outlier.
const cache = new Map<string, { node: number; outlier: boolean }[]>()
export function extraSpaceportNodes(surface: BodySurface, count: number): { node: number; outlier: boolean }[] {
  const key = `${surface.bodyName}|${surface.tier}|${count}|${surface.keySlots.map((k) => k.node).join(',')}`
  const hit = cache.get(key)
  if (hit) return hit
  const out = placeSites(surface, count)
  cache.set(key, out)
  return out
}

function placeSites(surface: BodySurface, count: number): { node: number; outlier: boolean }[] {
  const main = surface.keySlots.some((k) => k.kind === 'spaceport') ? 1 : 0
  const need = count - main
  if (need <= 0 || surface.keySlots.length === 0) return []
  const mesh = surfaceMesh()
  const cell = mesh.fineSpacingRad
  const seed = seedOf(surface.bodyName)
  const pull = equatorialPull(surface.bodyName)
  const taken = new Set(surface.keySlots.map((k) => k.node))
  const candidates: number[] = []
  for (let i = 0; i < mesh.count.fine; i++) {
    // Any walkable landmass, not just the single biggest one — otherwise a
    // multi-continent world (Earth) piles every spaceport onto Eurasia–Africa.
    if (surface.landComponent[i] < 0 || taken.has(i)) continue
    const t = TERRAIN_IDS[surface.terrain[i]]
    if (t === 'mountains' || !TERRAIN[t].paintable) continue
    candidates.push(i)
  }
  if (candidates.length === 0) return []
  // Height, 0 (lowest) – 1 (highest), from the real relief where there is one.
  const relief = surface.reliefM
  let lo = Infinity
  let hi = -Infinity
  if (relief) for (const i of candidates) {
    lo = Math.min(lo, relief[i])
    hi = Math.max(hi, relief[i])
  }
  const height = (i: number) => (relief && hi > lo ? (relief[i] - lo) / (hi - lo) : terrainAt(surface, i) === 'rock' ? 0.7 : 0.3)
  const settlements = surface.keySlots.filter((k) => k.kind === 'capital' || k.kind === 'city' || k.kind === 'outpost').map((k) => nodePoint(k.node))
  const coastal = (i: number) => mesh.neighbors.fine[i].some((j) => surface.landComponent[j] < 0)

  const picked: { node: number; outlier: boolean }[] = []
  const points = () => [...surface.keySlots.map((k) => nodePoint(k.node)), ...picked.map((p) => nodePoint(p.node))]
  const pick = (score: (i: number) => number, separation: number, outlier: boolean) => {
    for (let sep = separation; sep >= 0.5; sep -= 0.5) {
      const others = points()
      let best = -1
      let bestScore = -Infinity
      for (const i of candidates) {
        const p = nodePoint(i)
        if (others.some((o) => arc(o, p) / cell < sep)) continue
        const s = score(i)
        if (s > bestScore) {
          bestScore = s
          best = i
        }
      }
      if (best >= 0) {
        picked.push({ node: best, outlier })
        return true
      }
    }
    return false
  }

  const outliers = count >= OUTLIER_MIN_SITES ? Math.max(1, Math.round(count * OUTLIER_SHARE)) : 0
  const regular = need - outliers
  // Regular sites: low latitude (on a fast spinner), near a city, low ground.
  const regularScore = (i: number) => {
    const p = nodePoint(i)
    const lat = Math.abs(lonLatOf(p).lat) / (Math.PI / 2)
    const city = settlements.length > 0 ? Math.min(...settlements.map((s) => arc(s, p) / cell)) : NEAR_CITY_CELLS
    const nearCity = city <= NEAR_CITY_CELLS ? 1 - city / NEAR_CITY_CELLS : 0
    return pull * (1 - lat) * 1.2 + nearCity * (0.4 + 0.6 * (1 - pull)) + (1 - height(i)) * 0.3 + hash(i, seed) * 0.1
  }
  for (let n = 0; n < regular; n++) if (!pick(regularScore, SITE_SEPARATION_CELLS, false)) break
  // Strategic outliers: a coast, high ground, and far from the other sites.
  const outlierScore = (i: number) => {
    const p = nodePoint(i)
    const far = Math.min(...points().map((o) => arc(o, p) / cell))
    return (coastal(i) ? 0.5 : 0) + height(i) * 0.4 + Math.min(1, far / 10) * 0.6 + hash(i, seed + 1) * 0.1
  }
  for (let n = 0; n < outliers; n++) if (!pick(outlierScore, OUTLIER_SEPARATION_CELLS, true)) break
  return picked
}

// The surface with a key node for every spaceport the world's economy runs:
// the terrain's own spaceport is the first site; the rest are placed as above.
// Each carries its operator (shown on the map; the node itself is held by
// whichever nation's troops hold the ground, like any key node).
export function withSpaceportKeys(surface: BodySurface, sites: SpaceportSite[]): BodySurface {
  if (sites.length === 0) return surface
  const extra = extraSpaceportNodes(surface, sites.length)
  const main = surface.keySlots.some((k) => k.kind === 'spaceport') ? 1 : 0
  const keySlots: KeySlot[] = surface.keySlots.map((k) => (k.kind === 'spaceport' && main ? { ...k, operator: sites[0].operatorName } : k))
  extra.forEach((e, n) => {
    const site = sites[n + main]
    if (site) keySlots.push({ node: e.node, kind: 'spaceport', operator: site.operatorName, site: e.outlier ? 'outlier' : 'extra' })
  })
  return { ...surface, keySlots }
}
