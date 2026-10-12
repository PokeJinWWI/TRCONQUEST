// What the running economy says a body's world has: developed district levels, district levels on order and buildings.
// The ONE reader the placement ledger reconciles against (scene/placementOrders) and seeds from (scene/seedPlacementOrders).
import { districtLevels } from '../economy/districts'
import { districtsOf } from '../economy-abstract/abstractEconomy'
import { SIMPLE_BUILDINGS } from '../data/simplisticEconomyData'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { useTerritoryStore } from '../state/territoryStore'
import type { EconomyMode } from './districtSites'

export function hasWorld(bodyName: string, mode: EconomyMode): boolean {
  return mode === 'simple' ? !!useAbstractEconomyStore.getState().worlds[bodyName] : !!worldByName(useEconomyStore.getState().worlds, bodyName)
}

// Developed district levels per district id (every district the economy has).
export function worldLevels(bodyName: string, mode: EconomyMode): Record<string, number> {
  if (mode === 'simple') {
    const w = useAbstractEconomyStore.getState().worlds[bodyName]
    return w ? { ...districtsOf(w) } : {}
  }
  const w = worldByName(useEconomyStore.getState().worlds, bodyName)
  return w ? { ...districtLevels(w) } : {}
}

// District levels still on order (they count toward what may be placed).
export function queuedLevels(bodyName: string, mode: EconomyMode): Record<string, number> {
  const out: Record<string, number> = {}
  if (mode === 'simple') {
    const owner = useTerritoryStore.getState().bodyOwner[bodyName]
    for (const o of owner ? (useAbstractEconomyStore.getState().byCountry[owner]?.queue ?? []) : []) if (o.bodyName === bodyName && o.district) out[o.district] = (out[o.district] ?? 0) + 1
  } else {
    const w = worldByName(useEconomyStore.getState().worlds, bodyName)
    for (const o of w?.constructionQueue ?? []) if (o.district) out[o.district] = (out[o.district] ?? 0) + 1
  }
  return out
}

// Buildings the world has built, by building (Simple) or recipe (Complex) id, as units of level.
export function worldBuildings(bodyName: string, mode: EconomyMode): { id: string; count: number }[] {
  if (mode === 'simple') {
    const w = useAbstractEconomyStore.getState().worlds[bodyName]
    return w ? SIMPLE_BUILDINGS.map((id) => ({ id, count: w.buildings[id] ?? 0 })).filter((b) => b.count > 0) : []
  }
  const w = worldByName(useEconomyStore.getState().worlds, bodyName)
  const counts = new Map<string, number>()
  for (const b of w?.buildings ?? []) counts.set(b.recipeId, (counts.get(b.recipeId) ?? 0) + b.level)
  return [...counts].map(([id, count]) => ({ id, count }))
}
