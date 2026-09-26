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
  landOf,
  tickAbstractEconomy,
  type AbstractEconomyState,
  type WorldState,
} from '../src/economy-abstract/abstractEconomy'
import { applyAbstractEconomyAI } from '../src/economy-abstract/abstractEconomyAI'
import { useAbstractEconomyStore, landForBody } from '../src/state/abstractEconomyStore'
import { SLOTS_PER_DISTRICT, DISTRICT_COST, CLUSTER_MAX } from '../src/data/simplisticEconomyData'

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
    welfare: 0.3, allocation: { civilian: 0.5, military: 0.2, consumer: 0.3 }, researchFocus: 'physics', queue: [], nextOrderId: 1,
    currency: { code: 'X', name: 'X', rate: 1, baseRate: 1 }, trade: {}, ...over,
  }
}
const stock = () => ({ ...emptyStockpile(), food: 500, minerals: 3000, energy: 3000, electronics: 200, consumerGoods: 500 })
const home = (over: Partial<WorldState> = {}): WorldState => ({
  bodyName: 'Home', population: 2600, land: 15,
  buildings: { factory: 12, farm: 6, mine: 4, powerPlant: 4, researchLab: 2 },
  districts: { industrial: 3, academic: 1, agricultural: 2, mining: 1, generator: 1, urban: 1 },
  ...over,
})

console.log('=== 1. Simple: districts house buildings ===')
{
  const w = home()
  check('each district level gives slots', districtSlots(w, 'industrial') === 3 * SLOTS_PER_DISTRICT)
  check('a full district has no free slot', freeSlots(w, [], 'industrial') === 0)
  check('a district with room has free slots', freeSlots(w, [], 'agricultural') === 2)
  check('queued buildings take their slots', freeSlots(w, [{ id: 1, bodyName: 'Home', building: 'farm', progress: 0 }], 'agricultural') === 1)
  check('land limits district levels', freeLand(w, []) === 15 - 9)
  check('queued district levels use land', freeLand(w, [{ id: 1, bodyName: 'Home', district: 'industrial', progress: 0 }]) === 15 - 10)
  const legacy: WorldState = { bodyName: 'Old', population: 100, buildings: { factory: 5, farm: 1 } }
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
  const small = home({ buildings: { factory: 2, farm: 6, mine: 4, powerPlant: 4, researchLab: 2 } })
  const big = home()
  check('more buildings in a district, bigger cluster bonus', districtBonus(big, 'industrial').cluster > districtBonus(small, 'industrial').cluster)
  check('a single building gets no cluster bonus', districtBonus(home({ buildings: { factory: 1 } }), 'industrial').cluster === 0)
  check('the cluster bonus is capped', districtBonus(home({ buildings: { factory: 400 } }), 'industrial').cluster === CLUSTER_MAX)
  check('research parks lift industry on the same world', districtBonus(home({ districts: { industrial: 3, academic: 4 } }), 'industrial').link > districtBonus(big, 'industrial').link)
  check('...but not farms', districtBonus(big, 'agricultural').link === 0)
  const r0 = abstractReport(mk(), [home({ districts: { industrial: 3, academic: 0, agricultural: 2, mining: 1, generator: 1 } })], stock())
  const r1 = abstractReport(mk(), [home()], stock())
  check('the bonus shows up as production', r1.productionUnits > r0.productionUnits, `${r0.productionUnits.toFixed(1)} → ${r1.productionUnits.toFixed(1)} PU`)
  check('two cities with the same factories: the clustered one out-produces a split one',
    abstractReport(mk(), [home({ buildings: { factory: 12 } })], stock()).productionUnits >
      abstractReport(mk(), [home({ bodyName: 'A', buildings: { factory: 6 } }), home({ bodyName: 'B', buildings: { factory: 6 } })], stock()).productionUnits)
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
  const q = st.queueBuilding('imperial-state-of-mars', 'Mars', 'factory')
  check('building into a full district is refused with a reason', !q.ok && /develop the district/.test((q as { reason: string }).reason))
  const qd = st.queueDistrict('imperial-state-of-mars', 'Mars', 'industrial')
  check('developing a district is queued', qd.ok && useAbstractEconomyStore.getState().byCountry['imperial-state-of-mars'].queue.some((o) => o.district === 'industrial'))
  useAbstractEconomyStore.getState().reset()
  // AI: when its building's district is full, it develops the district first.
  const nation = mk({ allocation: { civilian: 0.6, military: 0.1, consumer: 0.3 } })
  const crowded = home({ population: 4000, buildings: { factory: 12, farm: 8, mine: 4, powerPlant: 4, researchLab: 2 } })
  const env = { worlds: [crowded], stock: stock(), report: abstractReport(nation, [crowded], stock()), atWar: false }
  const planned = applyAbstractEconomyAI(nation, env)
  check('the AI queues a district level when the district it needs is full', planned.queue.some((o) => o.district !== undefined), JSON.stringify(planned.queue.map((o) => o.district ?? o.building)))
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
  check('Mars has 15 land (a small planet), Venus 24', D.landOfWorld(mars) === 15 && D.landOfWorld(st.worlds.find((w) => w.name === 'Venus')!) === 24)
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
