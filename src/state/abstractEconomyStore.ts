import { create } from 'zustand'
import {
  tickAbstractEconomy,
  abstractReport,
  normalizeAllocation,
  type AbstractEconomyState,
  type AbstractReport,
  type Allocation,
  type EconomyType,
} from '../economy-abstract/abstractEconomy'

// The Abstract-Simplistic economy store (one macro state per nation). Only used
// when the game was started on the 'abstract' economy model (see playerStore);
// the deep economyStore is untouched and simply idle in that mode.

const MAX_CATCH_UP_TICKS = 40

// One point of a nation's macro history — for the panel's inflation / GDP /
// debt-to-GDP sparklines.
export interface AbstractHistoryPoint {
  gdp: number
  inflation: number
  debtToGdp: number
}
const HISTORY_LENGTH = 36

function seed(): Record<string, AbstractEconomyState> {
  const mk = (
    countryId: string,
    population: number,
    gdp: number,
    treasury: number,
    debt: number,
    taxRate: number,
    economyType: EconomyType,
    allocation: Allocation,
    stability = 0.6,
  ): AbstractEconomyState => ({ countryId, population, gdp, inflation: 0.02, stability, treasury, reserves: 40, debt, taxRate, economyType, moneyCreation: 0, warTaxes: false, allocation })
  const states: AbstractEconomyState[] = [
    mk('imperial-state-of-mars', 4000, 8000, 200, 2000, 0.1, 'corporatist', { civilian: 0.5, military: 0.2, consumer: 0.3 }),
    mk('republic-of-venus', 3000, 6500, 150, 1400, 0.12, 'market', { civilian: 0.5, military: 0.15, consumer: 0.35 }, 0.65),
    mk('orion-republic', 1500, 3500, 90, 600, 0.09, 'market', { civilian: 0.55, military: 0.15, consumer: 0.3 }),
    mk('kingdom-of-lalande', 2000, 3000, 60, 1200, 0.1, 'planned', { civilian: 0.4, military: 0.35, consumer: 0.25 }, 0.55),
  ]
  return Object.fromEntries(states.map((s) => [s.countryId, s]))
}

interface AbstractEconomyStore {
  byCountry: Record<string, AbstractEconomyState>
  reports: Record<string, AbstractReport>
  history: Record<string, AbstractHistoryPoint[]>
  advance: (ticks: number) => void
  setTaxRate: (countryId: string, rate: number) => void
  setEconomyType: (countryId: string, type: EconomyType) => void
  setMoneyCreation: (countryId: string, rate: number) => void
  setWarTaxes: (countryId: string, on: boolean) => void
  // Move cash between the treasury and the reserves buffer, or pay down debt
  // from either. Amounts are $B.
  invest: (countryId: string, amount: number) => void
  payDebt: (countryId: string, amount: number) => void
  // Set one leg of the production split; the store re-normalizes so the three
  // always sum to 1.
  setAllocation: (countryId: string, leg: keyof Allocation, value: number) => void
}

export const useAbstractEconomyStore = create<AbstractEconomyStore>((set) => ({
  byCountry: seed(),
  reports: Object.fromEntries(Object.entries(seed()).map(([id, s]) => [id, abstractReport(s)])),
  history: Object.fromEntries(Object.keys(seed()).map((id) => [id, []])),
  advance: (ticks) =>
    set((store) => {
      const steps = Math.max(0, Math.min(MAX_CATCH_UP_TICKS, Math.floor(ticks)))
      if (steps === 0) return store
      const byCountry = { ...store.byCountry }
      const reports = { ...store.reports }
      const history = { ...store.history }
      for (const id of Object.keys(byCountry)) {
        let s = byCountry[id]
        let r = reports[id]
        const series = history[id] ? [...history[id]] : []
        for (let i = 0; i < steps; i++) {
          const res = tickAbstractEconomy(s)
          s = res.state
          r = res.report
          series.push({ gdp: s.gdp, inflation: s.inflation, debtToGdp: r.debtToGdp })
        }
        if (series.length > HISTORY_LENGTH) series.splice(0, series.length - HISTORY_LENGTH)
        byCountry[id] = s
        reports[id] = r
        history[id] = series
      }
      return { byCountry, reports, history }
    }),
  setTaxRate: (countryId, rate) =>
    set((s) => patch(s, countryId, (c) => ({ ...c, taxRate: Math.max(0, Math.min(0.6, rate)) }))),
  setEconomyType: (countryId, type) => set((s) => patch(s, countryId, (c) => ({ ...c, economyType: type }))),
  setMoneyCreation: (countryId, rate) => set((s) => patch(s, countryId, (c) => ({ ...c, moneyCreation: Math.max(0, Math.min(1, rate)) }))),
  setWarTaxes: (countryId, on) => set((s) => patch(s, countryId, (c) => ({ ...c, warTaxes: on }))),
  invest: (countryId, amount) =>
    set((s) =>
      patch(s, countryId, (c) => {
        const move = Math.max(-c.reserves, Math.min(c.treasury, amount)) // + treasury→reserves, − back
        return { ...c, treasury: c.treasury - move, reserves: c.reserves + move }
      }),
    ),
  payDebt: (countryId, amount) =>
    set((s) =>
      patch(s, countryId, (c) => {
        // Pay from reserves first, then treasury.
        let pay = Math.max(0, Math.min(c.debt, amount))
        let reserves = c.reserves
        let treasury = c.treasury
        const fromReserves = Math.min(reserves, pay)
        reserves -= fromReserves
        pay -= fromReserves
        const fromTreasury = Math.min(treasury, pay)
        treasury -= fromTreasury
        const paid = fromReserves + fromTreasury
        return { ...c, reserves, treasury, debt: c.debt - paid }
      }),
    ),
  setAllocation: (countryId, leg, value) =>
    set((s) =>
      patch(s, countryId, (c) => ({ ...c, allocation: normalizeAllocation({ ...c.allocation, [leg]: Math.max(0, value) }) })),
    ),
}))

// Apply `fn` to one country's state and refresh its report.
function patch(
  store: AbstractEconomyStore,
  countryId: string,
  fn: (c: AbstractEconomyState) => AbstractEconomyState,
): Partial<AbstractEconomyStore> {
  const cur = store.byCountry[countryId]
  if (!cur) return {}
  const next = fn(cur)
  return { byCountry: { ...store.byCountry, [countryId]: next }, reports: { ...store.reports, [countryId]: abstractReport(next) } }
}
