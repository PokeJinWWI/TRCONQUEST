// Calibrates Complex mode's starting economy against the simulation itself and
// writes src/economy/seedCalibration.ts. Run after changing the seed or the tick:
//   npx tsx scripts/economy/calibrate.ts
//
// Starting prices and wages: run two years headless with the nations' AI on,
// start from where the markets settled, run again, repeat — keeping the round
// whose first two years drift least — so the game opens at its own
// equilibrium instead of lurching toward it (prices used to sink all year 1:
// the seed opened at base prices, well above where its markets clear).
//
// `--empires` calibrates the 20 generated empires instead (economy/empireSeed),
// run alongside the four nations exactly as the game runs them (empires deal only
// within their own neighbourhood), and writes src/economy/empireCalibration.ts.
// The nations keep the calibration they ship with.

import { writeFileSync } from 'node:fs'
import { galaxyEmpires } from '../../src/data/generatedEmpires'
import { measureStability } from './stability'
import { seedEmpireEconomies } from '../../src/economy/empireSeed'
import { tickEconomy } from '../../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountriesWith, seedWorldsWith } from '../../src/economy/economySeed'
import { getMethod, POP_CLASSES, type PopClass } from '../../src/economy/recipes'
import { GOOD_IDS, GOODS, type GoodId } from '../../src/economy/goods'
import { COUNTRY_CALIBRATION, SEED_CALIBRATION, type CountryCalibration, type SeedCalibration } from '../../src/economy/seedCalibration'
import type { World } from '../../src/economy/economyTypes'

const EMPIRES = process.argv.includes('--empires')
const MONTHS = 24
const MEASURE_FROM = 13 // average months 13–24: past the first adjustments
const PRICE_ROUNDS = 6
const TARGET_DEFICIT = 0.01 // a starting tax rate opens the budget at about this deficit, of GDP
const TAX_MIN = 0.05
const TAX_MAX = 0.45

interface Measured {
  produced: Record<string, Partial<Record<GoodId, number>>>
  demand: Record<string, Partial<Record<GoodId, number>>>
  prices: Record<string, Partial<Record<GoodId, number>>>
  wages: Record<string, Partial<Record<PopClass, number>>>
  worlds: World[]
  fiscal: Record<string, { revenue: number; balance: number; gdp: number }> // monthly, months 13–24
  cpiYear1: Record<string, number>
}

function run(cal: SeedCalibration, taxes: Record<string, CountryCalibration>, enableAI: boolean): Measured {
  let countries = seedCountriesWith(EMPIRES ? COUNTRY_CALIBRATION : taxes)
  let worlds = seedWorldsWith(EMPIRES ? SEED_CALIBRATION : cal)
  let corporations = seedCorporations()
  let banks = seedBanks()
  let canTrade: ((a: string, b: string) => boolean) | undefined
  if (EMPIRES) {
    const emp = seedEmpireEconomies(galaxyEmpires(), { worlds: cal, taxRates: Object.fromEntries(Object.entries(taxes).map(([id, t]) => [id, t.taxRate!])) })
    countries = [...countries, ...emp.countries]
    worlds = [...worlds, ...emp.worlds]
    corporations = [...corporations, ...emp.corporations]
    banks = [...banks, ...emp.banks]
    canTrade = (a, b) => (emp.tradeGroups[a] ?? 'core') === (emp.tradeGroups[b] ?? 'core')
  }
  const measuredCountry = (id: string) => !EMPIRES || id.startsWith('empire-')
  const measuredWorld = (w: World) => !EMPIRES || w.ownerId.startsWith('empire-')
  const produced: Measured['produced'] = {}
  const demand: Measured['demand'] = {}
  const prices: Measured['prices'] = {}
  const wages: Measured['wages'] = {}
  const n = MONTHS - MEASURE_FROM + 1
  const cpi: Record<string, number[]> = {}
  const fiscal: Measured['fiscal'] = {}
  for (let t = 1; t <= MONTHS; t++) {
    const r = tickEconomy(countries, worlds, corporations, { tick: t, enableAI, humanCountryIds: [], canTrade }, banks)
    ;({ countries, worlds, corporations, banks } = r)
    for (const c of countries) if (measuredCountry(c.id)) (cpi[c.id] ??= []).push(r.reports.countries[c.id].priceLevel)
    if (t < MEASURE_FROM) continue
    for (const c of countries) {
      if (!measuredCountry(c.id)) continue
      const f = r.reports.countries[c.id]
      const x = (fiscal[c.id] ??= { revenue: 0, balance: 0, gdp: 0 })
      x.revenue += f.revenue / n
      x.balance += f.balance / n
      x.gdp += f.gdp / n
    }
    for (const w of worlds) {
      if (!measuredWorld(w)) continue
      const rep = r.reports.worlds[w.id]
      if (!rep) continue
      const p = (produced[w.id] ??= {})
      const d = (demand[w.id] ??= {})
      const pr = (prices[w.id] ??= {})
      const wg = (wages[w.id] ??= {})
      for (const b of w.buildings) {
        const m = getMethod(b.recipeId, b.methodId)
        if (m) for (const o of m.outputs) p[o.good] = (p[o.good] ?? 0) + (o.amount * b.level * b.throughput) / n
      }
      for (const g of GOOD_IDS) {
        d[g] = (d[g] ?? 0) + rep.goods[g].demand / n
        pr[g] = (pr[g] ?? 0) + w.market.prices[g] / n
      }
      for (const cls of POP_CLASSES) wg[cls] = (wg[cls] ?? 0) + w.labor.wages[cls] / n
    }
  }
  const cpiYear1: Record<string, number> = {}
  for (const [id, xs] of Object.entries(cpi)) {
    const y1 = xs.slice(0, 12).reduce((a, b) => a + b, 0) / 12
    const y2 = xs.slice(12, 24).reduce((a, b) => a + b, 0) / 12
    cpiYear1[id] = y2 / y1 - 1
  }
  return { produced, demand, prices, wages, worlds: worlds.filter(measuredWorld), fiscal, cpiYear1 }
}

