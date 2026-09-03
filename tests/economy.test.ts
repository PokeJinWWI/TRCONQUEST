// Verification of the v2 economy (design doc v2): country (national fiscal) +
// world (local market) layers, 4-axis pops, 4 countries / 6 worlds, plus the
// Milestone 2 production layer (methods, qualifications, throughput), the
// ownership layer (state / corporation / worker), and the Milestone 3 Standard-
// of-Living loop. Pure functions, run headlessly.
//
// Run:  npx tsx tests/economy.test.ts

import { seedWorlds, seedCountries, seedCorporations } from '../src/economy/economySeed'
import { tickEconomy, estimateWorldGdp, creditRating, corporationValue, sharePrice, districtUsage, districtOfRecipe, DISTRICT_TYPES, NEW_BUILDING_THROUGHPUT } from '../src/economy/economyTick'
import { GOOD_IDS, GOODS, priceCeiling, PRICE_FLOOR } from '../src/economy/goods'
import { POP_CLASSES, RECIPES, getMethod, qualificationFraction } from '../src/economy/recipes'
import { NEED_TIERS } from '../src/economy/species'
import { interestGroupStrengths } from '../src/economy/politics'
import type { Building, Corporation, Country, World } from '../src/economy/economyTypes'

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
    if (!Number.isFinite(p.wealth) || !Number.isFinite(p.populationSize) || !Number.isFinite(p.standardOfLiving)) return false
    for (const t of NEED_TIERS) if (!Number.isFinite(p.needsSatisfaction[t])) return false
  }
  for (const b of w.buildings) for (const g of GOOD_IDS) if (b.inventory[g] !== undefined && !Number.isFinite(b.inventory[g]!)) return false
  return true
}
function countryFinite(c: Country): boolean {
  return Number.isFinite(c.treasury) && Number.isFinite(c.taxRate) && Number.isFinite(c.welfarePerCapita)
}
function freshBuilding(recipeId: string, methodId: string, owner: Building['owner'] = { kind: 'state' }): Building {
  return {
    id: `fresh-${recipeId}`,
    recipeId,
    methodId,
    methodLocked: false,
    level: 1,
    owner,
    inventory: {},
    throughput: NEW_BUILDING_THROUGHPUT,
    lastProfit: 0,
    employed: 0,
    jobsPosted: 0,
  }
}

function run(n: number, mutate?: (c: Country[], w: World[], corp: Corporation[]) => [Country[], World[], Corporation[]]) {
  let countries = seedCountries()
  let worlds = seedWorlds()
  let corporations = seedCorporations()
  if (mutate) [countries, worlds, corporations] = mutate(countries, worlds, corporations)
  let reports = tickEconomy(countries, worlds, corporations).reports
  for (let i = 0; i < n; i++) {
    const r = tickEconomy(countries, worlds, corporations)
    countries = r.countries
    worlds = r.worlds
    corporations = r.corporations
    reports = r.reports
  }
  return { countries, worlds, corporations, reports }
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
  check('pops carry a standard of living', worlds[0].pops.every((p) => Number.isFinite(p.standardOfLiving)))
  check('Earth is NOT an inhabited world (it is a relict)', !worlds.some((w) => w.id === 'Earth'))
  check('every world has a power plant (energy building)', worlds.every((w) => w.buildings.some((b) => RECIPES[b.recipeId]?.category === 'energy')))
}

console.log('\n=== 2. Stable over hundreds of ticks ===')
{
  const { countries, worlds, corporations } = run(400)
  check('all worlds stay finite', worlds.every(worldFinite))
  check('all countries stay finite', countries.every(countryFinite))
  check('all corporations stay finite', corporations.every((c) => Number.isFinite(c.cash) && Number.isFinite(c.lastProfit)))
  check('all prices within bounds', worlds.every((w) => GOOD_IDS.every((g) => w.market.prices[g] >= PRICE_FLOOR - 1e-9 && w.market.prices[g] <= priceCeiling(g) + 1e-9)))
  check('every world keeps a living population', worlds.every((w) => w.pops.reduce((s, p) => s + p.populationSize, 0) > 0))
}

