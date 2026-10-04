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
  // RGBA8 per pixel, packing a 20-bit triangle index and two corner weights:
  //   R = triangle index bits [15:8]
  //   G = triangle index bits [7:0]
  //   B = weight of corner A (top 6 bits) | triangle index bits [19:18] (low 2)
  //   A = weight of corner B (top 6 bits) | triangle index bits [17:16] (low 2)
  // Corner C's weight is what is left of 1. The 2-byte index (max 65,535) used to
  // overflow at mesh level 6 (~81,920 triangles); the two spare low bits of each
  // weight byte lift it to 20 bits (~1M triangles), costing the weights two bits
  // of precision (6 bits ≈ 1/64 of a cell, far inside the half-pixel tolerance).
  pixels: Uint8Array
  // Per triangle, RGBA float32: its three node ids (and 0), TRI_TEX_WIDTH per row.
  triangles: Float32Array
  triRows: number
}

// Pack/unpack the pixel so the bake, the thumbnail and the shader can never
// disagree. The shader (FlatMap.tsx) carries an equivalent decode in GLSL.
export function packPixel(pixels: Uint8Array, o: number, t: number, wa: number, wb: number): void {
  const hiNib = (t >> 16) & 0xf
  const wa6 = Math.round(Math.min(1, Math.max(0, wa)) * 63)
  const wb6 = Math.round(Math.min(1, Math.max(0, wb)) * 63)
  pixels[o] = (t >> 8) & 255
  pixels[o + 1] = t & 255
  pixels[o + 2] = (wa6 << 2) | ((hiNib >> 2) & 3)
  pixels[o + 3] = (wb6 << 2) | (hiNib & 3)
}

export function unpackPixel(pixels: Uint8Array, o: number): { t: number; wa: number; wb: number; wc: number } {
  const b = pixels[o + 2]
  const a = pixels[o + 3]
  const hiNib = ((b & 3) << 2) | (a & 3)
  const t = (hiNib << 16) | (pixels[o] << 8) | pixels[o + 1]
  const wa = (b >> 2) / 63
  const wb = (a >> 2) / 63
  return { t, wa, wb, wc: Math.max(0, 1 - wa - wb) }
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
      packPixel(pixels, (j * w + i) * 4, bestT, bw[0], bw[1])
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
