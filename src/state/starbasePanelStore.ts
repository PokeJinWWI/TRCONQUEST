import { create } from 'zustand'

// Which Starbase the management panel is open on (components/StarbasePanel.tsx).
// Session-only; opened from the Outliner's Starbase entries.
interface StarbasePanelState {
  openId: string | null
  open: (id: string) => void
  close: () => void
}

export const useStarbasePanelStore = create<StarbasePanelState>((set) => ({
  openId: null,
  open: (id) => set({ openId: id }),
  close: () => set({ openId: null }),
}))