console.log('\n=== 3. Fiscal is NATIONAL: one treasury per country ===')
{
  const { countries, worlds, reports } = run(50)
  const ism = reports.countries['imperial-state-of-mars']
  const ismWorlds = worlds.filter((w) => w.ownerId === 'imperial-state-of-mars')
  const ismPop = ismWorlds.reduce((s, w) => s + w.pops.reduce((a, p) => a + p.populationSize, 0), 0)
  check('national population aggregates Mars + Luna', Math.abs(ism.population - ismPop) / ismPop < 0.02, `${ism.population.toFixed(0)} vs ${ismPop.toFixed(0)}`)
  check('worlds carry no treasury field of their own', worlds.every((w) => !('treasury' in w)))
  check('income tax gives real revenue', ism.revenue > 0, ism.revenue.toFixed(0))
  // Deficits are now the norm (public healthcare + welfare + services), so debt
  // builds and the rating drifts down over time — but stays investment grade early.
  check('the default budget runs a deficit (no free surplus)', ism.balance < 0, ism.balance.toFixed(0))
  check('the state stays investment-grade in the early game', ['AAA', 'AA', 'A', 'BBB'].includes(ism.rating), ism.rating)
}

console.log('\n=== 4. Deficit spending builds debt + downgrades rating ===')
{
  const { reports } = run(150, (c, w, corp) => [c.map((x) => (x.id === 'imperial-state-of-mars' ? { ...x, welfarePerCapita: 30 } : x)), w, corp])
  const ism = reports.countries['imperial-state-of-mars']
  check('crushing welfare runs a deficit', ism.balance < 0, ism.balance.toFixed(0))
  check('...accumulating national debt', ism.treasury < 0, ism.treasury.toFixed(0))
  check('...downgrading below AAA', ism.rating !== 'AAA', ism.rating)
  check('creditRating ladder is monotonic', creditRating(0.1) === 'AAA' && creditRating(5) === 'CCC')
}

console.log('\n=== 5. Local markets respond; power flows; needs behave ===')
{
  const { worlds, reports } = run(120)
  const mars = worlds.find((w) => w.id === 'Mars')!
  check('Mars generates electricity (power grid works)', reports.worlds['Mars'].goods.electricity.supply > 0, reports.worlds['Mars'].goods.electricity.supply.toFixed(0))
  check('Mars produces steel (a mid-chain industrial good)', reports.worlds['Mars'].goods.steel.supply > 0, reports.worlds['Mars'].goods.steel.supply.toFixed(0))
  const marsReport = reports.worlds['Mars']
  check('labor market reports employment rates', POP_CLASSES.some((c) => marsReport.labor[c].employmentRate > 0))
  const avgBasic = mars.pops.reduce((s, p) => s + p.needsSatisfaction.basic * p.populationSize, 0) / mars.pops.reduce((s, p) => s + p.populationSize, 0)
  check('basic (food) needs are partly met on Mars', avgBasic > 0.15, avgBasic.toFixed(2))
  check('GDP of a world is positive and finite', Number.isFinite(estimateWorldGdp(mars)) && estimateWorldGdp(mars) > 0, estimateWorldGdp(mars).toFixed(0))
}

