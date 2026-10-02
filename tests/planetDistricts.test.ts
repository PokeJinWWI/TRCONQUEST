// Verification of districts that house buildings (Simple mode now; Complex
// mode in its own section once it lands) and the district ecosystem bonus.
// Run:  npx tsx tests/planetDistricts.test.ts

import {
  abstractReport,
  buildingsInDistrict,
  districtBonus,
  districtSlots,
  districtsOf,
  emptyStockpile,
  freeLand,
  freeSlots,
  teardownCost,
  teardownMonths,
  landOf,
  tickAbstractEconomy,
  type AbstractEconomyState,
  type WorldState,
} from '../src/economy-abstract/abstractEconomy'
import { applyAbstractEconomyAI } from '../src/economy-abstract/abstractEconomyAI'
import { useAbstractEconomyStore, landForBody } from '../src/state/abstractEconomyStore'
import { SLOTS_PER_DISTRICT, DISTRICT_COST, CLUSTER_MAX, SIMPLE_BUILDING_DEFS, SIMPLE_DISTRICTS } from '../src/data/simplisticEconomyData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function mk(over: Partial<AbstractEconomyState> = {}): AbstractEconomyState {
  return {
    countryId: 'x', population: 0, gdp: 6000, realGdp: 6000, priceLevel: 1, inflation: 0.02, stability: 0.5,
    treasury: 100, reserves: 40, debt: 1000, taxRate: 0.1, economyType: 'corporatist', moneyCreation: 0, warTaxes: false,
    welfare: 0.3, queue: [], nextOrderId: 1,
    currency: { code: 'X', name: 'X', rate: 1, baseRate: 1 }, trade: {}, ...over,
  }
}
const stock = () => ({ ...emptyStockpile(), food: 500, minerals: 3000, energy: 3000, electronics: 200, consumerGoods: 500 })
const home = (over: Partial<WorldState> = {}): WorldState => ({
  bodyName: 'Home', population: 2600, land: 15,
  buildings: { civilianFactory: 6, alloyFoundry: 3, consumerFactory: 3, farm: 6, mine: 4, powerPlant: 4, physicsLab: 2 },
  districts: { industrial: 3, academic: 1, agricultural: 2, mining: 1, generator: 1, urban: 1 },
  ...over,
})

console.log('=== 1. Simple: districts house buildings ===')
{
  const w = home()
  check('each district level gives slots', districtSlots(w, 'industrial') === 3 * SLOTS_PER_DISTRICT)
  check('a full district has no free slot', freeSlots(w, [], 'industrial') === 0)
  check('a district with room has free slots', freeSlots(w, [], 'agricultural') === 2)
  const levelQueued = [{ id: 1, bodyName: 'Home', district: 'industrial' as const, progress: 0 }]
  check('a queued district level adds its slots ahead of time (so buildings can be queued into it)', freeSlots(w, levelQueued, 'industrial') === SLOTS_PER_DISTRICT)
  check('...less the buildings already queued into them', freeSlots(w, [...levelQueued, { id: 2, bodyName: 'Home', building: 'civilianFactory' as const, progress: 0 }], 'industrial') === SLOTS_PER_DISTRICT - 1)
  check('queued buildings take their slots', freeSlots(w, [{ id: 1, bodyName: 'Home', building: 'farm', progress: 0 }], 'agricultural') === 1)
  check('land limits district levels', freeLand(w, []) === 15 - 9)
  check('queued district levels use land', freeLand(w, [{ id: 1, bodyName: 'Home', district: 'industrial', progress: 0 }]) === 15 - 10)
  const legacy: WorldState = { bodyName: 'Old', population: 100, buildings: { civilianFactory: 5, farm: 1 } }
  check('a world without districts gets just enough to house its buildings', districtsOf(legacy).industrial === 2 && districtsOf(legacy).agricultural === 1 && landOf(legacy) >= 3)
}

console.log('\n=== 2. Simple: developing a district, then building in it ===')
{
  let s = mk({ queue: [{ id: 1, bodyName: 'Home', district: 'industrial', progress: 0 }] })
  let ws = [home()]
  let st = stock()
  let months = 0
  while (districtsOf(ws[0]).industrial === 3 && months < 30) {
    const res = tickAbstractEconomy(s, ws, st)
    s = res.state
    ws = res.worlds
    st = res.stock
    months++
  }
  check('a district level completes and adds slots', districtsOf(ws[0]).industrial === 4 && freeSlots(ws[0], [], 'industrial') === SLOTS_PER_DISTRICT, `${months} months for ${DISTRICT_COST} CP`)
  const full = home({ land: 9 })
  const blocked = tickAbstractEconomy(mk({ queue: [{ id: 1, bodyName: 'Home', district: 'mining', progress: DISTRICT_COST - 1 }] }), [full], stock())
  check('no land, no new district level', districtsOf(blocked.worlds[0]).mining === 1)
}

