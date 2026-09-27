// Real maps of the solar system's solid bodies (data/bodyTopography.ts, made
// by scripts/terrain/build.ts from NASA/USGS/NOAA data and the IAU Gazetteer):
// decoding, and the rules that turn each node's data into terrain. Pure and
// memoised. Bodies not in the data (other star systems; Haumea, Makemake, Eris,
// Deimos, which have no maps) stay procedural, and so do the unmapped parts of
// partly-seen bodies (Pluto's far side, Uranus's moons' northern halves).
//
// Terrain rules, by kind of body:
//   water    Earth, Venus and Mars with oceans: a node is sea when most of its
//            cell is under water. Earth's land keeps its real biome regions
//            (earthTerrain.earthBiome). Venus's and Mars's land has no climate
//            data, so it is simple and stated: the highest or most rugged 12%
//            is mountains, near the poles (|lat| > 62°) tundra, coasts green
//            (forest within a cell of the sea, below 55°), far inland dry
//            (desert 3+ cells from the sea, below 40°), plains otherwise.
//   airless  bare rock; the most rugged 10% and highest 3% of the ground (and
//            named montes) is mountains; low, smooth ground (the lowest 35%
//            and smoothest 40%) is plains — the Moon's maria, Mercury's
//            smooth plains.
//   icy      ice (tundra); dark terrain is rock; montes are mountains; named
//            plains (Pluto's Sputnik Planitia) are plains.
//   io       paterae and eruptive centres are lava; montes are mountains; the
//            bright sulfur plains are desert; the rest plains.
//   titan    the real methane seas and lakes are sea; dark equatorial dune
//            fields are desert; bright highlands rock; the rest plains.

import { BODY_TOPOGRAPHY, type RawTopography } from '../data/bodyTopography'
import { FEATURE_CODES, type FeatureCode } from '../data/topographyCodes'
import type { TerrainId } from '../data/groundData'
import { lonLatOf } from './mapProjection'
import { nodePoint, surfaceMesh } from './surfaceMesh'
import { earthBiome } from './earthTerrain'