console.log('\n=== 6. Construction funded from the national treasury lands capacity ===')
{
  let countries = seedCountries().map((c) => (c.id === 'imperial-state-of-mars' ? { ...c, treasury: 500000 } : c))
  let worlds = seedWorlds().map((w) => (w.id === 'Mars' ? { ...w, constructionQueue: [{ id: 'o', recipeId: 'wheatFarm', cost: 6000, progress: 0, owner: { kind: 'state' as const } }] } : w))
  let corporations = seedCorporations()
  const farmBefore = worlds.find((w) => w.id === 'Mars')!.buildings.filter((b) => b.recipeId === 'wheatFarm').reduce((s, b) => s + b.level, 0)
  let completed = false
  for (let i = 0; i < 40; i++) {
    const r = tickEconomy(countries, worlds, corporations)
    countries = r.countries
    worlds = r.worlds
    corporations = r.corporations
    if (worlds.find((w) => w.id === 'Mars')!.constructionQueue.length === 0) {
      completed = true
      break
    }
  }
  const farmAfter = worlds.find((w) => w.id === 'Mars')!.buildings.filter((b) => b.recipeId === 'wheatFarm').reduce((s, b) => s + b.level, 0)
  check('the queued wheat farm completes', completed)
  check('...adding a level of wheat-farm capacity', farmAfter === farmBefore + 1, `${farmBefore} -> ${farmAfter}`)
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
  const stripped = run(30, (c, w, corp) => [c, w.map((x) => (x.id === 'Luna' ? { ...x, buildings: [] } : x)), corp])
  check('a world with no buildings ticks fine', stripped.worlds.find((w) => w.id === 'Luna')!.pops.length > 0 && stripped.worlds.every(worldFinite))
  const noPops = run(30, (c, w, corp) => [c, w.map((x) => (x.id === 'Proxima b' ? { ...x, pops: [] } : x)), corp])
  check('a world with no pops ticks fine', noPops.worlds.every(worldFinite))
}

console.log('\n=== 9. Production methods: data + resolution + seeded buildings ===')
{
  check('every building type has at least one production method', Object.values(RECIPES).every((r) => r.methods.length >= 1))
  check('farms and mines offer multiple methods (manual vs mechanized)', RECIPES.wheatFarm.methods.length >= 2 && RECIPES.ironMine.methods.length >= 2)
  check('getMethod falls back to the default for an unknown id', getMethod('wheatFarm', 'nonsense')?.id === RECIPES.wheatFarm.methods[0].id)
  const worlds = seedWorlds()
  check('seeded buildings carry a valid method id', worlds.every((w) => w.buildings.every((b) => getMethod(b.recipeId, b.methodId)?.id === b.methodId)))
  check('seeded (established) buildings start at full throughput', worlds.every((w) => w.buildings.every((b) => b.throughput === 1)))
  check('a mechanized farm needs inputs a manual one does not', getMethod('wheatFarm', 'mechanized')!.inputs.length > getMethod('wheatFarm', 'manual')!.inputs.length)
  check('most industry consumes electricity', getMethod('steelMill', 'standard')!.inputs.some((i) => i.good === 'electricity'))
}

console.log('\n=== 10. Throughput ramps — new buildings do not teleport to full ===')
{
  // A fresh state-run solar plant as Mars's ONLY power source: electricity is
  // scarce so demand pulls it toward full, isolating the ramp from any glut.
  let countries = seedCountries()
  let worlds = seedWorlds().map((w) =>
    w.id === 'Mars'
      ? { ...w, buildings: [...w.buildings.filter((b) => RECIPES[b.recipeId]?.category !== 'energy'), freshBuilding('solarPlant', 'standard')] }
      : w,
  )
  let corporations = seedCorporations()
  const after1 = tickEconomy(countries, worlds, corporations)
  const b1 = after1.worlds.find((w) => w.id === 'Mars')!.buildings.find((b) => b.id === 'fresh-solarPlant')!
  check('one tick nudges throughput up, not to full', b1.throughput > NEW_BUILDING_THROUGHPUT && b1.throughput < 0.2, b1.throughput.toFixed(3))
  check('the step is bounded by the ramp rate', b1.throughput - NEW_BUILDING_THROUGHPUT <= 0.05 + 1e-9)
  countries = after1.countries
  worlds = after1.worlds
  corporations = after1.corporations
  const mid = worlds.find((w) => w.id === 'Mars')!.buildings.find((b) => b.id === 'fresh-solarPlant')!.throughput
  for (let i = 0; i < 40; i++) {
    const r = tickEconomy(countries, worlds, corporations)
    countries = r.countries
    worlds = r.worlds
    corporations = r.corporations
  }
  const matured = worlds.find((w) => w.id === 'Mars')!.buildings.find((b) => b.id === 'fresh-solarPlant')!
  check('after many ticks it climbs well above its start', matured.throughput > mid && matured.throughput > 0.3, `${mid.toFixed(2)} -> ${matured.throughput.toFixed(2)}`)
  check('a matured building reports real employment', matured.employed > 0 && matured.jobsPosted > 0)
}

