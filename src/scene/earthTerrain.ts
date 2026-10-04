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

// Named mountain RANGES (rugged uplift) and PLATEAUS (high but smooth). These
// place the highland in the right part of the world; realTerrain (bodyTopography)
// then shapes it with the real DEM — within a range box only the genuinely high
// ground becomes 'mountains' (so a range is its spine, not the whole rectangle),
// and within a plateau box the high ground becomes 'plateau'. A box alone never
// paints a flat slab. Low, eroded ranges (the Urals) still show because the box
// lets their modest height count; the Tibetan plateau reads as plateau, not peaks,
// because it sits in a PLATEAU box, not a RANGE box.
const RANGES: Box[] = [
  [73, 96, 26, 32], // the Himalaya (south rim)
  [70, 78, 33, 38], // the Karakoram and Hindu Kush
  [74, 88, 40, 45], // the Tian Shan
  [84, 99, 45, 52], // the Altai and Sayan
  [96, 105, 22, 33], // the Hengduan
  [-78, -66, -55, 10], // the Andes
  [-120, -104, 36, 49], // the US Rockies (Front Range ~-105)
  [-126, -115, 49, 61], // the Canadian Rockies (well west of the Alberta prairie)
  [-125, -118, 36, 50], // the Sierra Nevada and Cascades
  [-152, -128, 58, 66], // the Alaska and Yukon ranges
  [5, 16, 44, 48], // the Alps
  [38, 49, 40, 44], // the Caucasus
  [57, 62, 50, 68], // the Urals
  [-10, 9, 29, 36], // the Atlas
  [5, 17, 59, 69], // the Scandes
  [-84, -73, 34, 47], // the Appalachians
  [44, 56, 30, 38], // the Zagros
  [136, 142, 34, 44], // the Japanese Alps
  [136, 148, -8, -3], // New Guinea's spine
  [166, 174, -46, -42], // New Zealand's Southern Alps
  [146, 152, -38, -25], // the Great Dividing Range
  [27, 31, -31, -27], // the Drakensberg
]
const PLATEAUS: Box[] = [
  [80, 100, 29, 38], // the Tibetan plateau
  [-71, -64, -24, -14], // the Altiplano
  [-113, -106, 36, 43], // the Colorado Plateau and Great Basin edge
  [-106, -99, 19, 24], // the Mexican plateau
  [51, 63, 28, 36], // the Iranian plateau
  [30, 43, 37, 40], // the Anatolian plateau
  [74, 80, 14, 24], // the Deccan
  [98, 116, 43, 50], // the Mongolian plateau
  [34, 38, -3, 2], // the East African plateau (the Kenyan highlands)
  [-51, -43, -22, -15], // the Brazilian highlands
  [-6, -2, 38, 42], // the Spanish Meseta
  [36, 40, 6, 14], // the Ethiopian highlands
]
export const inRangeBox = (lonDeg: number, latDeg: number) => inAny(lonDeg, latDeg, RANGES)
export const inPlateauBox = (lonDeg: number, latDeg: number) => inAny(lonDeg, latDeg, PLATEAUS)

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
  if (inAny(lonDeg, latDeg, DESERTS)) return 'desert'
  if (inAny(lonDeg, latDeg, FORESTS)) return 'forest'
  return 'plains'
}

export function earthBiomeAt(p: SurfacePoint): TerrainId {
  const { lon, lat } = lonLatOf(p)
  return earthBiome((lon * 180) / Math.PI, (lat * 180) / Math.PI)
}
