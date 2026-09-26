// Verification of Simple mode's economy AI (non-player nations running
// their own economy: production split, budget, welfare, construction, trade).
// Complex mode never calls it.
// Run:  npx tsx tests/abstractEconomyAI.test.ts

import { tickAbstractEconomy, abstractReport, emptyStockpile, type AbstractEconomyState, type Stockpile, type WorldState } from '../src/economy-abstract/abstractEconomy'
import { applyAbstractEconomyAI, targetAllocation, nextBuilding, worldFor, tradeOrders, type AbstractAIContext } from '../src/economy-abstract/abstractEconomyAI'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { seedSimplisticStock, seedStrategicResources } from '../src/scene/shipyardLogic'

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
function ctx(s: AbstractEconomyState, atWar: boolean, ws: WorldState[] = [world()], st: Stockpile = stock()): AbstractAIContext {
  return { atWar, worlds: ws, stock: st, report: abstractReport(s, ws, st) }
}
function run(s: AbstractEconomyState, months: number, atWar: boolean | null, ws: WorldState[] = [world()], st: Stockpile = stock()) {
  for (let i = 0; i < months; i++) {
    if (atWar !== null) s = applyAbstractEconomyAI(s, ctx(s, atWar, ws, st))
    const res = tickAbstractEconomy(s, ws, st)
    s = res.state
    ws = res.worlds
    st = res.stock
  }
  return { s, ws, st }
}
const sum = (s: AbstractEconomyState) => s.allocation.civilian + s.allocation.military + s.allocation.consumer

console.log('=== 1. The AI supplies its population ===')
{
  const starved = mk({ allocation: { civilian: 0.6, military: 0.38, consumer: 0.02 } })
  const one = applyAbstractEconomyAI(starved, ctx(starved, false))
  check('a consumer-starved nation raises its consumer share', one.allocation.consumer > starved.allocation.consumer, `${starved.allocation.consumer.toFixed(2)} → ${one.allocation.consumer.toFixed(2)}`)
  check('...gradually', one.allocation.consumer < targetAllocation(starved, ctx(starved, false)).consumer)
  const withAI = run(starved, 60, false)
  const without = run(starved, 60, null)
  check('with the AI, stability ends higher than a static starved economy', withAI.s.stability > without.s.stability, `${withAI.s.stability.toFixed(2)} vs ${without.s.stability.toFixed(2)}`)
  check('...with its needs met', abstractReport(withAI.s, withAI.ws, withAI.st).upkeepMet > 0.95)
  const unrest = targetAllocation(mk({ stability: 0.2 }), ctx(mk({ stability: 0.2 }), false)).consumer
  const calm = targetAllocation(mk(), ctx(mk(), false)).consumer
  check('low stability targets a bigger consumer share', unrest > calm, `${unrest.toFixed(2)} vs ${calm.toFixed(2)}`)
}

console.log('\n=== 2. War footing ===')
{
  const peace = run(mk(), 24, false).s
  const war = run(mk(), 24, true).s
  check('at war the military share rises', war.allocation.military > peace.allocation.military, `${war.allocation.military.toFixed(2)} vs ${peace.allocation.military.toFixed(2)}`)
  check('allocation always sums to 1', Math.abs(sum(war) - 1) < 1e-9 && Math.abs(sum(peace) - 1) < 1e-9)
  const big = mk()
  const tgt = targetAllocation(big, ctx(big, true, [world({ population: 60000 })]))
  check('civilian keeps its floor when consumer demand is huge', tgt.civilian >= 0.1 - 1e-9, tgt.civilian.toFixed(2))
}

console.log('\n=== 3. War taxes ===')
{
  const at = (s: AbstractEconomyState, war: boolean) => applyAbstractEconomyAI(s, ctx(s, war)).warTaxes
  check('enacted at war when stable', at(mk({ stability: 0.6 }), true))
  check('never in peace', !at(mk({ stability: 0.9, warTaxes: true }), false))
  check('not enacted when stability is marginal', !at(mk({ stability: 0.4 }), true))
  check('...but kept down to the unrest line', at(mk({ stability: 0.4, warTaxes: true }), true))
  check('dropped in unrest', !at(mk({ stability: 0.3, warTaxes: true }), true))
}

