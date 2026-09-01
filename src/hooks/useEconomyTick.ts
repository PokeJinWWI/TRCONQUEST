import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useEconomyStore } from '../state/economyStore'

// How many sim-days pass per economy tick. The economy moves at a coarse,
// strategic cadence (one tick a week or so of game time) rather than every
// frame — it's a slow macro simulation, not a per-frame physics loop, and
// this keeps it cheap regardless of how fast the clock is running.
const SIM_DAYS_PER_ECONOMY_TICK = 7

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
      useEconomyStore.getState().advance(ticks)
    })
  }, [])
}
