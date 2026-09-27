import type { TerrainId } from '../data/groundData'
import { lonLatOf } from './mapProjection'
import type { SurfacePoint } from './surfaceMesh'

// Earth's biomes, laid over its land: hand-placed regions (deserts, mountain
// ranges, forests, ice) — approximate. Its land and sea are real data
// (bodyTopography.ts: ETOPO 2022 bedrock with the sea 70 m higher, every ice
// sheet melted), and so is its relief.

// --- Biomes ------------------------------------------------------------------

// Boxes in degrees: [lon0, lon1, lat0, lat1].
type Box = [number, number, number, number]
const inAny = (lon: number, lat: number, boxes: Box[]) => boxes.some(([a, b, c, d]) => lon >= a && lon <= b && lat >= c && lat <= d)

const MOUNTAINS: Box[] = [
  [70, 105, 27, 38], // Himalaya and the Tibetan plateau
  [72, 96, 38, 46], // Tian Shan, Altai
  [-80, -66, -55, 12], // the Andes
  [-124, -104, 33, 60], // the Rockies and Sierra
  [5, 16, 44, 48], // the Alps
  [38, 49, 40, 44], // the Caucasus
  [57, 62, 50, 67], // the Urals
  [-9, 9, 30, 36], // the Atlas
  [35, 42, 6, 14], // the Ethiopian highlands
  [44, 58, 28, 37], // the Iranian plateau
  [6, 16, 60, 68], // the Scandes
  [96, 104, 20, 30], // Yunnan and the Hengduan
  [140, 152, -9, -2], // New Guinea's spine
]
const DESERTS: Box[] = [
  [-17, 35, 15, 32], // the Sahara
  [35, 58, 15, 32], // Arabia
  [52, 68, 36, 45], // the Karakum and Kyzylkum
  [90, 118, 37, 46], // the Gobi
  [68, 75, 24, 30], // the Thar
  [120, 142, -32, -20], // the Australian interior
  [12, 26, -28, -17], // the Kalahari and Namib
  [-72, -64, -50, -38], // Patagonia
  [-72, -68, -27, -18], // the Atacama
  [-118, -104, 28, 37], // the American south-west
  [40, 51, 2, 12], // the Horn of Africa
]
const FORESTS: Box[] = [
  [-75, -50, -12, 5], // the Amazon
  [9, 30, -6, 6], // the Congo basin
  [95, 140, -8, 22], // South-East Asia
  [30, 170, 52, 66], // the taiga
  [-135, -55, 48, 62], // the boreal forest
  [-95, -70, 30, 46], // the eastern United States
  [-5, 30, 42, 60], // Europe
  [100, 145, 22, 45], // southern China, Korea, Japan
  [-95, -77, 7, 20], // Central America
  [-15, 12, 4, 10], // the West African coast
  [145, 154, -38, -15], // eastern Australia
  [166, 178, -47, -35], // New Zealand
  [76, 82, 8, 16], // the Western Ghats
]

// The terrain of a land node at this longitude/latitude (degrees): ice at the
// poles, then mountains, deserts and forests in their regions, plains
// elsewhere.
export function earthBiome(lonDeg: number, latDeg: number): TerrainId {
  if (latDeg < -60 || latDeg > 72) return 'tundra'
  if (latDeg > 60 && lonDeg > -75 && lonDeg < -10) return 'tundra' // Greenland
  if (latDeg > 66) return 'tundra'
  if (inAny(lonDeg, latDeg, MOUNTAINS)) return 'mountains'
  if (inAny(lonDeg, latDeg, DESERTS)) return 'desert'
  if (inAny(lonDeg, latDeg, FORESTS)) return 'forest'
  return 'plains'
}

export function earthBiomeAt(p: SurfacePoint): TerrainId {
  const { lon, lat } = lonLatOf(p)
  return earthBiome((lon * 180) / Math.PI, (lat * 180) / Math.PI)
}
