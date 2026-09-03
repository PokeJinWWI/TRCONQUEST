import { create } from 'zustand'
import { HULL_CHASSES, emptyLoadout, type ShipDesign } from '../data/hullChassis'
import type { SlotCategory } from '../data/shipModules'

interface ShipDesignStore {
  designs: ShipDesign[]
  // Returns the new design's id (or '' if the chassis id is unknown) so a
  // caller can immediately select what it just created.
  createDesign: (chassisId: string, name: string) => string
  renameDesign: (designId: string, name: string) => void
  deleteDesign: (designId: string) => void
  // moduleId of null clears the slot.
  equipModule: (designId: string, category: SlotCategory, slotIndex: number, moduleId: string | null) => void
  // See ShipDesign.powerTier. Gating which tiers are actually OFFERED is the
  // UI's job (see shipModules.powerTiersAvailable), same as every other
  // tech-gated choice in the builder — this just sets it.
  setPowerTier: (designId: string, tier: number) => void
}

// Same id-generation pattern shipStore.ts already uses for fleet ids —
// timestamp plus a random tail, good enough for a per-session, never-synced
// identifier.
function newDesignId(): string {
  return `design-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

export const useShipDesignStore = create<ShipDesignStore>((set) => ({
  designs: [],

  createDesign: (chassisId, name) => {
    const chassis = HULL_CHASSES.find((c) => c.id === chassisId)
    if (!chassis) return ''
    const id = newDesignId()
    const design: ShipDesign = { id, name, chassisId, equipped: emptyLoadout(chassis), powerTier: 1 }
    set((state) => ({ designs: [...state.designs, design] }))
    return id
  },

  renameDesign: (designId, name) =>
    set((state) => ({
      designs: state.designs.map((d) => (d.id === designId ? { ...d, name } : d)),
    })),

  deleteDesign: (designId) =>
    set((state) => ({ designs: state.designs.filter((d) => d.id !== designId) })),

  equipModule: (designId, category, slotIndex, moduleId) =>
    set((state) => ({
      designs: state.designs.map((d) => {
        if (d.id !== designId) return d
        const nextCategorySlots = [...d.equipped[category]]
        nextCategorySlots[slotIndex] = moduleId
        return { ...d, equipped: { ...d.equipped, [category]: nextCategorySlots } }
      }),
    })),

  setPowerTier: (designId, tier) =>
    set((state) => ({
      designs: state.designs.map((d) => (d.id === designId ? { ...d, powerTier: tier } : d)),
    })),
}))