const report = (label: string, m: Measured) => {
  const glut = m.worlds.map((w) => {
    let over = 0
    let total = 0
    for (const g of GOOD_IDS) {
      const p = m.produced[w.id]?.[g] ?? 0
      const d = m.demand[w.id]?.[g] ?? 0
      if (p <= 0) continue
      const v = p * GOODS[g].basePrice
      total += v
      if (p > d * 1.5) over += v
    }
    return `${w.name.slice(0, 8)} ${total > 0 ? Math.round((over / total) * 100) : 0}%`
  })
  console.log(`${label}: output value in glut (>1.5× demand) ${glut.join(', ')} | year-2 over year-1 prices ${Object.entries(m.cpiYear1).map(([id, v]) => `${id.slice(0, 6)} ${(v * 100).toFixed(1)}%`).join(', ')}`)
}

// --- Levels come from the seed's nation-wide balancer (economySeed). An
// earlier level stage here (resize producers to measured demand) only churned:
// trimmed a mine, the AI rebuilt it past the need, a glut followed. ---
let cal: SeedCalibration = {}
// Prices settle with the nations' AI running, as they do in a game.
const taxes: Record<string, CountryCalibration> = {}
let measured = run(cal, taxes, true)
report('seed', measured)

// --- 2. Prices and wages (keeping the round that starts steadiest) ---
const drift = (m: Measured) => Object.values(m.cpiYear1).reduce((a, v) => a + Math.abs(v), 0)
// For the empires a round is judged by how many of the four nations' stability
// bounds the empires break over FIVE years (scripts/economy/stability.ts), not by
// year-2 price drift alone: calibrating each world to where its market settled
// can chase a moving target and leave the empires worse off than the plain seed.
const score = (c: SeedCalibration, t: Record<string, CountryCalibration>): number => {
  if (!EMPIRES) return 0
  const emp = seedEmpireEconomies(galaxyEmpires(), { worlds: c, taxRates: Object.fromEntries(Object.entries(t).map(([id, x]) => [id, x.taxRate!])) })
  const verdict = measureStability(
    { countries: [...seedCountriesWith(COUNTRY_CALIBRATION), ...emp.countries], worlds: [...seedWorldsWith(SEED_CALIBRATION), ...emp.worlds], corporations: [...seedCorporations(), ...emp.corporations], banks: [...seedBanks(), ...emp.banks] },
    { humanCountryIds: [], warPairs: [], tradeGroups: emp.tradeGroups },
  )
  return Object.entries(verdict.failing).filter(([id]) => id.startsWith('empire-')).reduce((n, [, f]) => n + f.length, 0) + verdict.nonFinite * 100
}
let bestPrices = { cal: structuredClone(cal), taxes: structuredClone(taxes), drift: EMPIRES ? score(cal, taxes) : drift(measured), round: 0 }
if (EMPIRES) console.log(`  round 0 (plain seed): ${bestPrices.drift} stability violations`)
for (let round = 1; round <= PRICE_ROUNDS; round++) {
  for (const w of measured.worlds) {
    const entry = (cal[w.id] ??= {})
    entry.prices = measured.prices[w.id]
    entry.wages = measured.wages[w.id]
  }
  // Starting tax rates: raise or lower each toward opening the budget at
  // TARGET_DEFICIT of GDP (half the gap a round; revenue is only roughly
  // proportional to the rate).
  for (const [id, f] of Object.entries(measured.fiscal)) {
    const rate = taxes[id]?.taxRate ?? (EMPIRES ? seedEmpireEconomies(galaxyEmpires()).countries : seedCountriesWith({})).find((c) => c.id === id)!.taxRate
    const gap = -f.balance - TARGET_DEFICIT * f.gdp
    const wanted = f.revenue > 0 ? rate * (1 + gap / f.revenue) : rate
    taxes[id] = { taxRate: Math.round(Math.min(TAX_MAX, Math.max(TAX_MIN, rate + (wanted - rate) / 2)) * 100) / 100 }
  }
  measured = run(cal, taxes, true)
  report(`prices round ${round}`, measured)
  console.log(`  taxes ${Object.entries(taxes).map(([id, t]) => `${id.slice(0, 6)} ${t.taxRate}`).join(', ')} | budgets ${Object.entries(measured.fiscal).map(([id, f]) => `${id.slice(0, 6)} ${((f.balance / f.gdp) * 100).toFixed(1)}%`).join(', ')}`)
  const judged = EMPIRES ? score(cal, taxes) : drift(measured)
  if (EMPIRES) console.log(`  round ${round}: ${judged} stability violations`)
  if (judged < bestPrices.drift) bestPrices = { cal: structuredClone(cal), taxes: structuredClone(taxes), drift: judged, round }
}
console.log(`keeping the prices from round ${bestPrices.round}`)
cal = bestPrices.cal
const chosenTaxes = bestPrices.taxes

