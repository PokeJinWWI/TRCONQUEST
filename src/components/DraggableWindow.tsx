import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface DraggableWindowProps {
  title: string
  /** Omit to render a window with no close button — for a panel that *is*
   * the view it lives in (the combat view's order panel), where dismissing it
   * would leave the player in an arena with no way to give orders. */
  onClose?: () => void
  /** Starting offset from the default spot, in pixels. Every window otherwise
   * opens at the same place, so two shown at once (the combat view's order
   * panel plus a selected ship's inspector) land exactly on top of each
   * other. The player can still drag from wherever this puts it. */
  initialOffset?: { x: number; y: number }
  /** Widens the window for content that genuinely needs the room (Fleet
   * Management's tables). Default 240px fits the inspector panels; anything
   * wider than that has to say so, rather than overflowing its own frame. */
  wide?: boolean
  children: ReactNode
}

// A movable HUD window (title bar drag, no resize) for the satellite-view
// inspection panel — re-centers on whichever body is selected but stays
// wherever the player last dragged it until they select something else.
export function DraggableWindow({ title, onClose, initialOffset, wide, children }: DraggableWindowProps) {
  const [pos, setPos] = useState(initialOffset ?? { x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const { startX, startY, origX, origY } = dragRef.current
    setPos({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) })
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  return (
    <div className={`draggable-window${wide ? ' wide' : ''}`} style={{ transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }}>
      <div
        className="draggable-window-titlebar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <span>{title}</span>
        {onClose && (
          <button type="button" className="draggable-window-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
      <div className="draggable-window-body">{children}</div>
    </div>
  )
}
