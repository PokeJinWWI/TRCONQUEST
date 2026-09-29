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

// The end of a drag is never a click on the map: letting go after turning or
// panning the camera over a marker (or a planet) must not select it, and a
// right-button drag (panning) must not become a move order where it ends.
// Swallowed here, in the capture phase, before any marker or r3f handler sees
// it. Shift+drag is the box select (components/BoxSelectLayer), which handles
// its own ending click. Clicks in panels and windows (sliders, text) pass.
const UI_SELECTOR = '.draggable-window, .dip-toasts, .outliner, .nav-sidebar, .nav-panel, .hud-bar, .context-menu, .tech-tree-overlay, input, textarea, select, button'
if (typeof window !== 'undefined') {
  const swallow = (e: MouseEvent) => {
    // A click from the keyboard or a script (detail 0) never ended a drag.
    if (e.shiftKey || (e.type === 'click' && e.detail === 0) || !wasDrag(e)) return
    if (e.target instanceof Element && e.target.closest(UI_SELECTOR)) return
    e.stopPropagation()
    if (e.type === 'contextmenu') e.preventDefault()
  }
  window.addEventListener('click', swallow, true)
  window.addEventListener('contextmenu', swallow, true)
}

// Whether this click ended a drag rather than being a still click.
// Where the last press (any button, so a right-click too) went down — for a
// menu opened from a callback that gets no mouse event.
export function lastPointerDown(): { x: number; y: number } | null {
  return down
}

export function wasDrag(event: { clientX?: number; clientY?: number }, from: { x: number; y: number } | null = down): boolean {
  if (!from || event.clientX === undefined || event.clientY === undefined) return false
  return Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG_TOLERANCE_PX
}
