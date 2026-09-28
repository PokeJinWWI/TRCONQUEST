// Shift+drag box selection (Stellaris-style), the pure part: the box a drag
// makes, and which markers it takes. A marker is taken when its on-screen
// centre is inside the box — however far away the thing it stands for is, as
// long as its marker is drawn. components/BoxSelectLayer.tsx is the DOM side
// (the drag, the drawn box, reading the markers' places, the stores).

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

// A drag shorter than this (px, either way) is a click, not a box.
export const BOX_SELECT_MIN_PX = 5

export function rectFromDrag(ax: number, ay: number, bx: number, by: number): ScreenRect {
  return { left: Math.min(ax, bx), top: Math.min(ay, by), right: Math.max(ax, bx), bottom: Math.max(ay, by) }
}

export function isBoxDrag(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(bx - ax) >= BOX_SELECT_MIN_PX || Math.abs(by - ay) >= BOX_SELECT_MIN_PX
}

export interface BoxCandidate {
  kind: 'ship' | 'unit'
  id: string
  // The marker's on-screen box; zero size = not drawn (hidden, behind the
  // camera, on the far side of a globe).
  rect: ScreenRect
}

// What a box takes: ids by kind, in the order found, each once.
export function pickInBox(box: ScreenRect, candidates: BoxCandidate[]): { ships: string[]; units: string[] } {
  const ships: string[] = []
  const units: string[] = []
  for (const c of candidates) {
    const w = c.rect.right - c.rect.left
    const h = c.rect.bottom - c.rect.top
    if (w <= 0 && h <= 0) continue
    const cx = (c.rect.left + c.rect.right) / 2
    const cy = (c.rect.top + c.rect.bottom) / 2
    if (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom) continue
    const list = c.kind === 'ship' ? ships : units
    if (!list.includes(c.id)) list.push(c.id)
  }
  return { ships, units }
}
