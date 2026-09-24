// Procedural terrain for every world's planetary map. There's no real
// geographic data for these worlds, so each surface is generated from seeded
// noise — deterministic per world (seeded by its name), and shaped by its
// planet class (data/groundData.ts SURFACE_CLASSES): how much is land, what
// the seas are, where the mountains, forests, deserts and ice go. Pure;
// memoised per world.
//
// Guarantees the ground war relies on:
//   - The land share is exact (sea level is set by elevation percentile).
//   - The largest landmass ("mainland") covers at least
//     MIN_MAINLAND_FRACTION; if the noise leaves it smaller, sea level drops
//     step by step until it does. Every key node sits on the mainland, so an
//     invasion landing there can always reach them on foot — even on an
//     ocean world like Venus.
//   - Gas and ice giants are cloud decks with an equatorial aerostat belt
//     (the only walkable ground).
import {
  KEY_MIN_SEPARATION_CELLS,
  MIN_MAINLAND_FRACTION,
  SURFACE_CLASSES,
  TERRAIN,
  UNIT_TYPES,
  citiesForDistricts,
  type SurfaceClassSpec,
  type TerrainId,
  type UnitType,
} from '../data/groundData'
import { PLANETS_BY_STAR, type PlanetClass } from './planetData'
import { getMoonsForPlanet } from './moonData'
import { estimateSize } from './bodyStats'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'

export const TERRAIN_IDS: TerrainId[] = ['ocean', 'plains', 'forest', 'desert', 'tundra', 'mountains', 'urban', 'rock', 'lava', 'cloud', 'aerostat']
const TERRAIN_INDEX = Object.fromEntries(TERRAIN_IDS.map((t, i) => [t, i])) as Record<TerrainId, number>

// How settled a world is, which decides its key nodes:
//   capital  capital city, spaceport, and cities by size
//   world    an inhabited world: cities by size and a spaceport
//   outpost  an owned but uninhabited body: one outpost
//   wild     nobody's: no key nodes
export type SettlementTier = 'capital' | 'world' | 'outpost' | 'wild'
export type KeyKind = 'capital' | 'city' | 'spaceport' | 'outpost'

export interface KeySlot {
  node: number
  kind: KeyKind
}

export interface BodySurface {
  bodyName: string
  radiusKm: number
  surfaceClass: PlanetClass
  tier: SettlementTier
  // Per fine node: index into TERRAIN_IDS.
  terrain: Uint8Array
  // Per fine node: land-component id for walkable ground, -1 otherwise.
  landComponent: Int32Array
  mainland: number
  keySlots: KeySlot[]
}

// --- Body lookup -------------------------------------------------------------

export interface BodyGroundInfo {
  radiusKm: number
  planetClass: PlanetClass
}

let bodyInfoCache: Map<string, BodyGroundInfo> | null = null

// Radius and surface class of any planet or moon. Moons have no authored
// class; they're treated as barren rock.
export function bodyGroundInfo(bodyName: string): BodyGroundInfo | null {
  if (!bodyInfoCache) {
    bodyInfoCache = new Map()
    for (const planets of Object.values(PLANETS_BY_STAR)) {
      for (const p of planets) {
        bodyInfoCache.set(p.name, { radiusKm: p.radiusKm, planetClass: p.planetClass })
        for (const m of getMoonsForPlanet(p.name).moons) bodyInfoCache.set(m.name, { radiusKm: m.radiusKm, planetClass: 'barren' })
      }
    }
  }
  return bodyInfoCache.get(bodyName) ?? null
}

export function terrainAt(surface: BodySurface, node: number): TerrainId {
  return TERRAIN_IDS[surface.terrain[node]]
}

// Can this kind of unit stand on this terrain at all?
export function passableFor(terrain: TerrainId, unit: UnitType): boolean {
  const spec = UNIT_TYPES[unit]
  if (spec.terrain[terrain]?.impassable) return false
  const p = TERRAIN[terrain].passable
  return p === 'all' || (p === 'amphibious' && spec.amphibious)
}

// --- Seeded noise ------------------------------------------------------------

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = smooth(x - xi)
  const yf = smooth(y - yi)
  const zf = smooth(z - zi)
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf)
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf)
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf)
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf)
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf)
}