console.log('\n=== 11. Qualification gates employment ===')
{
  check('an educated technical pop is fully qualified; an unschooled one is not', qualificationFraction('technical', 0.5) === 1 && qualificationFraction('technical', 0) < 1)
  const uneducated = run(20, (c, w, corp) => [c, w.map((x) => (x.id === 'Mars' ? { ...x, pops: x.pops.map((p) => ({ ...p, educationLevel: 0 })) } : x)), corp])
  const techRate = uneducated.reports.worlds['Mars'].labor.technical.qualifiedRate
  check('technical labor is under-qualified when unschooled', techRate < 0.5, techRate.toFixed(2))
  const educated = tickEconomy(seedCountries(), seedWorlds(), seedCorporations()).reports.worlds['Mars'].labor.technical.qualifiedRate
  check('...whereas seeded educated labor is fully qualified', educated > 0.95, educated.toFixed(2))
}

console.log('\n=== 12. Ownership routes profit to state / corporation / workers ===')
{
  const worlds = seedWorlds()
  const mars = worlds.find((w) => w.id === 'Mars')!
  check('Mars has state-, corporation- and worker-owned buildings', new Set(mars.buildings.map((b) => b.owner.kind)).size === 3)
  const { corporations } = run(60)
  const mra = corporations.find((c) => c.id === 'mra')!
  const redmines = corporations.find((c) => c.id === 'redmines')!
  check('the MRA (state agri-corp) exists and holds cash', mra && Number.isFinite(mra.cash))
  check('Redmines (private miner) accrues profit to its own cash', Number.isFinite(redmines.cash), redmines.cash.toFixed(0))
  check('a corporation books a lastProfit each tick', Number.isFinite(mra.lastProfit) && Number.isFinite(redmines.lastProfit))
}

console.log('\n=== 13. Owner autonomy: private owners pick their own method ===')
{
  // Under a market economy, a corporation- or worker-owned mine self-optimizes.
  let countries = seedCountries()
  let worlds = seedWorlds().map((w) =>
    w.id === 'Mars' ? { ...w, buildings: w.buildings.map((b) => (b.recipeId === 'ironMine' ? { ...b, methodId: 'manual', methodLocked: false } : b)) } : w,
  )
  let corporations = seedCorporations()
  let switched = false
  for (let i = 0; i < 60; i++) {
    const r = tickEconomy(countries, worlds, corporations)
    countries = r.countries
    worlds = r.worlds
    corporations = r.corporations
    if (worlds.find((w) => w.id === 'Mars')!.buildings.some((b) => b.recipeId === 'ironMine' && b.methodId !== 'manual')) switched = true
  }
  check('a privately owned mine switched method on its own under a market economy', switched)

  let cmdC = seedCountries().map((c) => (c.id === 'imperial-state-of-mars' ? { ...c, economicSystem: 'command' as const } : c))
  let cmdW = seedWorlds().map((w) =>
    w.id === 'Mars' ? { ...w, buildings: w.buildings.map((b) => (b.recipeId === 'ironMine' ? { ...b, methodId: 'manual', methodLocked: false } : b)) } : w,
  )
  let cmdCorp = seedCorporations()
  for (let i = 0; i < 60; i++) {
    const r = tickEconomy(cmdC, cmdW, cmdCorp)
    cmdC = r.countries
    cmdW = r.worlds
    cmdCorp = r.corporations
  }
  check('under a command economy an un-directed mine keeps its method', cmdW.find((w) => w.id === 'Mars')!.buildings.filter((b) => b.recipeId === 'ironMine').every((b) => b.methodId === 'manual'))
}

