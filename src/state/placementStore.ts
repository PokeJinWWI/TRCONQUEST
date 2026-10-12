import { create } from 'zustand'

// Where the buildings the player and the AI have ordered stand: site id -> building id -> count
// (scene/placement.ts has the rules, scene/placementOrders.ts the I/O). It records PLACEMENT
// only: how many buildings exist is the economies' own count, and a ledger entry is trimmed
// back to that count whenever it is read through `placedOn` (scene/placementOrders.ts), so a
// cancelled order or a demolished building cannot leave a phantom behind. Buildings that were
// seeded, or built before sites existed, are just unplaced.
interface PlacementStore {
  placed: Record<string, Record<string, number>>
  // District levels developed AT a site (site id -> district id -> levels). The world's own district totals stay the
  // economy's; this records where its levels stand (docs/territorial-design.md section 12).
  levels: Record<string, Record<string, number>>
  // Bodies whose starting buildings and levels have been assigned to sites (scene/seedPlacement.ts). On a body that
  // has not been, a building needs only room on the site (capacity), as before; on one that has, it needs a
  // developed slot.
  seeded: Record<string, true>
  // Set by a new game (scene/gameSetup): bodies are then seeded the first time they are needed. Absent in a bare test.
  autoSeed: boolean
  place: (siteId: string, buildingId: string, n?: number) => void
  unplace: (siteId: string, buildingId: string, n?: number) => void
  addLevel: (siteId: string, district: string, n?: number) => void
  removeLevel: (siteId: string, district: string, n?: number) => void
  markSeeded: (bodyName: string) => void
  setAutoSeed: (on: boolean) => void
}

export const usePlacementStore = create<PlacementStore>((set) => ({
  placed: {},
  levels: {},
  seeded: {},
  autoSeed: false,
  addLevel: (siteId, district, n = 1) =>
    set((s) => ({ levels: { ...s.levels, [siteId]: { ...(s.levels[siteId] ?? {}), [district]: ((s.levels[siteId] ?? {})[district] ?? 0) + n } } })),
  removeLevel: (siteId, district, n = 1) =>
    set((s) => {
      const here = { ...(s.levels[siteId] ?? {}) }
      const left = (here[district] ?? 0) - n
      if (left > 0) here[district] = left
      else delete here[district]
      const levels = { ...s.levels }
      if (Object.keys(here).length > 0) levels[siteId] = here
      else delete levels[siteId]
      return { levels }
    }),
  markSeeded: (bodyName) => set((s) => ({ seeded: { ...s.seeded, [bodyName]: true } })),
  setAutoSeed: (autoSeed) => set({ autoSeed }),
  place: (siteId, buildingId, n = 1) =>
    set((s) => ({ placed: { ...s.placed, [siteId]: { ...(s.placed[siteId] ?? {}), [buildingId]: ((s.placed[siteId] ?? {})[buildingId] ?? 0) + n } } })),
  unplace: (siteId, buildingId, n = 1) =>
    set((s) => {
      const here = { ...(s.placed[siteId] ?? {}) }
      const left = (here[buildingId] ?? 0) - n
      if (left > 0) here[buildingId] = left
      else delete here[buildingId]
      const placed = { ...s.placed }
      if (Object.keys(here).length > 0) placed[siteId] = here
      else delete placed[siteId]
      return { placed }
    }),
}))
