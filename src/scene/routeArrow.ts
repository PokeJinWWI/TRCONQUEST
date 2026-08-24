// Shared arrowhead geometry for every route line in the game (CombatPathLine,
// NavigationLine) — a chevron of two short "wing" points behind a segment's
// endpoint, drawn as two more disjoint Line2 segments alongside the shaft
// itself so a route reads as directional, not just as a line.
//
// Deliberately pure — takes plain positions and a camera position rather
// than touching a scene, matching the rest of this project's math (see
// combatArena.ts, shipPhysics.ts) so it stays testable without mounting one.

import { Vector3 } from 'three'

export interface ArrowWings {
  wing1: Vector3
  wing2: Vector3
}

// Billboarded off the camera rather than a fixed world axis: the wing offset
// comes from cross(direction, toCamera), which keeps the chevron reading as
// a clean 'V' from whatever angle it's actually viewed at. A fixed world-up
// cross product looks fine from most angles but flattens edge-on to the
// screen — and therefore invisible — from others, which a billboard doesn't.
export function arrowWings(start: Vector3, end: Vector3, cameraPosition: Vector3, length: number, halfAngleDeg = 22): ArrowWings | null {
  if (length <= 0) return null

  const dir = end.clone().sub(start)
  const segLength = dir.length()
  if (segLength < 1e-6) return null
  dir.divideScalar(segLength)

  const toCamera = cameraPosition.clone().sub(end)
  let perp = new Vector3().crossVectors(dir, toCamera)
  if (perp.lengthSq() < 1e-8) {
    // Degenerate only when the view direction is parallel to the segment
    // (looking straight down it, or straight along it from behind) — any
    // perpendicular reads identically from that angle, so pick an arbitrary
    // one rather than leaving the chevron undrawn.
    perp = (Math.abs(dir.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).cross(dir)
  }
  perp.normalize()

  const back = dir.clone().multiplyScalar(-1)
  const angle = (halfAngleDeg * Math.PI) / 180
  const along = Math.cos(angle) * length
  const across = Math.sin(angle) * length
  const backOffset = back.multiplyScalar(along)

  const wing1 = end.clone().add(backOffset).add(perp.clone().multiplyScalar(across))
  const wing2 = end.clone().add(backOffset).add(perp.clone().multiplyScalar(-across))
  return { wing1, wing2 }
}
