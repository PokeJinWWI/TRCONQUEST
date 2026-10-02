import { create } from 'zustand'

// Observer mode (a Debug Console cheat): a VIEW override that shows every
// empire's territory, every charted hyperlane and an empire panel, whatever the
// player has explored. It only changes what is drawn: nothing here ever writes
// game state or the player's knowledge (scene/observerView.ts, scene/ObserverLayer.tsx).
interface ObserverState {
  on: boolean
  // The empire panel: opens with the mode, and can be closed while the map layers stay.
  panelOpen: boolean
  setOn: (on: boolean) => void
  setPanelOpen: (open: boolean) => void
}

export const useObserverStore = create<ObserverState>((set) => ({
  on: false,
  panelOpen: false,
  setOn: (on) => set({ on, panelOpen: on }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}))
