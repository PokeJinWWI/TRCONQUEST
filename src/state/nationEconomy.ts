// A thin adapter over whichever economy this game runs (Simple or Complex) —
// for mode-agnostic systems (foreign buildings) that need a nation's GDP and
// treasury, one world's GDP, and its free Urban district slots.
import { economyModel } from './playerStore'
import { useAbstractEconomyStore } from './abstractEconomyStore'
import { useEconomyStore, worldByName } from './economyStore'
import { useTerritoryStore } from './territoryStore'
import { useDiplomacyStore, atWar } from './diplomacyStore'
import { abstractReport, freeSlots } from '../economy-abstract/abstractEconomy'
import { stockOf } from './abstractEconomyStore'
import { districtUsage, estimateWorldGdp, TICKS_PER_YEAR } from '../economy/economyTick'
import { relationIn } from './diplomacyStore'
import { COUNTRIES } from '../data/countryData'
import type { HoldingContext } from '../scene/holdings'

const simple = () => economyModel() === 'abstract'

export function gdpYearOf(countryId: string): number {
  if (simple()) return useAbstractEconomyStore.getState().byCountry[countryId]?.gdp ?? 0
  return (useEconomyStore.getState().countryReports[countryId]?.gdp ?? 0) * TICKS_PER_YEAR
}

export function treasuryOf(countryId: string): number {
  if (simple()) return useAbstractEconomyStore.getState().byCountry[countryId]?.treasury ?? 0
  return useEconomyStore.getState().countries.find((c) => c.id === countryId)?.treasury ?? 0
}

export function adjustTreasury(countryId: string, amount: number): void {
  if (simple()) useAbstractEconomyStore.getState().adjustTreasury(countryId, amount)
  else useEconomyStore.getState().adjustTreasury(countryId, amount)
}

export function worldGdpYearOf(bodyName: string): number {
  if (simple()) {
    const st = useAbstractEconomyStore.getState()
    const w = st.worlds[bodyName]
    const owner = useTerritoryStore.getState().bodyOwner[bodyName]
    const nation = owner ? st.byCountry[owner] : undefined
    return w && nation ? abstractReport(nation, [w], stockOf(owner!)).gdp : 0
  }
  const w = worldByName(useEconomyStore.getState().worlds, bodyName)
  return w ? estimateWorldGdp(w) * TICKS_PER_YEAR : 0
}

export function freeUrbanSlots(bodyName: string): number {
  if (simple()) {
    const st = useAbstractEconomyStore.getState()
    const w = st.worlds[bodyName]
    const owner = useTerritoryStore.getState().bodyOwner[bodyName]
    if (!w || !owner) return 0
    return freeSlots(w, st.byCountry[owner]?.queue ?? [], 'urban')
  }
  const w = worldByName(useEconomyStore.getState().worlds, bodyName)
  return w ? w.districtCapacity.urban - districtUsage(w).urban : 0
}

export function holdingContext(): HoldingContext {
  const owners = useTerritoryStore.getState().bodyOwner
  const relations = useDiplomacyStore.getState().relations
  return {
    owners,
    capitalOf: (id) => COUNTRIES.find((c) => c.id === id)?.capitalBodyName,
    atWar,
    freeUrbanSlots,
    treasuryOf,
    gdpYearOf,
    worldGdpYearOf,
    opinionOf: (from, to) => relationIn(relations, from, to).opinion,
  }
}