function fbm(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq + 17.3 * o, y * freq, z * freq, seed + o * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

// Rank of each value in [0,1] — thresholds become exact shares.
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out = new Array<number>(values.length)
  order.forEach(([, i], r) => (out[i] = values.length > 1 ? r / (values.length - 1) : 0))
  return out
}

// --- Generation --------------------------------------------------------------

const cache = new Map<string, BodySurface>()

// Tests only: forget every generated surface (to prove regeneration is
// deterministic).
export function clearSurfaceCache(): void {
  cache.clear()
}

export function surfaceOf(bodyName: string, tier: SettlementTier): BodySurface {
  const key = `${bodyName}|${tier}`
  const hit = cache.get(key)
  if (hit) return hit
  const info = bodyGroundInfo(bodyName) ?? { radiusKm: 1000, planetClass: 'barren' as PlanetClass }
  const spec = SURFACE_CLASSES[info.planetClass]
  const seed = hashString(bodyName)
  const mesh = surfaceMesh()
  const n = mesh.count.fine

  const elevation: number[] = []
  const moistureRaw: number[] = []
  const ridge: number[] = []
  for (let i = 0; i < n; i++) {
    const p = nodePoint(i)
    elevation.push(fbm(p.x * 1.8 + 5, p.y * 1.8 + 5, p.z * 1.8 + 5, seed) + spec.continentBias * fbm(p.x * 0.7 + 9, p.y * 0.7 + 9, p.z * 0.7 + 9, seed + 7))
    moistureRaw.push(fbm(p.x * 2.6 + 31, p.y * 2.6 + 31, p.z * 2.6 + 31, seed + 13))
    ridge.push(fbm(p.x * 4 + 71, p.y * 4 + 71, p.z * 4 + 71, seed + 29, 3))
  }
  const elevRank = ranks(elevation)
  const moisture = ranks(moistureRaw)

  let landFraction = spec.landFraction
  let terrain: Uint8Array = new Uint8Array(n)
  let components: Int32Array = new Int32Array(n)
  let mainland = -1
  for (let attempt = 0; attempt < 20; attempt++) {
    terrain = assignTerrain(spec, landFraction, elevRank, moisture, ridge)
    ;({ components, mainland } = landComponents(terrain))
    const mainlandSize = mainland < 0 ? 0 : countOf(components, mainland)
    if (spec.belt !== undefined || landFraction >= 1 || mainlandSize >= MIN_MAINLAND_FRACTION * n) break
    landFraction = Math.min(1, landFraction + 0.05)
  }

  const keySlots = placeKeySlots(info.radiusKm, tier, terrain, components, mainland, elevRank, seed)
  // Cities are urban ground: the slot and its ring of neighbours.
  for (const slot of keySlots) {
    if (slot.kind === 'outpost') continue
    for (const node of [slot.node, ...mesh.neighbors.fine[slot.node]]) {
      if (TERRAIN[TERRAIN_IDS[terrain[node]]].passable === 'all' && components[node] === mainland) terrain[node] = TERRAIN_INDEX.urban
    }
  }

  const surface: BodySurface = {
    bodyName,
    radiusKm: info.radiusKm,
    surfaceClass: info.planetClass,
    tier,
    terrain,
    landComponent: components,
    mainland,
    keySlots,
  }
  cache.set(key, surface)
  return surface
}

