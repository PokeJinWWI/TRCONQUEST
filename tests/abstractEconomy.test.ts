// Verification of the Abstract-Simplistic economy (Stellaris/HOI4/TNO-inspired):
// a single macro state per nation, production allocation, budget, stability.
// Run:  npx tsx tests/abstractEconomy.test.ts

import { tickAbstractEconomy, abstractReport, normalizeAllocation, type AbstractEconomyState, type EconomyType, type Allocation } from '../src/economy-abstract/abstractEconomy'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'

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
    population: 3000,
    gdp: 6000,
    inflation: 0.02,
    stability: 0.6,
    treasury: 100,
    debt: 1000,
    taxRate: 0.1,
    economyType: 'corporatist',
    moneyCreation: 0, warTaxes: false, reserves: 40,
    allocation: { civilian: 0.5, military: 0.2, consumer: 0.3 },
    ...over,
  }
}
function run(s: AbstractEconomyState, ticks: number): AbstractEconomyState {
  for (let i = 0; i < ticks; i++) s = tickAbstractEconomy(s).state
  return s
}
const finite = (s: AbstractEconomyState) =>
  [s.gdp, s.population, s.inflation, s.stability, s.treasury, s.debt].every((n) => Number.isFinite(n))

console.log('=== 1. Finiteness & bounds over a long run ===')
{
  const s = run(mk(), 120)
  check('all fields stay finite after 120 ticks', finite(s))
  check('GDP stays positive', s.gdp > 0, s.gdp.toFixed(0))
  check('stability stays in [0,1]', s.stability >= 0 && s.stability <= 1, s.stability.toFixed(2))
  check('inflation stays non-negative', s.inflation >= 0)
  const r = abstractReport(s)
  check('report is finite', Object.values(r).every((v) => typeof v !== 'number' || Number.isFinite(v)))
}

console.log('\n=== 2. Consumer allocation drives stability ===')
{
  const starved = run(mk({ allocation: { civilian: 0.6, military: 0.35, consumer: 0.05 } }), 40)
  const fed = run(mk({ allocation: { civilian: 0.4, military: 0.1, consumer: 0.5 } }), 40)
  check('a consumer-starved economy has lower stability than a well-supplied one', starved.stability < fed.stability, `${starved.stability.toFixed(2)} vs ${fed.stability.toFixed(2)}`)
  check('meeting consumer demand yields a surplus', abstractReport(fed).consumerBalance > 0, abstractReport(fed).consumerBalance.toFixed(0))
}

console.log('\n=== 3. Civilian allocation drives growth ===')
{
  const invest = run(mk({ allocation: { civilian: 0.7, military: 0.1, consumer: 0.2 } }), 40)
  const noInvest = run(mk({ allocation: { civilian: 0.1, military: 0.1, consumer: 0.8 } }), 40)
  check('more civilian production → larger GDP over time', invest.gdp > noInvest.gdp, `${invest.gdp.toFixed(0)} vs ${noInvest.gdp.toFixed(0)}`)
}

console.log('\n=== 4. Deficit financing: printing → inflation, borrowing → debt ===')
{
  // Force a deficit: tiny tax, heavy military upkeep, low treasury.
  const base = mk({ taxRate: 0.01, treasury: 5, debt: 200, allocation: { civilian: 0.2, military: 0.7, consumer: 0.1 } })
  const printed = run({ ...base, moneyCreation: 1 }, 24)
  const borrowed = run({ ...base, moneyCreation: 0 }, 24)
  check('money-printing a deficit raises inflation vs. borrowing', printed.inflation > borrowed.inflation, `${(printed.inflation * 100).toFixed(1)}% vs ${(borrowed.inflation * 100).toFixed(1)}%`)
  check('borrowing a deficit raises debt vs. printing', borrowed.debt > printed.debt, `${borrowed.debt.toFixed(0)} vs ${printed.debt.toFixed(0)}`)
}

console.log('\n=== 5. Economy type modifies production ===')
{
  const types: EconomyType[] = ['market', 'corporatist', 'planned']
  const prod = (t: EconomyType) => abstractReport(mk({ economyType: t })).productionUnits
  check('market yields more production than planned', prod('market') > prod('planned'), `${prod('market').toFixed(0)} vs ${prod('planned').toFixed(0)}`)
}

console.log('\n=== 6. Allocation normalization ===')
{
  const n = normalizeAllocation({ civilian: 2, military: 1, consumer: 1 } as Allocation)
  check('allocation normalizes to sum 1', Math.abs(n.civilian + n.military + n.consumer - 1) < 1e-9)
  check('...preserving proportions (civilian = 50%)', Math.abs(n.civilian - 0.5) < 1e-9)
  const z = normalizeAllocation({ civilian: 0, military: 0, consumer: 0 } as Allocation)
  check('a degenerate all-zero allocation falls back to thirds', Math.abs(z.civilian - 1 / 3) < 1e-9)
}

console.log('\n=== 7. Store seeds and advances ===')
{
  const store = useAbstractEconomyStore.getState()
  check('the store seeds the four nations', Object.keys(store.byCountry).length === 4)
  const mars0 = store.byCountry['imperial-state-of-mars'].gdp
  store.advance(6)
  const mars1 = useAbstractEconomyStore.getState().byCountry['imperial-state-of-mars'].gdp
  check('advancing the store grows GDP', mars1 > mars0, `${mars0.toFixed(0)} → ${mars1.toFixed(0)}`)
  check('the store keeps a report per nation', !!useAbstractEconomyStore.getState().reports['imperial-state-of-mars'])
  // Policy actions.
  store.setEconomyType('imperial-state-of-mars', 'planned')
  check('setEconomyType applies', useAbstractEconomyStore.getState().byCountry['imperial-state-of-mars'].economyType === 'planned')
  store.setAllocation('imperial-state-of-mars', 'military', 10)
  const a = useAbstractEconomyStore.getState().byCountry['imperial-state-of-mars'].allocation
  check('setAllocation re-normalizes to sum 1', Math.abs(a.civilian + a.military + a.consumer - 1) < 1e-9)
}

console.log('\n=== 8. Payment link: production → strategic resources ===')
{
  const { abstractResourceFlows } = await import('../src/economy-abstract/abstractResources')
  const milHeavy = abstractReport(mk({ allocation: { civilian: 0.2, military: 0.7, consumer: 0.1 } }))
  const civHeavy = abstractReport(mk({ allocation: { civilian: 0.7, military: 0.1, consumer: 0.2 } }))
  const milFlows = abstractResourceFlows(milHeavy, 6000)
  const civFlows = abstractResourceFlows(civHeavy, 6000)
  check('more military production → more alloys (the ship material)', (milFlows.alloys ?? 0) > (civFlows.alloys ?? 0), `${(milFlows.alloys ?? 0).toFixed(0)} vs ${(civFlows.alloys ?? 0).toFixed(0)}`)
  check('more civilian production → more energy', (civFlows.energy ?? 0) > (milFlows.energy ?? 0), `${(civFlows.energy ?? 0).toFixed(0)} vs ${(milFlows.energy ?? 0).toFixed(0)}`)
  check('flows are all finite and non-negative', Object.values(abstractResourceFlows(abstractReport(mk()), 8000)).every((v) => Number.isFinite(v) && (v as number) >= 0))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
