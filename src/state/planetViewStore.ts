import { create } from 'zustand'

// The planet screen's view options, kept for the game session (reset with the
// other game stores by scene/gameReset.ts).
interface PlanetViewStore {
  // Show identical buildings in a district as one tile with a count.
  groupBuildings: boolean
  setGroupBuildings: (on: boolean) => void
}

export const usePlanetViewStore = create<PlanetViewStore>((set) => ({
  groupBuildings: false,
  setGroupBuildings: (groupBuildings) => set({ groupBuildings }),
}))
