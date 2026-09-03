import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  /** Set false to omit the maximize button — for a small popup hanging off
   * the top HUD bar itself (a resource's info window, Treasury/Balance —
   * see ResourceBar.tsx/FiscalIndicators.tsx), where "fill the screen"
   * doesn't fit the window's own small, glance-and-close purpose. Defaults
   * true; already unavailable for an anchored window regardless (see
   * `anchor`). */
  maximizable?: boolean
  children: ReactNode
}

// Smallest a window can be dragged down to — small enough to still show a
// title and a line or two of content, not so small it collapses to nothing
// useful (which .collapse already covers, deliberately, via a real toggle).
const MIN_WIDTH = 200
const MIN_HEIGHT = 120

type ResizeAxis = 'x' | 'y' | 'xy'

// A shared stacking counter every window instance draws from — plain module
// state (not a store) since this is purely "who's on top," nothing any
// other component needs to read or react to. Starts above the CSS default
// (see .draggable-window's z-index: 20) so the very first window opened
// already sits above that base layer.
let topZIndex = 20
function bringToFrontZIndex(): number {
  topZIndex += 1
  return topZIndex
}

// A movable, resizable HUD window (title bar drag, edge/corner resize) for
// the satellite-view inspection panel and the nav sidebar's category
// windows — re-centers on whichever body is selected but stays wherever the
// player last dragged/resized it until they select something else.
export function DraggableWindow({ title, onClose, initialOffset, wide, anchor, maximizable = true, children }: DraggableWindowProps) {
  const [pos, setPos] = useState(initialOffset ?? { x: 0, y: 0 })
  // Collapsed to just its title bar — independent of `onClose`: a window
  // with no close button (the combat order panel, which *is* the view it
  // lives in) can still be tucked out of the way without losing it, which a
  // close button couldn't do for it anyway.
  const [collapsed, setCollapsed] = useState(false)
  // Explicit size once the player has dragged an edge/corner — null means
  // "still whatever the CSS default (or `wide`) is," so a window that's
  // never been resized keeps behaving exactly as before.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  // Starts already on top of anything opened before it — a freshly opened
  // window shouldn't appear to open BEHIND an existing one until clicked.
  const [zIndex, setZIndex] = useState(bringToFrontZIndex)
  // Windows-style maximize/restore — computed as an ordinary `pos`/`size`
  // change (see handleToggleMaximize), not a separate CSS positioning
  // scheme, specifically so it animates through the exact same
  // transform/width/height the drag/resize handlers already drive (see
  // `animating` below) rather than snapping between two different layout
  // mechanisms with nothing in common to interpolate.
  const [maximized, setMaximized] = useState(false)
  // Briefly true right after toggling maximize/restore — the only time a
  // CSS transition is actually wanted (see .animating). Ordinary dragging
  // and resizing must stay instantaneous, or every pointermove would lag
  // behind a queued transition instead of tracking the cursor.
  const [animating, setAnimating] = useState(false)
  const animationTimeoutRef = useRef<number | undefined>(undefined)
  const applyMaximizeTimeoutRef = useRef<number | undefined>(undefined)
  // What to restore `pos`/`size` to on the way back out — captured the
  // instant maximize is turned on, from whatever they actually were then
  // (a manually-resized window restores to that size, not the CSS default).
  const preMaximizeRef = useRef<{ pos: { x: number; y: number }; size: { width: number; height: number } | null } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{
    startX: number
    startY: number
    startW: number
    startH: number
    // The window's own pos at the moment resizing began — resizing needs to
    // shift pos as size grows (see handleResizePointerMove), and that shift
    // has to accumulate from a fixed starting point for the whole gesture,
    // not frame-to-frame, same reasoning dragRef already follows for moves.
    origPosX: number
    origPosY: number
    axis: ResizeAxis
  } | null>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  // The body's own rendered height at the moment it was last collapsed —
  // needed to reverse the compensation below on the way back out, since the
  // body isn't in the DOM to re-measure while collapsed.
  const collapsedBodyHeightRef = useRef(0)

  const handleResizePointerDown = (axis: ResizeAxis) => (e: React.PointerEvent) => {
    const rect = windowRef.current?.getBoundingClientRect()
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: rect?.width ?? MIN_WIDTH,
      startH: rect?.height ?? MIN_HEIGHT,
      origPosX: pos.x,
      origPosY: pos.y,
      axis,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!resizeRef.current) return
    const { startX, startY, startW, startH, origPosX, origPosY, axis } = resizeRef.current
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    const width = axis === 'y' ? startW : Math.max(MIN_WIDTH, Math.min(window.innerWidth - 32, startW + dx))
    const height = axis === 'x' ? startH : Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 32, startH + dy))
    setSize({ width, height })
    // The window's box is centre-hung (see the transform below — `calc(-50%
    // + Xpx)` on both axes), so growing width/height without correcting
    // `pos` expands the box symmetrically from its own middle: the left/top
    // edge would drift outward exactly as far as the right/bottom edge
    // does. Shifting the centre by half of whatever each axis just grew by
    // cancels that drift on the edge that's supposed to stay put, so only
    // the dragged edge actually moves — a real top-left-anchored resize.
    // Y always re-centres this way; X only does when the window isn't
    // edge-anchored (an anchored window's X position is pinned to the
    // screen edge via CSS instead, see the `anchor` prop and its className).
    setPos({
      x: anchor ? origPosX : origPosX + (width - startW) / 2,
      y: origPosY + (height - startH) / 2,
    })
  }

  const handleResizePointerUp = () => {
    resizeRef.current = null
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    // A maximized window doesn't drag — same as any OS's maximized windows,
    // and it sidesteps the question of what dragging even means once `pos`
    // has been repurposed to describe "fill the screen" (see
    // handleToggleMaximize) rather than a normal offset.
    if (maximized) return
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

  // Every window opens centre-hung at the same default spot (see `pos`'s
  // initializer) regardless of how tall its content turns out to be — fine
  // for the usual short inspector panel, but a genuinely tall one (a long
  // description, several rows) can end up with its title bar computed ABOVE
  // y=0 in a short viewport, taking the close button with it off-screen and
  // leaving no way to dismiss it. The drag handler above already clamps the
  // box to the viewport on every move; this runs the same clamp once, right
  // after the real (content-dependent) size is known, so a window can never
  // open already off-screen in the first place. A no-op whenever the window
  // already fits, so every existing window's default position is unchanged.
  useLayoutEffect(() => {
    const rect = windowRef.current?.getBoundingClientRect()
    if (!rect) return
    const overflowLeft = Math.max(0, -rect.left)
    const overflowRight = Math.max(0, rect.left + rect.width - window.innerWidth)
    const overflowTop = Math.max(0, -rect.top)
    const overflowBottom = Math.max(0, rect.top + rect.height - window.innerHeight)
    if (overflowLeft || overflowRight || overflowTop || overflowBottom) {
      setPos((p) => ({ x: p.x + overflowLeft - overflowRight, y: p.y + overflowTop - overflowBottom }))
    }
    // Intentionally mount-only: this corrects the INITIAL open position, not
    // an ongoing constraint — the drag handler already keeps it on-screen
    // for every move after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clears the maximize/restore transition timeouts if the window closes
  // mid-animation, so neither can fire a state update after unmount.
  useEffect(
    () => () => {
      window.clearTimeout(animationTimeoutRef.current)
      window.clearTimeout(applyMaximizeTimeoutRef.current)
    },
    [],
  )

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

  // Reads a HUD-bar height CSS var (set live by useHudBarLayout) as a number
  // of pixels, falling back the same way the CSS itself does when the var
  // isn't set yet (e.g. the very first render).
  const cssVarPx = (name: string, fallback: number): number => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : fallback
  }

  // Maximize/restore is just a `pos`/`size` change to a computed target,
  // same mechanism the drag/resize handlers already use — see this window's
  // own header comment on `maximized` for why that's deliberate (it's what
  // lets .animating interpolate the transition instead of snapping between
  // two unrelated positioning schemes). Not offered for an anchored window
  // (see the button's own guard below) — anchor's X offset means something
  // different (a straight pin-to-edge distance, not a centred translate), so
  // the fill-the-screen math below doesn't apply to it, and pinned combat
  // panels have no real reason to want fullscreen anyway — nor for one with
  // `maximizable={false}` (see that prop's own comment).
  const handleToggleMaximize = () => {
    if (anchor || !maximizable) return
    window.clearTimeout(animationTimeoutRef.current)
    window.clearTimeout(applyMaximizeTimeoutRef.current)
    // Arms the transition (see .animating) WITHOUT touching pos/size/
    // maximized yet — changing those in this same tick would let React
    // batch the class and the value change into one render, which the
    // browser can't animate (it never gets to paint the "before" state with
    // a transition actually active to transition FROM). A deferred
    // macrotask (not requestAnimationFrame — rAF callbacks can be
    // indefinitely suspended for a backgrounded/inactive tab, which is
    // exactly the state this needs to keep working correctly through)
    // guarantees a real paint happens in between, which is what makes the
    // following change land as an actual transition instead of an instant
    // jump.
    setAnimating(true)
    animationTimeoutRef.current = window.setTimeout(() => setAnimating(false), 260)

    applyMaximizeTimeoutRef.current = window.setTimeout(() => {
      if (!maximized) {
        preMaximizeRef.current = { pos, size }
        const hudTop = cssVarPx('--hud-top-height', 52)
        const hudBottom = cssVarPx('--hud-bottom-height', 58)
        const availableHeight = window.innerHeight - hudTop - hudBottom
        // The box centres itself at `left: 32%, top: 55%` (see the base
        // CSS rule) plus this translate offset — solving for the offset
        // that lands the centre at the fill-the-screen box's own centre
        // instead (full width, `hudTop` to `hudTop + availableHeight`).
        setPos({
          x: window.innerWidth * (0.5 - 0.32),
          y: hudTop + availableHeight / 2 - window.innerHeight * 0.55,
        })
        setSize({ width: window.innerWidth, height: availableHeight })
        setMaximized(true)
      } else {
        setMaximized(false)
        const prev = preMaximizeRef.current
        if (prev) {
          setPos(prev.pos)
          setSize(prev.size)
        }
      }
    }, 0)
  }

  return (
    <div
      ref={windowRef}
      className={`draggable-window${wide ? ' wide' : ''}${collapsed ? ' collapsed' : ''}${
        anchor ? ` anchor-${anchor}` : ''
      }${maximized ? ' maximized' : ''}${animating ? ' animating' : ''}`}
      // Capture phase so a click anywhere in the window — including on a
      // button that itself stops propagation — still brings it to front,
      // same reasoning capture-phase handlers are already used for elsewhere
      // in this project's event-race guards.
      onPointerDownCapture={() => setZIndex(bringToFrontZIndex())}
      // An anchored window is positioned from its own edge (see the
      // .anchor-left/.anchor-right rules), so it must NOT also be pulled back
      // by half its own width — only the default, centre-hung placement
      // wants that. Vertical centring is unchanged either way, which is what
      // keeps the collapse compensation above correct for both.
      style={{
        transform: anchor
          ? `translate(${pos.x}px, calc(-50% + ${pos.y}px))`
          : `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
        zIndex,
        // Only overrides the CSS default (240px, or 560px for `wide`) once
        // the player has actually dragged an edge/corner, or maximized —
        // see `size`.
        ...(size && !collapsed ? { width: size.width, height: size.height } : {}),
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
          {/* Not offered for an anchored window, or one with
              maximizable={false} — see handleToggleMaximize's own comment. */}
          {!anchor && maximizable && (
            <button
              type="button"
              className="draggable-window-maximize"
              onClick={handleToggleMaximize}
              aria-label={maximized ? 'Restore' : 'Maximize'}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? '❐' : '□'}
            </button>
          )}
          {onClose && (
            <button type="button" className="draggable-window-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </span>
      </div>
      {!collapsed && <div className="draggable-window-body">{children}</div>}
      {/* Resize handles — hidden while collapsed, since there's no body to
          resize into (only the title bar is showing), and while maximized,
          since a maximized window doesn't resize (see handleToggleMaximize).
          Corner comes last so it layers above the edge strips near the
          corner, where they'd otherwise both be hit-testable at once. */}
      {!collapsed && !maximized && (
        <>
          <div
            className="draggable-window-resize-right"
            onPointerDown={handleResizePointerDown('x')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
          />
          <div
            className="draggable-window-resize-bottom"
            onPointerDown={handleResizePointerDown('y')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
          />
          <div
            className="draggable-window-resize-corner"
            onPointerDown={handleResizePointerDown('xy')}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
          />
        </>
      )}
    </div>
  )
}
