import { EARTH_LAND_RINGS } from '../data/earthLand'
import type { TerrainId } from '../data/groundData'
import { lonLatOf } from './mapProjection'
import { normalize, surfaceMesh, type SurfacePoint } from './surfaceMesh'

// Earth's real geography for its planetary map: land and sea from the Natural
// Earth coastline (data/earthLand.ts), and biomes laid over the land from
// hand-placed regions (deserts, mountain ranges, forests, ice) — approximate,
// where the coastline is exact. Pure and memoised; every other world's terrain
// stays procedural (planetTerrain.ts).

// --- Land and sea ------------------------------------------------------------

interface Ring {
  pts: number[] // lon, lat in degrees, flat
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
}

let rings: Ring[] | null = null

function ringsOf(): Ring[] {
  if (rings) return rings
  rings = EARTH_LAND_RINGS.map((r) => {
    const pts = r.map((v) => v / 10)
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      minLon = Math.min(minLon, pts[i])
      maxLon = Math.max(maxLon, pts[i])
      minLat = Math.min(minLat, pts[i + 1])
      maxLat = Math.max(maxLat, pts[i + 1])
    }
    return { pts, minLon, maxLon, minLat, maxLat }
  })
  return rings
}

// Whether a spot (degrees) is on land: inside an odd number of rings.
export function isEarthLand(lonDeg: number, latDeg: number): boolean {
  let inside = false
  for (const ring of ringsOf()) {
    if (lonDeg < ring.minLon || lonDeg > ring.maxLon || latDeg < ring.minLat || latDeg > ring.maxLat) continue
    const p = ring.pts
    let within = false
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1]
      if (yi > latDeg !== yj > latDeg && lonDeg < ((xj - xi) * (latDeg - yi)) / (yj - yi) + xi) within = !within
    }
    if (within) inside = !inside
  }
  return inside
}

export function isEarthLandAt(p: SurfacePoint): boolean {
  const { lon, lat } = lonLatOf(p)
  return isEarthLand((lon * 180) / Math.PI, (lat * 180) / Math.PI)
}

let landValues: Float32Array | null = null

// How much of each fine node's cell is land (0-1), by sampling the cell: 19
// points, the middle and two rings around it. A node is land when this is at
// least a half, and the map's coasts are drawn along the half-way contour of
// these values, so they follow the real coastline to well within a cell.
export function earthLandValues(): Float32Array {
  if (landValues) return landValues
  const mesh = surfaceMesh()
  const n = mesh.count.fine
  const out = new Float32Array(n)
  const cell = mesh.fineSpacingRad
  const offsets: [number, number][] = [[0, 0]]
  for (let k = 0; k < 6; k++) offsets.push([Math.cos((k * Math.PI) / 3) * 0.28 * cell, Math.sin((k * Math.PI) / 3) * 0.28 * cell])
  for (let k = 0; k < 12; k++) offsets.push([Math.cos((k * Math.PI) / 6 + 0.26) * 0.55 * cell, Math.sin((k * Math.PI) / 6 + 0.26) * 0.55 * cell])
  for (let i = 0; i < n; i++) {
    const c = { x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] }
    // A tangent basis at the node.
    const ref = Math.abs(c.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
    const t1 = normalize({ x: ref.y * c.z - ref.z * c.y, y: ref.z * c.x - ref.x * c.z, z: ref.x * c.y - ref.y * c.x })
    const t2 = { x: c.y * t1.z - c.z * t1.y, y: c.z * t1.x - c.x * t1.z, z: c.x * t1.y - c.y * t1.x }
    let land = 0
    for (const [a, b] of offsets) {
      const p = normalize({ x: c.x + t1.x * a + t2.x * b, y: c.y + t1.y * a + t2.y * b, z: c.z + t1.z * a + t2.z * b })
      if (isEarthLandAt(p)) land++
    }
    out[i] = land / offsets.length
  }
  landValues = out
  return out
}

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
