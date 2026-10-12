import { create } from 'zustand'
import { UNREST_DECAY_DAYS, UNREST_PER_MILLION_DISPLACED } from '../data/demolitionData'

// Unrest a nation has taken on from displacing its own people (demolishing a city level, shrinking a zone under a settlement).
// Each entry decays on its own absolute deadline (never a countdown), and the sum is what the nation feels now. It lives
// beside the economies and is read through `unrestNow`; economy/state wiring is state/economyUnrest.ts.
export interface UnrestEntry {
  // The size of the shock when it happened.
  points: number
  // simDays it started and when it has gone.
  since: number
  until: number
}

interface UnrestStore {
  byNation: Record<string, UnrestEntry[]>
  // Displacing `millions` of people: adds a shock that fades over UNREST_DECAY_DAYS.
  add: (nationId: string, millions: number, simDays: number) => void
  // Drops entries that have run out.
  prune: (simDays: number) => void
}

export const useUnrestStore = create<UnrestStore>((set) => ({
  byNation: {},
  add: (nationId, millions, simDays) => {
    const points = millions * UNREST_PER_MILLION_DISPLACED
    if (points <= 0) return
    set((s) => ({ byNation: { ...s.byNation, [nationId]: [...(s.byNation[nationId] ?? []), { points, since: simDays, until: simDays + UNREST_DECAY_DAYS }] } }))
  },
  prune: (simDays) =>
    set((s) => {
      const next: Record<string, UnrestEntry[]> = {}
      for (const [id, list] of Object.entries(s.byNation)) {
        const kept = list.filter((e) => e.until > simDays)
        if (kept.length > 0) next[id] = kept
      }
      return { byNation: next }
    }),
}))

// What the nation feels now: each shock fades linearly to nothing at its deadline.
export function unrestNow(nationId: string, simDays: number, byNation = useUnrestStore.getState().byNation): number {
  let total = 0
  for (const e of byNation[nationId] ?? []) {
    if (simDays >= e.until) continue
    total += e.points * (1 - (simDays - e.since) / (e.until - e.since))
  }
  return total
}
