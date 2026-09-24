// The planetary map's grid: a geodesic sphere (a subdivided icosahedron),
// built once and shared by every world — only terrain differs per world (see
// planetTerrain.ts). Pure and stateless apart from the one cached build.
//
// Mirrors the space arena's lattice (combatArena.ts): the three densities
// are views of one nested grid, and none of them is where anything IS. A
// unit's position is a continuous point on the sphere; a density only
// decides which nodes are drawn and which node a click snaps to.
//
//   coarse    subdivision level 2 —   162 nodes
//   standard  subdivision level 3 —   642 nodes
//   fine      subdivision level 4 — 2,562 nodes
//
// Nesting is exact: each subdivision keeps every existing vertex index and
// appends the new midpoints, so the coarse nodes ARE fine nodes 0..161 and
// the standard nodes are fine nodes 0..641. Everything that is actual game
// state per node (terrain, who holds it) lives on the fine grid.
import type { GridDensity } from './combatArena'

export interface SurfacePoint {
  x: number
  y: number
  z: number
}

export interface SurfaceMesh {
  // Fine-grid node positions, unit vectors, xyz interleaved. Double
  // precision: the simulation measures arcs down to ~1e-5 rad, which float32
  // can't resolve (renderers copy this into a Float32Array themselves).
  positions: Float64Array
  // How many nodes each density uses (always a prefix of the fine nodes).
  count: Record<GridDensity, number>
  neighbors: Record<GridDensity, Int32Array[]>
  // Fine-grid triangles (for the rendered globe).
  faces: Uint16Array
  // Coarse/standard triangles (for drawing those grids' edges).
  facesByDensity: Record<GridDensity, Uint16Array>
  // Mean angular distance between neighbouring fine nodes, in radians — the
  // "cell" every surface radius in groundData is measured in.
  fineSpacingRad: number
}

const LEVEL_OF: Record<GridDensity, number> = { coarse: 2, standard: 3, fine: 4 }

let cached: SurfaceMesh | null = null

export function surfaceMesh(): SurfaceMesh {
  if (cached) return cached
  const t = (1 + Math.sqrt(5)) / 2
  const verts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalizeArr)
  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]
  const facesAtLevel: number[][][] = [faces]
  for (let level = 1; level <= LEVEL_OF.fine; level++) {
    const midpoint = new Map<string, number>()
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      const existing = midpoint.get(key)
      if (existing !== undefined) return existing
      const va = verts[a]
      const vb = verts[b]
      verts.push(normalizeArr([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]))
      midpoint.set(key, verts.length - 1)
      return verts.length - 1
    }
    const next: number[][] = []
    for (const [a, b, c] of faces) {
      const ab = mid(a, b)
      const bc = mid(b, c)
      const ca = mid(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
    facesAtLevel.push(faces)
  }

  const positions = new Float64Array(verts.length * 3)
  verts.forEach((v, i) => positions.set(v, i * 3))

  const neighborsFor = (levelFaces: number[][], n: number): Int32Array[] => {
    const sets: Set<number>[] = Array.from({ length: n }, () => new Set())
    for (const [a, b, c] of levelFaces) {
      sets[a].add(b).add(c)
      sets[b].add(a).add(c)
      sets[c].add(a).add(b)
    }
    return sets.map((s) => Int32Array.from([...s].sort((x, y) => x - y)))
  }
  const countOf = (level: number) => 10 * 4 ** level + 2
  const count: Record<GridDensity, number> = { coarse: countOf(2), standard: countOf(3), fine: countOf(4) }
  const neighbors = {
    coarse: neighborsFor(facesAtLevel[LEVEL_OF.coarse], count.coarse),
    standard: neighborsFor(facesAtLevel[LEVEL_OF.standard], count.standard),
    fine: neighborsFor(facesAtLevel[LEVEL_OF.fine], count.fine),
  }
  const flat = (f: number[][]) => Uint16Array.from(f.flat())

  // Mean fine edge length.
  let total = 0
  let edges = 0
  neighbors.fine.forEach((ns, i) => {
    for (const j of ns) {
      if (j <= i) continue
      total += arcIdx(positions, i, j)
      edges++
    }
  })

  cached = {
    positions,
    count,
    neighbors,
    faces: flat(facesAtLevel[LEVEL_OF.fine]),
    facesByDensity: {
      coarse: flat(facesAtLevel[LEVEL_OF.coarse]),
      standard: flat(facesAtLevel[LEVEL_OF.standard]),
      fine: flat(facesAtLevel[LEVEL_OF.fine]),
    },
    fineSpacingRad: total / edges,
  }
  return cached
}

