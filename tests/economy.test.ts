// Verification of the v2 economy (design doc v2): country (national fiscal) +
// world (local market) layers, 4-axis pops, 4 countries / 6 worlds. Pure
// functions, run headlessly.
//
// Run:  npx tsx tests/economy.test.ts

import { seedWorlds, seedCountries } from '../src/economy/economySeed'
import { tickEconomy, estimateWorldGdp, creditRating } from '../src/economy/economyTick'
import { GOOD_IDS, GOODS, priceCeiling, PRICE_FLOOR } from '../src/economy/goods'
import { POP_CLASSES } from '../src/economy/recipes'
import { NEED_TIERS } from '../src/economy/species'
import { interestGroupStrengths } from '../src/economy/politics'
import type { Country, World } from '../src/economy/economyTypes'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function worldFinite(w: World): boolean {
  for (const g of GOOD_IDS) if (!Number.isFinite(w.market.prices[g])) return false
  for (const c of POP_CLASSES) if (!Number.isFinite(w.labor.wages[c])) return false
  for (const p of w.pops) {
    if (!Number.isFinite(p.wealth) || !Number.isFinite(p.populationSize)) return false
    for (const t of NEED_TIERS) if (!Number.isFinite(p.needsSatisfaction[t])) return false
  }
  for (const b of w.buildings) for (const g of GOOD_IDS) if (b.inventory[g] !== undefined && !Number.isFinite(b.inventory[g]!)) return false
  return true
}
function countryFinite(c: Country): boolean {
  return Number.isFinite(c.treasury) && Number.isFinite(c.taxRate) && Number.isFinite(c.welfarePerCapita)
}

function run(n: number, mutate?: (c: Country[], w: World[]) => [Country[], World[]]) {
  let countries = seedCountries()
  let worlds = seedWorlds()
  if (mutate) [countries, worlds] = mutate(countries, worlds)
  let reports = tickEconomy(countries, worlds).reports
  for (let i = 0; i < n; i++) {
    const r = tickEconomy(countries, worlds)
    countries = r.countries
    worlds = r.worlds
    reports = r.reports
  }
  return { countries, worlds, reports }
}

console.log('\n=== 1. Seed: 4 countries, 6 inhabited worlds, 4-axis pops ===')
{
  const worlds = seedWorlds()
  const countries = seedCountries()
  check('4 countries load', countries.length === 4, `${countries.length}`)
  check('6 worlds load', worlds.length === 6, `${worlds.length}`)
  check('the Kingdom of Lalande exists', countries.some((c) => c.id === 'kingdom-of-lalande'))
  check('Lalande 21185 d is a Tidalian world', worlds.some((w) => w.id === 'Lalande 21185 d' && w.pops.every((p) => p.speciesTemplateId === 'tidalian')))
  check('pops carry all four axes (species/culture/religion/class)', worlds[0].pops.every((p) => p.speciesTemplateId && p.cultureId && p.religionId && p.class))
  check('a world has multiple religions among its pops', new Set(worlds[0].pops.map((p) => p.religionId)).size >= 2)
  check('Earth is NOT an inhabited world (it is a relict)', !worlds.some((w) => w.id === 'Earth'))
  check('every world starts below its population capacity', worlds.every((w) => w.pops.reduce((s, p) => s + p.populationSize, 0) < w.populationCapacity))
}

console.log('\n=== 2. Stable over hundreds of ticks ===')
{
  const { countries, worlds } = run(400)
  check('all worlds stay finite', worlds.every(worldFinite))
  check('all countries stay finite', countries.every(countryFinite))
  check('all prices within bounds', worlds.every((w) => GOOD_IDS.every((g) => w.market.prices[g] >= PRICE_FLOOR - 1e-9 && w.market.prices[g] <= priceCeiling(g) + 1e-9)))
  check('every world keeps a living population', worlds.every((w) => w.pops.reduce((s, p) => s + p.populationSize, 0) > 0))
}

console.log('\n=== 3. Fiscal is NATIONAL: one treasury per country, aggregating its worlds ===')
{
  const { countries, worlds, reports } = run(200)
  const ism = reports.countries['imperial-state-of-mars']
  const ismWorlds = worlds.filter((w) => w.ownerId === 'imperial-state-of-mars')
  const ismPop = ismWorlds.reduce((s, w) => s + w.pops.reduce((a, p) => a + p.populationSize, 0), 0)
  check('national population aggregates Mars + Luna', Math.abs(ism.population - ismPop) < 1, `${ism.population.toFixed(0)} vs ${ismPop.toFixed(0)}`)
  check('worlds carry no treasury field of their own', worlds.every((w) => !('treasury' in w)))
  check('the country has one treasury', countries.every((c) => typeof c.treasury === 'number'))
  check('income tax gives real revenue', ism.revenue > 0, ism.revenue.toFixed(0))
  check('default budget stays out of serious debt', ism.debtToGdp < 0.5, ism.debtToGdp.toFixed(2))
  check('...at an investment-grade rating', ['AAA', 'AA', 'A'].includes(ism.rating), ism.rating)
}

