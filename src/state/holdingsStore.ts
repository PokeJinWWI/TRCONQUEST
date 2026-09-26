import { create } from 'zustand'
import type { HoldingKind } from '../data/holdingsData'
import { canOpen, type Holding } from '../scene/holdings'
import { adjustTreasury, holdingContext } from './nationEconomy'
import { economyModel } from './playerStore'
import { useAbstractEconomyStore } from './abstractEconomyStore'
import { useEconomyStore } from './economyStore'

// Every foreign building (embassy / branch office) in the game, both economy
// modes. Rules: scene/holdings.ts. Each change re-syncs how many Urban slots
// they take on every world into the running economy (so native construction
// can't overfill the district). Monthly effects: hooks/useHoldingsResolver.ts.

export type HoldingResult = { ok: true } | { ok: false; reason: string }

interface HoldingsState {
  holdings: Holding[]
  open: (ownerId: string, bodyName: string, kind: HoldingKind, simDays: number) => HoldingResult
  close: (id: string) => void
  setHoldings: (holdings: Holding[]) => void
}

let counter = 0

function syncSlots(holdings: Holding[]) {
  const byBody: Record<string, number> = {}
  for (const h of holdings) byBody[h.bodyName] = (byBody[h.bodyName] ?? 0) + 1
  if (economyModel() === 'abstract') useAbstractEconomyStore.getState().setForeignSlots(byBody)
  else useEconomyStore.getState().setForeignSlots(byBody)
}

export const useHoldingsStore = create<HoldingsState>((set, get) => ({
  holdings: [],
  open: (ownerId, bodyName, kind, simDays) => {
    const holdings = get().holdings
    const check = canOpen(kind, ownerId, bodyName, holdings, holdingContext())
    if (!check.ok) return check
    adjustTreasury(ownerId, -check.cost)
    counter += 1
    const next = [...holdings, { id: `hold-${kind}-${ownerId}-${bodyName}-${counter}`, kind, ownerId, bodyName, openedSimDays: simDays }]
    set({ holdings: next })
    syncSlots(next)
    return { ok: true }
  },
  close: (id) => {
    const next = get().holdings.filter((h) => h.id !== id)
    set({ holdings: next })
    syncSlots(next)
  },
  setHoldings: (holdings) => {
    set({ holdings })
    syncSlots(holdings)
  },
}))
