import { create } from 'zustand'
import { seedEconomy } from '../economy/economySeed'
import { tickEconomy } from '../economy/economyTick'
import type { EconomyState, PlanetEconomy, TickReport } from '../economy/economyTypes'

// The live economy simulation as session state. The sim itself is pure (see
// economyTick.ts); this store just holds the current state and advances it,
// driven by the game clock (see useEconomyTick). Session-only, no persistence,
// same as every other store here.
interface EconomyStore extends EconomyState {
  // Last tick's per-planet diagnostics (prices/labor breakdown), kept so the
  // UI can show what just happened without re-deriving it.
  reports: Record<string, TickReport>
  advance: (ticks: number) => void
}

const MAX_CATCH_UP_TICKS = 40

export const useEconomyStore = create<EconomyStore>((set) => ({
  planets: seedEconomy(),
  tick: 0,
  reports: {},
  advance: (ticks: number) =>
    set((state) => {
      const steps = Math.max(0, Math.min(MAX_CATCH_UP_TICKS, Math.floor(ticks)))
      if (steps === 0) return state
      let planets = state.planets
      let reports = state.reports
      for (let i = 0; i < steps; i++) {
        const result = tickEconomy(planets)
        planets = result.planets
        reports = result.reports
      }
      return { planets, tick: state.tick + steps, reports }
    }),
}))

// The economy for a given planet by name (e.g. 'Mars'), or undefined if that
// planet has no economy yet (only the three seed worlds do in Milestone 1).
export function planetEconomy(planets: PlanetEconomy[], planetName: string | undefined): PlanetEconomy | undefined {
  if (!planetName) return undefined
  return planets.find((p) => p.id === planetName)
}
