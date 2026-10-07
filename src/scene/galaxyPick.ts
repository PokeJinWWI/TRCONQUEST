// Picking a galaxy-view marker by screen distance (pure). The galaxy view draws
// its 300+ neighbourhoods as one point cloud, not one DOM element each, so a
// click or hover is resolved here: the nearest marker within a few pixels.
export interface ScreenPoint {
  id: string
  x: number
  y: number
}

export const GALAXY_PICK_RADIUS_PX = 12

// A marker's own label (the name beside a selected or hovered cluster) counts as the
// marker: a click or right-click on it is a click on the cluster. Rects are screen
// pixels; the first one holding the point wins.
export interface ScreenRectOf {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

export function pickInRects(rects: ScreenRectOf[], x: number, y: number): string | null {
  for (const r of rects) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return r.id
  return null
}

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
