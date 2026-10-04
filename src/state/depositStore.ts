import { create } from 'zustand'
import { freshDeposits, type Deposits } from '../data/deposits'
import type { MaterialId } from '../data/materials'

// What is left in every natural deposit (data/deposits.ts holds where they are and
// how much they started with). Counted down as nations draw them
// (scene/extraction.ts); reset with the game.
interface DepositStore {
  remaining: Deposits
  // Takes up to `amount` from a body's deposit; returns what it actually took.
  draw: (material: MaterialId, bodyName: string, amount: number) => number
}

export const useDepositStore = create<DepositStore>((set, get) => ({
  remaining: freshDeposits(),
  draw: (material, bodyName, amount) => {
    const left = get().remaining[material][bodyName] ?? 0
    const taken = Math.max(0, Math.min(left, amount))
    if (taken > 0) set((s) => ({ remaining: { ...s.remaining, [material]: { ...s.remaining[material], [bodyName]: left - taken } } }))
    return taken
  },
}))
