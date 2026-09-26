// Verification of Simple mode's economy (economyModel 'abstract'): worlds
// with buildings, factories as Production Units, stockpile goods, value-added
// GDP, budget, construction, trade and currency.
// Run:  npx tsx tests/abstractEconomy.test.ts

import {
  tickAbstractEconomy,
  abstractReport,
  normalizeAllocation,
  emptyStockpile,
  fundamentalRate,
  type AbstractEconomyState,
  type Allocation,
  type Stockpile,
  type WorldState,
} from '../src/economy-abstract/abstractEconomy'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTechStore } from '../src/state/techStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { seedBodyOwners } from '../src/scene/territory'
import { SIMPLE_GOODS } from '../src/data/simplisticEconomyData'

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
    countryId: 'x',
    population: 0,
    gdp: 6000,
    realGdp: 6000,
    priceLevel: 1,
    inflation: 0.02,
    stability: 0.6,
    treasury: 100,
    reserves: 40,
    debt: 1000,
    taxRate: 0.1,
    economyType: 'corporatist',
    moneyCreation: 0,
    warTaxes: false,
    welfare: 0.3,
    allocation: { civilian: 0.5, military: 0.2, consumer: 0.3 },
    researchFocus: 'physics',
    queue: [],
    nextOrderId: 1,
    currency: { code: 'X', name: 'X', rate: 1, baseRate: 1 },
    trade: {},
    ...over,
  }
}
function world(over: Partial<WorldState> = {}): WorldState {
  return { bodyName: 'Home', population: 3000, slots: 80, buildings: { factory: 15, farm: 6, mine: 6, powerPlant: 6, researchLab: 2, exoticRefinery: 1 }, ...over }
}
function stock(over: Partial<Stockpile> = {}): Stockpile {
  return { ...emptyStockpile(), food: 200, minerals: 300, energy: 600, alloys: 400, electronics: 60, consumerGoods: 150, exoticMatter: 30, hyperium: 6, ...over }
}
function run(s: AbstractEconomyState, ws: WorldState[], st: Stockpile, months: number) {
  for (let i = 0; i < months; i++) {
    const res = tickAbstractEconomy(s, ws, st)
    s = res.state
    ws = res.worlds
    st = res.stock
  }
  return { s, ws, st }
}
const finite = (s: AbstractEconomyState) => [s.gdp, s.realGdp, s.priceLevel, s.inflation, s.stability, s.treasury, s.debt, s.currency.rate].every(Number.isFinite)

console.log('=== 1. Finiteness & bounds over ten years ===')
{
  const { s, ws, st } = run(mk(), [world()], stock(), 120)
  check('all fields finite after 120 months', finite(s))
  check('GDP positive', s.gdp > 0, s.gdp.toFixed(0))
  check('stability in [0,1]', s.stability >= 0 && s.stability <= 1, s.stability.toFixed(2))
  check('stockpiles never negative', SIMPLE_GOODS.every((g) => st[g] >= 0))
  check('population positive', ws[0].population > 0)
  const r = abstractReport(s, ws, st)
  check('report numbers finite', Object.values(r).every((v) => typeof v !== 'number' || Number.isFinite(v)))
}

console.log('\n=== 2. Factories are Production Units; workers cap them ===')
{
  const base = abstractReport(mk(), [world()], stock())
  const more = abstractReport(mk(), [world({ buildings: { ...world().buildings, factory: 20 } })], stock())
  check('more factories → more PU', more.productionUnits > base.productionUnits, `${base.productionUnits.toFixed(0)} → ${more.productionUnits.toFixed(0)}`)
  check('...and more GDP', more.realGdp > base.realGdp, `${base.realGdp.toFixed(0)} → ${more.realGdp.toFixed(0)}`)
  // A world with no spare workers: extra factories only dilute staffing.
  const full = world({ population: 2 * 15 * 40 + 2 * (6 * 30 + 6 * 20 + 6 * 15 + 2 * 20 + 20), buildings: { ...world().buildings } })
  const fullR = abstractReport(mk(), [full], stock())
  const overR = abstractReport(mk(), [{ ...full, buildings: { ...full.buildings, factory: 25 } }], stock())
  check('on a fully staffed world, new factories pull workers off the farms', overR.produced.food < fullR.produced.food, `food ${fullR.produced.food.toFixed(1)} → ${overR.produced.food.toFixed(1)}`)
  check('...because the world is now understaffed', overR.jobs > overR.workforce)
  check('...so total staffed jobs stay at the workforce', Math.abs(overR.workforce - fullR.workforce) < 1e-9)
}

