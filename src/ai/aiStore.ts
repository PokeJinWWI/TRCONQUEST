import { create } from 'zustand'
import { INITIAL_AI_MEMORY, type AiMemory } from './types'

// What each AI empire remembers between planning passes (see types.AiMemory),
// and when it next plans. Session-only, like every other store.
interface AiState {
  memory: Record<string, AiMemory>
  nextPlanSimDays: Record<string, number>
  memoryFor: (countryId: string) => AiMemory
  setMemory: (countryId: string, memory: AiMemory) => void
  setNextPlan: (countryId: string, simDays: number) => void
  reset: () => void
}

export const useAiStore = create<AiState>((set, get) => ({
  memory: {},
  nextPlanSimDays: {},
  memoryFor: (countryId) => get().memory[countryId] ?? INITIAL_AI_MEMORY,
  setMemory: (countryId, memory) => set((s) => ({ memory: { ...s.memory, [countryId]: memory } })),
  setNextPlan: (countryId, simDays) => set((s) => ({ nextPlanSimDays: { ...s.nextPlanSimDays, [countryId]: simDays } })),
  reset: () => set({ memory: {}, nextPlanSimDays: {} }),
}))
