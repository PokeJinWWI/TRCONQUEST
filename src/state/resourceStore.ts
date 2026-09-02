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
  // Net monthly gain/deficit per resource — the number the HUD's "+"
  // indicator and the click-to-open info panel's "Monthly" row both read
  // (see ResourceBar.tsx). Same honest-zero reasoning as `amounts`: no real
  // production/consumption tick exists yet to derive this from, so it starts
  // at zero rather than an invented figure. Deliberately its own field
  // rather than derived from consecutive `amounts` reads, since a future
  // economy tick can set it directly from its own per-resource production
  // minus consumption for the month, which is the actually-correct number —
  // reverse-engineering it from raw stockpile deltas would also count a
  // one-off debug-console grant as "monthly income."
  monthlyDelta: Record<ResourceId, number>
  setMonthlyDelta: (id: ResourceId, delta: number) => void
}

const ZERO_AMOUNTS: Record<ResourceId, number> = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>

export const useResourceStore = create<ResourceState>((set) => ({
  amounts: { ...ZERO_AMOUNTS },
  setAmount: (id, amount) => set((s) => ({ amounts: { ...s.amounts, [id]: amount } })),
  addAmount: (id, delta) => set((s) => ({ amounts: { ...s.amounts, [id]: s.amounts[id] + delta } })),
  monthlyDelta: { ...ZERO_AMOUNTS },
  setMonthlyDelta: (id, delta) => set((s) => ({ monthlyDelta: { ...s.monthlyDelta, [id]: delta } })),
}))
