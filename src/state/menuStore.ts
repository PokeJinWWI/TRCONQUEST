import { create } from 'zustand'
import { useGameTimeStore } from './gameTimeStore'

// The Escape menu (components/EscapeMenu.tsx). Opening it pauses the game; on
// closing, the game resumes only if the menu is what paused it — a game the
// player had already paused stays paused.
export type MenuView = 'main' | 'settings' | 'quit'

interface MenuState {
  open: boolean
  // Which page is showing. Closing the menu always puts it back on 'main', so
  // Esc from Settings and Esc again opens the menu, not Settings.
  view: MenuView
  setView: (view: MenuView) => void
  pausedByMenu: boolean
  openMenu: () => void
  closeMenu: () => void
}

export const useMenuStore = create<MenuState>((set, get) => ({
  open: false,
  view: 'main',
  setView: (view) => set({ view }),
  pausedByMenu: false,
  openMenu: () => {
    if (get().open) return
    const time = useGameTimeStore.getState()
    const willPause = !time.paused
    if (willPause) time.togglePause()
    set({ open: true, view: 'main', pausedByMenu: willPause })
  },
  closeMenu: () => {
    if (!get().open) return
    if (get().pausedByMenu && useGameTimeStore.getState().paused) useGameTimeStore.getState().togglePause()
    set({ open: false, view: 'main', pausedByMenu: false })
  },
}))