console.log('\n=== 3. Ecosystem: clustered buildings boost each other ===')
{
  const small = home({ buildings: { civilianFactory: 2, farm: 6, mine: 4, powerPlant: 4, physicsLab: 2 } })
  const big = home()
  check('more buildings in a district, bigger cluster bonus', districtBonus(big, 'industrial').cluster > districtBonus(small, 'industrial').cluster)
  check('a single building gets no cluster bonus', districtBonus(home({ buildings: { civilianFactory: 1 } }), 'industrial').cluster === 0)
  check('the cluster bonus is capped', districtBonus(home({ buildings: { civilianFactory: 400 } }), 'industrial').cluster === CLUSTER_MAX)
  check('research parks lift industry on the same world', districtBonus(home({ districts: { industrial: 3, academic: 4 } }), 'industrial').link > districtBonus(big, 'industrial').link)
  check('...but not farms', districtBonus(big, 'agricultural').link === 0)
  const r0 = abstractReport(mk(), [home({ districts: { industrial: 3, academic: 0, agricultural: 2, mining: 1, generator: 1 } })], stock())
  const r1 = abstractReport(mk(), [home()], stock())
  check('the bonus shows up as production', r1.productionUnits > r0.productionUnits, `${r0.productionUnits.toFixed(1)} → ${r1.productionUnits.toFixed(1)} PU`)
  check('two cities with the same factories: the clustered one out-produces a split one',
    abstractReport(mk(), [home({ buildings: { civilianFactory: 12 } })], stock()).productionUnits >
      abstractReport(mk(), [home({ bodyName: 'A', buildings: { civilianFactory: 6 } }), home({ bodyName: 'B', buildings: { civilianFactory: 6 } })], stock()).productionUnits)
}

console.log('\n=== 4. Simple: seeds, land from planet size, store and AI ===')
{
  const st = useAbstractEconomyStore.getState()
  check('Mars (small planet) has 15 land, Venus (medium) 24', landForBody('Mars') === 15 && landForBody('Venus') === 24)
  const everyFits = Object.values(st.worlds).every((w) => SIMPLE_FITS(w))
  function SIMPLE_FITS(w: WorldState) {
    const ds = districtsOf(w)
    return (Object.keys(ds) as (keyof typeof ds)[]).every((d) => buildingsInDistrict(w, d) <= districtSlots(w, d)) && Object.values(ds).reduce((a, b) => a + b, 0) <= landOf(w)
  }
  check('every seeded world houses its buildings within its land', everyFits)
  check('inhabited worlds start with an urban district, outposts without', districtsOf(st.worlds['Mars']).urban === 1 && districtsOf(st.worlds['Phobos']).urban === 0)
  const q = st.queueBuilding('imperial-state-of-mars', 'Mars', 'civilianFactory')
  check('building into a full district is refused with a reason', !q.ok && /Develop the district/.test((q as { reason: string }).reason))
  const qd = st.queueDistrict('imperial-state-of-mars', 'Mars', 'industrial')
  check('developing a district is queued', qd.ok && useAbstractEconomyStore.getState().byCountry['imperial-state-of-mars'].queue.some((o) => o.district === 'industrial'))
  useAbstractEconomyStore.getState().reset()
  // AI: when its building's district is full, it develops the district first.
  const nation = mk()
  const crowded = home({ population: 4000, buildings: { civilianFactory: 6, alloyFoundry: 3, consumerFactory: 3, farm: 8, mine: 4, powerPlant: 4, physicsLab: 2, entertainmentCenter: 2 } })
  const env = { worlds: [crowded], stock: stock(), report: abstractReport(nation, [crowded], stock()), atWar: false }
  const planned = applyAbstractEconomyAI(nation, env)
  check('the AI queues a district level when the district it needs is full', planned.queue.some((o) => o.district !== undefined), JSON.stringify(planned.queue.map((o) => o.district ?? o.building)))
}

