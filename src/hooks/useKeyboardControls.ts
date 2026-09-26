import { useEffect } from 'react'
import { useConfirmStore } from '../state/confirmStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { useMenuStore } from '../state/menuStore'
import { usePlayerStore } from '../state/playerStore'
import { installQueueModifier } from '../scene/queueModifier'

// Whether a key press is going into a text field (a search box, a tab rename,
// a number input) — those keep their keys.
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

// What Escape does, in order: cancel a pending decision, close the menu, drop a
// half-made placement on the ground map — and otherwise open the menu.
export function handleEscape(): void {
  const confirm = useConfirmStore.getState()
  if (confirm.pending) {
    confirm.resolve(false)
    return
  }
  const menu = useMenuStore.getState()
  if (menu.open) {
    menu.closeMenu()
    return
  }
  const ground = useGroundViewStore.getState()
  if (ground.mode.kind !== 'order') {
    ground.setMode({ kind: 'order' })
    return
  }
  menu.openMenu()
}

// Space pauses and resumes — not while the menu is up (it holds the pause) or a
// decision is waiting.
export function handleSpace(): void {
  if (useMenuStore.getState().open || useConfirmStore.getState().pending) return
  useGameTimeStore.getState().togglePause()
}

// Global game keys: Escape (menu) and Space (pause). Only once a game has
// started. Movement keys are handled per camera (scene/KeyboardPan.tsx).
export function useKeyboardControls() {
  useEffect(() => {
    const started = () => !!usePlayerStore.getState().selectedCountryId
    const onKeyDown = (e: KeyboardEvent) => {
      if (!started() || isTypingTarget(e.target)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        handleEscape()
      } else if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Also stops Space "clicking" whichever button was clicked last.
        e.preventDefault()
        if (!e.repeat) handleSpace()
      }
    }
    // A button is activated on Space's key-up, so swallow that too.
    const onKeyUp = (e: KeyboardEvent) => {
      if (started() && !isTypingTarget(e.target) && e.code === 'Space') e.preventDefault()
    }
    // Capture phase: game keys win over whatever has focus.
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    // Shift = "queue this order" everywhere (scene/queueModifier.ts).
    const removeQueueModifier = installQueueModifier()
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      removeQueueModifier()
    }
  }, [])
}
