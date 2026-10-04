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
import { earthBiome, inPlateauBox, inRangeBox } from './earthTerrain'

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
  regionNames: string[]
  region: Uint8Array | null // 1-based into regionNames, 0 = none
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
      regionNames: raw.regionNames,
      region: raw.region ? decode(raw.region) : null,
    }
  }
  cache.set(bodyName, t)
  return t
}

// The named region a node lies in (IAU: Xanthe Terra, Mare Imbrium…), if any.
export function regionAt(bodyName: string, node: number): string | null {
  const t = topographyOf(bodyName)
  const k = t?.region?.[node] ?? 0
  return k > 0 ? t!.regionNames[k - 1] ?? null : null
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
// Major inland lakes to paint back as water on Earth (connected-sea masking
// drops them). [lonMin, lonMax, latMin, latMax], degrees. Coarse boxes — enough
// for the iconic lakes to read on the map at this grid resolution.
const EARTH_LAKES: readonly [number, number, number, number][] = [
  [-92, -83, 44.5, 49], // Great Lakes — Superior/Michigan/Huron
  [-83.5, -76, 41, 44.5], // Great Lakes — Erie/Ontario (the L-bend east)
  [47, 54.5, 37, 47], // Caspian Sea
  [31.5, 34.5, -3, 0.8], // Lake Victoria
  [29, 31, -8.8, -3.3], // Lake Tanganyika (thin rift lake)
  [34, 35.6, -14.3, -9.3], // Lake Malawi (thin rift lake)
  [104, 110, 51.5, 55.5], // Lake Baikal (thin crescent)
]

export function realTerrain(t: Topography): (TerrainId | null)[] {
  const n = t.feature.length
  const all = Array.from({ length: n }, (_, i) => i)
  const mapped = all.filter((i) => t.mapped[i])
  const latOf = (i: number) => (lonLatOf(nodePoint(i)).lat * 180) / Math.PI
  const lonOf = (i: number) => (lonLatOf(nodePoint(i)).lon * 180) / Math.PI
  // A node is sea when this much of its cell is water. Earth uses a high cutoff:
  // because the water mask already bakes in the +70 m sea, any non-water sample is
  // genuine land ABOVE the risen sea, and open ocean cells have no land at all, so
  // a cell counts as land when even ~a sixth of it is above water. That fills in
  // coastlines and narrow archipelagos — Britain, Japan, Indonesia, the Philippines,
  // New Zealand — that would otherwise drown between the grid's nodes, without ever
  // turning open ocean into land. Other bodies keep the even 50% split.
  const seaCut = t.bodyName === 'Earth' ? 210 : 128
  const isSea = all.map((i) => !!t.water && t.water[i] >= seaCut)
  const land = mapped.filter((i) => !isSea[i])
  const highElev = t.elev ? percentile(t.elev, land, 0.88) : Infinity
  const highRough = t.rough ? Math.max(1, percentile(t.rough, land, 0.9)) : Infinity
  const peak = t.elev ? percentile(t.elev, land, 0.97) : Infinity
  // Earth highland thresholds: within a named range the higher ground is mountains,
  // within a named plateau the higher ground is plateau (lower bars than the global
  // peak test, so low eroded ranges — the Urals — and broad uplands still read).
  const earthRangeElev = t.elev ? percentile(t.elev, land, 0.55) : Infinity
  const earthRangeRough = t.rough ? Math.max(1, percentile(t.rough, land, 0.6)) : Infinity
  const earthPlateauElev = t.elev ? percentile(t.elev, land, 0.5) : Infinity
  const dark = t.bright ? percentile(t.bright, mapped, 0.3) : -1
  const bright = t.bright ? percentile(t.bright, mapped, 0.6) : Infinity
  const brightest = t.bright ? percentile(t.bright, mapped, 0.7) : Infinity
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
          const lon = lonOf(i)
          // Major inland lakes: the connected-sea mask leaves them as land (they
          // aren't joined to the ocean), which reads as uncanny on a real map.
          // Paint the big named ones back in as water.
          if (EARTH_LAKES.some((L) => lon >= L[0] && lon <= L[1] && lat >= L[2] && lat <= L[3])) return 'ocean'
          const b = earthBiome(lon, lat)
          if (b === 'tundra') return 'tundra'
          const e = t.elev ? t.elev[i] : 0
          const r = t.rough ? t.rough[i] : 0
          // Mountains: within a named range, ground that is both high AND rugged —
          // high but SMOOTH ground (the western high plains, Alberta's prairie) is
          // not a range, so it must clear the roughness bar too. Plus rugged high
          // ground anywhere (ranges the boxes miss). Then plateau: a named plateau's
          // upland, or any very high but not-rugged ground (Tibet reads as plateau).
          if (f === 'mountain' || (inRangeBox(lon, lat) && e >= earthRangeElev && r >= earthRangeRough) || (rugged && e >= highElev)) return 'mountains'
          if ((inPlateauBox(lon, lat) && e >= earthPlateauElev) || e >= highElev) return 'plateau'
          return b
        }
        if ((t.elev && t.elev[i] >= highElev) || rugged) return 'mountains'
        if (Math.abs(lat) > 62) return 'tundra'
        if (seaDist[i] <= 1 && Math.abs(lat) < 55) return 'forest'
        // Mars is terraformed green to the horizon — no deserts; its dry interior
        // reads as plains. Venus keeps the dry-interior desert band.
        if (seaDist[i] >= 3 && Math.abs(lat) < 40) return t.bodyName === 'Mars' ? 'plains' : 'desert'
        return 'plains'
      }
      case 'airless':
        // An airless body is bare grey rock, never green: mountains in the rugged
        // highlands, barren rock everywhere else (the Moon's maria and Mercury's
        // smooth plains read through the real-map relief shading, not a terrain tint).
        return rugged || (t.elev && t.elev[i] >= peak) ? 'mountains' : 'rock'
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