console.log('\n=== 3. The allocation decides what factories make ===')
{
  const mil = abstractReport(mk({ allocation: { civilian: 0.2, military: 0.7, consumer: 0.1 } }), [world()], stock())
  const civ = abstractReport(mk({ allocation: { civilian: 0.7, military: 0.1, consumer: 0.2 } }), [world()], stock())
  const con = abstractReport(mk({ allocation: { civilian: 0.2, military: 0.1, consumer: 0.7 } }), [world()], stock())
  check('military → alloys', mil.produced.alloys > civ.produced.alloys, `${mil.produced.alloys.toFixed(0)} vs ${civ.produced.alloys.toFixed(0)}`)
  check('civilian → construction points', civ.constructionPoints > mil.constructionPoints)
  check('consumer → consumer goods and electronics', con.produced.consumerGoods > civ.produced.consumerGoods && con.produced.electronics > civ.produced.electronics)
}

console.log('\n=== 4. Industry needs minerals and energy ===')
{
  const noInputs = world({ buildings: { factory: 15 } })
  const starved = abstractReport(mk(), [noInputs], stock({ minerals: 0, energy: 0 }))
  const fed = abstractReport(mk(), [noInputs], stock({ minerals: 10000, energy: 10000 }))
  check('with no minerals/energy, industry stops', starved.inputSatisfaction === 0 && starved.produced.alloys === 0)
  check('with a stockpile, industry runs', fed.inputSatisfaction === 1 && fed.produced.alloys > 0)
}

console.log('\n=== 5. Needs: food shortage costs stability and population ===')
{
  const hungry = run(mk(), [world({ buildings: { factory: 15, mine: 6, powerPlant: 6 } })], stock({ food: 0 }), 24)
  const fed = run(mk(), [world()], stock(), 24)
  check('food shortage lowers stability', hungry.s.stability < fed.s.stability, `${hungry.s.stability.toFixed(2)} vs ${fed.s.stability.toFixed(2)}`)
  check('food shortage shrinks the population', hungry.ws[0].population < 3000, hungry.ws[0].population.toFixed(0))
  check('a fed population grows', fed.ws[0].population > 3000, fed.ws[0].population.toFixed(0))
}