function normalizeArr(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

function arcIdx(positions: Float64Array, i: number, j: number): number {
  const at = (k: number) => ({ x: positions[k * 3], y: positions[k * 3 + 1], z: positions[k * 3 + 2] })
  return arc(at(i), at(j))
}

export function nodePoint(node: number): SurfacePoint {
  const p = surfaceMesh().positions
  return { x: p[node * 3], y: p[node * 3 + 1], z: p[node * 3 + 2] }
}

export function normalize(p: SurfacePoint): SurfacePoint {
  const l = Math.hypot(p.x, p.y, p.z) || 1
  return { x: p.x / l, y: p.y / l, z: p.z / l }
}

// Great-circle angle between two surface points, in radians. atan2 of the
// cross and dot products rather than acos(dot), which loses precision for
// the tiny angles a single simulation step moves.
export function arc(a: SurfacePoint, b: SurfacePoint): number {
  const cx = a.y * b.z - a.z * b.y
  const cy = a.z * b.x - a.x * b.z
  const cz = a.x * b.y - a.y * b.x
  return Math.atan2(Math.hypot(cx, cy, cz), a.x * b.x + a.y * b.y + a.z * b.z)
}

function dotNode(p: SurfacePoint, positions: Float64Array, i: number): number {
  return p.x * positions[i * 3] + p.y * positions[i * 3 + 1] + p.z * positions[i * 3 + 2]
}

// The node of `density` nearest to `p`. Greedy walk over neighbours from
// `hint` (a cached last-known node) — or from the nearest of the 12 base
// vertices every density shares — then a final check of the 2-ring so a
// near-tie can't strand it on the wrong side.
export function nearestNode(p: SurfacePoint, density: GridDensity, hint?: number): number {
  const mesh = surfaceMesh()
  const { positions } = mesh
  const neighbors = mesh.neighbors[density]
  const n = mesh.count[density]
  let best = hint !== undefined && hint >= 0 && hint < n ? hint : -1
  if (best < 0) {
    let bestDot = -Infinity
    for (let i = 0; i < 12; i++) {
      const d = dotNode(p, positions, i)
      if (d > bestDot) {
        bestDot = d
        best = i
      }
    }
  }
  let bestDot = dotNode(p, positions, best)
  for (let guard = 0; guard < n; guard++) {
    let improved = false
    for (const j of neighbors[best]) {
      const d = dotNode(p, positions, j)
      if (d > bestDot) {
        bestDot = d
        best = j
        improved = true
      }
    }
    if (!improved) break
  }
  for (const j of neighbors[best]) {
    for (const k of neighbors[j]) {
      const d = dotNode(p, positions, k)
      if (d > bestDot) {
        bestDot = d
        best = k
      }
    }
  }
  return best
}

// Moves `angle` radians from `from` toward `to` along the great circle.
export function slerpToward(from: SurfacePoint, to: SurfacePoint, angle: number): SurfacePoint {
  const total = arc(from, to)
  if (total <= 1e-12 || angle >= total) return to
  const t = angle / total
  const s = Math.sin(total)
  const a = Math.sin((1 - t) * total) / s
  const b = Math.sin(t * total) / s
  return normalize({ x: from.x * a + to.x * b, y: from.y * a + to.y * b, z: from.z * a + to.z * b })
}

// Walks `budgetRad` along a path of waypoints. Returns the new position, the
// waypoints still ahead, and how much of the budget was left unused (when
// the path ran out).
export function moveAlong(
  position: SurfacePoint,
  path: SurfacePoint[],
  budgetRad: number,
): { position: SurfacePoint; path: SurfacePoint[]; leftover: number } {
  let pos = position
  let remaining = budgetRad
  let i = 0
  while (i < path.length && remaining > 0) {
    const leg = arc(pos, path[i])
    if (leg <= remaining) {
      remaining -= leg
      pos = path[i]
      i++
    } else {
      pos = slerpToward(pos, path[i], remaining)
      remaining = 0
    }
  }
  return { position: pos, path: path.slice(i), leftover: remaining }
}