function assignTerrain(spec: SurfaceClassSpec, landFraction: number, elevRank: number[], moisture: number[], ridge: number[]): Uint8Array {
  const n = elevRank.length
  const out = new Uint8Array(n)
  const seaLevel = 1 - landFraction
  const landIdx: number[] = []
  for (let i = 0; i < n; i++) {
    const p = nodePoint(i)
    if (spec.belt !== undefined) {
      out[i] = Math.abs(p.y) <= spec.belt ? TERRAIN_INDEX.aerostat : TERRAIN_INDEX.cloud
      continue
    }
    if (elevRank[i] < seaLevel) {
      out[i] = TERRAIN_INDEX[spec.seaTerrain]
      continue
    }
    landIdx.push(i)
    let t: TerrainId = spec.landBase
    if (Math.abs(p.y) > spec.iceLatitude) t = 'tundra'
    else if (moisture[i] > spec.forestMoisture) t = 'forest'
    else if (moisture[i] < spec.desertMoisture) t = 'desert'
    if (spec.eyeball) {
      if (p.x > 0.4) t = 'desert'
      else if (p.x < -0.4) t = 'tundra'
    }
    out[i] = TERRAIN_INDEX[t]
  }
  // The highest, most rugged land is mountains.
  if (spec.mountainFraction > 0 && landIdx.length > 0) {
    const scored = landIdx.map((i) => [elevRank[i] + 0.6 * ridge[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
    const count = Math.floor(spec.mountainFraction * landIdx.length)
    for (let k = 0; k < count; k++) out[scored[k][1]] = TERRAIN_INDEX.mountains
  }
  return out
}

// Connected components of ground every line unit can walk ('all').
function landComponents(terrain: Uint8Array): { components: Int32Array; mainland: number } {
  const { neighbors, count } = surfaceMesh()
  const n = count.fine
  const components = new Int32Array(n).fill(-1)
  const walkable = (i: number) => TERRAIN[TERRAIN_IDS[terrain[i]]].passable === 'all'
  let next = 0
  let best = -1
  let bestSize = 0
  for (let start = 0; start < n; start++) {
    if (components[start] !== -1 || !walkable(start)) continue
    const id = next++
    let size = 0
    const stack = [start]
    components[start] = id
    while (stack.length) {
      const i = stack.pop()!
      size++
      for (const j of neighbors.fine[i]) {
        if (components[j] === -1 && walkable(j)) {
          components[j] = id
          stack.push(j)
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      best = id
    }
  }
  return { components, mainland: best }
}

function countOf(components: Int32Array, id: number): number {
  let c = 0
  for (const v of components) if (v === id) c++
  return c
}

function placeKeySlots(
  radiusKm: number,
  tier: SettlementTier,
  terrain: Uint8Array,
  components: Int32Array,
  mainland: number,
  elevRank: number[],
  seed: number,
): KeySlot[] {
  if (tier === 'wild' || mainland < 0) return []
  const mesh = surfaceMesh()
  const cell = mesh.fineSpacingRad
  const candidates: number[] = []
  for (let i = 0; i < mesh.count.fine; i++) {
    if (components[i] === mainland && TERRAIN_IDS[terrain[i]] !== 'mountains') candidates.push(i)
  }
  if (candidates.length === 0) {
    for (let i = 0; i < mesh.count.fine; i++) if (components[i] === mainland) candidates.push(i)
  }
  const coastal = (i: number) => mesh.neighbors.fine[i].some((j) => components[j] !== mainland)
  // Deterministic jitter so equal-looking worlds don't all put the capital
  // in the same place.
  const jitter = (i: number) => hash3(i, 3, 7, seed) * 0.15
  const capitalScore = (i: number) => (coastal(i) ? 0.4 : 0) + (1 - elevRank[i]) * 0.6 + jitter(i)
  const first = candidates.reduce((best, i) => (capitalScore(i) > capitalScore(best) ? i : best), candidates[0])

  const slots: KeySlot[] = []
  const districts = estimateSize(radiusKm).districts
  const cities = tier === 'capital' || tier === 'world' ? citiesForDistricts(districts) : 0
  if (tier === 'outpost') return [{ node: first, kind: 'outpost' }]

  slots.push({ node: first, kind: tier === 'capital' ? 'capital' : 'city' })
  // Spaceport: close to the first city (2–3.5 cells), low ground.
  const near = candidates
    .filter((i) => {
      const d = arc(nodePoint(i), nodePoint(first)) / cell
      return d >= 1.8 && d <= 3.6
    })
    .sort((a, b) => elevRank[a] - elevRank[b] || a - b)
  if (near.length > 0) slots.push({ node: near[0], kind: 'spaceport' })

  // Further cities: farthest-point sampling, at least the minimum separation.
  const extra = tier === 'capital' ? cities : cities - 1
  let separation = KEY_MIN_SEPARATION_CELLS
  while (slots.filter((s) => s.kind === 'city' || s.kind === 'capital').length < extra + 1 && separation >= 1) {
    let bestNode = -1
    let bestDist = -1
    for (const i of candidates) {
      const d = Math.min(...slots.map((s) => arc(nodePoint(i), nodePoint(s.node)) / cell))
      if (d >= separation && d + jitter(i) > bestDist) {
        bestDist = d + jitter(i)
        bestNode = i
      }
    }
    if (bestNode < 0) separation -= 1
    else slots.push({ node: bestNode, kind: 'city' })
  }
  return slots
}
