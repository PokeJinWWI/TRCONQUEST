import { create } from 'zustand'

// A nation's colony on a body (version 1: one per body; it stands on a settlement site, `siteId`).
// Its owner is the body's owner (territoryStore.bodyOwner), never stored here,
// so a treaty that cedes the body cedes the colony with it. Rules in
// scene/colonies.ts; stepped by hooks/useColonyResolver.ts.
export type ColonyStage = 'micro' | 'planetary'

export interface Colony {
  bodyName: string
  // The planetary outpost: a key node on the body's ground map.
  outpostNode: number
  stage: ColonyStage
  foundedSimDays: number
  // Since when the owner's patrol ships have held the orbit uncontested, or
  // null while they don't.
  orbitSecureSinceSimDays: number | null
  // The development site (scene/locations.ts) the colony stands on, when its body has one.
  siteId?: string
}

interface ColonyState {
  colonies: Record<string, Colony>
  setColonies: (colonies: Record<string, Colony>) => void
  addColony: (colony: Colony) => void
}

export const useColonyStore = create<ColonyState>((set) => ({
  colonies: {},
  setColonies: (colonies) => set({ colonies }),
  addColony: (colony) => set((s) => ({ colonies: { ...s.colonies, [colony.bodyName]: colony } })),
}))
