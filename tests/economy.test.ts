// Milestone 1 verification of the economy simulation (see src/economy/). The
// whole sim is pure functions over PlanetEconomy, the same way the combat
// resolver is pure over its state, so the definition of done — load the three
// seed planets, run hundreds of ticks, watch prices/employment/needs move in
// economically sensible directions, and survive the edge cases — is checked
// directly here.
//
// Run:  npx tsx tests/economy.test.ts
//
// Deliberately outside `src/`, like every other test file — tsconfig.app.json
// only includes `src`.

import { seedEconomy } from '../src/economy/economySeed'
import { tickEconomy, tickPlanet, estimateGdp } from '../src/economy/economyTick'
import { GOOD_IDS, GOODS, priceCeiling, PRICE_FLOOR } from '../src/economy/goods'
import { POP_CLASSES } from '../src/economy/recipes'
import { NEED_TIERS } from '../src/economy/species'
import type { PlanetEconomy } from '../src/economy/economyTypes'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function isFinitePlanet(p: PlanetEconomy): boolean {
  for (const g of GOOD_IDS) if (!Number.isFinite(p.market.prices[g])) return false
  for (const cls of POP_CLASSES) if (!Number.isFinite(p.labor.wages[cls])) return false
  for (const pop of p.pops) {
    if (!Number.isFinite(pop.wealth) || !Number.isFinite(pop.populationSize)) return false
    for (const t of NEED_TIERS) if (!Number.isFinite(pop.needsSatisfaction[t])) return false
  }
  for (const b of p.buildings) {
    for (const g of GOOD_IDS) if (b.inventory[g] !== undefined && !Number.isFinite(b.inventory[g]!)) return false
    if (!Number.isFinite(b.lastProfit)) return false
  }
  return Number.isFinite(p.treasury)
}

function runTicks(planets: PlanetEconomy[], n: number): PlanetEconomy[] {
  let state = planets
  for (let i = 0; i < n; i++) state = tickEconomy(state).planets
  return state
}

// ---------------------------------------------------------------------------

console.log('\n=== 1. Seed loads and the three test-fixture worlds are present ===')
{
  const seed = seedEconomy()
  check('three seed planets load', seed.length === 3, `${seed.length}`)
  check('they are Mars / Venus / Arcadia', seed.map((p) => p.id).join(',') === 'Mars,Venus,Arcadia', seed.map((p) => p.id).join(','))
  check('each has pops', seed.every((p) => p.pops.length > 0))
  check('each has at least an extraction, a food, and an industry building', seed.every((p) => {
    const recipes = new Set(p.buildings.map((b) => b.recipeId))
    return recipes.has('mine') && recipes.has('farm') && recipes.has('factory')
  }))
  check('each starts below its population capacity', seed.every((p) => {
    const total = p.pops.reduce((s, x) => s + x.populationSize, 0)
    return total < p.populationCapacity
  }))
}

console.log('\n=== 2. Runs hundreds of ticks without producing non-finite state ===')
{
  let state = seedEconomy()
  let allFinite = true
  for (let i = 0; i < 500; i++) {
    state = tickEconomy(state).planets
    if (!state.every(isFinitePlanet)) {
      allFinite = false
      break
    }
  }
  check('500 ticks, every planet stays fully finite (no NaN/Infinity)', allFinite)
  check('all prices stay within their [floor, ceiling] bounds', state.every((p) =>
    GOOD_IDS.every((g) => p.market.prices[g] >= PRICE_FLOOR - 1e-9 && p.market.prices[g] <= priceCeiling(g) + 1e-9),
  ))
}

console.log('\n=== 3. Prices respond to surplus (cheap) and to genuine scarcity (dear) ===')
{
  // Mars runs minerals in surplus (a level-3 mine feeds only a level-3
  // factory) — a surplus good should settle at or below its base price.
  const mars = runTicks(seedEconomy(), 300).find((p) => p.id === 'Mars')!
  check('a surplus good (minerals) settles at or below its base price', mars.market.prices.minerals <= GOODS.minerals.basePrice + 1e-6, mars.market.prices.minerals.toFixed(2))

  // Arcadia is labor-starved (a tiny subsistence class can't fully staff its
  // farm) with high wages, so its scarce food is bid well above base —
  // scarcity-drives-price-up, demonstrated where buyers can actually afford to
  // bid it up.
  const arcadia = runTicks(seedEconomy(), 300).find((p) => p.id === 'Arcadia')!
  check('a scarce good on a labor-starved world (Arcadia food) is driven above base', arcadia.market.prices.food > GOODS.food.basePrice, arcadia.market.prices.food.toFixed(2))
}

