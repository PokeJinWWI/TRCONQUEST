// The people living on a body, in the running economy (millions). Its own small module so scene code that only needs the number
// (footprints) does not pull in the placement and jurisdiction layers.
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { isAbstractEconomy } from '../state/playerStore'

export function bodyPopulation(bodyName: string): number {
  if (isAbstractEconomy()) return useAbstractEconomyStore.getState().worlds[bodyName]?.population ?? 0
  return worldByName(useEconomyStore.getState().worlds, bodyName)?.pops.reduce((n, p) => n + p.populationSize, 0) ?? 0
}
