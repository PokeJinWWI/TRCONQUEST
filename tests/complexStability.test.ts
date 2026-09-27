// Verification that Complex mode's economy holds together: every nation, with
// its AI running, over five years. Guards the fixes behind it — wages bargained
// over value added (economyTick LABOR_SHARE), the fiscal rule, government
// purchases and dividends that put money back into circulation, trade between
// nations (internationalTrade.ts), price-elastic demand, rigid wages, a seed
// with its bureaucracy covered and its wages at the bargained level, and the
// damped AI (divest a level at a time; build only what's scarce and can get its
// inputs; never retool into a glut), and a start calibrated to its own
// equilibrium (seedCalibration.ts: settled prices and wages, tax rates; the
// seed balancer sized per nation; a month's stock; plants at a staffable run).
// Run:  npx tsx tests/complexStability.test.ts

import { tickEconomy } from '../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import { getMethod } from '../src/economy/recipes'
import { GOODS } from '../src/economy/goods'
import type { World } from '../src/economy/economyTypes'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// Real output: what the buildings make, at base prices (constant-price GDP).
function realOutput(worlds: World[], id: string): number {
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

interface Year { real: number; nominal: number; balance: number; priceLevel: number; formalEmployed: number; formalWorkers: number; ore: number; oreUsed: number }
const YEARS = 5
let countries = seedCountries()
let worlds = seedWorlds()
let corporations = seedCorporations()
let banks = seedBanks()
const ids = countries.map((c) => c.id)
const years: Record<string, Year[]> = Object.fromEntries(ids.map((id) => [id, []]))
for (let y = 0; y < YEARS; y++) {
  const acc: Record<string, Year> = Object.fromEntries(ids.map((id) => [id, { real: 0, nominal: 0, balance: 0, priceLevel: 0, formalEmployed: 0, formalWorkers: 0, ore: 0, oreUsed: 0 }]))
  for (let m = 0; m < 12; m++) {
    const r = tickEconomy(countries, worlds, corporations, { enableAI: true, tick: y * 12 + m + 1, humanCountryIds: [] }, banks)
    ;({ countries, worlds, corporations, banks } = r)
    for (const id of ids) {
      const a = acc[id]
      const f = r.reports.countries[id]
      a.real += realOutput(worlds, id)
      a.nominal += f.gdp
      a.balance += f.balance
      a.priceLevel += f.priceLevel / 12
      // Iron ore made in the nation against what its buildings used.
      for (const w of worlds) {
        if (w.ownerId !== id) continue
        for (const b of w.buildings) {
          const m = getMethod(b.recipeId, b.methodId)
          const o = m?.outputs.find((x) => x.good === 'ironOre')
          if (o) a.ore += o.amount * b.level * b.throughput
        }
        a.oreUsed += r.reports.worlds[w.id]?.goods.ironOre.demand ?? 0
      }
      // The formal labour force: the working classes (subsistence is the
      // informal sector — people outside formal jobs by design).
      for (const w of worlds) {
        if (w.ownerId !== id) continue
        for (const [cls, l] of Object.entries(r.reports.worlds[w.id]?.labor ?? {})) {
          if (cls === 'subsistence' || cls === 'investor') continue
          a.formalWorkers += l.workers
          a.formalEmployed += l.workers * l.employmentRate
        }
      }
    }
  }
  for (const id of ids) years[id].push(acc[id])
}

console.log('=== Five years, every nation, AI on ===')
for (const id of ids) {
  const ys = years[id]
  const growth = ys.slice(1).map((y, i) => y.real / ys[i].real - 1)
  const inflation = ys.slice(1).map((y, i) => y.priceLevel / ys[i].priceLevel - 1)
  const pct = (xs: number[]) => xs.map((x) => `${(x * 100).toFixed(1)}%`).join(' ')
  // No collapse: real output never falls more than 6% in a year.
  check(`${id}: no year of collapse (real output never falls more than 6%)`, growth.every((g) => g > -0.06), pct(growth))
  // Budgets under the fiscal rule: every year's balance within 8% of GDP.
  const deficits = ys.slice(1).map((y) => y.balance / y.nominal)
  check(`${id}: the budget stays within 8% of GDP`, deficits.every((d) => Math.abs(d) <= 0.08), pct(deficits))
  // Prices anchored: under 15% a year from year 1 to 2 on. (Most years run
  // 0–5%; known: Orion's consumer goods run short from year 3 — a laissez-faire
  // state doesn't build and its companies rarely invest — and its prices can
  // climb ~10–15% then.)
  check(`${id}: prices are anchored (under 15% a year, from year 1 to 2 on)`, inflation.every((i) => Math.abs(i) < 0.15), pct(inflation))
  // The formal labour force is mostly in work: ≥ 80% through year 3, ≥ 75%
  // after. (Known drift: on Venus and Lalande it slips toward 78% by year 5 —
  // population grows, and plants short of technicians or of electricity and
  // steel post fewer jobs while labourers stand idle.)
  const employment = ys.map((y) => y.formalEmployed / Math.max(1, y.formalWorkers))
  check(`${id}: most of the formal labour force is employed (≥ 80% to year 3, ≥ 75% after)`, employment.every((e, i) => e >= (i < 3 ? 0.8 : 0.75)), pct(employment))
}

console.log('\n=== Mars’s iron ore is not in glut ===')
{
  const y2 = years['imperial-state-of-mars'][1]
  // (Its mines used to be sized world by world, on top of Luna's mine that also
  // feeds the Martian mills, then mechanized to double their output: ore piled
  // up at twice what was used.)
  check('Mars makes no more than 1.5× the iron ore it uses (year 2)', y2.ore <= 1.5 * y2.oreUsed, `${(y2.ore / y2.oreUsed).toFixed(2)}×`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
