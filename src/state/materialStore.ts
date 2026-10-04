import { create } from 'zustand'
import type { MaterialId } from '../data/materials'

// The materials each nation has discovered (data/materials.ts). Latched: a nation
// that has found or held a material keeps it even when the stockpile runs dry.
// Written by hooks/useMaterialDiscovery.ts; read by the player's research UI.
interface MaterialStore {
  discovered: Record<string, MaterialId[]>
  // Adds to a nation's set; no-op (same state) when nothing is new.
  discover: (nationId: string, ids: readonly MaterialId[]) => void
}

export const useMaterialStore = create<MaterialStore>((set) => ({
  discovered: {},
  discover: (nationId, ids) =>
    set((s) => {
      const have = s.discovered[nationId] ?? []
      const add = ids.filter((id) => !have.includes(id))
      return add.length === 0 ? s : { discovered: { ...s.discovered, [nationId]: [...have, ...add] } }
    }),
}))
