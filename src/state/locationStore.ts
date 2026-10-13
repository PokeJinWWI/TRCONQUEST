import { nativeOfName } from '../data/nativeNames'
import { nativeFor } from './placeNameStore'
import { create } from 'zustand'
import { setCustomSites } from '../scene/customSites'
import { bodyOfLocation, locationById, type DevLocation } from '../scene/locations'
import { seedBodyOwners } from '../scene/territory'

// The run-time half of development locations (scene/locations.ts is the where and
// what, derived and never saved): which sites a nation has ESTABLISHED. A site
// nobody has established is open ground; the fixed sites of a body that starts
// inhabited (its capital, its cities, its spaceports) belong to that body's starting
// owner until this store says otherwise, so nothing needs seeding at boot.
//
// This is property of the SITE (who built there), not sovereignty over the ground:
// the territorial claims that decide who governs a place are M3's.
export interface EstablishedSite {
  ownerId: string
  // simDays when it was established.
  since: number
  // A site a new game's starting buildings were assigned to: the starting economy was balanced with its freight already
  // getting out, so it counts as connected to its hubs (scene/infrastructureOrders.accessOnBody) until the enemy holds it.
  // Never set on anything built during play.
  connected?: boolean
}

interface LocationStore {
  established: Record<string, EstablishedSite>
  // Sites FOUNDED during play by choosing ground (scene/siteFounding.ts), by body. `locationsOf` adds them to the generated ones.
  custom: Record<string, DevLocation[]>
  // Names the player gave sites (site id -> name); a site with none keeps its generated name.
  names: Record<string, string>
  renameSite: (siteId: string, name: string) => void
  addCustom: (site: DevLocation) => void
  removeCustom: (siteId: string) => void
  // Establishes a site for `ownerId`. False for an unknown id or a site already held by someone else.
  establish: (siteId: string, ownerId: string, simDays: number, opts?: { connected?: boolean }) => boolean
  // Gives the site up (it becomes open ground; a fixed site of a starting world too).
  abandon: (siteId: string) => void
}

export const useLocationStore = create<LocationStore>((set) => ({
  established: {},
  custom: {},
  names: {},
  renameSite: (siteId, name) =>
    set((s) => {
      const trimmed = name.trim().slice(0, 40)
      const names = { ...s.names }
      if (trimmed) names[siteId] = trimmed
      else delete names[siteId]
      return { names }
    }),
  addCustom: (site) => set((s) => ({ custom: { ...s.custom, [site.bodyName]: [...(s.custom[site.bodyName] ?? []).filter((x) => x.id !== site.id), site] } })),
  removeCustom: (siteId) =>
    set((s) => {
      const body = bodyOfLocation(siteId)
      const left = (s.custom[body] ?? []).filter((x) => x.id !== siteId)
      const custom = { ...s.custom }
      if (left.length > 0) custom[body] = left
      else delete custom[body]
      const established = { ...s.established }
      delete established[siteId]
      const names = { ...s.names }
      delete names[siteId]
      return { custom, established, names }
    }),
  establish: (siteId, ownerId, simDays, opts) => {
    if (!locationById(siteId)) return false
    const holder = siteOwner(siteId)
    if (holder && holder !== ownerId) return false
    set((s) => ({ established: { ...s.established, [siteId]: { ownerId, since: s.established[siteId]?.since ?? simDays, ...(opts?.connected || s.established[siteId]?.connected ? { connected: true } : {}) } } }))
    return true
  },
  abandon: (siteId) =>
    set((s) => ({ established: { ...s.established, [siteId]: { ownerId: '', since: s.established[siteId]?.since ?? 0 } } })),
}))

// The scene layer reads founded sites from its own registry; every change here (a founding, a loaded save, a reset) is pushed there.
let pushed: Record<string, DevLocation[]> | null = null
function pushCustom(custom: Record<string, DevLocation[]>): void {
  if (custom === pushed) return
  pushed = custom
  setCustomSites(custom)
}
useLocationStore.subscribe((s) => pushCustom(s.custom))

let seedOwners: Record<string, string> | null = null

// Who holds a site: its establisher, or for a fixed site of a starting world that
// world's starting owner; undefined = open ground. An abandoned site is open.
export function siteOwner(siteId: string, established = useLocationStore.getState().established): string | undefined {
  const own = established[siteId]
  if (own) return own.ownerId || undefined
  if (!/#(settlement|infrastructure)-\d+$/.test(siteId)) return undefined
  const site = locationById(siteId)
  if (!site?.fixed) return undefined
  seedOwners ??= seedBodyOwners()
  return seedOwners[bodyOfLocation(siteId)]
}

// What to call a site: the player's name for it, else its generated one, else its plain id.
export function siteName(siteId: string, names = useLocationStore.getState().names): string {
  return names[siteId] ?? locationById(siteId)?.name ?? siteId.slice(siteId.lastIndexOf('#') + 1)
}

// The subscript beside a site's name: the player's own, else the built-in one for Earth's Chinese places.
export function siteNative(siteId: string): string | undefined {
  return nativeFor(siteId, nativeOfName(locationById(siteId)?.name))
}
