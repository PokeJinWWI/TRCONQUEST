import { flatLookup } from './flatLookup'
import { flatPos, fromLonLat, lonLatOf } from './mapProjection'
import { nearestNode, surfaceMesh, type SurfacePoint } from './surfaceMesh'
import type { HoloNode } from './HoloGlobe'

// Small pictures of the planetary map for the projection switch (see
// components/ProjectionSwitch.tsx): the whole world flat, or the globe seen
// from one side. Painted from the same node colours as the real map, one crisp
// cell per node, with the world's units on top as dots.
const OCEAN = [3, 20, 29]

export interface ThumbUnit {
  position: SurfacePoint
  color: string
}

// Terrain of the flat map, w x h RGBA.
export function flatThumbPixels(w: number, h: number, nodes: HoloNode[]): ImageData {
  const lk = flatLookup()
  const img = new ImageData(w, h)
  for (let y = 0; y < h; y++) {
    const j = Math.min(lk.height - 1, Math.floor(((h - 1 - y + 0.5) / h) * lk.height))
    for (let x = 0; x < w; x++) {
      const i = Math.min(lk.width - 1, Math.floor(((x + 0.5) / w) * lk.width))
      const o = (j * lk.width + i) * 4
      const t = (lk.pixels[o] << 8) | lk.pixels[o + 1]
      const wa = lk.pixels[o + 2] / 255
      const wb = lk.pixels[o + 3] / 255
      const wc = Math.max(0, 1 - wa - wb)
      const ids = [lk.triangles[t * 4], lk.triangles[t * 4 + 1], lk.triangles[t * 4 + 2]]
      const ws = [wa, wb, wc]
      const land = ids.reduce((s, id, k) => s + ws[k] * (nodes[id]?.land ? 1 : 0), 0) > 0.5
      // The heaviest land corner (or just the heaviest) gives the colour.
      let best = 0
      let bestScore = -1
      for (let k = 0; k < 3; k++) {
        const score = (nodes[ids[k]]?.land ? 1 : 0) + ws[k]
        if (score > bestScore) {
          bestScore = score
          best = k
        }
      }
      const n = nodes[ids[best]]
      const p = (y * w + x) * 4
      img.data[p] = land && n ? n.r : OCEAN[0]
      img.data[p + 1] = land && n ? n.g : OCEAN[1]
      img.data[p + 2] = land && n ? n.b : OCEAN[2]
      img.data[p + 3] = 255
    }
  }
  return img
}

// The basis of a globe seen from `focus`: the direction to the viewer, and the
// screen's right and up.
function basis(focus: SurfacePoint) {
  const f = focus
  let r = { x: f.z, y: 0, z: -f.x } // up x f, with up = +y
  const l = Math.hypot(r.x, r.y, r.z)
  r = l < 1e-6 ? { x: 1, y: 0, z: 0 } : { x: r.x / l, y: 0, z: r.z / l }
  const u = { x: f.y * r.z - f.z * r.y, y: f.z * r.x - f.x * r.z, z: f.x * r.y - f.y * r.x }
  return { f, r, u }
}

// Terrain of the globe seen from `focus`, size x size RGBA (transparent outside
// the disc).
export function globeThumbPixels(size: number, nodes: HoloNode[], focus: SurfacePoint): ImageData {
  const img = new ImageData(size, size)
  const { f, r, u } = basis(focus)
  const R = size / 2 - 1
  let hint: number | undefined
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5 - size / 2) / R
      const sy = -(y + 0.5 - size / 2) / R
      const d2 = sx * sx + sy * sy
      if (d2 > 1) continue
      const sz = Math.sqrt(1 - d2)
      const p = { x: f.x * sz + r.x * sx + u.x * sy, y: f.y * sz + r.y * sx + u.y * sy, z: f.z * sz + r.z * sx + u.z * sy }
      const node = nearestNode(p, 'fine', hint)
      hint = node
      const n = nodes[node]
      const o = (y * size + x) * 4
      img.data[o] = n?.land ? n.r : OCEAN[0]
      img.data[o + 1] = n?.land ? n.g : OCEAN[1]
      img.data[o + 2] = n?.land ? n.b : OCEAN[2]
      img.data[o + 3] = 255
    }
  }
  return img
}

// Where the globe thumbnail should look: at the units if there are any.
export function thumbFocus(units: ThumbUnit[]): SurfacePoint {
  if (units.length === 0) return fromLonLat(0, 0.3)
  const sum = units.reduce((a, u) => ({ x: a.x + u.position.x, y: a.y + u.position.y, z: a.z + u.position.z }), { x: 0, y: 0, z: 0 })
  const l = Math.hypot(sum.x, sum.y, sum.z)
  if (l < 1e-6) return fromLonLat(0, 0.3)
  return { x: sum.x / l, y: sum.y / l, z: sum.z / l }
}

export function drawUnitsFlat(ctx: CanvasRenderingContext2D, w: number, h: number, units: ThumbUnit[]): void {
  for (const u of units) {
    const [x, y] = flatPos(u.position)
    const px = ((x / 20 + 1) / 2) * w
    const py = (1 - (y / 10 + 1) / 2) * h
    dot(ctx, px, py, u.color)
  }
}

export function drawUnitsGlobe(ctx: CanvasRenderingContext2D, size: number, units: ThumbUnit[], focus: SurfacePoint): void {
  const { f, r, u } = basis(focus)
  const R = size / 2 - 1
  for (const unit of units) {
    const p = unit.position
    if (p.x * f.x + p.y * f.y + p.z * f.z <= 0.02) continue
    dot(ctx, size / 2 + (p.x * r.x + p.y * r.y + p.z * r.z) * R, size / 2 - (p.x * u.x + p.y * u.y + p.z * u.z) * R, unit.color)
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(x - 2.5, y - 2.5, 5, 5)
  ctx.fillStyle = color
  ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
}

// Every node's display colour, for the thumbnails.
export function collectNodes(nodeAt: (node: number) => HoloNode): HoloNode[] {
  const count = surfaceMesh().count.fine
  const out: HoloNode[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = nodeAt(i)
  return out
}

export { lonLatOf }
