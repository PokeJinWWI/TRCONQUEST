// Where research pays for the resources a tech consumes. In Simple mode that is
// the strategic resourceStore pool (and the deposit/extraction system behind it).
// In COMPLEX mode exotic matter and hyperium are real economy goods, so research
// draws them from the nation's capital stockpile — the SAME single count the
// military shipyard spends (scene/shipyardLogic). Everything else stays in
// resourceStore. This is the one place the research system reads/spends resources,
// so there is exactly one exotic-matter and one hyperium count per mode.
import { useResourceStore } from '../state/resourceStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { economyModel } from '../state/playerStore'
import { COUNTRIES } from '../data/countryData'
import type { ResourceId } from '../data/resourceData'
import type { GoodId } from '../economy/goods'

// The resources that are economy goods in Complex mode (drawn from the capital
// stockpile) rather than strategic-pool resources.
const ECONOMY_GOOD_RESOURCES: ResourceId[] = ['exoticMatter', 'hyperium']

function complex(): boolean {
  return economyModel() === 'complex'
}

function capitalWorldId(countryId: string): string | null {
  const name = COUNTRIES.find((c) => c.id === countryId)?.capitalBodyName
  if (!name) return null
  return worldByName(useEconomyStore.getState().worlds, name)?.id ?? null
}

function capitalStockpile(countryId: string): Partial<Record<GoodId, number>> {
  const name = COUNTRIES.find((c) => c.id === countryId)?.capitalBodyName
  if (!name) return {}
  return worldByName(useEconomyStore.getState().worlds, name)?.stockpiles ?? {}
}

// The amounts a tech's resourceCost / resourceHold is checked against: in Complex,
// exotic matter and hyperium come from the capital economy stockpile; the rest
// (and everything in Simple mode) from resourceStore.
export function researchResourceAmounts(countryId: string): Record<ResourceId, number> {
  const strategic = useResourceStore.getState().stateFor(countryId).amounts
  if (!complex()) return strategic
  const stock = capitalStockpile(countryId)
  const merged = { ...strategic }
  for (const id of ECONOMY_GOOD_RESOURCES) merged[id] = stock[id as GoodId] ?? 0
  return merged
}

// Spend a tech's resourceCost: in Complex, exotic matter and hyperium come out of
// the capital economy stockpile, everything else out of resourceStore.
export function spendResearchResources(countryId: string, cost: Partial<Record<ResourceId, number>>): void {
  const useEconomy = complex()
  const res = useResourceStore.getState()
  const econGoods: Partial<Record<GoodId, number>> = {}
  for (const [id, n] of Object.entries(cost) as [ResourceId, number][]) {
    if (useEconomy && ECONOMY_GOOD_RESOURCES.includes(id)) econGoods[id as GoodId] = (econGoods[id as GoodId] ?? 0) + n
    else res.addAmount(countryId, id, -n)
  }
  if (useEconomy && Object.keys(econGoods).length > 0) {
    const wid = capitalWorldId(countryId)
    if (wid) useEconomyStore.getState().consumeStockpile(wid, econGoods)
  }
}
