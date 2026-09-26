import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerStore } from '../state/playerStore'
import { COUNTRIES } from '../data/countryData'
import { SIM_DAYS_PER_INCOME_TICK } from '../data/shipyardData'
import { applyStrategicIncome, seedSimplisticStock, seedStrategicResources } from '../scene/shipyardLogic'

// Feeds EVERY nation's strategic stockpile (alloys, exotic matter,
// hyperium…) with the PLACEHOLDER supply in data/shipyardData.ts: a starting
// reserve the moment the game starts (a nation is picked), then a flat
// monthly income — one whole tick per SIM_DAYS_PER_INCOME_TICK, the same
// cadence useEconomyTick runs at. AI empires get exactly the same supply the
// player does. Goes away when a real production chain replaces it.
export function useStrategicResources() {
  useEffect(() => {
    const seedAll = () => {
      for (const country of COUNTRIES) {
        seedStrategicResources(country.id)
        // Simple mode's civilian goods (food, consumer goods, electronics).
        if (usePlayerStore.getState().economyModel === 'abstract') seedSimplisticStock(country.id)
      }
    }
    const started = () => {
      const { selectedCountryId, sandbox } = usePlayerStore.getState()
      return !!selectedCountryId && !sandbox
    }
    if (started()) seedAll()
    const unsubPlayer = usePlayerStore.subscribe((state, prev) => {
      if (state.selectedCountryId && !state.sandbox && state.selectedCountryId !== prev.selectedCountryId) seedAll()
    })

    let lastTickSimDays = useGameTimeStore.getState().simDays
    const unsubTime = useGameTimeStore.subscribe((state) => {
      const elapsed = state.simDays - lastTickSimDays
      // Clock reset (e.g. a fresh session) — re-anchor rather than wait.
      if (elapsed < 0) {
        lastTickSimDays = state.simDays
        return
      }
      if (elapsed < SIM_DAYS_PER_INCOME_TICK) return
      const ticks = Math.floor(elapsed / SIM_DAYS_PER_INCOME_TICK)
      lastTickSimDays += ticks * SIM_DAYS_PER_INCOME_TICK
      if (!started()) return
      // In Simple mode the resources come from that economy's buildings
      // (see useEconomyTick), not this flat placeholder.
      if (usePlayerStore.getState().economyModel === 'abstract') return
      for (const country of COUNTRIES) applyStrategicIncome(country.id, ticks)
    })
    return () => {
      unsubPlayer()
      unsubTime()
    }
  }, [])
}
