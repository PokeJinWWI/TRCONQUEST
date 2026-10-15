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
import { NEED_TIERS, SPECIES_TEMPLATES } from '../../src/economy/species'
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

// --- 1b. Fit what the plants make to what is wanted (mothballing only) ---
// Levels stay with the seed's balancer (see above), but its estimate of demand is a guess, and a world that opens making a third more than its
// people, industry and state use sits in glut (floor prices, unsold stock, wages that never rise). A fit round measures what every good makes
// against what is wanted and mothballs a share of the plants making far more (never below a floor), or reopens mothballed ones that are short:
// most of the gap a round (three quarters), since the plants' inputs move too.
const FIT_TARGET = 1.15 // fit a good's output to this many times what is wanted (room for exports and a buffer)
const FIT_ONLY_ABOVE = 1.3 // only goods made more than this many times what is wanted are cut
const FIT_FLOOR = 0.03
const FIT_FLOOR_BASIC = 0.1 // the chain basics (steel, tools, machinery...) keep at least this much running
// Only goods that industry (not households) buys are fitted: people buy more of what is cheap, so a glut of consumer goods clears through
// price and fitting it to the depressed demand it caused would spiral (fewer jobs, lower wages, less demand). Intermediate and capital goods
// have no such give: when more is made than industry uses, it just piles up.
// The goods households live on every day (basic, everyday and healthcare needs) are left alone; comfort and luxury goods are fitted too, but
// only once they are made far more than wanted (few people work in them, so cutting them cannot spiral the way cutting groceries would).
const CORE_NEEDS = new Set<GoodId>(Object.values(SPECIES_TEMPLATES).flatMap((t) => (['basic', 'everyday', 'healthcare'] as const).flatMap((tier) => t.needs[tier].flatMap((g) => g.goods.map((x) => x.good)))))
const COMFORT = new Set<GoodId>(Object.values(SPECIES_TEMPLATES).flatMap((t) => (['comfort', 'luxury'] as const).flatMap((tier) => t.needs[tier].flatMap((g) => g.goods.map((x) => x.good)))))
const COMFORT_ONLY_ABOVE = 2
// Goods that cannot be stored (power, water, services) need headroom and are left alone too.
const UNSTORABLE = new Set<GoodId>(['electricity', 'water', 'transportation', 'retail', 'healthcare', 'dental', 'education', 'onlineServices'])
const fittable = (g: GoodId) => !CORE_NEEDS.has(g) && !UNSTORABLE.has(g)
const BASICS: GoodId[] = ['electricity', 'water', 'steel', 'tools', 'machinery', 'coal', 'ironOre', 'concrete', 'lumber', 'glass', 'fuel']
const misfit = (m: Measured): number => {
  let off = 0
  let made = 0
  for (const w of m.worlds) {
    for (const g of GOOD_IDS.filter(fittable)) {
      const p = m.produced[w.id]?.[g] ?? 0
      const d = m.demand[w.id]?.[g] ?? 0
      made += p * GOODS[g].basePrice
      off += Math.abs(p - d) * GOODS[g].basePrice
    }
  }
  return made > 0 ? off / made : 0
}
const drift = (m: Measured) => Object.values(m.cpiYear1).reduce((a, v) => a + Math.abs(v), 0)
const fitRound = (label: string) => {
  const seeded = (EMPIRES ? seedEmpireEconomies(galaxyEmpires(), { worlds: cal }).worlds : seedWorldsWith(cal)) as World[]
  for (const w of measured.worlds) {
    const here = seeded.find((x) => x.id === w.id)
    if (!here) continue
    const entry = (cal[w.id] ??= {})
    const idle = (entry.idle ??= {})
    for (const recipe of new Set(here.buildings.map((b) => b.recipeId))) {
      const method = getMethod(recipe, here.buildings.find((b) => b.recipeId === recipe)!.methodId)
      if (!method || method.outputs.length === 0 || !method.outputs.every((o) => fittable(o.good))) continue
      const current = 1 - Math.max(...here.buildings.filter((b) => b.recipeId === recipe).map((b) => b.idle ?? 0))
      // The scarcest of its outputs decides (like the seed's own balancer): a plant with one short output keeps running.
      const ratios = method.outputs.map((o) => {
        const made = measured.produced[w.id]?.[o.good] ?? 0
        const wanted = measured.demand[w.id]?.[o.good] ?? 0
        return { made, wanted, ratio: made > 1e-9 ? (wanted * FIT_TARGET) / made : 1 }
      })
      const worst = Math.max(...ratios.map((r) => r.ratio))
      const surplus = ratios.every((r, i) => r.made > r.wanted * (COMFORT.has(method.outputs[i].good) ? COMFORT_ONLY_ABOVE : FIT_ONLY_ABOVE))
      const floor = method.outputs.some((o) => BASICS.includes(o.good)) ? FIT_FLOOR_BASIC : FIT_FLOOR
      let next = current
      if (surplus) next = Math.max(floor, current * (0.25 + 0.75 * Math.min(1, worst)))
      else if (worst > 1.1 && current < 1) next = Math.min(1, current * (0.5 + 0.5 * worst))
      const shaved = Math.round((1 - next) * 100) / 100
      if (shaved > 0.009) idle[recipe] = shaved
      else delete idle[recipe]
    }
  }
  measured = run(cal, taxes, true)
  report(label, measured)
  console.log(`  ${label}: misfit ${(misfit(measured) * 100).toFixed(1)}%`)
}

