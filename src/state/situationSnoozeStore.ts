import { create } from 'zustand'

// Situation lines the player snoozed (right-click), by `typeId|key` (scene/situations.lineId).
// A snooze lasts until its line goes away once, so the same problem coming back later shows
// again (useSituationTracker prunes them). Part of the game: saved.
interface SituationSnoozeState {
  snoozed: string[]
  snooze: (id: string) => void
  unsnooze: (id: string) => void
  setSnoozed: (ids: string[]) => void
}

export const useSituationSnoozeStore = create<SituationSnoozeState>((set) => ({
  snoozed: [],
  snooze: (id) => set((s) => (s.snoozed.includes(id) ? s : { snoozed: [...s.snoozed, id] })),
  unsnooze: (id) => set((s) => ({ snoozed: s.snoozed.filter((x) => x !== id) })),
  setSnoozed: (ids) => set({ snoozed: ids }),
}))
