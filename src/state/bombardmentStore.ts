import { create } from 'zustand'
import type { Strike } from '../scene/bombardment'

// Orbital bombardment state: each body's devastation (0–1) and the strikes of
// the latest day (for "under bombardment" in the UI). Rules in
// scene/bombardment.ts, driven by hooks/useBombardmentResolver.ts, which also
// pushes devastation into whichever economy the game runs.
interface BombardmentState {
  devastation: Record<string, number>
  strikes: Strike[]
  update: (devastation: Record<string, number>, strikes: Strike[]) => void
}

export const useBombardmentStore = create<BombardmentState>((set) => ({
  devastation: {},
  strikes: [],
  update: (devastation, strikes) => set({ devastation, strikes }),
}))