// --- 2. Prices and wages (keeping the round that starts steadiest) ---
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
// A round is judged by price steadiness AND by how well the plants fit what is wanted (the empires: by stability violations first).
// ...and by how far people's standard of living has fallen from the plain seed's: mothballing plants cuts jobs and wages, so a fit that
// trims the glut by costing the nation its living standard is no improvement.
const meanSoL = (m: Measured): Record<string, number> => {
  const sum: Record<string, { w: number; n: number }> = {}
  for (const w of m.worlds) {
    const x = (sum[w.ownerId] ??= { w: 0, n: 0 })
    for (const p of w.pops) {
      x.w += p.standardOfLiving * p.populationSize
      x.n += p.populationSize
    }
  }
  return Object.fromEntries(Object.entries(sum).map(([id, x]) => [id, x.n > 0 ? x.w / x.n : 0]))
}
const baselineSoL = meanSoL(measured)
const SOL_PENALTY = 3 // per point (0..1) of average living standard lost, averaged over the nations
const solDrop = (m: Measured): number => {
  const now = meanSoL(m)
  const ids = Object.keys(baselineSoL)
  return ids.length > 0 ? ids.reduce((n, id) => n + Math.max(0, baselineSoL[id] - (now[id] ?? 0)), 0) / ids.length : 0
}
const judge = (m: Measured): number => (EMPIRES ? score(cal, taxes) + misfit(m) : drift(m) * 3 + misfit(m) + SOL_PENALTY * solDrop(m))
let best = { cal: structuredClone(cal), taxes: structuredClone(taxes), judged: judge(measured), label: 'the plain seed' }
if (EMPIRES) console.log(`  plain seed: ${best.judged}`)
const keepIfBest = (label: string) => {
  const judged = judge(measured)
  console.log(`  ${label}: judged ${judged.toFixed(3)} (misfit ${(misfit(measured) * 100).toFixed(1)}%, living standard down ${(solDrop(measured) * 100).toFixed(1)} points; best so far ${best.judged.toFixed(3)} from ${best.label})`)
  if (judged < best.judged) best = { cal: structuredClone(cal), taxes: structuredClone(taxes), judged, label }
}
const priceRound = (label: string) => {
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
  report(label, measured)
  console.log(`  taxes ${Object.entries(taxes).map(([id, t]) => `${id.slice(0, 6)} ${t.taxRate}`).join(', ')} | budgets ${Object.entries(measured.fiscal).map(([id, f]) => `${id.slice(0, 6)} ${((f.balance / f.gdp) * 100).toFixed(1)}%`).join(', ')}`)
}
// The schedule: settle prices once, then alternate fitting the plants and re-settling prices, ending on a fit so the plants match what is
// wanted at the prices the game opens with. Each step is a candidate; the best-judged is kept.
let stepNo = 1
for (const step of ['price', 'fit', 'fit', 'fit', 'price', 'fit', 'fit', 'fit', 'price', 'fit', 'fit', 'fit', 'fit'] as const) {
  const label = `${step} ${best.label === 'the plain seed' ? '1' : ''}`.trim() + ` (${stepNo++})`
  if (step === 'fit') fitRound(label)
  else priceRound(label)
  keepIfBest(label)
}
console.log(`keeping ${best.label}`)
cal = best.cal
const chosenTaxes = best.taxes

