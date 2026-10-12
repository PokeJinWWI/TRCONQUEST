// One way to pay for a state project in either economy (the shipyard's rule): Complex mode spends
// the economy's goods from the nation's capital stockpile, Simple mode (and a faction with no
// capital world) the strategic pool. Routes (scene/infrastructureOrders) and orbital facilities
// (scene/orbitalOrders) both pay through this.
import type { GoodCost, ResourceCost } from '../data/shipyardData'
import { isAbstractEconomy } from '../state/playerStore'
import { useResourceStore } from '../state/resourceStore'
import { capitalStockpileOf, capitalWorldIdOf, missingEconomyGoods, missingResources, spendCost, spendEconomyCost } from './shipyardLogic'

export const paysFromEconomy = (countryId: string): boolean => !isAbstractEconomy() && capitalWorldIdOf(countryId) !== null

// Labels of what the nation is short of for this cost; empty = it can pay.
export function shortOf(countryId: string, goods: GoodCost, resources: ResourceCost): string[] {
  return paysFromEconomy(countryId) ? missingEconomyGoods(goods, capitalStockpileOf(countryId)) : missingResources(resources, useResourceStore.getState().stateFor(countryId).amounts)
}

export function pay(countryId: string, goods: GoodCost, resources: ResourceCost): void {
  if (paysFromEconomy(countryId)) spendEconomyCost(countryId, goods)
  else spendCost(countryId, resources)
}
