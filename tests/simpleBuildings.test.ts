// Verification of Simple mode's building roster (Stellaris-style): a dedicated
// factory per product, labs per research tree, dense buildings for crowded
// worlds, amenities from urban buildings, per-building input shortages,
// demolition, and the real-GDP map lens.
// Run:  npx tsx tests/simpleBuildings.test.ts

import {
  abstractReport,
  amenitiesHappiness,
  emptyStockpile,
  tickAbstractEconomy,
  worldAmenities,
  type AbstractEconomyState,
  type Stockpile,
  type WorldState,
} from '../src/economy-abstract/abstractEconomy'
import { DISTRICT_OF_BUILDING, SIMPLE_BUILDING_DEFS, SIMPLE_BUILDINGS, SIMPLE_DISTRICT_DEFS, SIMPLE_DISTRICTS, type SimpleBuildingId } from '../src/data/simplisticEconomyData'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { gdpColors } from '../src/scene/mapModeColor'
import type { PlanetData } from '../src/scene/planetData'

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
    countryId: 'x', population: 0, gdp: 6000, realGdp: 6000, priceLevel: 1, inflation: 0.02, stability: 0.6,
    treasury: 100, reserves: 40, debt: 1000, taxRate: 0.1, economyType: 'corporatist', moneyCreation: 0, warTaxes: false,
    welfare: 0.3, queue: [], nextOrderId: 1, currency: { code: 'X', name: 'X', rate: 1, baseRate: 1 }, trade: {}, ...over,
  }
}
// A world with plenty of workers, where one building type is studied at a time.
const solo = (b: SimpleBuildingId, levels = 1, over: Partial<WorldState> = {}): WorldState => ({ bodyName: 'Lab', population: 200, buildings: { [b]: levels }, ...over })
const rich = (over: Partial<Stockpile> = {}): Stockpile => ({ ...emptyStockpile(), food: 5000, minerals: 5000, energy: 5000, alloys: 500, electronics: 500, consumerGoods: 500, exoticMatter: 50, hyperium: 10, ...over })

console.log('=== 1. The roster: every building lives in one district and does something ===')
{
  check('17 buildings', SIMPLE_BUILDINGS.length === 17, SIMPLE_BUILDINGS.join(', '))
  check('each building is listed under its own district', SIMPLE_BUILDINGS.every((b) => SIMPLE_DISTRICT_DEFS[DISTRICT_OF_BUILDING[b]].buildings.includes(b)))
  check('every economy district has buildings (the military one holds defenses)', SIMPLE_DISTRICTS.every((d) => (d === 'military') === (SIMPLE_DISTRICT_DEFS[d].buildings.length === 0)))
  check('every building has an output, jobs and a cost', SIMPLE_BUILDINGS.every((b) => Object.keys(SIMPLE_BUILDING_DEFS[b].outputs).length > 0 && SIMPLE_BUILDING_DEFS[b].jobs > 0 && SIMPLE_BUILDING_DEFS[b].cost > 0))
  check('the factories are four separate buildings', ['civilianFactory', 'alloyFoundry', 'consumerFactory', 'electronicsPlant'].every((b) => DISTRICT_OF_BUILDING[b as SimpleBuildingId] === 'industrial'))
}

console.log('\n=== 2. One building, one product ===')
{
  const s = mk()
  const out = (b: SimpleBuildingId) => abstractReport(s, [solo(b)], rich())
  const foundry = out('alloyFoundry')
  check('an alloy foundry makes alloys, and no consumer goods or construction', foundry.produced.alloys > 0 && foundry.produced.consumerGoods === 0 && foundry.constructionPoints === 0)
  const civ = out('civilianFactory')
  check('a civilian factory makes construction, no goods', civ.constructionPoints > 0 && civ.produced.alloys === 0 && civ.produced.consumerGoods === 0)
  check('a consumer goods factory makes consumer goods', out('consumerFactory').produced.consumerGoods > 0 && out('consumerFactory').produced.alloys === 0)
  check('an electronics plant makes electronics', out('electronicsPlant').produced.electronics > 0)
  check('each uses its listed upkeep', Math.abs(foundry.used.minerals - SIMPLE_BUILDING_DEFS.alloyFoundry.upkeep.minerals!) < 1e-9 && Math.abs(foundry.used.energy - SIMPLE_BUILDING_DEFS.alloyFoundry.upkeep.energy!) < 1e-9)
  check('a farm, mine or power plant needs nothing', out('farm').used.energy === 0 && out('mine').used.energy === 0 && out('powerPlant').used.minerals === 0)
  check('a commercial zone adds services to GDP', out('commercialZone').realGdp > abstractReport(s, [solo('farm', 0)], rich()).realGdp)
}

