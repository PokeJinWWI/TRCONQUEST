// Verification of Complex mode's extra history series (Economy Overview and
// Central Bank graphs).
// Run:  npx tsx tests/economyCharts.test.ts

import { useEconomyStore, unemploymentOf, type FiscalSample } from '../src/state/economyStore'
import { trailingSeries, gdpPerYear, realGdpPerYear, gdpPerCapita, yoyGrowth } from '../src/components/complexCharts'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('=== 1. Monthly samples carry the new series ===')
{
  useEconomyStore.getState().advance(6)
  const st = useEconomyStore.getState()
  const id = st.countries[0].id
  const h = st.history[id]
  const last = h[h.length - 1]
  check('six months of history', h.length === 6 && st.tick === 6)
  check('budget series: balance and debt', Number.isFinite(last.balance) && Number.isFinite(last.debt))
  check('monetary series: policy rate, real rate, expectations, output gap', [last.policyRate, last.realRate, last.inflationExpectation, last.outputGap].every((v) => v !== undefined && Number.isFinite(v)))
  check('money series: M0, M2, loans, deposits', [last.baseMoney, last.broadMoney, last.loans, last.deposits].every((v) => v !== undefined && v >= 0))
  check('currency series: exchange rate, FX reserves, credibility', [last.exchangeRate, last.fxReserves, last.credibility].every((v) => v !== undefined && Number.isFinite(v)))
  check('unemployment is a share', last.unemployment !== undefined && last.unemployment >= 0 && last.unemployment <= 1, ((last.unemployment ?? 0) * 100).toFixed(1) + '%')
  check('unemploymentOf matches the live worlds', Math.abs(unemploymentOf(id, st.worlds, st.worldReports) - (last.unemployment ?? -1)) < 1e-9)
  const pegged = st.countries.find((c) => c.centralBank && c.centralBank.exchangeRegime !== 'float')
  if (pegged) check('a pegged currency records its target', st.history[pegged.id].at(-1)?.pegTarget !== undefined, pegged.id)
}

console.log('\n=== 2. trailingSeries: charts only the run of samples that have a field ===')
{
  const mk = (over: Partial<FiscalSample>): FiscalSample => ({ gdp: 1, priceLevel: 1, inflation: 0, revenue: 0, expenditure: 0, debtToGdp: 0, treasury: 0, ...over })
  const h = [mk({}), mk({}), mk({ policyRate: 0.03 }), mk({ policyRate: 0.04 })]
  const s = trailingSeries(h, (p) => p.policyRate)
  check('older samples without the field are skipped', s.length === 2 && s[0] === 0.03 && s[1] === 0.04)
  check('an empty history gives an empty series', trailingSeries([], (p) => p.policyRate).length === 0)
}

console.log('\n=== 3. One convention: GDP and budget flows per year; GDP per capita ===')
{
  const st = useEconomyStore.getState()
  const id = st.countries[0].id
  const f = st.countryReports[id]
  const last = st.history[id].at(-1)!
  check('population is recorded for per-capita charts', last.population !== undefined && last.population > 0, `${last.population?.toFixed(0)}M`)
  check('the charted GDP equals the headline GDP per year', Math.abs(gdpPerYear(last) - f.gdp * 12) < 1e-9)
  check('real GDP is nominal over the price level', Math.abs(realGdpPerYear(last) - (f.gdp * 12) / f.priceLevel) < 1e-6)
  const pc = gdpPerCapita(gdpPerYear(last), last.population)
  check('GDP per capita = yearly GDP / people', pc !== undefined && Math.abs(pc * last.population! * 1e6 - gdpPerYear(last)) < 1e-6)
  check('no population, no per-capita figure', gdpPerCapita(100, 0) === undefined && gdpPerCapita(100, undefined) === undefined)
  const mk = (gdp: number) => ({ gdp, priceLevel: 1, inflation: 0, revenue: 0, expenditure: 0, debtToGdp: 0, treasury: 0 })
  const g = yoyGrowth(Array.from({ length: 14 }, (_, i) => mk(i < 12 ? 100 : 110)))
  check('year-on-year growth compares with 12 months earlier', g.length === 2 && Math.abs(g[0] - 0.1) < 1e-9, g.map((v) => v.toFixed(2)).join(', '))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