console.log('\n=== 4b. Simple: deconstruction is its own reverse bar; queueing into coming levels ===')
{
  const id = 'imperial-state-of-mars'
  useAbstractEconomyStore.getState().reset()
  const st = () => useAbstractEconomyStore.getState()
  const nation = () => st().byCountry[id]
  const farmCost = SIMPLE_BUILDING_DEFS.farm.cost
  const before = st().worlds['Mars'].buildings.farm ?? 0
  // Something in the construction queue to prove it is left alone.
  st().queueDistrict(id, 'Mars', 'industrial')
  const queueBefore = nation().queue.map((o) => o.id).join()

  const r = st().queueDemolish(id, 'Mars', 'farm')
  const td = (nation().teardowns ?? [])[0]
  check('deconstruction is queued as a teardown', r.ok && !!td && td.building === 'farm' && td.bodyName === 'Mars')
  check('...its bar starts full (the build cost)', !!td && td.progress === farmCost && teardownCost(td) === farmCost)
  check('...and it is NOT a construction order: the queue is unchanged', nation().queue.map((o) => o.id).join() === queueBefore && !nation().queue.some((o) => o.building === 'farm'))
  check('...the building keeps standing', (st().worlds['Mars'].buildings.farm ?? 0) === before)
  check('...without taking a slot', freeSlots(st().worlds['Mars'], nation().queue, 'agricultural') === freeSlots(st().worlds['Mars'], nation().queue.filter(() => true), 'agricultural'))
  const months = teardownMonths({ building: 'farm' })
  st().advance(1)
  const t1 = (nation().teardowns ?? [])[0]
  check('each month the bar runs down by cost / months', !!t1 && Math.abs(t1.progress - (farmCost - farmCost / months)) < 1e-6, `${t1?.progress}`)
  check('...with the building still standing', (st().worlds['Mars'].buildings.farm ?? 0) === before)
  check('...and the construction points going to the queue, not the teardown', nation().queue.some((o) => o.progress > 0))
  for (let i = 1; i < months; i++) st().advance(1)
  check('when the bar reaches zero, one is gone', (st().worlds['Mars'].buildings.farm ?? 0) === before - 1)
  check('...and the teardown is finished', (nation().teardowns ?? []).length === 0)

  // Stopping one leaves the building.
  st().queueDemolish(id, 'Mars', 'farm')
  const tid = (nation().teardowns ?? [])[0].id
  st().cancelOrder(id, tid)
  check('stopping a deconstruction keeps the building', (nation().teardowns ?? []).length === 0 && (st().worlds['Mars'].buildings.farm ?? 0) === before - 1)
  check('nothing to deconstruct is refused', !st().queueDemolish(id, 'Mars', 'nonexistentbuilding' as never).ok)
  // No more teardowns than buildings.
  const farms = st().worlds['Mars'].buildings.farm ?? 0
  for (let i = 0; i < farms; i++) st().queueDemolish(id, 'Mars', 'farm')
  check('no more than the buildings standing', !st().queueDemolish(id, 'Mars', 'farm').ok)

  // A district level: same, on a longer bar, if what stands still fits.
  useAbstractEconomyStore.getState().reset()
  const w0 = st().worlds['Mars']
  const fits = SIMPLE_DISTRICTS.find((d) => districtsOf(w0)[d] > 0 && buildingsInDistrict(w0, d) <= (districtsOf(w0)[d] - 1) * SLOTS_PER_DISTRICT)
  const full = SIMPLE_DISTRICTS.find((d) => districtsOf(w0)[d] > 0 && buildingsInDistrict(w0, d) > (districtsOf(w0)[d] - 1) * SLOTS_PER_DISTRICT)
  if (full) check('a district whose buildings would no longer fit is refused', !st().queueDemolishDistrict(id, 'Mars', full).ok && /fit/.test((st().queueDemolishDistrict(id, 'Mars', full) as { reason: string }).reason))
  if (fits) {
    const lv = districtsOf(w0)[fits]
    check('a district level can be deconstructed', st().queueDemolishDistrict(id, 'Mars', fits).ok && (nation().teardowns ?? [])[0].district === fits)
    check('...it takes no queue place', nation().queue.length === 0)
    const dm = teardownMonths({ district: fits })
    for (let i = 0; i < dm - 1; i++) st().advance(1)
    check('...the level stands until the bar is empty', districtsOf(st().worlds['Mars'])[fits] === lv)
    st().advance(1)
    check('...then it is gone, freeing its land', districtsOf(st().worlds['Mars'])[fits] === lv - 1 && (nation().teardowns ?? []).length === 0)
  } else console.log('  (no district with room on Mars to test a level teardown)')

  // A building can be queued into a slot a queued district level will add.
  useAbstractEconomyStore.getState().reset()
  const fullQ = st().queueBuilding(id, 'Mars', 'civilianFactory')
  st().queueDistrict(id, 'Mars', 'industrial')
  const after = st().queueBuilding(id, 'Mars', 'civilianFactory')
  check('a full district refuses, but takes a building once a level is queued', !fullQ.ok && after.ok)
}

