// Whether the "queue this order" modifier (Shift) is held — read by every
// order handler so Shift + right-click adds to a route instead of replacing it.
// Tracked globally (window key events, plus the modifier state carried on every
// pointer event as a backstop, e.g. Shift pressed while the window wasn't
// focused), because the scenes' right-click callbacks are handed a target, not
// the mouse event.
let held = false
// Ctrl/Cmd, the "open in a new tab" modifier, tracked the same way for the
// scenes' select callbacks (they get a name, not the click).
let newTabHeld = false

export function isNewTabModifierHeld(): boolean {
  return newTabHeld
}

export function isQueueModifierHeld(): boolean {
  return held
}

// For headless tests.
export function setQueueModifierHeld(value: boolean): void {
  held = value
}

export function installQueueModifier(): () => void {
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Shift') held = e.type === 'keydown'
    if (e.key === 'Control' || e.key === 'Meta') newTabHeld = e.type === 'keydown'
  }
  const pointer = (e: MouseEvent | PointerEvent) => {
    held = e.shiftKey
    newTabHeld = e.ctrlKey || e.metaKey
  }
  const clear = () => {
    held = false
    newTabHeld = false
  }
  window.addEventListener('keydown', key, true)
  window.addEventListener('keyup', key, true)
  window.addEventListener('pointerdown', pointer, true)
  window.addEventListener('contextmenu', pointer, true)
  window.addEventListener('blur', clear)
  return () => {
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('keyup', key, true)
    window.removeEventListener('pointerdown', pointer, true)
    window.removeEventListener('contextmenu', pointer, true)
    window.removeEventListener('blur', clear)
    held = false
  }
}