console.log('\n=== 3. Labs research their own tree ===')
{
  const s = mk()
  for (const [b, t] of [['physicsLab', 'physics'], ['societyLab', 'society'], ['engineeringLab', 'engineering']] as const) {
    const r = abstractReport(s, [solo(b, 2)], rich())
    check(`${SIMPLE_BUILDING_DEFS[b].name} → ${t} only`, r.researchByTree[t] > 0 && Math.abs(r.research - r.researchByTree[t]) < 1e-9)
  }
}

console.log('\n=== 4. Dense buildings: more per slot, for an upkeep ===')
{
  const s = mk()
  const per = (b: SimpleBuildingId, g: 'food' | 'minerals' | 'energy') => abstractReport(s, [solo(b)], rich()).produced[g]
  check('a hydroponics bay makes twice a farm’s food', Math.abs(per('hydroponicsBay', 'food') / per('farm', 'food') - 2) < 1e-9)
  check('a deep core mine makes twice a mine’s minerals', Math.abs(per('deepCoreMine', 'minerals') / per('mine', 'minerals') - 2) < 1e-9)
  check('a fusion reactor makes 2.5× a power plant’s energy', Math.abs(per('fusionReactor', 'energy') / per('powerPlant', 'energy') - 2.5) < 1e-9)
  check('...but they pay upkeep the plain ones do not', abstractReport(s, [solo('hydroponicsBay')], rich()).used.energy > 0 && abstractReport(s, [solo('fusionReactor')], rich()).used.electronics > 0)
  const dark = abstractReport(s, [solo('hydroponicsBay')], rich({ energy: 0 }))
  check('with no energy a hydroponics bay grows nothing', dark.produced.food === 0)
}

console.log('\n=== 5. Input shortages hit only the buildings that need that input ===')
{
  const s = mk()
  const w: WorldState = { bodyName: 'Mixed', population: 400, buildings: { alloyFoundry: 1, physicsLab: 1, mine: 2, powerPlant: 2 } }
  const r = abstractReport(s, [w], rich({ electronics: 0 }))
  check('with no electronics, labs stall', r.research === 0)
  check('...but the foundry keeps pouring alloys', r.produced.alloys > 0 && (r.byBuilding.alloyFoundry?.output.alloys ?? 0) > 0)
  check('...and the shortage is named', r.inputShortages.includes('electronics') && !r.inputShortages.includes('minerals'))
  // A fusion reactor fed by an electronics plant on the same world runs (the chain settles).
  const chain: WorldState = { bodyName: 'Chain', population: 400, buildings: { fusionReactor: 1, electronicsPlant: 1, mine: 1, powerPlant: 1 } }
  const rc = abstractReport(s, [chain], rich({ electronics: 0 }))
  check('a building fed by this month’s output of another runs', (rc.byBuilding.fusionReactor?.output.energy ?? 0) > 0, `electronics made ${rc.produced.electronics.toFixed(1)}, used ${rc.used.electronics.toFixed(1)}`)
}

