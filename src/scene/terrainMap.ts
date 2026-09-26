// The terrain map's ground: a square patch of a world's surface, cut out around
// a fight, with real relief. Pure and deterministic — the relief is a property
// of the ground (noise sampled at the world's own coordinates), so the same
// hills are there whenever and wherever the patch is cut.
//
// Coordinates: the patch has a local frame (x east, y north) in FINE CELLS —
// the same unit ranges and speeds are measured in on the planetary map — from a
// gnomonic projection onto the tangent plane at its centre, good to a percent
// or so across the patch. The relief grid has TERRAIN_GRID_PER_CELL points to a
// cell.
import { TERRAIN, TERRAIN_GRID_PER_CELL, TERRAIN_HALF_CELLS, TERRAIN_RELIEF, type TerrainId } from '../data/groundData'
import { TERRAIN_IDS, type BodySurface } from './planetTerrain'
import { nearestNode, normalize, surfaceMesh, type SurfacePoint } from './surfaceMesh'

// --- The local frame ---------------------------------------------------------

export interface TerrainFrame {
  center: SurfacePoint
  east: SurfacePoint
  north: SurfacePoint
}

const cross = (a: SurfacePoint, b: SurfacePoint): SurfacePoint => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const dot = (a: SurfacePoint, b: SurfacePoint) => a.x * b.x + a.y * b.y + a.z * b.z

export function makeFrame(center: SurfacePoint): TerrainFrame {
  const c = normalize(center)
  const up = Math.abs(c.y) > 0.999 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const east = normalize(cross(up, c))
  const north = cross(c, east)
  return { center: c, east, north }
}

// A point on the globe, as (x, y) in cells from the frame's centre.
export function toLocal(frame: TerrainFrame, p: SurfacePoint): { x: number; y: number } {
  const cell = surfaceMesh().fineSpacingRad
  const d = dot(p, frame.center) || 1e-9
  const q = { x: p.x / d - frame.center.x, y: p.y / d - frame.center.y, z: p.z / d - frame.center.z }
  return { x: dot(q, frame.east) / cell, y: dot(q, frame.north) / cell }
}

// The globe point at local (x, y) cells.
export function toGlobal(frame: TerrainFrame, x: number, y: number): SurfacePoint {
  const cell = surfaceMesh().fineSpacingRad
  return normalize({
    x: frame.center.x + (frame.east.x * x + frame.north.x * y) * cell,
    y: frame.center.y + (frame.east.y * x + frame.north.y * y) * cell,
    z: frame.center.z + (frame.east.z * x + frame.north.z * y) * cell,
  })
}

// --- Noise (of the globe point, so relief belongs to the ground) --------------

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const s = (t: number) => t * t * (3 - 2 * t)
  const xf = s(x - xi), yf = s(y - yi), zf = s(z - zi)
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  )
}

function fbm(p: SurfacePoint, freq: number, octaves: number): number {
  let sum = 0, amp = 1, norm = 0, f = freq
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(p.x * f + 17.3 * o, p.y * f + 5.1 * o, p.z * f + 9.7 * o)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

// --- The relief grid ---------------------------------------------------------

export interface TerrainGrid {
  n: number // points along a side
  perCell: number
  half: number // cells each side of the centre
  terrain: Uint8Array // per point: index into TERRAIN_IDS
  height: Float32Array // per point, metres
}

export const gridSize = () => Math.round(2 * TERRAIN_HALF_CELLS * TERRAIN_GRID_PER_CELL)

// The local position (cells) of a grid point's centre.
export function gridPoint(grid: TerrainGrid, i: number, j: number): { x: number; y: number } {
  return { x: (i + 0.5) / grid.perCell - grid.half, y: (j + 0.5) / grid.perCell - grid.half }
}

// The grid point under a local position, clamped to the patch.
export function gridCell(grid: TerrainGrid, x: number, y: number): { i: number; j: number } {
  const i = Math.floor((x + grid.half) * grid.perCell)
  const j = Math.floor((y + grid.half) * grid.perCell)
  return { i: Math.max(0, Math.min(grid.n - 1, i)), j: Math.max(0, Math.min(grid.n - 1, j)) }
}

export function terrainAtLocal(grid: TerrainGrid, x: number, y: number): TerrainId {
  const { i, j } = gridCell(grid, x, y)
  return TERRAIN_IDS[grid.terrain[j * grid.n + i]]
}

// Height (metres) at a local position, interpolated between grid points.
export function heightAtLocal(grid: TerrainGrid, x: number, y: number): number {
  const fx = Math.max(0, Math.min(grid.n - 1, (x + grid.half) * grid.perCell - 0.5))
  const fy = Math.max(0, Math.min(grid.n - 1, (y + grid.half) * grid.perCell - 0.5))
  const i0 = Math.floor(fx), j0 = Math.floor(fy)
  const i1 = Math.min(grid.n - 1, i0 + 1), j1 = Math.min(grid.n - 1, j0 + 1)
  const tx = fx - i0, ty = fy - j0
  const h = (i: number, j: number) => grid.height[j * grid.n + i]
  return (h(i0, j0) * (1 - tx) + h(i1, j0) * tx) * (1 - ty) + (h(i0, j1) * (1 - tx) + h(i1, j1) * tx) * ty
}

// Box-blurs a grid (radius in points, edges clamped).
function blur(src: Float32Array, n: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const w = radius * 2 + 1
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let d = -radius; d <= radius; d++) s += src[j * n + Math.max(0, Math.min(n - 1, i + d))]
      tmp[j * n + i] = s / w
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let d = -radius; d <= radius; d++) s += tmp[Math.max(0, Math.min(n - 1, j + d)) * n + i]
      out[j * n + i] = s / w
    }
  }
  return out
}

