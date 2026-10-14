import { useEffect, useState } from 'react'
import { nativeOf, setPlayerLabels } from '../i18n/native'
import { labelKey } from '../i18n/labelText'
import { descriptionOf, loadDescriptions, normalizeDescription } from '../i18n/descriptionLookup'
import { SCRIPT_LABELS, useThemeStore, type ScriptId } from '../state/themeStore'
import { usePlaceNameStore, type NativeNames } from '../state/placeNameStore'

// The NERV theme puts a native-script label beside EVERY label on screen, including the many the
// game builds from data (building names, tabs from lists, planet classes). Components that know a
// label wrap it in <Bi>; everything else is found here: every element whose only content is a
// short label gets `data-native`, and themes/nerv.css draws it after the text (::after). Nothing is
// inserted into React's DOM, so no component changes. Off (and cleaned up) in the Default theme.
// Alt-click any label to type its native text yourself (per script; saved with the game as
// placeNameStore `label:<English>`): what you type wins over the dictionary, which is how names the
// dictionaries cannot know (foreign names, organizations; Chinese has no kana to spell them) get one.
// In a dev build, labels with no translation yet collect in window.__nativeMisses.
const SKIP = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'CANVAS', 'svg', 'SVG'])
const ATTR = 'data-native'
// A translated paragraph, drawn as a block under the English (themes/nerv.css).
const DESC_ATTR = 'data-native-desc'
export const LABEL_KEY_PREFIX = 'label:'

// The player's typed labels, from the store into the lookup.
function syncPlayerLabels(natives: Record<string, NativeNames>): void {
  const labels: Record<string, NativeNames> = {}
  for (const [k, v] of Object.entries(natives)) if (k.startsWith(LABEL_KEY_PREFIX)) labels[k.slice(LABEL_KEY_PREFIX.length)] = v
  setPlayerLabels(labels)
}
syncPlayerLabels(usePlaceNameStore.getState().natives)
usePlaceNameStore.subscribe((s, before) => {
  if (s.natives !== before.natives) syncPlayerLabels(s.natives)
})

function isLeafLabel(el: Element): boolean {
  if (SKIP.has(el.tagName) || el.closest('.native, [contenteditable], .native-label-editor')) return false
  if (el.querySelector('.native')) return false
  return ![...el.children].some((c) => (c.textContent ?? '').trim().length > 0)
}

// A description paragraph: its whole text is a translated description, and no child holds all of it
// (so the translation goes on the innermost element only).
// An element's text without the native-script labels <Bi> adds inside it, so a paragraph holding a
// <Bi> still matches its description.
function englishText(el: Element): string {
  if (!el.querySelector('.native')) return el.textContent ?? ''
  let out = ''
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? ''
    else if (n.nodeType === Node.ELEMENT_NODE && !(n as Element).classList.contains('native')) n.childNodes.forEach(walk)
  }
  el.childNodes.forEach(walk)
  return out
}

function annotateDescription(el: Element, script: ScriptId): void {
  const text = englishText(el)
  const native = text.length > 40 && !SKIP.has(el.tagName) && !el.closest('.native-label-editor') ? descriptionOf(text, script) : undefined
  const inner = native && [...el.children].some((c) => normalizeDescription(englishText(c)) === normalizeDescription(text))
  if (native && !inner) {
    if (el.getAttribute(DESC_ATTR) !== native) el.setAttribute(DESC_ATTR, native)
  } else if (el.hasAttribute(DESC_ATTR)) el.removeAttribute(DESC_ATTR)
}

function annotate(el: Element, script: ScriptId, misses?: Set<string>): void {
  annotateDescription(el, script)
  // Inside a translated paragraph the whole sentence is translated below it: no label mid-sentence.
  if (!isLeafLabel(el) || el.parentElement?.hasAttribute(DESC_ATTR)) {
    if (el.hasAttribute(ATTR)) el.removeAttribute(ATTR)
    return
  }
  const key = labelKey(el.textContent ?? '')
  const native = key ? nativeOf(key, script) : undefined
  if (native) {
    if (el.getAttribute(ATTR) !== native) el.setAttribute(ATTR, native)
  } else {
    if (el.hasAttribute(ATTR)) el.removeAttribute(ATTR)
    if (misses && key && /^[A-Z]/.test(key) && key.split(' ').length <= 5) misses.add(key)
  }
}

