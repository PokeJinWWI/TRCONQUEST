import { create } from 'zustand'

// A floating building-detail window (components/BuildingDetailWindow.tsx), opened
// by clicking a building anywhere — e.g. a producer/consumer row in the Good
// Detail panel. Identified by its world + building id; one at a time.
interface BuildingDetailState {
  worldId: string | null
  buildingId: string | null
  openBuilding: (worldId: string, buildingId: string) => void
  close: () => void
}

export const useBuildingDetailStore = create<BuildingDetailState>((set) => ({
  worldId: null,
  buildingId: null,
  openBuilding: (worldId, buildingId) => set({ worldId, buildingId }),
  close: () => set({ worldId: null, buildingId: null }),
}))