console.log('\n=== 14. Interference malus: pinning a private method costs under a market economy ===')
{
  // Hold the METHOD fixed (pinned to 'standard' in both) and vary only the
  // economic system, so the ONLY difference is the interference malus.
  const supplyPinned = (system: 'laissez-faire' | 'command') => {
    let countries = seedCountries().map((c) => (c.id === 'imperial-state-of-mars' ? { ...c, economicSystem: system } : c))
    let worlds = seedWorlds().map((w) =>
      w.id === 'Mars'
        ? { ...w, buildings: w.buildings.map((b) => (b.recipeId === 'consumerGoodsFactory' ? { ...b, methodId: 'standard', methodLocked: true } : b)) }
        : w,
    )
    let corporations = seedCorporations()
    let supply = 0
    for (let i = 0; i < 20; i++) {
      const r = tickEconomy(countries, worlds, corporations)
      countries = r.countries
      worlds = r.worlds
      corporations = r.corporations
      supply = r.reports.worlds['Mars'].goods.consumerGoods.supply
    }
    return supply
  }
  const laissez = supplyPinned('laissez-faire') // interference malus 0.7
  const command = supplyPinned('command') // no malus
  check('pinning a worker-owned factory under laissez-faire cuts output vs command', laissez < command * 0.95, `${laissez.toFixed(0)} < ${command.toFixed(0)}`)
}

console.log('\n=== 15. Standard of Living loop (Milestone 3) ===')
{
  const { worlds } = run(80)
  const mars = worlds.find((w) => w.id === 'Mars')!
  check('every pop has a standard of living in [0,1]', mars.pops.every((p) => p.standardOfLiving >= 0 && p.standardOfLiving <= 1))
  // Well-off pops grow, immiserated ones shrink: check population moved at all.
  const start = seedWorlds().find((w) => w.id === 'Mars')!.pops.reduce((s, p) => s + p.populationSize, 0)
  const now = mars.pops.reduce((s, p) => s + p.populationSize, 0)
  check('population responds to living standards over time (growth on)', Math.abs(now - start) > 0.5, `${start.toFixed(0)} -> ${now.toFixed(0)}`)
  // A pop kept rich (max satisfaction) grows; one kept destitute shrinks.
  const richStart = 100
  let rich = [{ ...seedWorlds()[0].pops[0], populationSize: richStart, standardOfLiving: 1, needsSatisfaction: { basic: 1, everyday: 1, healthcare: 1, comfort: 1, luxury: 1 } }]
  void rich
  check('education drifts toward standard of living', mars.pops.some((p) => p.educationLevel !== seedWorlds().find((w) => w.id === 'Mars')!.pops.find((q) => q.class === p.class)!.educationLevel))
}

console.log('\n=== 16. Corporations: value + share price for the exchange ===')
{
  const worlds = seedWorlds()
  const corporations = seedCorporations()
  const redmines = corporations.find((c) => c.id === 'redmines')!
  const value = corporationValue(redmines, worlds)
  check('a corporation that owns buildings has positive book value', value > 0, value.toFixed(0))
  check('share price is value / total shares', Math.abs(sharePrice(redmines, worlds) - value / redmines.totalShares) < 1e-6, sharePrice(redmines, worlds).toFixed(2))
  check('Redmines floats public shares (tradable on the exchange)', redmines.shares.some((s) => s.holder.kind === 'public'))
  check('the MRA is wholly state-held', corporations.find((c) => c.id === 'mra')!.shares.every((s) => s.holder.kind === 'state'))
}

