import { create } from 'zustand'

// The floating window of a standalone building (components/StandaloneDetailWindow.tsx): a spaceport in Simple mode, a fortress, a battery, a
// rural structure. One at a time, identified by its world and the row key scene/standalone.standaloneRows gives it.
interface StandaloneDetailState {
  bodyName: string | null
  key: string | null
  open: (bodyName: string, key: string) => void
  close: () => void
}

export const useStandaloneDetailStore = create<StandaloneDetailState>((set) => ({
  bodyName: null,
  key: null,
  open: (bodyName, key) => set({ bodyName, key }),
  close: () => set({ bodyName: null, key: null }),
}))
