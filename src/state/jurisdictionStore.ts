import { create } from 'zustand'
import type { Claim } from '../scene/claims'
import type { Permission } from '../scene/jurisdiction'

// Run-time territorial claims and standing permissions (scene/claims.ts and
// scene/jurisdiction.ts hold the rules; scene/sovereignty.ts is the I/O layer that
// reads and writes this). Starts EMPTY: today's borders are territoryStore.bodyOwner (the
// recognized body-wide sovereign), and claims are everything weaker or narrower:
// provisional claims, regions, locations, whole systems.
interface JurisdictionStore {
  claims: Claim[]
  permissions: Permission[]
  setClaims: (claims: Claim[]) => void
  addPermission: (permission: Permission) => void
  removePermission: (id: string) => void
}

export const useJurisdictionStore = create<JurisdictionStore>((set) => ({
  claims: [],
  permissions: [],
  setClaims: (claims) => set({ claims }),
  addPermission: (permission) => set((s) => ({ permissions: [...s.permissions.filter((p) => p.id !== permission.id), permission] })),
  removePermission: (id) => set((s) => ({ permissions: s.permissions.filter((p) => p.id !== id) })),
}))
