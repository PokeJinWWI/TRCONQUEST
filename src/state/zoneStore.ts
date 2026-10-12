import { create } from 'zustand'
import { setZoneCapacities } from '../scene/customSites'
import type { LocationKind } from '../data/locationData'
import { capacityFromZone } from '../scene/zoning'
import { DEFAULT_LAND_USE_POLICY, type LandUsePolicy } from '../data/zoningData'

// The player's (and anyone's) REDRAWN zones. A site not named here has its default zone (scene/zoning.defaultZone), derived and
// never saved. The land-use law per nation, and the permit requests waiting on a government decision.
export interface PermitRequest {
  id: string
  nationId: string
  siteId: string
  // The cells to add to the site's zone once approved.
  cells: number[]
  // simDays when the request is decided (an absolute deadline).
  decideSimDays: number
}

interface ZoneStore {
  zones: Record<string, number[]>
  // Nature reserves: cells (by body) no zone may grow into, deliberately kept wild.
  reserves: Record<string, number[]>
  policy: Record<string, LandUsePolicy>
  requests: PermitRequest[]
  setZone: (siteId: string, cells: number[]) => void
  setReserve: (bodyName: string, cells: number[]) => void
  // Back to the default zone.
  clearZone: (siteId: string) => void
  setPolicy: (nationId: string, policy: LandUsePolicy) => void
  addRequest: (request: PermitRequest) => void
  removeRequest: (id: string) => void
}

export const useZoneStore = create<ZoneStore>((set) => ({
  zones: {},
  reserves: {},
  policy: {},
  requests: [],
  setZone: (siteId, cells) => set((s) => ({ zones: { ...s.zones, [siteId]: cells } })),
  setReserve: (bodyName, cells) =>
    set((s) => {
      const reserves = { ...s.reserves }
      if (cells.length > 0) reserves[bodyName] = cells
      else delete reserves[bodyName]
      return { reserves }
    }),
  clearZone: (siteId) =>
    set((s) => {
      const zones = { ...s.zones }
      delete zones[siteId]
      return { zones }
    }),
  setPolicy: (nationId, policy) => set((s) => ({ policy: { ...s.policy, [nationId]: policy } })),
  addRequest: (request) => set((s) => ({ requests: [...s.requests, request] })),
  removeRequest: (id) => set((s) => ({ requests: s.requests.filter((r) => r.id !== id) })),
}))

export const landUsePolicyOf = (nationId: string, policy = useZoneStore.getState().policy): LandUsePolicy => policy[nationId] ?? DEFAULT_LAND_USE_POLICY

// The scene layer reads the capacity a redrawn zone gives from its own registry (so scene/locations needs no store).
let pushed: Record<string, number[]> | null = null
function pushCapacities(zones: Record<string, number[]>): void {
  if (zones === pushed) return
  pushed = zones
  const byBody: Record<string, Record<string, number>> = {}
  for (const [siteId, cells] of Object.entries(zones)) {
    // The id carries both: "<body>#<kind>-<n>". (Not looked up, so a load may restore the zones before the founded sites.)
    const hash = siteId.lastIndexOf('#')
    const kind = siteId.slice(hash + 1, siteId.lastIndexOf('-')) as LocationKind
    ;(byBody[siteId.slice(0, hash)] ??= {})[siteId] = capacityFromZone(kind, cells.length)
  }
  setZoneCapacities(byBody)
}
useZoneStore.subscribe((s) => pushCapacities(s.zones))