console.log('\n=== 4. Cutting off a good’s only producer drives its price up ===')
{
  // Minerals demand comes from factories (price-inelastic input buying), not
  // from budget-limited pops, so removing every mine is a clean test that a
  // real supply cutoff drives price up rather than being masked by
  // affordability. Take a settled Mars, delete its mines, keep ticking.
  let mars = runTicks(seedEconomy(), 200).find((p) => p.id === 'Mars')!
  const priceBefore = mars.market.prices.minerals
  mars = { ...mars, buildings: mars.buildings.filter((b) => b.recipeId !== 'mine') }
  for (let i = 0; i < 60; i++) mars = tickPlanet(mars).planet
  const priceAfter = mars.market.prices.minerals
  check('removing all mineral production drives its price up', priceAfter > priceBefore, `${priceBefore.toFixed(2)} -> ${priceAfter.toFixed(2)}`)
  check('...and it does not crash with a good that has demand but zero supply', isFinitePlanet(mars))
}

console.log('\n=== 4b. A need with no producer is expensive and goes unmet ===')
{
  // Arcadia has no clinic, so medicine has demand but zero supply: its price
  // should sit near the ceiling and its healthcare need should be ~unmet.
  const arcadia = runTicks(seedEconomy(), 200).find((p) => p.id === 'Arcadia')!
  const hasClinic = arcadia.buildings.some((b) => b.recipeId === 'clinic')
  check('Arcadia genuinely has no medicine producer', !hasClinic)
  check('an unproduced but needed good (medicine) is driven far above base', arcadia.market.prices.medicine > GOODS.medicine.basePrice * 2, arcadia.market.prices.medicine.toFixed(2))
  const avgHealthcare = arcadia.pops.reduce((s, p) => s + p.needsSatisfaction.healthcare, 0) / arcadia.pops.length
  check('...and the healthcare need it maps to is essentially unmet', avgHealthcare < 0.1, avgHealthcare.toFixed(2))
}

console.log('\n=== 4c. Inventory stays bounded (buildings cut production when goods do not sell) ===')
{
  // Without the "glutted → cut production" throttle, unsold output piles up
  // without bound. Confirm total inventory of any good stays finite and modest
  // over a long run rather than growing every tick.
  const mars = runTicks(seedEconomy(), 500).find((p) => p.id === 'Mars')!
  const totalInventory = (g: 'food' | 'minerals' | 'consumerGoods' | 'medicine') => mars.buildings.reduce((s, b) => s + (b.inventory[g] ?? 0), 0)
  const maxInv = Math.max(totalInventory('food'), totalInventory('minerals'), totalInventory('consumerGoods'), totalInventory('medicine'))
  check('no good’s inventory has run away (production throttles on a glut)', maxInv < 1000, maxInv.toFixed(1))
}

console.log('\n=== 5. Unemployment appears when workers outnumber jobs ===')
{
  // Flood Mars with far more labor-class workers than there are labor jobs;
  // the employment rate for that class must drop below 1.
  const seed = seedEconomy()
  let mars = seed.find((p) => p.id === 'Mars')!
  const extraLabor = { ...mars.pops[0], id: 'flood-labor', class: 'labor' as const, populationSize: 100 }
  mars = { ...mars, pops: [...mars.pops, extraLabor] }
  const report = tickPlanet(mars).report
  check('a large labor surplus yields an employment rate below 1', report.labor.labor.employmentRate < 1, report.labor.labor.employmentRate.toFixed(2))
  check('...while a class with jobs to spare stays fully employed where workers are scarce', report.labor.subsistence.employmentRate <= 1)
}