console.log('\n=== 5b. Pops: strata, upkeep, happiness, approval, stability (Stellaris-style) ===')
{
  const r = abstractReport(mk(), [world()], stock())
  const total = r.strata.workers.population + r.strata.specialists.population + r.strata.unemployed.population
  check('strata add up to the population', Math.abs(total - r.population) < 1e-6, `${r.strata.workers.population.toFixed(0)} / ${r.strata.specialists.population.toFixed(0)} / ${r.strata.unemployed.population.toFixed(0)}`)
  check('lab and refinery jobs make specialists', r.strata.specialists.population > 0)
  check('the unemployed are the least happy', r.strata.unemployed.happiness < r.strata.workers.happiness && r.strata.unemployed.happiness < r.strata.specialists.happiness)
  check('approval is the population-weighted happiness', Math.abs(r.approval - (r.strata.workers.population * r.strata.workers.happiness + r.strata.specialists.population * r.strata.specialists.happiness + r.strata.unemployed.population * r.strata.unemployed.happiness) / r.population) < 1e-9)
  check('stability heads for approval', Math.abs(r.stabilityTarget - r.approval) < 1e-9)
  // Specialists want more consumer goods than workers, per head.
  const onlyLabs = abstractReport(mk(), [world({ population: 400, buildings: { researchLab: 10 } })], stock())
  const onlyFarms = abstractReport(mk(), [world({ population: 400, buildings: { farm: 6, mine: 1 } })], stock())
  check('specialists consume more consumer goods per head', onlyLabs.needs.consumerGoods.demand > onlyFarms.needs.consumerGoods.demand)
  // A consumer goods shortage hurts happiness but kills nobody; a food shortage kills.
  const noGoods = abstractReport(mk({ allocation: { civilian: 0.7, military: 0.3, consumer: 0 } }), [world()], stock({ consumerGoods: 0 }))
  check('a consumer goods shortage lowers happiness', noGoods.strata.workers.happiness < r.strata.workers.happiness, `${r.strata.workers.happiness.toFixed(2)} → ${noGoods.strata.workers.happiness.toFixed(2)}`)
  check('...and the shortage shows in the breakdown', noGoods.strata.workers.parts.some((p) => p.label === 'Consumer goods shortage' && p.value < 0))
  const cgOnly = run(mk({ allocation: { civilian: 0.7, military: 0.3, consumer: 0 } }), [world()], stock({ consumerGoods: 0, electronics: 0 }), 24)
  check('...but the population still grows', cgOnly.ws[0].population > 3000)
  // Full employment beats mass unemployment.
  const jobless = abstractReport(mk(), [world({ population: 6000 })], stock())
  check('mass unemployment drags approval down', jobless.approval < r.approval, `${r.approval.toFixed(2)} → ${jobless.approval.toFixed(2)}`)
  // Welfare helps the unemployed most.
  const w0 = abstractReport(mk({ welfare: 0 }), [world()], stock())
  const w1 = abstractReport(mk({ welfare: 1 }), [world()], stock())
  check('welfare raises the unemployed more than specialists', w1.strata.unemployed.happiness - w0.strata.unemployed.happiness > w1.strata.specialists.happiness - w0.strata.specialists.happiness)
  // Economy type splits the strata.
  const market = abstractReport(mk({ economyType: 'market' }), [world()], stock())
  const planned = abstractReport(mk({ economyType: 'planned' }), [world()], stock())
  check('a market economy pleases specialists, a planned one workers', market.strata.specialists.happiness > planned.strata.specialists.happiness && planned.strata.workers.happiness > market.strata.workers.happiness)
  // Unrest.
  const calm = abstractReport(mk({ stability: 0.5 }), [world()], stock())
  const riot = abstractReport(mk({ stability: 0.2 }), [world()], stock())
  check('below 25% stability is unrest, which cuts tax revenue', riot.unrest && !calm.unrest && riot.revenue < calm.revenue * 0.95)
  check('low stability cuts output', riot.productionUnits < calm.productionUnits)
}

console.log('\n=== 6. Construction builds buildings ===')
{
  let s = mk({ queue: [{ id: 1, bodyName: 'Home', building: 'farm', progress: 0 }, { id: 2, bodyName: 'Home', building: 'mine', progress: 0 }] })
  let ws = [world()]
  let st = stock()
  const r0 = abstractReport(s, ws, st)
  const res = tickAbstractEconomy(s, ws, st)
  check('two projects progress in parallel (each capped per month)', res.state.queue.every((o) => o.progress > 0 && o.progress <= 40), res.state.queue.map((o) => o.progress.toFixed(0)).join(', '))
  check('the first project gets the full per-project cap', res.state.queue[0].progress === 40 && r0.constructionPoints > 40, r0.constructionPoints.toFixed(0))
  for (let i = 0; i < 12; i++) ({ state: s, worlds: ws, stock: st } = tickAbstractEconomy(s, ws, st))
  check('both finish and add a level', s.queue.length === 0 && ws[0].buildings.farm === 7 && ws[0].buildings.mine === 7)
  // An order for a world the nation doesn't hold is paused, not lost.
  const paused = tickAbstractEconomy(mk({ queue: [{ id: 1, bodyName: 'Elsewhere', building: 'farm', progress: 10 }] }), [world()], stock())
  check('an order on a world not held is paused', paused.state.queue.length === 1 && paused.state.queue[0].progress === 10)
  // A full world can't complete a building.
  const packed = world({ slots: 36 }) // exactly its 36 levels
  const stuck = tickAbstractEconomy(mk({ queue: [{ id: 1, bodyName: 'Home', building: 'farm', progress: 149 }] }), [packed], stock())
  check('a world with no free slot does not gain a building', (stuck.worlds[0].buildings.farm ?? 0) === 6)
}