console.log('\n=== 6. Amenities ===')
{
  const s = mk()
  check('shortfall costs happiness in proportion; a surplus adds a little, capped', amenitiesHappiness(0) === -0.25 && amenitiesHappiness(1) === 0 && amenitiesHappiness(1.2) > 0 && amenitiesHappiness(9) === amenitiesHappiness(1.5))
  const bare: WorldState = { bodyName: 'Bare', population: 3000, buildings: { farm: 20, mine: 5, powerPlant: 5 } }
  const lively: WorldState = { ...bare, buildings: { ...bare.buildings, entertainmentCenter: 2 } }
  const a0 = worldAmenities(bare, 1)
  const a1 = worldAmenities(lively, 1)
  check('the city provides some amenities, not enough for a big world', a0.supply > 0 && a0.supply < a0.need, `${a0.supply.toFixed(1)} / ${a0.need.toFixed(1)}`)
  check('entertainment centers cover the gap', a1.supply >= a1.need, `${a1.supply.toFixed(1)} / ${a1.need.toFixed(1)}`)
  const r0 = abstractReport(s, [bare], rich())
  const r1 = abstractReport(s, [lively], rich())
  check('short of amenities, people are unhappier', r0.strata.workers.happiness < r1.strata.workers.happiness && r0.strata.workers.parts.some((p) => p.label === 'Amenities' && p.value < 0))
  check('entertainment centers use consumer goods', r1.used.consumerGoods > r0.used.consumerGoods)
  const outpost: WorldState = { bodyName: 'Rock', population: 48, buildings: { mine: 1 } }
  check('a small outpost needs no amenities', worldAmenities(outpost, 1).need === 0)
  check('amenities do not depend on stability (no feedback loop)', abstractReport(mk({ stability: 0.1 }), [lively], rich()).amenities.supply === abstractReport(mk({ stability: 0.9 }), [lively], rich()).amenities.supply)
}

console.log('\n=== 7. Clinics grow the population ===')
{
  const s = mk()
  const base: WorldState = { bodyName: 'Home', population: 1000, buildings: { farm: 10, mine: 2, powerPlant: 2, consumerFactory: 2 } }
  const withClinic: WorldState = { ...base, buildings: { ...base.buildings, clinic: 2 } }
  const grow = (w: WorldState) => tickAbstractEconomy(s, [w], rich()).worlds[0].population
  check('a world with clinics grows faster', grow(withClinic) > grow(base), `${grow(base).toFixed(3)} vs ${grow(withClinic).toFixed(3)}`)
}

console.log('\n=== 8. Opening numbers: Mars still opens around 9.3k GDP; research spread by lab ===')
{
  useAbstractEconomyStore.getState().reset()
  const st = useAbstractEconomyStore.getState()
  const mars = st.byCountry['imperial-state-of-mars']
  check('Mars opens within 5% of 9.3k GDP (the pre-roster figure)', Math.abs(mars.gdp / 9300 - 1) < 0.05, mars.gdp.toFixed(0))
  for (const [id, r] of Object.entries(st.reports)) {
    check(`${id} opens with amenities covered and no input shortage`, r.amenities.ratio >= 1 && r.inputShortages.length === 0, `amenities ${r.amenities.ratio.toFixed(2)}`)
  }
  check('Mars researches physics and engineering from its labs', st.reports['imperial-state-of-mars'].researchByTree.physics > 0 && st.reports['imperial-state-of-mars'].researchByTree.engineering > 0)
}

console.log('\n=== 9. Demolishing ===')
{
  useAbstractEconomyStore.getState().reset()
  useTerritoryStore.getState().reset()
  const mars = 'imperial-state-of-mars'
  const before = useAbstractEconomyStore.getState().worlds['Mars'].buildings.farm ?? 0
  const res = useAbstractEconomyStore.getState().demolish(mars, 'Mars', 'farm')
  check('demolishing takes down one level at once', res.ok && useAbstractEconomyStore.getState().worlds['Mars'].buildings.farm === before - 1)
  check("can't demolish on someone else's world", !useAbstractEconomyStore.getState().demolish(mars, 'Venus', 'farm').ok)
  check("can't demolish what isn't there", !useAbstractEconomyStore.getState().demolish(mars, 'Mars', 'fusionReactor').ok)
  useAbstractEconomyStore.getState().reset()
}

console.log('\n=== 10. GDP map lens uses real GDP ===')
{
  const p = (name: string, radiusKm: number) => ({ name, radiusKm }) as PlanetData
  const planets = [p('Big but empty', 60000), p('Small but rich', 3000), p('Colony', 5000)]
  const colors = gdpColors(planets, { 'Small but rich': 9000, Colony: 300 })
  const g = (name: string) => parseInt(colors.get(name)!.slice(3, 5), 16) // the green channel
  check('the richest world is brightest', g('Small but rich') > g('Colony'))
  check('an uninhabited giant is dimmer than any inhabited world', g('Big but empty') < g('Colony'))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