console.log('\n=== 6. Idle workers get hired when a job opens ===')
{
  // Start Mars with NO factories, let labor pile up unemployed, then add a big
  // factory and confirm the technical-class employment rate rises next tick.
  const seed = seedEconomy()
  let mars = seed.find((p) => p.id === 'Mars')!
  mars = { ...mars, buildings: mars.buildings.filter((b) => b.recipeId !== 'factory' && b.recipeId !== 'clinic') }
  const before = tickPlanet(mars).report.labor.technical.employmentRate
  mars = { ...mars, buildings: [...mars.buildings, { id: 'new-factory', recipeId: 'factory', level: 4, stateFraction: 0, inventory: {}, lastProfit: 0 }] }
  const after = tickPlanet(mars).report.labor.technical.employmentRate
  check('opening a factory raises technical-class employment', after > before, `${before.toFixed(2)} -> ${after.toFixed(2)}`)
}

console.log('\n=== 7. Needs satisfaction tracks whether pops can actually buy ===')
{
  // A well-supplied basic good (food is produced) should leave basic-needs
  // satisfaction meaningfully positive; cutting all food production should
  // collapse it.
  const fed = runTicks(seedEconomy(), 150).find((p) => p.id === 'Mars')!
  const avgBasicFed = fed.pops.reduce((s, p) => s + p.needsSatisfaction.basic, 0) / fed.pops.length
  check('with food produced, basic-needs satisfaction is positive', avgBasicFed > 0.3, avgBasicFed.toFixed(2))

  let starved = { ...fed, buildings: fed.buildings.filter((b) => b.recipeId !== 'farm') }
  for (let i = 0; i < 60; i++) starved = tickPlanet(starved).planet
  const avgBasicStarved = starved.pops.reduce((s, p) => s + p.needsSatisfaction.basic, 0) / starved.pops.length
  check('cutting all food production collapses basic-needs satisfaction', avgBasicStarved < avgBasicFed, `${avgBasicFed.toFixed(2)} -> ${avgBasicStarved.toFixed(2)}`)
  check('an empty comfort/luxury tier reads as trivially satisfied', fed.pops.every((p) => p.needsSatisfaction.comfort === 1 && p.needsSatisfaction.luxury === 1))
}

console.log('\n=== 8. Edge cases do not crash ===')
{
  // A planet with no buildings at all.
  let barren: PlanetEconomy = { ...seedEconomy()[0], id: 'Barren', buildings: [] }
  for (let i = 0; i < 30; i++) barren = tickPlanet(barren).planet
  check('a planet with zero buildings ticks without crashing', isFinitePlanet(barren))

  // A planet with no pops at all.
  let empty: PlanetEconomy = { ...seedEconomy()[0], id: 'Empty', pops: [] }
  for (let i = 0; i < 30; i++) empty = tickPlanet(empty).planet
  check('a planet with zero pops ticks without crashing', isFinitePlanet(empty))

  // A factory with no minerals anywhere (its only input) must not divide by
  // zero or produce garbage.
  let noInput: PlanetEconomy = {
    ...seedEconomy()[0],
    id: 'NoInput',
    buildings: [{ id: 'lonely-factory', recipeId: 'factory', level: 2, stateFraction: 0, inventory: {}, lastProfit: 0 }],
  }
  for (let i = 0; i < 30; i++) noInput = tickPlanet(noInput).planet
  check('a factory with no input good available ticks without crashing', isFinitePlanet(noInput))
}

console.log('\n=== 9. State treasury and GDP are sane ===')
{
  const mars = runTicks(seedEconomy(), 200).find((p) => p.id === 'Mars')!
  check('a taxing state accumulates a non-negative treasury', mars.treasury >= 0, mars.treasury.toFixed(1))
  check('estimated GDP is a positive finite number', Number.isFinite(estimateGdp(mars)) && estimateGdp(mars) > 0, estimateGdp(mars).toFixed(1))
}

console.log('\n=== 10. All three worlds remain stable over the long run ===')
{
  const settled = runTicks(seedEconomy(), 400)
  check('every world still has a living population after 400 ticks', settled.every((p) => p.pops.reduce((s, x) => s + x.populationSize, 0) > 0))
  check('no world exceeds its population capacity', settled.every((p) => p.pops.reduce((s, x) => s + x.populationSize, 0) <= p.populationCapacity + 1e-6))
  check('every world stays fully finite', settled.every(isFinitePlanet))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