console.log('\n=== 4. Deficit spending builds debt + downgrades rating ===')
{
  const { reports } = run(200, (c, w) => [c.map((x) => (x.id === 'imperial-state-of-mars' ? { ...x, welfarePerCapita: 2.5 } : x)), w])
  const ism = reports.countries['imperial-state-of-mars']
  check('heavy welfare runs a deficit', ism.balance < 0, ism.balance.toFixed(0))
  check('...accumulating national debt', ism.treasury < 0, ism.treasury.toFixed(0))
  check('...downgrading below AAA', ism.rating !== 'AAA', ism.rating)
  check('creditRating ladder is monotonic', creditRating(0.1) === 'AAA' && creditRating(5) === 'CCC')
}

console.log('\n=== 5. Local markets respond; employment & needs behave ===')
{
  const { worlds, reports } = run(200)
  const mars = worlds.find((w) => w.id === 'Mars')!
  check("a surplus good is cheap somewhere (Mars minerals ≤ base)", mars.market.prices.minerals <= GOODS.minerals.basePrice + 1e-6, mars.market.prices.minerals.toFixed(2))
  const marsReport = reports.worlds['Mars']
  check('labor market reports employment rates', POP_CLASSES.some((c) => marsReport.labor[c].employmentRate > 0))
  const avgBasic = mars.pops.reduce((s, p) => s + p.needsSatisfaction.basic * p.populationSize, 0) / mars.pops.reduce((s, p) => s + p.populationSize, 0)
  check('basic needs are partly met on Mars', avgBasic > 0.2, avgBasic.toFixed(2))
  check('GDP of a world is positive and finite', Number.isFinite(estimateWorldGdp(mars)) && estimateWorldGdp(mars) > 0, estimateWorldGdp(mars).toFixed(0))
}

console.log('\n=== 6. Construction funded from the national treasury lands capacity ===')
{
  let countries = seedCountries().map((c) => (c.id === 'imperial-state-of-mars' ? { ...c, treasury: 500000 } : c))
  let worlds = seedWorlds().map((w) => (w.id === 'Mars' ? { ...w, constructionQueue: [{ id: 'o', recipeId: 'farm', cost: 6000, progress: 0 }] } : w))
  const farmBefore = worlds.find((w) => w.id === 'Mars')!.buildings.filter((b) => b.recipeId === 'farm').reduce((s, b) => s + b.level, 0)
  let completed = false
  for (let i = 0; i < 40; i++) {
    const r = tickEconomy(countries, worlds)
    countries = r.countries
    worlds = r.worlds
    if (worlds.find((w) => w.id === 'Mars')!.constructionQueue.length === 0) {
      completed = true
      break
    }
  }
  const farmAfter = worlds.find((w) => w.id === 'Mars')!.buildings.filter((b) => b.recipeId === 'farm').reduce((s, b) => s + b.level, 0)
  check('the queued farm completes', completed)
  check('...adding a level of farm capacity', farmAfter === farmBefore + 1, `${farmBefore} -> ${farmAfter}`)
}

console.log('\n=== 7. Politics: interest groups from real 4-axis pops ===')
{
  const worlds = seedWorlds()
  const groups = interestGroupStrengths(worlds.find((w) => w.id === 'Mars')!)
  check('interest groups are computed and ranked', groups.length === 4 && groups[0].strength >= groups[3].strength)
  check('shares sum to ~1', Math.abs(groups.reduce((s, g) => s + g.share, 0) - 1) < 1e-6)
}

console.log('\n=== 8. Edge cases do not crash ===')
{
  const stripped = run(30, (c, w) => [c, w.map((x) => (x.id === 'Luna' ? { ...x, buildings: [] } : x))])
  check('a world with no buildings ticks fine', stripped.worlds.find((w) => w.id === 'Luna')!.pops.length > 0 && stripped.worlds.every(worldFinite))
  const noPops = run(30, (c, w) => [c, w.map((x) => (x.id === 'Proxima b' ? { ...x, pops: [] } : x))])
  check('a world with no pops ticks fine', noPops.worlds.every(worldFinite))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
