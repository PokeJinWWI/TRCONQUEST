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
// Pure DOM event delegation: nothing else has to opt in. This is the ONE
// tooltip system: whatever is under the cursor gets exactly one box. The
// nearest `title` anywhere up the tree is always taken over (else the browser
// would show it natively beside ours) and merged with the glossary entry of the
// label hovered. For SVG, use `data-tooltip` (styled only) rather than a
// <title> child, which the browser would show natively.

const SHOW_DELAY_MS = 450
const MAX_GLOSSARY_TEXT = 40 // only short labels are matched against the glossary
const MAX_DEPTH = 6

interface Tip {
  title: string | null
  entry: GlossaryEntry | null
  x: number
  y: number
}

// The bits of a DOM element resolveTooltip reads (a real Element fits; tests pass fakes).
export interface TipNode {
  tagName: string
  parentElement: TipNode | null
  childElementCount: number
  textContent: string | null
  getAttribute(name: string): string | null
}

export interface TooltipSource {
  anchor: TipNode // the tooltip lasts while the pointer stays inside this
  titleEl: TipNode | null // the element whose title/data-tip/data-tooltip is shown
  title: string | null
  entry: GlossaryEntry | null
}

const CONTROLS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'])
const titleOf = (el: TipNode) => el.getAttribute('title') || el.getAttribute('data-tip') || el.getAttribute('data-tooltip') || null

// What explains the element under the cursor: the NEAREST titled element up the
// whole tree (exactly what the browser would show natively — so ours replaces
// it), plus the glossary entry of the nearest short label within a few levels
// (not climbing out of a control into its container). One box shows both.
export function resolveTooltip(start: TipNode | null): TooltipSource | null {
  let titleEl: TipNode | null = null
  let glossEl: TipNode | null = null
  let entry: GlossaryEntry | null = null
  let glossDone = false
  let el = start
  for (let depth = 0; el; depth++, el = el.parentElement) {
    if ((el.getAttribute('class') ?? '').split(/\s+/).includes('game-tooltip')) return null
    if (!titleEl && titleOf(el)) titleEl = el
    if (!glossDone && depth < MAX_DEPTH) {
      const text = el.childElementCount <= 2 ? (el.textContent ?? '') : ''
      const found = text && text.length <= MAX_GLOSSARY_TEXT ? glossaryLookup(text) : undefined
      if (found) {
        entry = found
        glossEl = el
        glossDone = true
      } else if (CONTROLS.has(el.tagName.toUpperCase())) glossDone = true
    } else glossDone = true
    if (titleEl && glossDone) break
  }
  if (!titleEl && !entry) return null
  // Anchor on the outer of the two, so moving between them keeps one tooltip.
  let anchor = titleEl ?? glossEl!
  if (titleEl && glossEl) for (let a: TipNode | null = titleEl; a; a = a.parentElement) if (a === glossEl) anchor = glossEl
  const title = titleEl ? titleOf(titleEl) : null
  return { anchor, titleEl, title, entry: entry && entry.text !== title ? entry : null }
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let anchor: Element | null = null
    let stashed: Element | null = null // the element whose title we took over
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
      restoreTitle(stashed)
      stashed = null
      anchor = null
      setTip(null)
    }

    const onOver = (e: PointerEvent) => {
      const src = resolveTooltip(e.target as Element | null)
      if (!src) {
        if (anchor) hide()
        return
      }
      if (src.anchor === anchor && src.titleEl === stashed) return
      hide()
      anchor = src.anchor as Element
      // Keep the browser's own tooltip from appearing beside ours.
      const titled = src.titleEl as Element | null
      const own = titled?.getAttribute('title')
      if (titled && own) {
        titled.setAttribute('data-tip', own)
        titled.removeAttribute('title')
        stashed = titled
      }
      const text = src.title
      const entry = src.entry
      timer = setTimeout(() => {
        timer = null
        setTip({ title: text, entry, x: mouse.x, y: mouse.y })
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