console.log('\n=== 4. Budget: deficits raise taxes, surpluses buy welfare ===')
{
  const deficit = mk({ taxRate: 0.02 })
  check('the base case is in deficit', ctx(deficit, false).report.deficitPctGdp < -0.01)
  check('a deficit raises the tax rate', applyAbstractEconomyAI(deficit, ctx(deficit, false)).taxRate > 0.02)
  const withAI = run(deficit, 60, false).s
  const without = run(deficit, 60, null).s
  check('over 5 years the AI nation runs up less debt', withAI.debt < without.debt, `${withAI.debt.toFixed(0)} vs ${without.debt.toFixed(0)}`)
  const flush = mk({ taxRate: 0.3, welfare: 0.2 })
  const f1 = applyAbstractEconomyAI(flush, ctx(flush, false))
  check('a big surplus buys welfare first', f1.welfare > 0.2 && f1.taxRate === 0.3)
  const maxed = mk({ taxRate: 0.3, welfare: 1 })
  check('...then cuts taxes', applyAbstractEconomyAI(maxed, ctx(maxed, false)).taxRate < 0.3)
}

console.log('\n=== 5. Money creation ===')
{
  const near = mk({ debt: 9500 }) // well past the ceiling for its rating
  check('prints near the debt ceiling while inflation is tame', applyAbstractEconomyAI(near, ctx(near, false)).moneyCreation > 0)
  const hot = { ...near, inflation: 0.1 }
  check('stops printing when inflation is high', applyAbstractEconomyAI(hot, ctx(hot, false)).moneyCreation === 0)
  const room = mk({ moneyCreation: 1 })
  check('never prints with room to borrow', applyAbstractEconomyAI(room, ctx(room, false)).moneyCreation === 0)
}

console.log('\n=== 6. Treasury management ===')
{
  const rich = mk({ treasury: 3000, debt: 4000 })
  const r1 = applyAbstractEconomyAI(rich, ctx(rich, false))
  check('spare cash repays debt when indebted', r1.debt < rich.debt)
  const richLow = mk({ treasury: 3000, debt: 300 })
  const r2 = applyAbstractEconomyAI(richLow, ctx(richLow, false))
  check('...or builds reserves when debt is low', r2.reserves > richLow.reserves && r2.debt === richLow.debt)
  const worth = (s: AbstractEconomyState) => s.treasury + s.reserves - s.debt
  check('moving cash conserves net worth', Math.abs(worth(r1) - worth(rich)) < 1e-6 && Math.abs(worth(r2) - worth(richLow)) < 1e-6)
  const thin = mk({ treasury: 0, reserves: 100 })
  check('a thin treasury draws on reserves', applyAbstractEconomyAI(thin, ctx(thin, false)).treasury > 0)
  check('economy type is never changed', applyAbstractEconomyAI(mk({ economyType: 'planned' }), ctx(mk({ economyType: 'planned' }), true)).economyType === 'planned')
}

console.log('\n=== 7. Construction ===')
{
  const hungryWorld = world({ buildings: { factory: 15, farm: 1, mine: 6, powerPlant: 6, researchLab: 2, exoticRefinery: 1 } })
  const s = mk()
  check('a food deficit queues a farm', nextBuilding(s, ctx(s, false, [hungryWorld])) === 'farm')
  const noPower = world({ buildings: { factory: 15, farm: 8, mine: 6, powerPlant: 1, researchLab: 2, exoticRefinery: 1 } })
  check('an energy deficit queues a power plant', nextBuilding(s, ctx(s, false, [noPower], stock({ energy: 0 }))) === 'powerPlant')
  const full = world({ bodyName: 'Full', population: 2000 }) // 1000 workers, 1050 jobs
  const roomy = world({ bodyName: 'Roomy', population: 5000 })
  check('builds on the world with spare workers', worldFor(s, [full, roomy], 'factory')?.bodyName === 'Roomy')
  check("won't build where there are no spare workers", worldFor(s, [full], 'factory') === null)
  const one = applyAbstractEconomyAI(s, ctx(s, false))
  check('queues a project when the queue is short', one.queue.length === 1 && one.nextOrderId === 2)
  const over = run(mk(), 36, false)
  const levels = (w: WorldState) => Object.values(w.buildings).reduce((n, v) => n + (v ?? 0), 0)
  check('over 3 years the AI builds on its world', levels(over.ws[0]) > levels(world()), `${levels(world())} → ${levels(over.ws[0])} levels`)
  check('...and never builds past its workforce by much', abstractReport(over.s, over.ws, over.st).jobs <= abstractReport(over.s, over.ws, over.st).workforce + 40)
}

