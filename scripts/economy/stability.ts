// Five years of an economy, judged by the bounds tests/complexStability.test.ts
// holds the four nations to: no year of collapse (real output never falls more
// than 6%), the budget in bounds (deficit <= 8%, surplus <= 15% of GDP), prices
// anchored (under 15% a year from year 1 to 2 on), most of the formal labour
// force employed (>= 80% to year 3, >= 75% after). Shared by the empires' test
// and their calibration (calibrate.ts --empires), which picks the starting
// prices and tax rates that violate these the least.
import { runEconomySteps, type EconomyStepInput } from '../../src/economy/economyStep'
import { getMethod } from '../../src/economy/recipes'
import { GOODS } from '../../src/economy/goods'
import type { Bank, Corporation, Country, World } from '../../src/economy/economyTypes'

export interface EconomyState {
  countries: Country[]
  worlds: World[]
  corporations: Corporation[]
  banks: Bank[]
}

export type Violation = 'collapse' | 'budget' | 'prices' | 'jobs'
export interface Verdict {
  // Per nation, what it breaks and the yearly figures behind it.
  failing: Record<string, { kind: Violation; detail: string }[]>
  // Every year's figures, per nation (for the report).
  years: Record<string, { real: number; nominal: number; balance: number; priceLevel: number; employed: number; workers: number }[]>
  // Months where something went NaN or infinite.
  nonFinite: number
  // Wall-clock ms of each month's tick (all nations together).
  tickMs: number[]
}

export function realOutput(worlds: World[], id: string): number {
  let v = 0
  for (const w of worlds) {
    if (w.ownerId !== id) continue
    for (const b of w.buildings) {
      const m = getMethod(b.recipeId, b.methodId)
      if (m) for (const o of m.outputs) v += o.amount * b.level * b.throughput * GOODS[o.good].basePrice
    }
  }
  return v
}

const pct = (xs: number[]) => xs.map((x) => `${(x * 100).toFixed(1)}%`).join(' ')

export function measureStability(start: EconomyState, extra: Pick<EconomyStepInput, 'humanCountryIds' | 'warPairs' | 'tradeGroups'>, yearCount = 5): Verdict {
  let state = start
  const ids = start.countries.map((c) => c.id)
  const years: Verdict['years'] = Object.fromEntries(ids.map((id) => [id, []]))
  const tickMs: number[] = []
  let nonFinite = 0
  for (let y = 0; y < yearCount; y++) {
    const acc = Object.fromEntries(ids.map((id) => [id, { real: 0, nominal: 0, balance: 0, priceLevel: 0, employed: 0, workers: 0 }]))
    for (let m = 0; m < 12; m++) {
      const t0 = performance.now()
      const out = runEconomySteps({ ...state, startTick: y * 12 + m, steps: 1, ...extra })
      tickMs.push(performance.now() - t0)
      state = { countries: out.countries, worlds: out.worlds, corporations: out.corporations, banks: out.banks }
      for (const id of ids) {
        const a = acc[id]
        const f = out.countryReports[id]
        a.real += realOutput(state.worlds, id)
        a.nominal += f.gdp
        a.balance += f.balance
        a.priceLevel += f.priceLevel / 12
        for (const w of state.worlds) {
          if (w.ownerId !== id) continue
          for (const [cls, l] of Object.entries(out.worldReports[w.id]?.labor ?? {})) {
            if (cls === 'subsistence' || cls === 'investor') continue
            a.workers += l.workers
            a.employed += l.workers * l.employmentRate
          }
        }
      }
      if (!Number.isFinite(out.countries.reduce((s, c) => s + c.treasury, 0)) || out.worlds.some((w) => w.pops.some((p) => !Number.isFinite(p.populationSize)))) nonFinite++
    }
    for (const id of ids) years[id].push(acc[id])
  }
  const failing: Verdict['failing'] = {}
  for (const id of ids) {
    const ys = years[id]
    const growth = ys.slice(1).map((y, i) => y.real / ys[i].real - 1)
    const balances = ys.slice(1).map((y) => y.balance / y.nominal)
    const inflation = ys.slice(1).map((y, i) => y.priceLevel / ys[i].priceLevel - 1)
    const employment = ys.map((y) => y.employed / Math.max(1, y.workers))
    const bad: { kind: Violation; detail: string }[] = []
    if (!growth.every((g) => g > -0.06)) bad.push({ kind: 'collapse', detail: pct(growth) })
    if (!balances.every((d) => d >= -0.08 && d <= 0.15)) bad.push({ kind: 'budget', detail: pct(balances) })
    if (!inflation.every((i) => Math.abs(i) < 0.15)) bad.push({ kind: 'prices', detail: pct(inflation) })
    if (!employment.every((e, i) => e >= (i < 3 ? 0.8 : 0.75))) bad.push({ kind: 'jobs', detail: pct(employment) })
    if (bad.length) failing[id] = bad
  }
  return { failing, years, nonFinite, tickMs }
}