function annotateTree(root: Element, script: ScriptId, misses?: Set<string>): void {
  annotate(root, script, misses)
  for (const el of root.querySelectorAll('*')) annotate(el, script, misses)
}

// The label an Alt-click landed on: a <Bi> label's English, or a plain leaf label's text.
function labelAt(target: Element): string | null {
  const bi = target.closest('[data-bi]')
  if (bi) return bi.getAttribute('data-bi')
  let el: Element | null = target
  for (let i = 0; el && i < 3; i++, el = el.parentElement) {
    if (isLeafLabel(el)) return labelKey(el.textContent ?? '')
  }
  return null
}

export function NativeAnnotator() {
  const nerv = useThemeStore((s) => s.theme === 'nerv')
  const script = useThemeStore((s) => s.script)
  const natives = usePlaceNameStore((s) => s.natives)
  const [editing, setEditing] = useState<{ label: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!nerv) {
      for (const el of document.querySelectorAll(`[${ATTR}], [${DESC_ATTR}]`)) {
        el.removeAttribute(ATTR)
        el.removeAttribute(DESC_ATTR)
      }
      return
    }
    // The description table loads on first use of NERV; annotate again once it is here.
    let cancelled = false
    void loadDescriptions().then(() => {
      if (!cancelled) annotateTree(document.body, script)
    })
    const misses = import.meta.env.DEV ? ((window as unknown as { __nativeMisses?: Set<string> }).__nativeMisses ??= new Set()) : undefined
    annotateTree(document.body, script, misses)
    // New or changed content is annotated in batches, a moment after it appears.
    let pending = new Set<Element>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      const batch = pending
      pending = new Set()
      for (const el of batch) if (el.isConnected) annotateTree(el, script, misses)
    }
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target.nodeType === Node.ELEMENT_NODE ? (r.target as Element) : r.target.parentElement
        if (el) pending.add(el)
      }
      timer ??= setTimeout(flush, 120)
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    // Alt-click a label: type its native text.
    const onClick = (e: MouseEvent) => {
      if (!e.altKey || !(e.target instanceof Element) || e.target.closest('.native-label-editor')) return
      const label = labelAt(e.target)
      if (!label) return
      e.preventDefault()
      e.stopPropagation()
      setEditing({ label, x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY + 12, window.innerHeight - 90) })
    }
    window.addEventListener('click', onClick, true)
    return () => {
      cancelled = true
      observer.disconnect()
      window.removeEventListener('click', onClick, true)
      if (timer) clearTimeout(timer)
    }
    // `natives` is a dependency so a typed label re-annotates the whole screen.
  }, [nerv, script, natives])

  if (!nerv || !editing) return null
  const key = `${LABEL_KEY_PREFIX}${editing.label}`
  const own = natives[key]?.[script]
  const close = () => setEditing(null)
  return (
    <div className="native-label-editor" style={{ left: editing.x, top: editing.y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="native-label-editor-title">{editing.label}</div>
      <input
        autoFocus
        lang={script}
        value={own !== undefined ? own.trim() : nativeOf(editing.label, script) ?? ''}
        placeholder={SCRIPT_LABELS[script]}
        maxLength={40}
        onChange={(e) => usePlaceNameStore.getState().setNative(key, script, e.target.value === '' ? ' ' : e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') close()
        }}
        onBlur={close}
      />
      <div className="native-label-editor-hint">
        {SCRIPT_LABELS[script]} · Enter to close ·{' '}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            usePlaceNameStore.getState().setNative(key, script, '')
            close()
          }}
        >
          reset
        </button>
      </div>
    </div>
  )
}
