import { create } from 'zustand'

// The size the player last dragged each HUD window to (DraggableWindow), keyed
// by the window's memory key (its title unless it passes one). Kept for this
// game session only: in memory (a page reload forgets it) and reset with every
// other game store when the player quits (scene/gameReset.ts) — not a setting.
export interface WindowSize {
  width: number
  height: number
}

interface WindowLayoutStore {
  sizes: Record<string, WindowSize>
  rememberSize: (key: string, size: WindowSize) => void
}

export const useWindowLayoutStore = create<WindowLayoutStore>((set) => ({
  sizes: {},
  rememberSize: (key, size) => set((s) => ({ sizes: { ...s.sizes, [key]: size } })),
}))
