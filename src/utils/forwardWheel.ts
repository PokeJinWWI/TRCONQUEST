import type { WheelEvent as ReactWheelEvent } from 'react'

/**
 * The HTML marker overlays (drei `Html`) sit on top of the canvas and, with
 * pointer-events enabled for click/hover, also swallow wheel events before
 * they reach the canvas underneath — since they're a DOM sibling, not a
 * descendant, of the canvas, the event never bubbles there. This matters a
 * lot once a body is camera-locked (its marker sits right where the user's
 * cursor naturally is while scrolling to zoom), so re-dispatch the wheel
 * event onto the canvas manually.
 */
export function forwardWheelToCanvas(e: ReactWheelEvent) {
  const canvas = document.querySelector('canvas')
  if (!canvas) return
  canvas.dispatchEvent(
    new WheelEvent('wheel', {
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaZ: e.deltaZ,
      deltaMode: e.deltaMode,
      clientX: e.clientX,
      clientY: e.clientY,
      bubbles: true,
      cancelable: true,
    }),
  )
}