console.log('\n=== 7. Budget: deficits are printed or borrowed; welfare costs money and buys stability ===')
{
  const base = mk({ taxRate: 0.01, treasury: 5, allocation: { civilian: 0.2, military: 0.7, consumer: 0.1 } })
  const printed = run({ ...base, moneyCreation: 1 }, [world()], stock(), 24).s
  const borrowed = run({ ...base, moneyCreation: 0 }, [world()], stock(), 24).s
  check('printing a deficit raises inflation', printed.inflation > borrowed.inflation, `${(printed.inflation * 100).toFixed(1)}% vs ${(borrowed.inflation * 100).toFixed(1)}%`)
  check('borrowing it raises debt', borrowed.debt > printed.debt, `${borrowed.debt.toFixed(0)} vs ${printed.debt.toFixed(0)}`)
  check('inflation raises the price level', printed.priceLevel > borrowed.priceLevel)
  check('nominal GDP = real × price level', Math.abs(printed.gdp - printed.realGdp * (printed.priceLevel / (1 + printed.inflation / 12))) / printed.gdp < 0.05)
  const noWelfare = abstractReport(mk({ welfare: 0 }), [world()], stock())
  const fullWelfare = abstractReport(mk({ welfare: 1 }), [world()], stock())
  check('welfare costs money', fullWelfare.expWelfare > noWelfare.expWelfare && noWelfare.expWelfare === 0)
  check('welfare raises the stability target', fullWelfare.stabilityTarget > noWelfare.stabilityTarget)
  const steady = run(mk(), [world()], stock(), 120).s
  check('with no printing, inflation settles near 2%', Math.abs(steady.inflation - 0.02) < 0.005, (steady.inflation * 100).toFixed(2) + '%')
}

console.log('\n=== 8. Economy type ===')
{
  const prod = (t: 'market' | 'corporatist' | 'planned') => abstractReport(mk({ economyType: t }), [world()], stock()).productionUnits
  check('market yields more production than planned', prod('market') > prod('planned'))
}

console.log('\n=== 9. Research labs ===')
{
  const r = abstractReport(mk(), [world()], stock())
  check('labs produce research', r.research > 0, r.research.toFixed(1))
  const noLabs = abstractReport(mk(), [world({ buildings: { ...world().buildings, researchLab: 0 } })], stock())
  check('no labs, no research', noLabs.research === 0)
  const noElec = abstractReport(mk({ allocation: { civilian: 0.6, military: 0.4, consumer: 0 } }), [world()], stock({ electronics: 0 }))
  check('labs without electronics stall', noElec.research === 0)
}

console.log('\n=== 10. Trade and the exchange rate ===')
{
  const s = mk({ trade: { food: 20, minerals: -50 }, treasury: 1000 })
  const r = abstractReport(s, [world()], stock())
  check('an import brings goods in', r.traded.food === 20)
  check('an export takes goods out', r.traded.minerals === -50)
  check('imports cost, exports earn', r.importCost > 0 && r.exportRevenue > 0)
  const strong = abstractReport({ ...s, currency: { ...s.currency, rate: 2 } }, [world()], stock())
  check('a strong currency makes imports cheaper', strong.importCost < r.importCost)
  const broke = abstractReport(mk({ trade: { food: 1000 }, treasury: 10 }), [world()], stock())
  check('imports are limited by the treasury', broke.importCost <= 10 + 1e-9 && broke.traded.food < 1000)
  const thin = abstractReport(mk({ trade: { exoticMatter: -1000 } }), [world()], stock())
  check('exports are limited by what is on hand', -thin.traded.exoticMatter <= 30 + thin.produced.exoticMatter + 1e-6 && -thin.traded.exoticMatter > 30)
  const res = tickAbstractEconomy(s, [world()], stock())
  check('trade settles into the treasury', Math.abs(res.state.treasury - (s.treasury + r.balance / 12 + r.tradeBalance)) < 1e-6 || res.state.debt < s.debt)
  const inflated = mk({ inflation: 0.15 })
  const r2 = abstractReport(inflated, [world()], stock())
  check('high inflation pulls the rate down', fundamentalRate(inflated, r2) < fundamentalRate(mk(), abstractReport(mk(), [world()], stock())))
  let weak = inflated
  for (let i = 0; i < 24; i++) weak = { ...tickAbstractEconomy({ ...weak, inflation: 0.15 }, [world()], stock()).state }
  check('...and the currency depreciates over time', weak.currency.rate < 1, weak.currency.rate.toFixed(3))
}

