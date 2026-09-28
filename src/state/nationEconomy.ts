// A thin adapter over whichever economy this game runs (Simple or Complex) —
// for mode-agnostic systems (foreign buildings) that need a nation's GDP and
// treasury, one world's GDP, and its free Urban district slots.
import { economyModel } from './playerStore'
import { useAbstractEconomyStore } from './abstractEconomyStore'
import { useEconomyStore, worldByName } from './economyStore'
import { useTerritoryStore } from './territoryStore'
import { useDiplomacyStore, atWar } from './diplomacyStore'
import { abstractReport, districtSlots, freeSlots } from '../economy-abstract/abstractEconomy'
import { stockOf } from './abstractEconomyStore'
import { districtUsage, estimateWorldGdp, TICKS_PER_YEAR } from '../economy/economyTick'
import { relationIn } from './diplomacyStore'
import { COUNTRIES, getCountry } from '../data/countryData'
import type { HoldingContext } from '../scene/holdings'
import type { SpaceportSite } from '../scene/spaceportSites'
import { treatyPortOperatorOf } from './treatyStore'

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

// Military district slots on a world (both modes): how many its levels offer.
// What's in them is the defense store's (planetary defenses of the military
// kinds), so the caller counts those itself.
export function militarySlotsOf(bodyName: string): number {
  if (simple()) {
    const w = useAbstractEconomyStore.getState().worlds[bodyName]
    return w ? districtSlots(w, 'military') : 0
  }
  const w = worldByName(useEconomyStore.getState().worlds, bodyName)
  return w ? w.districtCapacity.military ?? 0 : 0
}

// A world's spaceports, as its economy runs them (scene/spaceportSites.ts puts
// each on the ground map as a key node): Complex — one per spaceport building,
// run by the state or a company; Simple — one per level of its spaceport
// building. None without an economy world here.
export function spaceportSitesOf(bodyName: string): SpaceportSite[] {
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  const nation = owner ? getCountry(owner)?.name ?? owner : 'the state'
  const sites = (() => {
    if (simple()) {
      const w = useAbstractEconomyStore.getState().worlds[bodyName]
      const n = w?.buildings.spaceport ?? 0
      return Array.from({ length: n }, () => ({ operator: 'state', operatorName: `${nation} (state)` }))
    }
    const st = useEconomyStore.getState()
    const w = worldByName(st.worlds, bodyName)
    if (!w) return []
    return w.buildings
      .filter((b) => b.recipeId === 'spaceport')
      .map((b) => {
        if (b.owner.kind === 'corporation') {
          const id = b.owner.corporationId
          return { operator: id, operatorName: st.corporations.find((c) => c.id === id)?.name ?? id }
        }
        return { operator: 'state', operatorName: b.owner.kind === 'worker' ? 'its workers (co-op)' : `${nation} (state)` }
      })
  })()
  // A treaty port cedes operating rights over the body's FIRST spaceport site
  // (sites carry no id to target a particular one more precisely) to a
  // foreign nation — a foothold with no territory changing hands.
  const treatyOperatorId = treatyPortOperatorOf(bodyName)
  if (treatyOperatorId && sites.length > 0) {
    const name = getCountry(treatyOperatorId)?.name ?? treatyOperatorId
    sites[0] = { operator: treatyOperatorId, operatorName: `${name} (treaty port)` }
  }
  return sites
}

// Tell both economies how many military slots each world's defenses take.
export function syncMilitarySlots(byBody: Record<string, number>): void {
  if (simple()) useAbstractEconomyStore.getState().setMilitarySlots(byBody)
  else useEconomyStore.getState().setMilitarySlots(byBody)
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