// --- 2b. A nation keeps its living standard ---
// Mothballing helps a nation only if it does not cost its people: a nation whose standard of living ends more than this far below the plain
// seed's has its fit halved (the others keep theirs), and the two years are measured again, up to three times.
const MAX_SOL_LOSS = 0.03
if (!EMPIRES) {
  for (let pass = 0; pass < 4; pass++) {
    cal = best.cal
    measured = run(cal, { ...chosenTaxes }, true)
    const now = meanSoL(measured)
    const costly = Object.keys(baselineSoL).filter((id) => baselineSoL[id] - (now[id] ?? 0) > MAX_SOL_LOSS)
    console.log(`  living standard check ${pass + 1}: ${costly.length ? `${costly.join(', ')} lose more than ${MAX_SOL_LOSS * 100} points` : 'every nation keeps its living standard'}`)
    if (costly.length === 0) break
    // Back the fit off by half (what is left of it is tried again): a nation keeps as much of it as its people can afford.
    for (const w of measured.worlds) {
      const idle = costly.includes(w.ownerId) ? cal[w.id]?.idle : undefined
      if (!idle) continue
      for (const k of Object.keys(idle)) {
        const half = Math.round((idle[k]! / 2) * 100) / 100
        if (half >= 0.03) idle[k] = half
        else delete idle[k]
      }
    }
    best = { ...best, cal: structuredClone(cal) }
  }
}

// --- 3. The empires keep their jobs ---
// Mothballing cuts jobs as well as output. An empire whose labour force ends year 5 under 55% in work (the test holds every empire to 50%)
// gets its fit taken back, world by world, and the five years are measured again.
if (EMPIRES) {
  for (let pass = 0; pass < 3; pass++) {
    const emp = seedEmpireEconomies(galaxyEmpires(), { worlds: cal, taxRates: Object.fromEntries(Object.entries(chosenTaxes).map(([id, x]) => [id, x.taxRate!])) })
    const verdict = measureStability(
      { countries: [...seedCountriesWith(COUNTRY_CALIBRATION), ...emp.countries], worlds: [...seedWorldsWith(SEED_CALIBRATION), ...emp.worlds], corporations: [...seedCorporations(), ...emp.corporations], banks: [...seedBanks(), ...emp.banks] },
      { humanCountryIds: [], warPairs: [], tradeGroups: emp.tradeGroups },
    )
    const idle = Object.entries(verdict.years).filter(([id, ys]) => id.startsWith('empire-') && ys.length >= 5 && ys[4].employed / Math.max(1, ys[4].workers) < 0.55).map(([id]) => id)
    console.log(`  jobs check ${pass + 1}: ${idle.length ? `${idle.join(', ')} end year 5 under 55% in work` : 'every empire keeps its jobs'}`)
    if (idle.length === 0) break
    for (const w of emp.worlds) if (idle.includes(w.ownerId) && cal[w.id]) delete cal[w.id].idle
  }
}

// --- Write ---
const sig = (x: number) => Number(x.toPrecision(4))
const worldsBody = (c: SeedCalibration) =>
  Object.entries(c)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, w]) => {
      const prices = Object.entries(w.prices ?? {}).map(([g, p]) => `${g}: ${sig(p as number)}`).join(', ')
      const wages = Object.entries(w.wages ?? {}).map(([k, v]) => `${k}: ${sig(v as number)}`).join(', ')
      const idle = Object.entries(w.idle ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ')
      return `  ${JSON.stringify(id)}: {\n    prices: { ${prices} },\n    wages: { ${wages} },${idle ? `\n    idle: { ${idle} },` : ''}\n  },`
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
    const idle = Object.entries(c.idle ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ')
    return `  ${JSON.stringify(id)}: {\n    prices: { ${prices} },\n    wages: { ${wages} },${idle ? `\n    idle: { ${idle} },` : ''}\n  },`
  })
  .join('\n')
const file = `// GENERATED by scripts/economy/calibrate.ts — do not edit by hand; rerun it
// (\`npx tsx scripts/economy/calibrate.ts\`) after changing the seed or the tick.
import type { GoodId } from './goods'
import type { PopClass } from './recipes'

// Per world: the prices and wages its markets settle at, and the share of each plant mothballed at the start.
export interface WorldCalibration {
  prices?: Partial<Record<GoodId, number>>
  wages?: Partial<Record<PopClass, number>>
  // Per recipe: the share of its capacity mothballed at the start (Building.idle), fitted so the world does not open making far more
  // than it uses (scripts/economy/calibrate.ts, the "fit" stage).
  idle?: Partial<Record<string, number>>
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