console.log('\n=== 11. Allocation normalization ===')
{
  const n = normalizeAllocation({ civilian: 2, military: 1, consumer: 1 } as Allocation)
  check('allocation normalizes to sum 1', Math.abs(n.civilian + n.military + n.consumer - 1) < 1e-9 && Math.abs(n.civilian - 0.5) < 1e-9)
  const z = normalizeAllocation({ civilian: 0, military: 0, consumer: 0 } as Allocation)
  check('all-zero falls back to thirds', Math.abs(z.civilian - 1 / 3) < 1e-9)
}

console.log('\n=== 12. Store: seeds, stockpile sync, research, construction, territory ===')
{
  const store = useAbstractEconomyStore.getState()
  check('seeds the four nations', Object.keys(store.byCountry).length === 4)
  check('every owned body is a world', Object.keys(store.worlds).length === Object.keys(seedBodyOwners()).length)
  const gdp = (id: string) => store.byCountry[id].gdp
  check('opening GDPs are ordered Mars > Venus > Orion > Lalande', gdp('imperial-state-of-mars') > gdp('republic-of-venus') && gdp('republic-of-venus') > gdp('orion-republic') && gdp('orion-republic') > gdp('kingdom-of-lalande'),
    ['imperial-state-of-mars', 'republic-of-venus', 'orion-republic', 'kingdom-of-lalande'].map((id) => gdp(id).toFixed(0)).join(' / '))
  const mars = 'imperial-state-of-mars'
  const res = useResourceStore.getState()
  res.setAmount(mars, 'food', 200)
  res.setAmount(mars, 'minerals', 300)
  res.setAmount(mars, 'energy', 600)
  const net = useAbstractEconomyStore.getState().reports[mars]
  void net
  const alloys0 = res.stateFor(mars).amounts.alloys
  const research0 = useTechStore.getState().stateFor(mars).researchPoints.physics
  store.advance(1)
  const after = useResourceStore.getState().stateFor(mars)
  check('a month writes production into the resource stockpile', after.amounts.alloys > alloys0, `${alloys0} → ${after.amounts.alloys.toFixed(1)}`)
  check('...and the monthly figure', after.monthlyDelta.alloys > 0, `+${after.monthlyDelta.alloys}`)
  check('research reaches the tech tree', useTechStore.getState().stateFor(mars).researchPoints.physics > research0)

  const q1 = useAbstractEconomyStore.getState().queueBuilding(mars, 'Mars', 'factory')
  check('queueing on an owned world works', q1.ok && useAbstractEconomyStore.getState().byCountry[mars].queue.length === 1)
  const q2 = useAbstractEconomyStore.getState().queueBuilding(mars, 'Venus', 'factory')
  check("can't build on someone else's world", !q2.ok)
  useAbstractEconomyStore.getState().cancelOrder(mars, useAbstractEconomyStore.getState().byCountry[mars].queue[0].id)
  check('cancel removes the order', useAbstractEconomyStore.getState().byCountry[mars].queue.length === 0)

  // Occupation: Luna held by Venus drops out of Mars's economy.
  const before = useAbstractEconomyStore.getState()
  const popBefore = before.reports[mars].population
  useTerritoryStore.getState().occupyBody('Luna', 'republic-of-venus')
  check('queueing on an occupied world is refused', !useAbstractEconomyStore.getState().queueBuilding(mars, 'Luna', 'farm').ok)
  useAbstractEconomyStore.getState().advance(1)
  const popAfter = useAbstractEconomyStore.getState().reports[mars].population
  check('an occupied world leaves its owner\'s economy', popAfter < popBefore - 500, `${popBefore.toFixed(0)} → ${popAfter.toFixed(0)}`)
  check("...and doesn't join the occupier's", useAbstractEconomyStore.getState().reports['republic-of-venus'].population < 3100)
  useTerritoryStore.getState().liberateBody('Luna')

  // A ceded body takes its queued projects with it.
  useAbstractEconomyStore.getState().queueBuilding(mars, 'Phobos', 'mine')
  useTerritoryStore.setState({ bodyOwner: { ...useTerritoryStore.getState().bodyOwner, Phobos: 'republic-of-venus' } })
  useAbstractEconomyStore.getState().advance(1)
  check('a ceded world drops its queued projects', !useAbstractEconomyStore.getState().byCountry[mars].queue.some((o) => o.bodyName === 'Phobos'))
  check('...and its economy now belongs to the new owner', useAbstractEconomyStore.getState().reports['republic-of-venus'].population > 3000)
  useTerritoryStore.getState().reset()
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
