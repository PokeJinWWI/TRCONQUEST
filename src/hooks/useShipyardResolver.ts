import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { useShipyardStore } from '../state/shipyardStore'
import { COUNTRIES } from '../data/countryData'
import { shipyardSlotsForWorld, spawnBuiltShip, stepShipyardQueue } from '../scene/shipyardLogic'

// One step of every nation's shipyard up to `simDays` — exported so a
// headless run (tests) can drive it without React.
export function resolveShipyards(simDays: number): void {
  const { ordersFor, setOrders } = useShipyardStore.getState()
  for (const country of COUNTRIES) {
    const orders = ordersFor(country.id)
    if (orders.length === 0) continue

    const world = worldByName(useEconomyStore.getState().worlds, country.capitalBodyName)
    const step = stepShipyardQueue(orders, shipyardSlotsForWorld(world), simDays)
    const changed = step.completed.length > 0 || step.orders.some((o, i) => o.startedSimDays !== orders[i]?.startedSimDays)
    if (!changed) continue

    setOrders(country.id, step.orders)
    for (const done of step.completed) spawnBuiltShip(done, country)
  }
}

// Runs EVERY nation's capital shipyard off the game clock — the player's and
// each AI empire's alike: starts waiting builds as slots open, and puts each
// finished hull into orbit around its own nation's capital, owned by that
// nation. Subscribes to simDays the same way useCommsResolver/
// useShipOrderSettler do, so it keeps building whichever view is mounted.
export function useShipyardResolver() {
  useEffect(() => {
    resolveShipyards(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolveShipyards(state.simDays))
  }, [])
}
