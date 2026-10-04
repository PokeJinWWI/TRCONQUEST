// A registry of the closable floating windows currently open, with their stacking
// order, so Escape can close the TOPMOST one before falling back to the pause menu
// (see hooks/useKeyboardControls.handleEscape). Plain module state — nothing reads
// it reactively; every DraggableWindow with an onClose registers here while mounted
// (see components/DraggableWindow.tsx).
interface RegisteredWindow {
  zIndex: number
  onClose: () => void
}

const windows = new Map<number, RegisteredWindow>()
let nextId = 1

export function registerWindow(onClose: () => void, zIndex: number): number {
  const id = nextId++
  windows.set(id, { zIndex, onClose })
  return id
}

export function updateWindow(id: number, onClose: () => void, zIndex: number): void {
  const e = windows.get(id)
  if (e) {
    e.onClose = onClose
    e.zIndex = zIndex
  }
}

export function unregisterWindow(id: number): void {
  windows.delete(id)
}

export function hasOpenWindow(): boolean {
  return windows.size > 0
}

// Close the window with the highest z-index (the one visually on top). Returns
// true if a window was closed, false if none were open.
export function closeTopmostWindow(): boolean {
  let topId = -1
  let topZ = -Infinity
  for (const [id, e] of windows) {
    if (e.zIndex > topZ) {
      topZ = e.zIndex
      topId = id
    }
  }
  if (topId < 0) return false
  windows.get(topId)!.onClose()
  return true
}
