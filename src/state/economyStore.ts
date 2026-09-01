import { create } from 'zustand'
import { seedWorlds, seedCountries } from '../economy/economySeed'
import { tickEconomy, constructionCost } from '../economy/economyTick'
import type { Country, CountryFiscal, World, WorldReport } from '../economy/economyTypes'

// One sampled point of a country's headline fiscal metrics, appended each tick
// — the series the finance graphs plot.
export interface FiscalSample {
  gdp: number
  priceLevel: number
  inflation: number
  revenue: number
  expenditure: number
  debtToGdp: number
  treasury: number
}

const HISTORY_LENGTH = 104
const MAX_CATCH_UP_TICKS = 40

interface EconomyStore {
  countries: Country[]
  worlds: World[]
  tick: number
  worldReports: Record<string, WorldReport>
  countryReports: Record<string, CountryFiscal>
  // Per-country fiscal history, oldest first.
  history: Record<string, FiscalSample[]>
  advance: (ticks: number) => void
  setTaxRate: (countryId: string, rate: number) => void
  setWelfare: (countryId: string, perCapita: number) => void
  queueConstruction: (worldId: string, recipeId: string) => void
  cancelConstruction: (worldId: string, orderId: string) => void
}

let constructionCounter = 0

function sampleOf(f: CountryFiscal): FiscalSample {
  return {
    gdp: f.gdp,
    priceLevel: f.priceLevel,
    inflation: f.inflation,
    revenue: f.revenue,
    expenditure: f.expenditure,
    debtToGdp: f.debtToGdp,
    treasury: f.treasury,
  }
}

export const useEconomyStore = create<EconomyStore>((set) => ({
  countries: seedCountries(),
  worlds: seedWorlds(),
  tick: 0,
  worldReports: {},
  countryReports: {},
  history: {},
  advance: (ticks) =>
    set((state) => {
      const steps = Math.max(0, Math.min(MAX_CATCH_UP_TICKS, Math.floor(ticks)))
      if (steps === 0) return state
      let countries = state.countries
      let worlds = state.worlds
      let worldReports = state.worldReports
      let countryReports = state.countryReports
      const history: Record<string, FiscalSample[]> = { ...state.history }
      for (let i = 0; i < steps; i++) {
        const res = tickEconomy(countries, worlds)
        countries = res.countries
        worlds = res.worlds
        worldReports = res.reports.worlds
        countryReports = res.reports.countries
        for (const c of countries) {
          const series = history[c.id] ? [...history[c.id]] : []
          series.push(sampleOf(countryReports[c.id]))
          if (series.length > HISTORY_LENGTH) series.splice(0, series.length - HISTORY_LENGTH)
          history[c.id] = series
        }
      }
      return { countries, worlds, worldReports, countryReports, history, tick: state.tick + steps }
    }),
  setTaxRate: (countryId, rate) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === countryId ? { ...c, taxRate: Math.max(0, Math.min(0.6, rate)) } : c)),
    })),
  setWelfare: (countryId, perCapita) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === countryId ? { ...c, welfarePerCapita: Math.max(0, Math.min(3, perCapita)) } : c)),
    })),
  queueConstruction: (worldId, recipeId) =>
    set((state) => ({
      worlds: state.worlds.map((w) => {
        if (w.id !== worldId) return w
        constructionCounter += 1
        const order = { id: `con-${worldId}-${recipeId}-${constructionCounter}`, recipeId, cost: constructionCost(), progress: 0 }
        return { ...w, constructionQueue: [...w.constructionQueue, order] }
      }),
    })),
  cancelConstruction: (worldId, orderId) =>
    set((state) => ({
      worlds: state.worlds.map((w) =>
        w.id === worldId ? { ...w, constructionQueue: w.constructionQueue.filter((o) => o.id !== orderId) } : w,
      ),
    })),
}))

// The World for a given body name (e.g. 'Mars'), or undefined if uninhabited.
export function worldByName(worlds: World[], name: string | undefined): World | undefined {
  if (!name) return undefined
  return worlds.find((w) => w.id === name)
}
