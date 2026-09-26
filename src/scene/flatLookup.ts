import { fromLonLat } from './mapProjection'
import { nearestNode, surfaceMesh } from './surfaceMesh'

// What the flat map needs from the globe's triangle mesh: for every pixel of an
// equirectangular grid, which triangle of the fine mesh it falls in and its
// weights in that triangle. The shader then shades a pixel exactly as the globe
// shades the same spot (see HoloGlobe / FlatMap). The mesh is the same for
// every world, so this is baked once.
export const LOOKUP_WIDTH = 1024
export const LOOKUP_HEIGHT = 512
export const TRI_TEX_WIDTH = 128

export interface FlatLookup {
  width: number
  height: number
  // RGBA8 per pixel: triangle index high byte, low byte, weight of corner A,
  // weight of corner B (corner C's weight is what is left of 1).
  pixels: Uint8Array
  // Per triangle, RGBA float32: its three node ids (and 0), TRI_TEX_WIDTH per row.
  triangles: Float32Array
  triRows: number
}

let cached: FlatLookup | null = null

export function flatLookup(): FlatLookup {
  if (cached) return cached
  const mesh = surfaceMesh()
  const { positions, faces } = mesh
  const triCount = faces.length / 3
  const triRows = Math.ceil(triCount / TRI_TEX_WIDTH)
  const triangles = new Float32Array(TRI_TEX_WIDTH * triRows * 4)
  // Triangles around each node.
  const around: number[][] = Array.from({ length: mesh.count.fine }, () => [])
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const n = faces[t * 3 + k]
      around[n].push(t)
      triangles[t * 4 + k] = n
    }
  }

  const w = LOOKUP_WIDTH
  const h = LOOKUP_HEIGHT
  const pixels = new Uint8Array(w * h * 4)
  let hint: number | undefined
  for (let j = 0; j < h; j++) {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w - 0.5) * Math.PI * 2
      const p = fromLonLat(lon, lat)
      const node = nearestNode(p, 'fine', hint)
      hint = node
      // The triangle around the nearest node that holds the point best: all
      // three of its (barycentric) coefficients non-negative, or failing that
      // the one where the smallest is least negative.
      let bestT = around[node][0]
      let bestMin = -Infinity
      let bw: [number, number] = [1, 0]
      for (const t of around[node]) {
        const a = faces[t * 3] * 3
        const b = faces[t * 3 + 1] * 3
        const c = faces[t * 3 + 2] * 3
        const co = solve3(positions, a, b, c, p.x, p.y, p.z)
        const min = Math.min(co[0], co[1], co[2])
        if (min > bestMin) {
          bestMin = min
          bestT = t
          const sum = co[0] + co[1] + co[2] || 1
          bw = [Math.max(0, co[0] / sum), Math.max(0, co[1] / sum)]
        }
        if (min >= 0) break
      }
      const o = (j * w + i) * 4
      pixels[o] = bestT >> 8
      pixels[o + 1] = bestT & 255
      pixels[o + 2] = Math.round(Math.min(1, bw[0]) * 255)
      pixels[o + 3] = Math.round(Math.min(1, bw[1]) * 255)
    }
  }
  cached = { width: w, height: h, pixels, triangles, triRows }
  return cached
}

// Coefficients (u, v, s) with p = u*A + v*B + s*C, by Cramer's rule.
export function solve3(pos: Float64Array, a: number, b: number, c: number, px: number, py: number, pz: number): [number, number, number] {
  const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
  const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
  const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2]
  const det = ax * (by * cz - bz * cy) - bx * (ay * cz - az * cy) + cx * (ay * bz - az * by)
  if (Math.abs(det) < 1e-12) return [-1, -1, -1]
  const u = (px * (by * cz - bz * cy) - bx * (py * cz - pz * cy) + cx * (py * bz - pz * by)) / det
  const v = (ax * (py * cz - pz * cy) - px * (ay * cz - az * cy) + cx * (ay * pz - az * py)) / det
  const s = (ax * (by * pz - bz * py) - bx * (ay * pz - az * py) + px * (ay * bz - az * by)) / det
  return [u, v, s]
}