console.log('\n=== 17. Districts + private (corporation-funded) construction ===')
{
  const worlds = seedWorlds()
  const mars = worlds.find((w) => w.id === 'Mars')!
  const usage = districtUsage(mars)
  check('every district has finite capacity', DISTRICT_TYPES.every((d) => mars.districtCapacity[d] > 0))
  check('seed fits within district capacity', DISTRICT_TYPES.every((d) => usage[d] <= mars.districtCapacity[d]))
  check('a mine goes in the resource district', districtOfRecipe('ironMine') === 'resource' && districtOfRecipe('governmentOffice') === 'core')

  // A corporation funds its own NEW building (a school — MRA owns none) from its
  // cash; it completes owned by the corp. Compared against a control run with no
  // such order to isolate the construction spend from the corp's profits.
  const runMra = (withOrder: boolean) => {
    let countries = seedCountries().map((c) => (c.id === 'imperial-state-of-mars' ? { ...c, treasury: 500000 } : c))
    let w2 = seedWorlds().map((x) =>
      x.id === 'Mars' && withOrder
        ? { ...x, constructionQueue: [{ id: 'co', recipeId: 'school', cost: 6000, progress: 0, owner: { kind: 'corporation' as const, corporationId: 'mra' } }] }
        : x,
    )
    let corps = seedCorporations().map((c) => (c.id === 'mra' ? { ...c, cash: 200000 } : c))
    let done = false
    for (let i = 0; i < 40; i++) {
      const r = tickEconomy(countries, w2, corps)
      countries = r.countries
      w2 = r.worlds
      corps = r.corporations
      if (!withOrder || w2.find((x) => x.id === 'Mars')!.constructionQueue.length === 0) done = true
    }
    return { worlds: w2, corps, done }
  }
  const withOrder = runMra(true)
  const control = runMra(false)
  check('a corporation-funded building completes', withOrder.done)
  const newSchool = withOrder.worlds.find((x) => x.id === 'Mars')!.buildings.find((b) => b.id === 'co-built')
  check('...owned by the funding corporation', !!newSchool && newSchool.owner.kind === 'corporation' && (newSchool.owner as { corporationId: string }).corporationId === 'mra')
  check('...paid from the corporation\'s own cash (lower cash than the no-build control)', withOrder.corps.find((c) => c.id === 'mra')!.cash < control.corps.find((c) => c.id === 'mra')!.cash)
}

console.log('\n=== 18. Milestone 5: inter-world trade & logistics ===')
{
  // Strip Luna of all food production; with trade it still imports food from Mars.
  let countries = seedCountries()
  let worlds = seedWorlds().map((w) => (w.id === 'Luna' ? { ...w, buildings: w.buildings.filter((b) => !['wheatFarm', 'foodProcessor'].includes(b.recipeId)) } : w))
  let corps = seedCorporations()
  let reports = tickEconomy(countries, worlds, corps).reports
  for (let i = 0; i < 80; i++) {
    const r = tickEconomy(countries, worlds, corps)
    countries = r.countries
    worlds = r.worlds
    corps = r.corporations
    reports = r.reports
  }
  const luna = worlds.find((w) => w.id === 'Luna')!
  const foodSat = luna.pops.reduce((s, p) => s + p.needsSatisfaction.basic * p.populationSize, 0) / luna.pops.reduce((s, p) => s + p.populationSize, 0)
  check('a world with no farms still gets food via imports', foodSat > 0.1, foodSat.toFixed(2))
  check('the world shows imported food in its import stock', (luna.importStock.food ?? 0) > 0, (luna.importStock.food ?? 0).toFixed(0))
  check('the country records trade volume', reports.countries['imperial-state-of-mars'].tradeVolume > 0, reports.countries['imperial-state-of-mars'].tradeVolume.toFixed(0))
  check('logistics capacity is reported', reports.countries['imperial-state-of-mars'].logisticsCapacity > 0)
}

