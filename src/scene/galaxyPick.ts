// Picking a galaxy-view marker by screen distance (pure). The galaxy view draws
// its 300+ neighbourhoods as one point cloud, not one DOM element each, so a
// click or hover is resolved here: the nearest marker within a few pixels.
export interface ScreenPoint {
  id: string
  x: number
  y: number
}

export const GALAXY_PICK_RADIUS_PX = 12

export function pickNearest(points: ScreenPoint[], x: number, y: number, radiusPx = GALAXY_PICK_RADIUS_PX): string | null {
  let best: string | null = null
  let bestD = radiusPx * radiusPx
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d <= bestD) {
      bestD = d
      best = p.id
    }
  }
  return best
}
