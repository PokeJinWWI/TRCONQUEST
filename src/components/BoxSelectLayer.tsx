import { useEffect, useRef, useState } from 'react'
import { isBoxDrag, pickInBox, rectFromDrag, type BoxCandidate, type ScreenRect } from '../scene/boxSelect'
import { useGroundViewStore } from '../state/groundViewStore'
import { useShipStore } from '../state/shipStore'

// Shift+drag on any map draws a box and selects every one of the player's own
// ships (or ground units) whose marker is inside it — at any distance, as long
// as the marker is drawn (scene/boxSelect.ts). Markers opt in with
// `data-select-ship` / `data-select-unit`, set only on the player's own.
//
// Mounted once (main.tsx), listening on the window in the capture phase so it
// sees the drag before the scene's camera controls do: while Shift is held on
// a map, pointer moves are kept from the camera (a Shift+drag never turns or
// pans it), and the click that ends a real box is swallowed so the scene
// doesn't read it as a click on empty space (which would clear the selection).
// A Shift+click without a drag is left alone — it still adds/removes one.
export function BoxSelectLayer() {
  const [box, setBox] = useState<ScreenRect | null>(null)
  const drag = useRef<{ x: number; y: number; active: boolean; pointerId: number } | null>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.shiftKey) return
      // Only a drag that starts on a map (the scene canvas, or one of its
      // markers) — never on a panel.
      const t = e.target
      if (!(t instanceof HTMLCanvasElement) && !(t instanceof Element && t.closest('.ship-marker, .ground-unit-marker'))) return
      drag.current = { x: e.clientX, y: e.clientY, active: false, pointerId: e.pointerId }
    }
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      e.stopPropagation()
      if (!d.active && isBoxDrag(d.x, d.y, e.clientX, e.clientY)) d.active = true
      if (d.active) setBox(rectFromDrag(d.x, d.y, e.clientX, e.clientY))
    }
    const onUp = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      drag.current = null
      setBox(null)
      if (!d.active) return
      finish(rectFromDrag(d.x, d.y, e.clientX, e.clientY))
      // The click this release makes is the box's, not the scene's.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation()
        c.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    }
    const onCancel = () => {
      drag.current = null
      setBox(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onCancel)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onCancel)
    }
  }, [])

  if (!box) return null
  return (
    <div
      className="box-select-rect"
      style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }}
    />
  )
}

// Selects what the box took. An empty box leaves the selection alone.
function finish(rect: ScreenRect) {
  const candidates: BoxCandidate[] = []
  const read = (selector: string, kind: BoxCandidate['kind'], attr: string) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const id = el.getAttribute(attr)
      if (!id) return
      // A ship marker's own box is empty (its triangle and label hang off it):
      // the triangle is what the player sees and aims at.
      const r = (el.querySelector('.ship-marker-icon') ?? el).getBoundingClientRect()
      candidates.push({ kind, id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
    })
  }
  read('[data-select-ship]', 'ship', 'data-select-ship')
  read('[data-select-unit]', 'unit', 'data-select-unit')
  const picked = pickInBox(rect, candidates)
  if (picked.ships.length > 0) useShipStore.getState().selectShips(picked.ships)
  if (picked.units.length > 0) useGroundViewStore.getState().selectUnits(picked.units)
}
