import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useEconomyStore } from '../state/economyStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useResourceStore } from '../state/resourceStore'
import { economyModel } from '../state/playerStore'
import { abstractResourceFlows } from '../economy-abstract/abstractResources'
import type { ResourceId } from '../data/resourceData'

// How many sim-days pass per economy tick. The economy moves at a coarse,
// strategic cadence — ONE TICK PER IN-GAME MONTH — rather than every frame. It's
// a slow macro simulation, not a per-frame physics loop, so 12 ticks make a
// year (see TICKS_PER_YEAR in economyTick, kept in step).
const SIM_DAYS_PER_ECONOMY_TICK = 30

// Advances the economy off the game clock, the same subscribe-to-simDays
// pattern useShipDriftIntegrator uses. Whole ticks only — it accumulates game
// time and fires one economy tick per SIM_DAYS_PER_ECONOMY_TICK elapsed, with
// the store's own bounded catch-up guarding against a big time jump trying to
// run thousands of ticks at once.
export function useEconomyTick() {
  useEffect(() => {
    let lastTickSimDays = useGameTimeStore.getState().simDays
    return useGameTimeStore.subscribe((state) => {
      const elapsed = state.simDays - lastTickSimDays
      if (elapsed < SIM_DAYS_PER_ECONOMY_TICK) return
      const ticks = Math.floor(elapsed / SIM_DAYS_PER_ECONOMY_TICK)
      lastTickSimDays += ticks * SIM_DAYS_PER_ECONOMY_TICK
      // Advance whichever economic model this game runs (chosen at the menu).
      if (economyModel() === 'abstract') {
        const store = useAbstractEconomyStore.getState()
        store.advance(ticks)
        // Payment link: turn each nation's production into the strategic
        // resources ships/armies are paid for with (useStrategicResources'
        // flat placeholder is gated off in this mode). setMonthlyDelta powers
        // the HUD "/mo" read; addAmount credits the whole elapsed span.
        const res = useResourceStore.getState()
        const reports = useAbstractEconomyStore.getState().reports
        const byCountry = useAbstractEconomyStore.getState().byCountry
        for (const id of Object.keys(reports)) {
          const flows = abstractResourceFlows(reports[id], byCountry[id]?.gdp ?? 0)
          for (const [rid, perMonth] of Object.entries(flows) as [ResourceId, number][]) {
            res.setMonthlyDelta(id, rid, perMonth)
            res.addAmount(id, rid, perMonth * ticks)
          }
        }
      } else useEconomyStore.getState().advance(ticks)
    })
  }, [])
}
