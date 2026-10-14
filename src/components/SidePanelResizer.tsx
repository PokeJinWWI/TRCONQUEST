import { useRef } from 'react'
import { SIDE_PANEL_DEFAULT, useSidePanelStore, type SidePanel } from '../state/sidePanelStore'

// The drag handle on a side panel's inner edge: drag to make the panel wider or narrower
// (clamped by the store), double-click to put it back to the default width. While dragging,
// <html> carries `side-resizing` so the panels' width transition does not lag the pointer.
export function SidePanelResizer({ panel }: { panel: SidePanel }) {
  const start = useRef<{ x: number; width: number } | null>(null)
  // The nav grows to the right, the Outliner to the left.
  const sign = panel === 'nav' ? 1 : -1
  return (
    <div
      className={`side-panel-resizer ${panel}`}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, width: useSidePanelStore.getState().widths[panel] }
        document.documentElement.classList.add('side-resizing')
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        useSidePanelStore.getState().setWidth(panel, start.current.width + sign * (e.clientX - start.current.x))
      }}
      onPointerUp={(e) => {
        start.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.documentElement.classList.remove('side-resizing')
      }}
      onPointerCancel={() => {
        start.current = null
        document.documentElement.classList.remove('side-resizing')
      }}
      onDoubleClick={() => useSidePanelStore.getState().setWidth(panel, SIDE_PANEL_DEFAULT)}
    />
  )
}