console.log('\n=== 8. Trade ===')
{
  const s = mk()
  const hungry = world({ buildings: { factory: 15, farm: 1, mine: 6, powerPlant: 6, researchLab: 2, exoticRefinery: 1 } })
  const t = tradeOrders(ctx(s, false, [hungry], stock({ food: 10 })))
  check('imports food that is running out', (t.food ?? 0) > 0, `food +${t.food}`)
  const t2 = tradeOrders(ctx(s, false, [hungry], stock({ food: 5000 })))
  check("doesn't import with a big stockpile", !t2.food)
  const t3 = tradeOrders(ctx(s, false, [world()], stock({ minerals: 10000 })))
  check('exports a bulk surplus piling up', (t3.minerals ?? 0) < 0, `minerals ${t3.minerals}`)
  const t4 = tradeOrders(ctx(s, false, [world()], stock({ minerals: 500 })))
  check('...but not a modest stockpile', !t4.minerals)
}

console.log('\n=== 9. Long run: the four nations under AI, 20 years in peace and at war ===')
{
  for (const atWar of [false, true]) {
    useAbstractEconomyStore.getState().reset()
    const ids = Object.keys(useAbstractEconomyStore.getState().byCountry)
    for (const id of ids) {
      seedStrategicResources(id)
      seedSimplisticStock(id)
    }
    const start = Object.fromEntries(ids.map((id) => [id, useAbstractEconomyStore.getState().byCountry[id].realGdp]))
    for (let y = 0; y < 20; y++) useAbstractEconomyStore.getState().advance(12, (s, env) => applyAbstractEconomyAI(s, { ...env, atWar }))
    const st = useAbstractEconomyStore.getState()
    for (const id of ids) {
      const s = st.byCountry[id]
      const r = st.reports[id]
      const growth = s.realGdp / start[id]
      check(
        `${id} ${atWar ? 'war' : 'peace'}: grows without running away, stable, solvent`,
        [s.gdp, s.realGdp, s.stability, s.treasury, s.debt, s.currency.rate].every(Number.isFinite) && growth > 1.1 && growth < 3 && s.stability > 0.4 && r.rating !== 'CCC' && r.upkeepMet > 0.95 && r.inputSatisfaction > 0.95,
        `real GDP ×${growth.toFixed(2)}, stab ${s.stability.toFixed(2)}, approval ${(r.approval * 100).toFixed(0)}%, upkeep ${(r.upkeepMet * 100).toFixed(0)}%, debt/GDP ${(r.debtToGdp * 100).toFixed(0)}%, ${s.currency.code} ${s.currency.rate.toFixed(2)}, welfare ${(s.welfare * 100).toFixed(0)}%`,
      )
    }
  }
  useAbstractEconomyStore.getState().reset()
}

console.log('\n=== 10. Store steer: AI nations move, the player is left alone ===')
{
  const store = useAbstractEconomyStore.getState()
  const player = 'imperial-state-of-mars'
  const before = store.byCountry
  store.advance(3, (s, env) => (s.countryId === player ? s : applyAbstractEconomyAI(s, { ...env, atWar: true })))
  const after = useAbstractEconomyStore.getState().byCountry
  check("the player's allocation is untouched", JSON.stringify(after[player].allocation) === JSON.stringify(before[player].allocation))
  check("the player's queue and policies are untouched", after[player].queue.length === 0 && after[player].taxRate === before[player].taxRate && !after[player].warTaxes)
  check('AI nations go on a war footing and start building', after['republic-of-venus'].allocation.military > before['republic-of-venus'].allocation.military && after['republic-of-venus'].queue.length > 0)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
