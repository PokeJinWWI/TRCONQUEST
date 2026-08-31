import { useEffect } from 'react'
import type { RefObject } from 'react'

// The top/bottom HUD bars aren't a fixed height — the top bar wraps to two
// lines on a narrow viewport, and both grow/shrink with their own content
// (the resource readout, breadcrumb, etc.) — so anything that needs to dock
// flush against them (Outliner, NavBar, DebugConsole) can't use a guessed
// pixel constant without drifting out of sync the moment either bar's
// content changes. This measures both bars' real height on mount and on
// every resize, and publishes them as CSS custom properties every docked
// panel reads from instead.
export function useHudBarLayout(topRef: RefObject<HTMLElement | null>, bottomRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const topEl = topRef.current
    const bottomEl = bottomRef.current
    if (!topEl || !bottomEl) return

    const root = document.documentElement.style
    const update = () => {
      root.setProperty('--hud-top-height', `${topEl.getBoundingClientRect().height}px`)
      root.setProperty('--hud-bottom-height', `${bottomEl.getBoundingClientRect().height}px`)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(topEl)
    observer.observe(bottomEl)
    return () => observer.disconnect()
  }, [topRef, bottomRef])
}
