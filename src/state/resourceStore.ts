import { create } from 'zustand'
import type { ResourceId } from '../data/resourceData'
import { RESOURCE_TYPES } from '../data/resourceData'

interface ResourceState {
  // Real current stockpile, not placeholder data — starts at zero because no
  // production/consumption system exists yet to make any other number true
  // (same "empty means empty" rule Outliner's Colonies/Starbases sections
  // follow). Whatever future economy system lands wires into `setAmount`/
  // `addAmount` rather than needing a new store.
  amounts: Record<ResourceId, number>
  setAmount: (id: ResourceId, amount: number) => void
  addAmount: (id: ResourceId, delta: number) => void
}

const ZERO_AMOUNTS: Record<ResourceId, number> = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>

export const useResourceStore = create<ResourceState>((set) => ({
  amounts: { ...ZERO_AMOUNTS },
  setAmount: (id, amount) => set((s) => ({ amounts: { ...s.amounts, [id]: amount } })),
  addAmount: (id, delta) => set((s) => ({ amounts: { ...s.amounts, [id]: s.amounts[id] + delta } })),
}))
