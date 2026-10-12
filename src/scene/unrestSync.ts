// Hands each nation's current unrest (state/unrestStore) to the economy that runs it, at the start of every month with the rest
// of the main-thread facts (scene/infrastructureOrders.syncSiteAccess). Nothing is written while nobody has any.
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore } from '../state/economyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { isAbstractEconomy } from '../state/playerStore'
import { unrestNow, useUnrestStore } from '../state/unrestStore'

export function syncUnrest(): void {
  const now = useGameTimeStore.getState().simDays
  const store = useUnrestStore.getState()
  const nations = Object.keys(store.byNation)
  const byCountry: Record<string, number> = {}
  for (const id of nations) {
    const v = unrestNow(id, now, store.byNation)
    if (v > 0) byCountry[id] = v
  }
  if (isAbstractEconomy()) useAbstractEconomyStore.getState().setDisplacedUnrest(byCountry)
  else useEconomyStore.getState().setDisplacedUnrest(byCountry)
  if (nations.length > 0) store.prune(now)
}
