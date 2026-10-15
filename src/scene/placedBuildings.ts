// What stands where on a body, in the same shape for both economies (docs/territorial-design.md section 14).
//
// Complex keeps a Building per (recipe, owner, site), so this is just its list. Simple keeps counts per building id per world, so the
// per-place record IS the placement ledger (state/placementStore) less what is only on order there; whatever the ledger does not place
// is the unplaced remainder. Either way a row is "this many levels of this building at this place".
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { usePlacementStore } from '../state/placementStore'
import { economyModel } from '../state/playerStore'
import { useTerritoryStore } from '../state/territoryStore'
import type { EconomyMode } from './districtSites'
import { worldBuildings } from './worldDistricts'

export interface PlacedBuilding {
  // The recipe (Complex) or Simple building id.
  id: string
  // Where it stands; null = unplaced (seeded without a site, or one no site could hold).
  siteId: string | null
  // How many stand there.
  level: number
  // Complex only: the Building this row is (opens its window, takes owner / method changes).
  buildingId?: string
  // Complex only: who owns it.
  owner?: string
}

const ownerLabel = (o: { kind: string; corporationId?: string }): string => (o.kind === 'corporation' ? `corporation:${o.corporationId}` : o.kind)

export function placedBuildings(bodyName: string, mode: EconomyMode = economyModel() === 'abstract' ? 'simple' : 'complex'): PlacedBuilding[] {
  if (mode === 'complex') {
    const world = worldByName(useEconomyStore.getState().worlds, bodyName)
    return (world?.buildings ?? []).filter((b) => b.level > 0).map((b) => ({ id: b.recipeId, siteId: b.siteId ?? null, level: b.level, buildingId: b.id, owner: ownerLabel(b.owner) }))
  }
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  const queue = (owner ? useAbstractEconomyStore.getState().byCountry[owner]?.queue : undefined) ?? []
  const out: PlacedBuilding[] = []
  const placedById = new Map<string, number>()
  for (const [siteId, row] of Object.entries(usePlacementStore.getState().placed)) {
    if (!siteId.startsWith(`${bodyName}#`)) continue
    for (const [id, n] of Object.entries(row)) {
      const onOrder = queue.filter((o) => o.bodyName === bodyName && o.building === id && o.siteId === siteId).length
      const level = n - onOrder
      if (level <= 0) continue
      out.push({ id, siteId, level })
      placedById.set(id, (placedById.get(id) ?? 0) + level)
    }
  }
  for (const b of worldBuildings(bodyName, 'simple')) {
    const rest = b.count - (placedById.get(b.id) ?? 0)
    if (rest > 0) out.push({ id: b.id, siteId: null, level: rest })
  }
  return out
}

// "Factory: 4 levels in 2 places": per building, its levels across every place and how many places hold it.
export function buildingTotals(rows: readonly PlacedBuilding[]): { id: string; levels: number; places: number }[] {
  const by = new Map<string, { levels: number; places: Set<string> }>()
  for (const r of rows) {
    const t = by.get(r.id) ?? { levels: 0, places: new Set<string>() }
    t.levels += r.level
    t.places.add(r.siteId ?? '')
    by.set(r.id, t)
  }
  return [...by].map(([id, t]) => ({ id, levels: t.levels, places: t.places.size })).sort((a, b) => (a.id < b.id ? -1 : 1))
}