// The patch of `surface` around `frame`: each point takes the terrain of the
// nearest world node (looked up through a little noise, so biome borders wander
// like real ones), and its height is the blurred base of the surrounding
// terrains plus fractal noise scaled by how rugged they are.
export function buildRelief(surface: BodySurface, frame: TerrainFrame): TerrainGrid {
  const n = gridSize()
  const perCell = TERRAIN_GRID_PER_CELL
  const half = TERRAIN_HALF_CELLS
  const grid: TerrainGrid = { n, perCell, half, terrain: new Uint8Array(n * n), height: new Float32Array(n * n) }
  const base = new Float32Array(n * n)
  const amp = new Float32Array(n * n)
  const shape = new Float32Array(n * n)
  const cell = surfaceMesh().fineSpacingRad
  let hint: number | undefined
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const { x, y } = gridPoint(grid, i, j)
      const p0 = toGlobal(frame, x, y)
      // Wander the lookup by up to about a third of a cell.
      const wx = valueNoise(p0.x * 9, p0.y * 9, p0.z * 9) - 0.5
      const wy = valueNoise(p0.x * 9 + 100, p0.y * 9 + 100, p0.z * 9 + 100) - 0.5
      const p = normalize({
        x: p0.x + (frame.east.x * wx + frame.north.x * wy) * cell * 0.7,
        y: p0.y + (frame.east.y * wx + frame.north.y * wy) * cell * 0.7,
        z: p0.z + (frame.east.z * wx + frame.north.z * wy) * cell * 0.7,
      })
      const node = nearestNode(p, 'fine', hint)
      hint = node
      const t = surface.terrain[node]
      const id = TERRAIN_IDS[t]
      grid.terrain[j * n + i] = t
      base[j * n + i] = TERRAIN_RELIEF[id].base
      amp[j * n + i] = TERRAIN_RELIEF[id].amp
      const rough = fbm(p0, 7, 4)
      const ridged = 1 - Math.abs(2 * rough - 1)
      const ridge = Math.max(0, Math.min(1, TERRAIN_RELIEF[id].base / 2000))
      shape[j * n + i] = rough * (1 - ridge) + ridged * ridge
    }
  }
  const smoothBase = blur(base, n, 3)
  const smoothAmp = blur(amp, n, 3)
  for (let k = 0; k < n * n; k++) {
    const id = TERRAIN_IDS[grid.terrain[k]]
    // Water stays level.
    grid.height[k] = id === 'ocean' ? 0 : Math.max(0, smoothBase[k] + smoothAmp[k] * (shape[k] * 2 - 1))
  }
  return grid
}

// Is this terrain a place ground units can be at all (used for the relief's
// own sanity checks and for drawing).
export function isLandTerrain(id: TerrainId): boolean {
  return TERRAIN[id].passable !== 'none' && id !== 'ocean'
}