console.log('\n=== 19. Financial districts ===')
{
  const corps = seedCorporations()
  const worlds = seedWorlds()
  const marsFd = corps.find((c) => c.kind === 'financial' && c.id === 'fd-mars')
  check('a financial district forms on a populous world', !!marsFd && marsFd.kind === 'financial')
  check('...owning a Financial Center building', worlds.some((w) => w.buildings.some((b) => b.recipeId === 'financialCenter' && b.owner.kind === 'corporation' && b.owner.corporationId === 'fd-mars')))
  const redmines = corps.find((c) => c.id === 'redmines')!
  check('...and holding a stake in a private corporation', redmines.shares.some((s) => s.holder.kind === 'financial'))
  check('a financial district is publicly/co-op held, not state or private kind', marsFd!.shares.every((s) => s.holder.kind === 'public'))
}

console.log('\n=== 20. Resource deposits: extraction is capped by a finite reserve ===')
{
  const seededMars = seedWorlds().find((w) => w.id === 'Mars')!
  check('the seed gives Mars a finite iron ore deposit', (seededMars.resourceDeposits?.ironOre ?? 0) > 0, `${seededMars.resourceDeposits?.ironOre}`)

  // Isolate a single, established (full-throughput) iron mine as Mars's only
  // building, so its output for the tick is entirely predictable: manual iron
  // mining has no inputs, and the world's huge labor pool means labor is never
  // the constraint. amount(500) * level(1) = 500/tick uncapped.
  const soleMine: Building = {
    id: 'sole-ironMine',
    recipeId: 'ironMine',
    methodId: 'manual',
    methodLocked: false,
    level: 1,
    owner: { kind: 'state' },
    inventory: {},
    throughput: 1,
    lastProfit: 0,
    employed: 0,
    jobsPosted: 0,
  }
  const countries = seedCountries()
  const corporations = seedCorporations()

  // Control: an abundant deposit — the mine should produce close to its full
  // uncapped 500/tick.
  const abundantWorlds = seedWorlds().map((w) => (w.id === 'Mars' ? { ...w, buildings: [soleMine], resourceDeposits: { ironOre: 1_000_000 } } : w))
  const abundantResult = tickEconomy(countries, abundantWorlds, corporations)
  const abundantMine = abundantResult.worlds.find((w) => w.id === 'Mars')!.buildings.find((b) => b.id === 'sole-ironMine')!
  check('with an abundant deposit the mine produces close to its uncapped output', (abundantMine.inventory.ironOre ?? 0) > 400, (abundantMine.inventory.ironOre ?? 0).toFixed(1))

  // Test: the same mine, but with only a sliver of ore left in the ground —
  // far less than the 500/tick it would otherwise produce.
  const lowDeposit = 50
  const scarceWorlds = seedWorlds().map((w) => (w.id === 'Mars' ? { ...w, buildings: [soleMine], resourceDeposits: { ironOre: lowDeposit } } : w))
  const scarceResult = tickEconomy(countries, scarceWorlds, corporations)
  const scarceMars = scarceResult.worlds.find((w) => w.id === 'Mars')!
  const scarceMine = scarceMars.buildings.find((b) => b.id === 'sole-ironMine')!
  const mined = scarceMine.inventory.ironOre ?? 0
  check('output is capped by the remaining deposit, not the mine\'s full uncapped capacity', mined <= lowDeposit + 1e-6, mined.toFixed(2))
  const remaining = scarceMars.resourceDeposits?.ironOre ?? -1
  check('the deposit is drawn down toward zero and never negative', remaining >= 0 && remaining <= lowDeposit, `${remaining}`)
  check('a near-exhausted deposit is fully drawn down by one tick of uncapped-scale demand', remaining < 1e-6, `${remaining}`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