export interface Topography {
  bodyName: string
  kind: RawTopography['kind']
  seaLevelM: number | null
  source: string
  picture: string | null
  elev: Int16Array | null
  rough: Uint8Array | null
  bright: Uint8Array | null
  water: Uint8Array | null // 0–255 share under water
  feature: Uint8Array
  mapped: Uint8Array
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const cache = new Map<string, Topography | null>()

export function hasTopography(bodyName: string): boolean {
  return bodyName in BODY_TOPOGRAPHY
}

export function topographyOf(bodyName: string): Topography | null {
  if (cache.has(bodyName)) return cache.get(bodyName)!
  const raw = BODY_TOPOGRAPHY[bodyName]
  let t: Topography | null = null
  if (raw) {
    const e = raw.elev ? decode(raw.elev) : null
    t = {
      bodyName,
      kind: raw.kind,
      seaLevelM: raw.seaLevelM,
      source: raw.source,
      picture: raw.picture,
      elev: e ? new Int16Array(e.buffer, e.byteOffset, e.byteLength / 2) : null,
      rough: raw.rough ? decode(raw.rough) : null,
      bright: raw.bright ? decode(raw.bright) : null,
      water: raw.water ? decode(raw.water) : null,
      feature: decode(raw.feature),
      mapped: decode(raw.mapped),
    }
  }
  cache.set(bodyName, t)
  return t
}

export const featureAt = (t: Topography, node: number): FeatureCode => FEATURE_CODES[t.feature[node]] ?? 'none'

// Share of each node's cell that is land (0–1), for worlds with seas (the map
// draws coasts along its half-way contour); undefined for dry bodies.
export function landValuesOf(t: Topography): Float32Array | undefined {
  if (!t.water) return undefined
  const out = new Float32Array(t.water.length)
  for (let i = 0; i < out.length; i++) out[i] = 1 - t.water[i] / 255
  return out
}

// Height of each node above the sea (water worlds) or above the body's median
// ground, in metres — the terrain map's base relief. Undefined without a DEM.
export function reliefOf(t: Topography): Float32Array | undefined {
  if (!t.elev) return undefined
  const ref = t.seaLevelM ?? median(Array.from(t.elev))
  const out = new Float32Array(t.elev.length)
  for (let i = 0; i < out.length; i++) out[i] = t.elev[i] - ref
  return out
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

// The value at the p-th percentile (0–1) of `v` over the given nodes.
function percentile(v: ArrayLike<number>, nodes: number[], p: number): number {
  const s = nodes.map((i) => v[i]).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : Infinity
}

// Steps (in fine nodes) from each node to the nearest sea node.
function distanceToSea(isSea: boolean[]): number[] {
  const nb = surfaceMesh().neighbors.fine
  const dist = isSea.map((s) => (s ? 0 : Infinity))
  const queue: number[] = []
  isSea.forEach((s, i) => s && queue.push(i))
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    for (const j of nb[i]) {
      if (dist[j] === Infinity) {
        dist[j] = dist[i] + 1
        queue.push(j)
      }
    }
  }
  return dist
}

// The terrain of every node from the real data, or null where the body is
// unmapped (the caller fills those procedurally).
export function realTerrain(t: Topography): (TerrainId | null)[] {
  const n = t.feature.length
  const all = Array.from({ length: n }, (_, i) => i)
  const mapped = all.filter((i) => t.mapped[i])
  const latOf = (i: number) => (lonLatOf(nodePoint(i)).lat * 180) / Math.PI
  const lonOf = (i: number) => (lonLatOf(nodePoint(i)).lon * 180) / Math.PI
  const isSea = all.map((i) => !!t.water && t.water[i] >= 128)
  const land = mapped.filter((i) => !isSea[i])
  const highElev = t.elev ? percentile(t.elev, land, 0.88) : Infinity
  const highRough = t.rough ? Math.max(1, percentile(t.rough, land, 0.9)) : Infinity
  const peak = t.elev ? percentile(t.elev, land, 0.97) : Infinity
  const dark = t.bright ? percentile(t.bright, mapped, 0.3) : -1
  const bright = t.bright ? percentile(t.bright, mapped, 0.6) : Infinity
  const brightest = t.bright ? percentile(t.bright, mapped, 0.7) : Infinity
  const lowPlain = t.elev ? percentile(t.elev, land, 0.35) : -Infinity
  const smooth = t.rough ? percentile(t.rough, land, 0.4) : -Infinity
  const seaDist = t.water ? distanceToSea(isSea) : []
  return all.map((i): TerrainId | null => {
    if (!t.mapped[i]) return null
    const f = featureAt(t, i)
    const lat = latOf(i)
    const rugged = (t.rough ? t.rough[i] >= highRough : false) || f === 'mountain'
    switch (t.kind) {
      case 'water': {
        if (isSea[i]) return 'ocean'
        if (t.bodyName === 'Earth') {
          const b = earthBiome(lonOf(i), lat)
          // Real mountains the region boxes miss (and none of their false hits on low ground).
          return b === 'tundra' ? b : rugged && t.elev![i] >= highElev ? 'mountains' : b
        }
        if ((t.elev && t.elev[i] >= highElev) || rugged) return 'mountains'
        if (Math.abs(lat) > 62) return 'tundra'
        if (seaDist[i] <= 1 && Math.abs(lat) < 55) return 'forest'
        if (seaDist[i] >= 3 && Math.abs(lat) < 40) return 'desert'
        return 'plains'
      }
      case 'airless':
        if (rugged || (t.elev && t.elev[i] >= peak)) return 'mountains'
        // Low, smooth ground is plains: the Moon's maria, Mercury's smooth plains.
        if (t.elev && t.rough && t.elev[i] <= lowPlain && t.rough[i] <= smooth) return 'plains'
        return 'rock'
      case 'icy':
        if (f === 'mountain' || (t.rough && t.rough[i] >= highRough)) return 'mountains'
        if (f === 'plain') return 'plains'
        if (t.bright && t.bright[i] <= dark) return 'rock'
        return 'tundra'
      case 'io':
        if (f === 'volcano') return 'lava'
        if (f === 'mountain') return 'mountains'
        if (t.bright && t.bright[i] >= bright) return 'desert'
        return 'plains'
      case 'titan':
        if (isSea[i]) return 'ocean'
        if (f === 'mountain') return 'mountains'
        if (Math.abs(lat) < 30 && t.bright && t.bright[i] <= dark) return 'desert'
        if (t.bright && t.bright[i] >= brightest) return 'rock'
        return 'plains'
    }
    return null
  })
}
