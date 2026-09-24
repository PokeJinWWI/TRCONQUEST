import { create } from 'zustand'
import { INITIAL_AI_MEMORY, type AiMemory } from './types'

// What each AI empire remembers between planning passes (see types.AiMemory),
// and when it next plans. Session-only, like every other store.
// How often the player has been offered peace in a war, and how often they've
// turned it down — what throttles further offers (see executor.ts).
export interface PlayerOfferRecord {
  lastOfferSimDays: number
  declines: number
}

interface AiState {
  memory: Record<string, AiMemory>
  // warId → offers made to the player in it.
  playerOffers: Record<string, PlayerOfferRecord>
  // The last offer of any kind made to the player.
  lastPlayerOfferSimDays: number | null
  recordPlayerOffer: (warId: string, simDays: number) => void
  recordPlayerDecline: (warId: string) => void
  nextPlanSimDays: Record<string, number>
  memoryFor: (countryId: string) => AiMemory
  setMemory: (countryId: string, memory: AiMemory) => void
  setNextPlan: (countryId: string, simDays: number) => void
  reset: () => void
}

export const useAiStore = create<AiState>((set, get) => ({
  memory: {},
  playerOffers: {},
  lastPlayerOfferSimDays: null,
  recordPlayerOffer: (warId, simDays) =>
    set((s) => ({
      playerOffers: { ...s.playerOffers, [warId]: { declines: s.playerOffers[warId]?.declines ?? 0, lastOfferSimDays: simDays } },
      lastPlayerOfferSimDays: simDays,
    })),
  recordPlayerDecline: (warId) =>
    set((s) => {
      const rec = s.playerOffers[warId]
      return rec ? { playerOffers: { ...s.playerOffers, [warId]: { ...rec, declines: rec.declines + 1 } } } : s
    }),
  nextPlanSimDays: {},
  memoryFor: (countryId) => get().memory[countryId] ?? INITIAL_AI_MEMORY,
  setMemory: (countryId, memory) => set((s) => ({ memory: { ...s.memory, [countryId]: memory } })),
  setNextPlan: (countryId, simDays) => set((s) => ({ nextPlanSimDays: { ...s.nextPlanSimDays, [countryId]: simDays } })),
  reset: () => set({ memory: {}, nextPlanSimDays: {}, playerOffers: {}, lastPlayerOfferSimDays: null }),
}))