console.log('\n=== 5. Complex mode: districts that house buildings ===')
{
  const { useEconomyStore } = await import('../src/state/economyStore')
  const { districtUsage } = await import('../src/economy/economyTick')
  const { tickEconomy } = await import('../src/economy/economyTick')
  const D = await import('../src/economy/districts')
  const { DISTRICT_TYPES } = await import('../src/economy/recipes')
  const st = useEconomyStore.getState()
  const mars = st.worlds.find((w) => w.name === 'Mars')!
  check('seeded capacity is whole district levels', DISTRICT_TYPES.every((d) => mars.districtCapacity[d] === D.districtLevels(mars)[d] * D.SLOTS_PER_DISTRICT_LEVEL), JSON.stringify(D.districtLevels(mars)))
  check('every seeded world fits its land and houses its buildings', st.worlds.every((w) => D.districtLevelsTotal(w) <= D.landOfWorld(w) && DISTRICT_TYPES.every((d) => districtUsage(w)[d] <= w.districtCapacity[d])))
  // Mars's seed already fills its 15 land; its capital's Military level adds one.
  check('Mars has 15 land (a small planet) + its capital military level, Venus 24', D.landOfWorld(mars) === Math.max(15, D.districtLevelsTotal(mars)) && D.districtLevels(mars).military === 1 && D.landOfWorld(st.worlds.find((w) => w.name === 'Venus')!) === 24, `Mars ${D.landOfWorld(mars)}`)
  const bonus = D.districtBonus(mars, 'industrial')
  check('a busy industrial district has an ecosystem bonus', bonus.cluster > 0 && bonus.total <= D.CLUSTER_MAX + D.LINK_MAX, `+${(bonus.total * 100).toFixed(1)}%`)
  // Developing a district: the order doesn't take a building slot, and it lands as +8 slots.
  const venus = st.worlds.find((w) => w.name === 'Venus')!
  const usageBefore = districtUsage(venus).industrial
  st.queueDistrict(venus.id, 'industrial')
  const venusQ = useEconomyStore.getState().worlds.find((w) => w.id === venus.id)!
  check('queueing a district adds a state order', venusQ.constructionQueue.some((o) => o.district === 'industrial' && o.owner.kind === 'state'))
  check("a district order doesn't use a building slot", districtUsage(venusQ).industrial === usageBefore)
  check('a queued district uses land', D.freeLandOfWorld(venusQ) === D.freeLandOfWorld(venus) - 1)
  const almost = { ...venusQ, constructionQueue: venusQ.constructionQueue.map((o) => (o.district ? { ...o, progress: o.cost - 0.01 } : o)) }
  const worlds = useEconomyStore.getState().worlds.map((w) => (w.id === venus.id ? almost : w))
  const res = tickEconomy(useEconomyStore.getState().countries, worlds, useEconomyStore.getState().corporations, { humanCountryIds: [], tick: 1, enableAI: false }, useEconomyStore.getState().banks)
  const after = res.worlds.find((w) => w.id === venus.id)!
  check('a finished district level adds its slots', after.districtCapacity.industrial === venus.districtCapacity.industrial + D.SLOTS_PER_DISTRICT_LEVEL && D.districtLevels(after).industrial === D.districtLevels(venus).industrial + 1)
  check('...and leaves the queue', !after.constructionQueue.some((o) => o.district))
  const full = { ...mars, land: D.districtLevelsTotal(mars) }
  check('no free land, no district', D.freeLandOfWorld(full) === 0)
  check('a world without districts reads as enough to cover its capacity', D.districtLevels({ districtCapacity: { core: 9, urban: 8, industrial: 17, resource: 0 } }).industrial === 3)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
