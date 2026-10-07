// Camera framing, pure: how far out a camera has to be to fit a set of points, and how
// far to keep one so that two things a known distance apart read as apart on screen.
// The galactic view opens on the player's own cluster (not the whole galaxy off to one
// side), and a cluster's map opens fitted to its stars instead of far out, so the
// numbers come from here rather than from per-scene constants.

export type Vec3 = readonly [number, number, number]

export interface Sphere {
  centre: [number, number, number]
  radius: number
}

// The smallest sphere about the middle of the points' bounding box that holds all of
// them. (The mean of the points would lean towards a crowded side and leave the far
// star at the edge of the screen.)
export function boundingSphere(points: readonly Vec3[]): Sphere {
  if (points.length === 0) return { centre: [0, 0, 0], radius: 0 }
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < lo[i]) lo[i] = p[i]
      if (p[i] > hi[i]) hi[i] = p[i]
    }
  }
  const centre: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  let radius = 0
  for (const p of points) radius = Math.max(radius, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]))
  return { centre, radius }
}

const degToRad = (deg: number) => (deg * Math.PI) / 180

// How far from its centre a camera has to be for a sphere to fit the view, with
// `margin` (>= 1) to spare. `fovDeg` is the vertical field of view; a view narrower
// than it is tall (aspect < 1) is limited by its width instead.
export function fitDistance(radius: number, fovDeg: number, aspect = 1, margin = 1.3): number {
  const half = degToRad(fovDeg) / 2
  const halfLimit = Math.min(half, Math.atan(Math.tan(half) * Math.max(aspect, 0.01)))
  return (radius * margin) / Math.sin(halfLimit)
}

// A camera position `distance` from `target` along `direction` (any length).
export function cameraAlong(target: Vec3, direction: Vec3, distance: number): [number, number, number] {
  const len = Math.hypot(direction[0], direction[1], direction[2]) || 1
  const k = distance / len
  return [target[0] + direction[0] * k, target[1] + direction[1] * k, target[2] + direction[2] * k]
}

// How far out to put the camera so two points `unitsApart` apart (at right angles to
// the view) land `desiredPx` apart on a viewport `viewportPx` tall.
export function separationDistance(unitsApart: number, desiredPx: number, fovDeg: number, viewportPx: number): number {
  const tan = Math.tan(degToRad(fovDeg) / 2)
  return (unitsApart * viewportPx) / (2 * Math.max(desiredPx, 1) * tan)
}

// The nearest other point to `from`, in the same units (Infinity when there is none).
export function nearestDistance(from: Vec3, others: readonly Vec3[]): number {
  let best = Infinity
  for (const p of others) {
    const d = Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2])
    if (d > 0 && d < best) best = d
  }
  return best
}

// The aspect of the part of the window a map is actually seen in: the canvas runs under the
// side panels, so the stars are fitted to what is left of the width between them.
export function visibleAspect(width: number, height: number, gutterPx: number): number {
  return Math.max(width - gutterPx, height * 0.4) / Math.max(height, 1)
}

// The room a cluster map's stars are given when it opens fitted to them (1 = edge to edge).
export const CLUSTER_FIT_MARGIN = 1.05
