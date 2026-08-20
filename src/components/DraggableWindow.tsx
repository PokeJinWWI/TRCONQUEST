import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface DraggableWindowProps {
  title: string
  onClose: () => void
  children: ReactNode
}

// A movable HUD window (title bar drag, no resize) for the satellite-view
// inspection panel — re-centers on whichever body is selected but stays
// wherever the player last dragged it until they select something else.
export function DraggableWindow({ title, onClose, children }: DraggableWindowProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
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
    <div className="draggable-window" style={{ transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }}>
      <div
        className="draggable-window-titlebar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <span>{title}</span>
        <button type="button" className="draggable-window-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="draggable-window-body">{children}</div>
    </div>
  )
}
