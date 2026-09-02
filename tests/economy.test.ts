// Verification of the v2 economy (design doc v2): country (national fiscal) +
// world (local market) layers, 4-axis pops, 4 countries / 6 worlds. Pure
// functions, run headlessly.
//
// Run:  npx tsx tests/economy.test.ts

import { seedWorlds, seedCountries } from '../src/economy/economySeed'
import { tickEconomy, estimateWorldGdp, creditRating, NEW_BUILDING_THROUGHPUT } from '../src/economy/economyTick'
import { GOOD_IDS, GOODS, priceCeiling, PRICE_FLOOR } from '../src/economy/goods'
import { POP_CLASSES, RECIPES, getMethod, qualificationFraction } from '../src/economy/recipes'
import { NEED_TIERS } from '../src/economy/species'
import { interestGroupStrengths } from '../src/economy/politics'
import type { Building, Country, World } from '../src/economy/economyTypes'

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

// ============================ Milestone 2 ============================
// Production methods, qualification-gated employment, and throughput ramping.

function freshBuilding(recipeId: string, methodId: string, stateFraction = 0): Building {
  return {
    id: `fresh-${recipeId}`,
    recipeId,
    methodId,
    methodLocked: false,
    level: 1,
    stateFraction,
    inventory: {},
    throughput: NEW_BUILDING_THROUGHPUT,
    lastProfit: 0,
    employed: 0,
    jobsPosted: 0,
  }
}

console.log('\n=== 9. Production methods: data + resolution + seeded buildings ===')
{
  check('every building type offers at least two production methods', Object.values(RECIPES).every((r) => r.methods.length >= 2))
  check('getMethod falls back to the default for an unknown id', getMethod('farm', 'nonsense')?.id === RECIPES.farm.methods[0].id)
  const worlds = seedWorlds()
  check('seeded buildings carry a valid method id', worlds.every((w) => w.buildings.every((b) => getMethod(b.recipeId, b.methodId)?.id === b.methodId)))
  check('seeded (established) buildings start at full throughput', worlds.every((w) => w.buildings.every((b) => b.throughput === 1)))
  check('a mechanized method needs inputs a manual one does not', getMethod('farm', 'mechanized')!.inputs.length > getMethod('farm', 'manual')!.inputs.length)
}

console.log('\n=== 10. Throughput ramps — new buildings do not teleport to full output ===')
{
  // A fresh, state-run farm (throughput 0.1) as Mars's ONLY food source: food
  // is scarce so demand pulls it toward full, and state ownership keeps owner
  // autonomy from switching its method — isolating the labor/throughput ramp. It
  // should climb gradually, not snap.
  let countries = seedCountries()
  let worlds = seedWorlds().map((w) =>
    w.id === 'Mars' ? { ...w, buildings: [...w.buildings.filter((b) => b.recipeId !== 'farm'), freshBuilding('farm', 'manual', 1)] } : w,
  )
  const after1 = tickEconomy(countries, worlds)
  const b1 = after1.worlds.find((w) => w.id === 'Mars')!.buildings.find((b) => b.id === 'fresh-farm')!
  check('one tick nudges throughput up, not to full', b1.throughput > NEW_BUILDING_THROUGHPUT && b1.throughput < 0.2, b1.throughput.toFixed(3))
  check('the step is bounded by the ramp rate', b1.throughput - NEW_BUILDING_THROUGHPUT <= 0.05 + 1e-9)
  countries = after1.countries
  worlds = after1.worlds
  for (let i = 0; i < 4; i++) {
    const r = tickEconomy(countries, worlds)
    countries = r.countries
    worlds = r.worlds
  }
  const midThroughput = worlds.find((w) => w.id === 'Mars')!.buildings.find((b) => b.id === 'fresh-farm')!.throughput
  for (let i = 0; i < 40; i++) {
    const r = tickEconomy(countries, worlds)
    countries = r.countries
    worlds = r.worlds
  }
  const matured = worlds.find((w) => w.id === 'Mars')!.buildings.find((b) => b.id === 'fresh-farm')!
  check('after many ticks it reaches high throughput', matured.throughput > 0.8, matured.throughput.toFixed(2))
  check('throughput climbed over time (ramp, not snap)', matured.throughput > midThroughput, `${midThroughput.toFixed(2)} -> ${matured.throughput.toFixed(2)}`)
  check('a matured building reports real employment against its posted jobs', matured.employed > 0 && matured.jobsPosted > 0)
}

