import { create } from 'zustand'
import type { GridDensity } from '../scene/combatArena'
import type { ArmyKind } from '../data/armyData'

// UI-only state for the planetary map (scene/GroundViewScene.tsx): what's
// selected there, which grid is drawn, and what a click on the globe will do
// (order units, choose a landing site for a transport, or place a
// console-spawned army). Not game state, so not snapshotted anywhere.
export type GroundClickMode =
  | { kind: 'order' }
  | { kind: 'drop'; shipId: string }
  | { kind: 'spawn'; ownerId: string; armyKind: ArmyKind }

interface GroundViewState {
  selectedUnitIds: string[]
  density: GridDensity
  mode: GroundClickMode
  // The node under the pointer (for the terrain tooltip), or null.
  hoverNode: number | null
  // A one-line message from the last click (a refused landing, etc.).
  notice: string | null
  selectUnit: (id: string | null) => void
  toggleUnit: (id: string) => void
  selectUnits: (ids: string[]) => void
  setDensity: (density: GridDensity) => void
  setMode: (mode: GroundClickMode) => void
  setHoverNode: (node: number | null) => void
  setNotice: (notice: string | null) => void
}

export const useGroundViewStore = create<GroundViewState>((set) => ({
  selectedUnitIds: [],
  density: 'standard',
  mode: { kind: 'order' },
  hoverNode: null,
  notice: null,
  selectUnit: (id) => set({ selectedUnitIds: id ? [id] : [] }),
  toggleUnit: (id) =>
    set((s) => ({
      selectedUnitIds: s.selectedUnitIds.includes(id) ? s.selectedUnitIds.filter((x) => x !== id) : [...s.selectedUnitIds, id],
    })),
  selectUnits: (ids) => set({ selectedUnitIds: [...new Set(ids)] }),
  setDensity: (density) => set({ density }),
  setMode: (mode) => set({ mode, notice: null }),
  setHoverNode: (hoverNode) => set({ hoverNode }),
  setNotice: (notice) => set({ notice }),
}))
