// Tells a click from the end of a drag. Turning or panning the camera and
// letting go over empty space still produces a click there, and a click on
// empty space deselects — so every "click on nothing" handler asks whether the
// pointer actually travelled since it went down.
export const DRAG_TOLERANCE_PX = 4

let down: { x: number; y: number } | null = null
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      down = { x: e.clientX, y: e.clientY }
    },
    true,
  )
}

// Whether this click ended a drag rather than being a still click.
export function wasDrag(event: { clientX?: number; clientY?: number }, from: { x: number; y: number } | null = down): boolean {
  if (!from || event.clientX === undefined || event.clientY === undefined) return false
  return Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG_TOLERANCE_PX
}