console.log('\n=== 11. Qualification gates employment ===')
{
  check('an educated technical pop is fully qualified; an unschooled one is not', qualificationFraction('technical', 0.5) === 1 && qualificationFraction('technical', 0) < 1)
  // A Mars where NOBODY is educated: the skilled rungs (technical/professional)
  // can only partly staff their jobs, so the factory throttles down.
  let countries = seedCountries()
  let worlds = seedWorlds().map((w) =>
    w.id === 'Mars' ? { ...w, pops: w.pops.map((p) => ({ ...p, educationLevel: 0 })) } : w,
  )
  let reports = tickEconomy(countries, worlds).reports
  for (let i = 0; i < 30; i++) {
    const r = tickEconomy(countries, worlds)
    countries = r.countries
    worlds = r.worlds
    reports = r.reports
  }
  const techRate = reports.worlds['Mars'].labor.technical.qualifiedRate
  check('technical labor is under-qualified when unschooled', techRate < 0.5, techRate.toFixed(2))
  const factory = worlds.find((w) => w.id === 'Mars')!.buildings.find((b) => b.recipeId === 'factory')!
  check('the factory throttles below full throughput for lack of skilled labor', factory.throughput < 0.95, factory.throughput.toFixed(2))
  // Control: with the seeded (educated) pops, technical labor is fully qualified.
  const educated = tickEconomy(seedCountries(), seedWorlds()).reports.worlds['Mars'].labor.technical.qualifiedRate
  check('...whereas seeded educated labor is fully qualified', educated > 0.95, educated.toFixed(2))
}

console.log('\n=== 12. Switching production method changes inputs/outputs ===')
{
  // Same Mars, farms on manual vs mechanized: the mechanized line demands
  // minerals (equipment) the manual one never touches.
  const manual = seedWorlds()
  const mechanized = seedWorlds().map((w) =>
    w.id === 'Mars' ? { ...w, buildings: w.buildings.map((b) => (b.recipeId === 'farm' ? { ...b, methodId: 'mechanized' } : b)) } : w,
  )
  const manualDemand = tickEconomy(seedCountries(), manual).reports.worlds['Mars'].goods.minerals.demand
  const mechDemand = tickEconomy(seedCountries(), mechanized).reports.worlds['Mars'].goods.minerals.demand
  check('mechanized farming raises minerals demand vs manual', mechDemand > manualDemand, `${manualDemand.toFixed(0)} -> ${mechDemand.toFixed(0)}`)
  check('the two methods post different worker mixes', getMethod('farm', 'manual')!.jobs.length !== getMethod('farm', 'mechanized')!.jobs.length)
}

console.log('\n=== 13. Owner autonomy: private owners pick their own method ===')
{
  // A world whose farm would be more profitable mechanized: give it cheap
  // minerals and skilled labor, then let the private owner run itself. Under a
  // market economy it should switch off the manual default on its own.
  const build = () =>
    seedWorlds().map((w) =>
      w.id === 'Mars'
        ? { ...w, buildings: w.buildings.map((b) => (b.recipeId === 'farm' ? { ...b, methodId: 'manual', methodLocked: false } : b)) }
        : w,
    )
  let countries = seedCountries()
  let worlds = build()
  let switched = false
  for (let i = 0; i < 60; i++) {
    const r = tickEconomy(countries, worlds)
    countries = r.countries
    worlds = r.worlds
    if (worlds.find((w) => w.id === 'Mars')!.buildings.some((b) => b.recipeId === 'farm' && b.methodId !== 'manual')) switched = true
  }
  check('a private farm switched method on its own under a market economy', switched)

  // Under a command economy owners do NOT self-optimize: the method sticks.
  let cmdCountries = seedCountries().map((c) => (c.id === 'imperial-state-of-mars' ? { ...c, economicSystem: 'command' as const } : c))
  let cmdWorlds = build()
  for (let i = 0; i < 60; i++) {
    const r = tickEconomy(cmdCountries, cmdWorlds)
    cmdCountries = r.countries
    cmdWorlds = r.worlds
  }
  check('under a command economy an un-directed farm keeps its method', cmdWorlds.find((w) => w.id === 'Mars')!.buildings.filter((b) => b.recipeId === 'farm').every((b) => b.methodId === 'manual'))
}

console.log('\n=== 14. Interference malus: overriding a private method costs under a market economy ===')
{
  // Same private factory, pinned by the state to its current method. Under
  // laissez-faire that interference cuts its output vs an un-pinned control;
  // under a command economy it does not.
  const factoryOutput = (system: 'laissez-faire' | 'command', pinned: boolean) => {
    let countries = seedCountries().map((c) => (c.id === 'imperial-state-of-mars' ? { ...c, economicSystem: system } : c))
    let worlds = seedWorlds().map((w) =>
      w.id === 'Mars'
        ? { ...w, buildings: w.buildings.map((b) => (b.recipeId === 'factory' ? { ...b, methodLocked: pinned } : b)) }
        : w,
    )
    let supply = 0
    for (let i = 0; i < 20; i++) {
      const r = tickEconomy(countries, worlds)
      countries = r.countries
      worlds = r.worlds
      supply = r.reports.worlds['Mars'].goods.consumerGoods.supply
    }
    return supply
  }
  const free = factoryOutput('laissez-faire', false)
  const pinnedMarket = factoryOutput('laissez-faire', true)
  const pinnedCommand = factoryOutput('command', true)
  check('pinning a private method under laissez-faire cuts output', pinnedMarket < free * 0.98, `${pinnedMarket.toFixed(0)} < ${free.toFixed(0)}`)
  check('the same pin under a command economy carries no such malus', pinnedCommand >= free * 0.98, `${pinnedCommand.toFixed(0)} vs ${free.toFixed(0)}`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
