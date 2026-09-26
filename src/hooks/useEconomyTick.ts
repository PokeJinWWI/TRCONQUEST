import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useEconomyStore } from '../state/economyStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { economyModel, isSandbox, usePlayerStore } from '../state/playerStore'
import { atWar } from '../state/diplomacyStore'
import { applyAbstractEconomyAI } from '../economy-abstract/abstractEconomyAI'

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
      // The clock went backwards (a fresh game after quitting to the menu):
      // re-anchor to it rather than wait for it to pass the old time.
      if (elapsed < 0) {
        lastTickSimDays = state.simDays
        return
      }
      if (elapsed < SIM_DAYS_PER_ECONOMY_TICK) return
      const ticks = Math.floor(elapsed / SIM_DAYS_PER_ECONOMY_TICK)
      lastTickSimDays += ticks * SIM_DAYS_PER_ECONOMY_TICK
      // Advance whichever economic model this game runs (chosen at the menu).
      if (economyModel() === 'abstract') {
        // Simple mode: the store runs every nation's month, writing its
        // goods into the resourceStore stockpile and its research into the tech
        // trees. Every nation but the player's runs its own economy. Nothing in
        // the sandbox, where there are no nations.
        if (isSandbox()) return
        const store = useAbstractEconomyStore.getState()
        const playerId = usePlayerStore.getState().selectedCountryId
        const nations = Object.keys(store.byCountry)
        store.advance(ticks, (s, env) =>
          s.countryId === playerId ? s : applyAbstractEconomyAI(s, { ...env, atWar: nations.some((other) => atWar(s.countryId, other)) }),
        )
      } else useEconomyStore.getState().advance(ticks)
    })
  }, [])
}
