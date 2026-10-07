import { create } from 'zustand'
import type { GoodId } from '../economy/goods'

// The Good Detail panel (components/GoodDetailPanel.tsx) — a Vic3-style market
// view of one good, opened by clicking that good anywhere (a building's inputs/
// outputs, the Market tab). One at a time; opening another good replaces it.
interface GoodDetailState {
  good: GoodId | null
  openGood: (good: GoodId) => void
  close: () => void
}

export const useGoodDetailStore = create<GoodDetailState>((set) => ({
  good: null,
  openGood: (good) => set({ good }),
  close: () => set({ good: null }),
}))
