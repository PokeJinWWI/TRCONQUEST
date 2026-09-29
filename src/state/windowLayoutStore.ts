import { create } from 'zustand'

// The size the player last dragged each HUD window to (DraggableWindow), keyed
// by the window's memory key (its title unless it passes one). Kept for this
// game session only: in memory (a page reload forgets it) and reset with every
// other game store when the player quits (scene/gameReset.ts) — not a setting.
export interface WindowSize {
  width: number
  height: number
}

// How an inspector window opens: docked against the right edge at full height
// (a left click on a planet, star or ship), or filling the screen (a right
// click on one with none of your ships selected). DraggableWindow applies it
// when it opens, and again whenever a new request for its key comes in.
export type OpenMode = 'docked' | 'maximized'
// Windows that open docked unless asked otherwise.
export const DOCKED_WINDOW_KEYS: ReadonlySet<string> = new Set(['planet', 'ship', 'ships', 'star'])

interface WindowLayoutStore {
  sizes: Record<string, WindowSize>
  rememberSize: (key: string, size: WindowSize) => void
  // The latest open-mode request per window key; `n` makes a repeat request new.
  openRequests: Record<string, { mode: OpenMode; n: number }>
  requestOpenMode: (key: string, mode: OpenMode) => void
}

let requestCounter = 0
export const useWindowLayoutStore = create<WindowLayoutStore>((set) => ({
  sizes: {},
  rememberSize: (key, size) => set((s) => ({ sizes: { ...s.sizes, [key]: size } })),
  openRequests: {},
  requestOpenMode: (key, mode) => set((s) => ({ openRequests: { ...s.openRequests, [key]: { mode, n: ++requestCounter } } })),
}))
