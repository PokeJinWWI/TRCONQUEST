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
  /** Pins the window against a screen edge instead of floating near the
   * middle. The combat view uses this to get its two always-open panels
   * (the engagement roster and the selected ship's inspector) out of the
   * arena itself rather than sitting on top of the fight — see
   * CombatViewScene. `initialOffset` is still applied on top, and the player
   * can still drag it anywhere from there. */
  anchor?: 'left' | 'right'
  children: ReactNode
}

// A movable HUD window (title bar drag, no resize) for the satellite-view
// inspection panel — re-centers on whichever body is selected but stays
// wherever the player last dragged it until they select something else.
export function DraggableWindow({ title, onClose, initialOffset, wide, anchor, children }: DraggableWindowProps) {
  const [pos, setPos] = useState(initialOffset ?? { x: 0, y: 0 })
  // Collapsed to just its title bar — independent of `onClose`: a window
  // with no close button (the combat order panel, which *is* the view it
  // lives in) can still be tucked out of the way without losing it, which a
  // close button couldn't do for it anyway.
  const [collapsed, setCollapsed] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  // The body's own rendered height at the moment it was last collapsed —
  // needed to reverse the compensation below on the way back out, since the
  // body isn't in the DOM to re-measure while collapsed.
  const collapsedBodyHeightRef = useRef(0)

  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const { startX, startY, origX, origY } = dragRef.current
    let x = origX + (e.clientX - startX)
    let y = origY + (e.clientY - startY)

    // Clamp so the window's rendered box never leaves the viewport. The
    // element's current rect already reflects `pos` from the last render,
    // and the transform's pixel term (`calc(-50% + Xpx)`) moves the window
    // exactly one screen pixel per one unit of `pos` — so diffing the
    // proposed pos against the current one converts directly into how far
    // the on-screen box is about to move, with no need to know the window's
    // static `left`/`top` percentages at all.
    const rect = windowRef.current?.getBoundingClientRect()
    if (rect) {
      const dx = x - pos.x
      const dy = y - pos.y
      const left = rect.left + dx
      const top = rect.top + dy
      x += Math.max(0, -left) - Math.max(0, left + rect.width - window.innerWidth)
      y += Math.max(0, -top) - Math.max(0, top + rect.height - window.innerHeight)
    }

    setPos({ x, y })
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  // The window is centred vertically on `pos.y` (see the transform below —
  // `calc(-50% + Ypx)` on BOTH axes), which is deliberate for how a fresh
  // window opens, but means collapsing (the body leaving the DOM shrinks the
  // box) would shrink it toward its own vertical MIDDLE, visibly dropping
  // the title bar down instead of leaving it in place. Compensating `pos.y`
  // by half the body's own height exactly cancels that: the box still
  // shrinks toward its centre, but the centre itself moves up by the same
  // amount the bottom edge is about to lose, so the TOP edge — and the title
  // bar sitting on it — doesn't move at all. Reversed symmetrically on the
  // way back out.
  const handleToggleCollapse = () => {
    if (!collapsed) {
      const bodyHeight = windowRef.current?.querySelector<HTMLElement>('.draggable-window-body')?.getBoundingClientRect().height ?? 0
      collapsedBodyHeightRef.current = bodyHeight
      setPos((p) => ({ ...p, y: p.y - bodyHeight / 2 }))
    } else {
      setPos((p) => ({ ...p, y: p.y + collapsedBodyHeightRef.current / 2 }))
    }
    setCollapsed((c) => !c)
  }

  return (
    <div
      ref={windowRef}
      className={`draggable-window${wide ? ' wide' : ''}${collapsed ? ' collapsed' : ''}${
        anchor ? ` anchor-${anchor}` : ''
      }`}
      // An anchored window is positioned from its own edge (see the
      // .anchor-left/.anchor-right rules), so it must NOT also be pulled back
      // by half its own width — only the default, centre-hung placement
      // wants that. Vertical centring is unchanged either way, which is what
      // keeps the collapse compensation above correct for both.
      style={{
        transform: anchor
          ? `translate(${pos.x}px, calc(-50% + ${pos.y}px))`
          : `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
      }}
    >
      <div
        className="draggable-window-titlebar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <span>{title}</span>
        <span className="draggable-window-titlebar-controls">
          <button
            type="button"
            className="draggable-window-collapse"
            onClick={handleToggleCollapse}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          {onClose && (
            <button type="button" className="draggable-window-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </span>
      </div>
      {!collapsed && <div className="draggable-window-body">{children}</div>}
    </div>
  )
}
