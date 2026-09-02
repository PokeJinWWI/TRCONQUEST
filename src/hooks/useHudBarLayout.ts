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
//
// Deliberately no dependency array (re-runs after every render) rather than
// `[topRef, bottomRef]` — a `useRef` object's IDENTITY never changes, so an
// effect keyed on it only ever runs once, tied to whenever THAT render
// happened to commit. App.tsx calls this hook unconditionally, before its
// own `if (!selectedCountryId) return <MainMenu />` — on the very first
// render (still showing MainMenu) `topRef.current`/`bottomRef.current` are
// null, this effect no-ops, and with a `[topRef, bottomRef]` dependency
// array it would NEVER run again once the header/footer actually mount
// after a nation is chosen, permanently leaving the CSS vars unset and every
// docked panel silently falling back to its hardcoded default instead of the
// bar's real height — this is what was actually happening. Re-running on
// every render fixes it (and correctly re-observes if the DOM node itself
// ever changes) at the cost of a cheap disconnect+reobserve on renders where
// nothing changed, which is rare for this top-level component.
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
  })
}
