import { create } from 'zustand'
import type { CivicBuilding } from '../scene/civic'

// The civic buildings of each body (scene/civic.ts derives them from the key nodes; they are written here the first time a body is
// seeded, so they are part of the saved game and a name never changes under the player). Both economy modes read this one list.
interface CivicStore {
  civic: Record<string, CivicBuilding[]>
  setBody: (bodyName: string, list: CivicBuilding[]) => void
}

export const useCivicStore = create<CivicStore>((set) => ({
  civic: {},
  setBody: (bodyName, list) => set((s) => ({ civic: { ...s.civic, [bodyName]: list } })),
}))

// The window that opens a civic building (components/CivicBuildingWindow.tsx).
interface CivicDetailStore {
  open: { bodyName: string; id: string } | null
  openBuilding: (bodyName: string, id: string) => void
  close: () => void
}

export const useCivicDetailStore = create<CivicDetailStore>((set) => ({
  open: null,
  openBuilding: (bodyName, id) => set({ open: { bodyName, id } }),
  close: () => set({ open: null }),
}))