// --- Write ---
const sig = (x: number) => Number(x.toPrecision(4))
const worldsBody = (c: SeedCalibration) =>
  Object.entries(c)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, w]) => {
      const prices = Object.entries(w.prices ?? {}).map(([g, p]) => `${g}: ${sig(p as number)}`).join(', ')
      const wages = Object.entries(w.wages ?? {}).map(([k, v]) => `${k}: ${sig(v as number)}`).join(', ')
      return `  ${JSON.stringify(id)}: {\n    prices: { ${prices} },\n    wages: { ${wages} },\n  },`
    })
    .join('\n')
if (EMPIRES) {
  const file = `// GENERATED by scripts/economy/calibrate.ts --empires — do not edit by hand; rerun
// it (\`npx tsx scripts/economy/calibrate.ts --empires\`) after changing the empires'
// seed (economy/empireSeed.ts, the generated galaxy) or the tick.
import type { SeedCalibration } from './seedCalibration'

// Per empire world: the prices and wages its markets settle at.
export const EMPIRE_WORLD_CALIBRATION: SeedCalibration = {
${worldsBody(cal)}
}

// Per empire: the starting tax rate that opens its budget near balance.
export const EMPIRE_TAX_RATES: Record<string, number> = {
${Object.entries(chosenTaxes)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, t]) => `  ${JSON.stringify(id)}: ${t.taxRate},`)
  .join('\n')}
}
`
  writeFileSync(new URL('../../src/economy/empireCalibration.ts', import.meta.url), file)
  console.log('wrote src/economy/empireCalibration.ts')
  process.exit(0)
}
const body = Object.entries(cal)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, c]) => {
    const prices = Object.entries(c.prices ?? {}).map(([g, p]) => `${g}: ${sig(p as number)}`).join(', ')
    const wages = Object.entries(c.wages ?? {}).map(([k, v]) => `${k}: ${sig(v as number)}`).join(', ')
    return `  ${JSON.stringify(id)}: {\n    prices: { ${prices} },\n    wages: { ${wages} },\n  },`
  })
  .join('\n')
const file = `// GENERATED by scripts/economy/calibrate.ts — do not edit by hand; rerun it
// (\`npx tsx scripts/economy/calibrate.ts\`) after changing the seed or the tick.
import type { GoodId } from './goods'
import type { PopClass } from './recipes'

// Per world: the prices and wages its markets settle at.
export interface WorldCalibration {
  prices?: Partial<Record<GoodId, number>>
  wages?: Partial<Record<PopClass, number>>
}
export type SeedCalibration = Record<string, WorldCalibration>

export const SEED_CALIBRATION: SeedCalibration = {
${body}
}

// Per nation: the starting tax rate that opens its budget near balance.
export interface CountryCalibration {
  taxRate?: number
}
export const COUNTRY_CALIBRATION: Record<string, CountryCalibration> = {
${Object.entries(chosenTaxes)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, t]) => `  ${JSON.stringify(id)}: { taxRate: ${t.taxRate} },`)
  .join('\n')}
}
`
writeFileSync(new URL('../../src/economy/seedCalibration.ts', import.meta.url), file)
console.log('wrote src/economy/seedCalibration.ts')
