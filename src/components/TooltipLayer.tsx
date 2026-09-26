import { useEffect, useRef, useState } from 'react'
import { glossaryLookup, type GlossaryEntry } from '../data/glossary'

// The game's hover tooltips, in both economy modes. Mounted once at the root.
// Hover anything for a moment and a styled tooltip explains it:
//   • any element with a `title` (every hint already written into the UI) —
//     the title is lifted into `data-tip` while hovered so the browser's own
//     plain tooltip never shows, and put back on leave so React stays in charge
//     of the attribute;
//   • any short label whose text is a glossary term ("Tax rate", "GDP",
//     "Stability", a nav button…) — the concept's plain-language explanation
//     (data/glossary.ts), shown under the title when both apply.
// Pure DOM event delegation: nothing else has to opt in.

const SHOW_DELAY_MS = 450
const MAX_GLOSSARY_TEXT = 40 // only short labels are matched against the glossary
const MAX_DEPTH = 6

interface Tip {
  title: string | null
  entry: GlossaryEntry | null
  x: number
  y: number
}

// The element (target or an ancestor) that explains what's under the cursor.
function findSource(start: Element | null): { el: Element; title: string | null; entry: GlossaryEntry | null } | null {
  let el: Element | null = start
  for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = el.parentElement) {
    if (el.closest('.game-tooltip')) return null
    const title = el.getAttribute('title') || el.getAttribute('data-tip')
    const text = el.childElementCount <= 2 ? (el.textContent ?? '') : ''
    const entry = text && text.length <= MAX_GLOSSARY_TEXT ? (glossaryLookup(text) ?? null) : null
    if (title || entry) return { el, title: title || null, entry }
    // Don't climb out of an interactive control into its container.
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return null
  }
  return null
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let anchor: Element | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let mouse = { x: 0, y: 0 }

    const restoreTitle = (el: Element | null) => {
      if (!el) return
      const stashed = el.getAttribute('data-tip')
      if (stashed !== null) {
        if (!el.hasAttribute('title')) el.setAttribute('title', stashed)
        el.removeAttribute('data-tip')
      }
    }
    const hide = () => {
      if (timer) clearTimeout(timer)
      timer = null
      restoreTitle(anchor)
      anchor = null
      setTip(null)
    }

    const onOver = (e: PointerEvent) => {
      const src = findSource(e.target as Element | null)
      if (!src) {
        if (anchor) hide()
        return
      }
      if (src.el === anchor) return
      hide()
      anchor = src.el
      // Keep the browser's own tooltip from appearing over ours.
      const title = src.el.getAttribute('title')
      if (title) {
        src.el.setAttribute('data-tip', title)
        src.el.removeAttribute('title')
      }
      const text = src.title
      const entry = src.entry
      timer = setTimeout(() => {
        timer = null
        setTip({ title: text, entry: entry && entry.text !== text ? entry : null, x: mouse.x, y: mouse.y })
      }, SHOW_DELAY_MS)
    }
    const onMove = (e: PointerEvent) => {
      mouse = { x: e.clientX, y: e.clientY }
    }
    const onOut = (e: PointerEvent) => {
      if (!anchor) return
      const to = e.relatedTarget as Node | null
      if (to && anchor.contains(to)) return
      hide()
    }

    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('wheel', hide, true)
    document.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('wheel', hide, true)
      document.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Place it beside the cursor, kept on screen.
  useEffect(() => {
    if (!tip || !boxRef.current) {
      setPos(null)
      return
    }
    const box = boxRef.current.getBoundingClientRect()
    const margin = 8
    let left = tip.x + 14
    let top = tip.y + 18
    if (left + box.width > window.innerWidth - margin) left = Math.max(margin, tip.x - box.width - 10)
    if (top + box.height > window.innerHeight - margin) top = Math.max(margin, tip.y - box.height - 10)
    setPos({ left, top })
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={boxRef}
      className="game-tooltip"
      role="tooltip"
      style={{ left: pos?.left ?? tip.x + 14, top: pos?.top ?? tip.y + 18, visibility: pos ? 'visible' : 'hidden' }}
    >
      {tip.title && <div className="game-tooltip-text">{tip.title}</div>}
      {tip.entry && (
        <div className={tip.title ? 'game-tooltip-gloss with-title' : 'game-tooltip-gloss'}>
          <b>{tip.entry.term}</b> — {tip.entry.text}
        </div>
      )}
    </div>
  )
}
