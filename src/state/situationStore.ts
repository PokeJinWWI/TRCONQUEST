import { create } from 'zustand'
import type { SituationLine } from '../scene/situations'

// The Situations panel's current lines, kept by hooks/useSituationTracker.ts. Derived from the
// game every sim day (scene/situations.ts), never saved: a loaded game rebuilds it.
interface SituationState {
  lines: SituationLine[]
  // Bumped when a NEW line of a pause-on type appeared, so the badge can flash.
  alarmAt: number
  // Whose lines these are: the first fill for a nation (a new or loaded game) never pauses.
  primedFor: string | null
  setLines: (lines: SituationLine[], primedFor: string | null) => void
  raiseAlarm: () => void
}

export const useSituationStore = create<SituationState>((set) => ({
  lines: [],
  alarmAt: 0,
  primedFor: null,
  setLines: (lines, primedFor) => set({ lines, primedFor }),
  raiseAlarm: () => set({ alarmAt: Date.now() }),
}))
