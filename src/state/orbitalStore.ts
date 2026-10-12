import { create } from 'zustand'
import type { OrbitalFacility } from '../scene/orbits'

// The facilities standing in orbital zones (scene/orbits.ts has the rules, scene/orbitalOrders.ts the I/O).
// Property of the facility's owner; a station confers no sovereignty.
interface OrbitalStore {
  facilities: OrbitalFacility[]
  add: (facility: OrbitalFacility) => void
  remove: (id: string) => void
  setOwner: (id: string, ownerId: string) => void
}

export const useOrbitalStore = create<OrbitalStore>((set) => ({
  facilities: [],
  add: (facility) => set((s) => ({ facilities: [...s.facilities, facility] })),
  remove: (id) => set((s) => ({ facilities: s.facilities.filter((f) => f.id !== id) })),
  setOwner: (id, ownerId) => set((s) => ({ facilities: s.facilities.map((f) => (f.id === id ? { ...f, ownerId } : f)) })),
}))
