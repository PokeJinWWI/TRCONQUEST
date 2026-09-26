import { useState, type ReactNode } from 'react'
import { useEconomyStore, unemploymentOf } from '../state/economyStore'
import { useViewStore } from '../state/viewStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { MONTHS_PER_YEAR, formatMoney, formatPop } from '../economy/format'
import { effectiveIndependence, exchangeRateRegimeDef, hasCentralBank } from '../economy/centralBank'
import {
  BudgetFlowChart,
  DebtToGdpChart,
  ExchangeRateChart,
  GdpChart,
  GdpPerCapitaChart,
  GrowthChart,
  InflationChart,
  InterestRatesChart,
  TreasuryDebtChart,
  UnemploymentChart,
  gdpPerCapita,
  yoyGrowth,
} from './complexCharts'

// Complex mode's Economy > Overview: the whole national economy on one
// scrollable page (Simple mode's dashboard look) — headline numbers you click
// to chart, growth, the budget with its deficit, debt and credit rating,
// money and the central bank, trade, and warning signs. Every section links to
// the detailed tab it summarises; those tabs stay as they were.
//
// GDP and budget flows are shown PER YEAR, as everywhere in Complex mode's
// economy screens; the charts are the shared ones in complexCharts.tsx, so the
// same number looks the same here, in Finance and in the Central Bank tabs.

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`

type Metric = 'gdp' | 'perCapita' | 'growth' | 'inflation' | 'unemployment' | 'rate' | 'debt' | 'balance' | 'currency'

function Card({ label, value, color, active, onClick, tip }: { label: string; value: string; color: string; active: boolean; onClick: () => void; tip: string }) {
  return (
    <button type="button" className={`abs-statcard${active ? ' active' : ''}`} onClick={onClick} title={`${tip} Click to chart it below.`}>
      <div className="abs-statcard-head" style={{ color }}>{label}</div>
      <div className="abs-statcard-value">{value}</div>
    </button>
  )
}

// A section heading with a link to the tab that has the full detail.
function Section({ title, category, sub, children }: { title: string; category: string; sub: string | null; children: ReactNode }) {
  const setNavCategory = useViewStore((s) => s.setNavCategory)
  return (
    <>
      <div className="eco-section-head">
        <span className="econ-subtitle">{title}</span>
        <button type="button" className="eco-details" title={`Open ${category}${sub ? ` › ${sub}` : ''} for the full detail`} onClick={(e) => {
            // Land at the top of the detail tab, not at this page's scroll position.
            e.currentTarget.closest('.draggable-window-body')?.scrollTo({ top: 0 })
            setNavCategory(category, sub)
          }}>
          Details →
        </button>
      </div>
      {children}
    </>
  )
}

function Meter({ label, value, title }: { label: string; value: number; title?: string }) {
  const p = Math.round(value * 100)
  return (
    <div className="cb-meter" title={title}>
      <div className="cb-meter-head"><span>{label}</span><span className="cb-meter-val">{p}%</span></div>
      <div className="cb-meter-track"><div className="cb-meter-fill" style={{ width: `${p}%` }} /></div>
    </div>
  )
}

export function EconomyOverview() {
  const { country } = usePlayerEconomy()
  const [metric, setMetric] = useState<Metric>('gdp')
  const fiscal = useEconomyStore((s) => (country ? s.countryReports[country.id] : undefined))
  const money = useEconomyStore((s) => (country ? s.moneyReports[country.id] : undefined))
  const history = useEconomyStore((s) => (country ? s.history[country.id] : undefined))
  const tick = useEconomyStore((s) => s.tick)
  const worlds = useEconomyStore((s) => s.worlds)
  const worldReports = useEconomyStore((s) => s.worldReports)
  const setTaxRate = useEconomyStore((s) => s.setTaxRate)

  if (!country) return <div className="nav-placeholder">No national government in context.</div>
  if (!fiscal) return <div className="nav-placeholder">Advance time a month to see your economy.</div>

  const h = history ?? []
  const Y = MONTHS_PER_YEAR
  const gdpYear = fiscal.gdp * Y
  const realGdpYear = fiscal.priceLevel > 0 ? gdpYear / fiscal.priceLevel : gdpYear
  const perCapita = gdpPerCapita(gdpYear, fiscal.population)
  const growthSeries = yoyGrowth(h)
  const growth = growthSeries.length > 0 ? growthSeries[growthSeries.length - 1] : undefined
  const unemployment = unemploymentOf(country.id, worlds, worldReports)
  const cb = country.centralBank && hasCentralBank(country.centralBank) ? country.centralBank : undefined
  const deficitPct = fiscal.gdp > 0 ? fiscal.balance / fiscal.gdp : 0


  const expenses: { label: string; value: number; tip: string }[] = [
    { label: 'Welfare (pensions)', value: fiscal.welfare, tip: 'The per-person pension/benefit' },
    { label: 'Public services', value: fiscal.services, tip: 'The state share of healthcare, dental and education' },
    { label: 'Admin & defense', value: fiscal.admin, tip: 'Running the state and its forces' },
    { label: 'Subsidies', value: fiscal.subsidiesSpent, tip: 'Paid to corporations and buildings' },
    { label: 'Construction', value: fiscal.construction, tip: 'State-funded building projects' },
    { label: 'Stockpile purchases', value: fiscal.stockpileSpend, tip: 'Goods bought into strategic stockpiles' },
    { label: 'Debt interest', value: fiscal.interest, tip: 'Interest on the national debt' },
  ]

  const signs: { label: string; on: boolean }[] = [
    { label: 'Negative real growth', on: growth !== undefined && growth < 0 },
    { label: 'Inflation critical', on: fiscal.inflation > 0.08 },
    { label: 'Deflation', on: fiscal.inflation < 0 },
    { label: 'High unemployment', on: unemployment > 0.1 },
    { label: 'Extremely high deficit', on: deficitPct < -0.05 },
    { label: 'Treasury overdrawn', on: fiscal.treasury < 0 },
    { label: 'Critical debt', on: fiscal.debtToGdp > 1.5 },
    { label: 'Junk credit rating', on: ['BB', 'B', 'CCC'].includes(fiscal.rating) },
  ]

  return (
    <div className="econ-panel">
      <div className="abs-headline">
        <span className="abs-econtype" title="Your currency and its value in Terra Standard Credits">
          {country.currency ? `${country.currency.code} · ${country.currency.rate.toFixed(3)} TSC` : 'National economy'}
        </span>
        <span className={`abs-rating rating-${fiscal.rating}`} title="Credit rating — how safe lenders think your debt is, from AAA down to CCC. It follows debt-to-GDP.">{fiscal.rating}</span>
      </div>

      <div className="abs-statcards">
        <Card label="GDP / YR" value={formatMoney(gdpYear)} color="#4ade80" active={metric === 'gdp'} onClick={() => setMetric('gdp')} tip="Everything the nation produces in a year." />
        <Card label="GDP / CAPITA" value={perCapita === undefined ? '—' : formatMoney(perCapita)} color="#8ab4ff" active={metric === 'perCapita'} onClick={() => setMetric('perCapita')} tip="GDP per person per year — how much the economy produces for each inhabitant." />
        <Card label="REAL GROWTH" value={growth === undefined ? '—' : pct(growth, 1)} color="#9be37b" active={metric === 'growth'} onClick={() => setMetric('growth')} tip="Real GDP vs a year earlier." />
        <Card label="INFLATION" value={pct(fiscal.inflation, 2)} color="#ff6b6b" active={metric === 'inflation'} onClick={() => setMetric('inflation')} tip="How fast prices are rising, per year." />
        <Card label="UNEMPLOYMENT" value={pct(unemployment, 1)} color="#ffd23f" active={metric === 'unemployment'} onClick={() => setMetric('unemployment')} tip="Share of workers without a job." />
        <Card label="POLICY RATE" value={fiscal.policyRate === undefined ? '—' : pct(fiscal.policyRate, 2)} color="#6fe3ff" active={metric === 'rate'} onClick={() => setMetric('rate')} tip="The central bank's interest rate." />
        <Card label="DEBT / GDP" value={pct(fiscal.debtToGdp, 0)} color="#ff9a6b" active={metric === 'debt'} onClick={() => setMetric('debt')} tip="National debt as a share of a year's GDP." />
        <Card label="BALANCE / YR" value={formatMoney(fiscal.balance * Y)} color={fiscal.balance >= 0 ? '#4ade80' : '#ff6b6b'} active={metric === 'balance'} onClick={() => setMetric('balance')} tip="Revenue minus spending over a year — negative is a deficit." />
        <Card label="EXCHANGE RATE" value={country.currency ? country.currency.rate.toFixed(3) : '—'} color="#6fe3ff" active={metric === 'currency'} onClick={() => setMetric('currency')} tip="Your currency's value in Terra Standard Credits." />
      </div>
      {metric === 'gdp' && <GdpChart h={h} tick={tick} />}
      {metric === 'perCapita' && <GdpPerCapitaChart h={h} tick={tick} />}
      {metric === 'growth' && <GrowthChart h={h} tick={tick} />}
      {metric === 'inflation' && <InflationChart h={h} tick={tick} />}
      {metric === 'unemployment' && <UnemploymentChart h={h} tick={tick} />}
      {metric === 'rate' && <InterestRatesChart h={h} tick={tick} />}
      {metric === 'debt' && <DebtToGdpChart h={h} tick={tick} />}
      {metric === 'balance' && <BudgetFlowChart h={h} tick={tick} />}
      {metric === 'currency' && <ExchangeRateChart h={h} tick={tick} code={country.currency?.code ?? 'Rate'} showPeg={!!cb && cb.exchangeRegime !== 'float'} />}

      <div className="cb-facts">
        <div><span className="inspect-label">Real GDP</span><span>{formatMoney(realGdpYear)}/yr</span></div>
        <div><span className="inspect-label">Population</span><span>{formatPop(fiscal.population)}</span></div>
        <div title="GDP per person per year"><span className="inspect-label">GDP per capita</span><span>{perCapita === undefined ? '—' : `${formatMoney(perCapita)}/yr`}</span></div>
        <div><span className="inspect-label">Price level</span><span>{fiscal.priceLevel.toFixed(3)}</span></div>
        {fiscal.outputGap !== undefined && (
          <div><span className="inspect-label">Output gap</span><span className={fiscal.outputGap > 0.02 ? 'econ-neg' : ''}>{pct(fiscal.outputGap, 1)}</span></div>
        )}
      </div>

      <Section title="Budget (per year)" category="Economy" sub="Budget">
        <div className="abs-deficit">
          <span title="Revenue minus spending. Negative is a deficit, borrowed or printed.">Yearly balance</span>
          <span className={fiscal.balance >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(fiscal.balance * Y)} ({pct(deficitPct)} GDP)</span>
        </div>
        <div className="abs-budget-cols">
          <div className="abs-budget-col">
            <div className="abs-budget-title econ-neg">Expenditure {formatMoney(fiscal.expenditure * Y)}</div>
            {expenses.map((e) => (
              <div key={e.label} title={e.tip}><span>{e.label}</span><span>{formatMoney(e.value * Y)}</span></div>
            ))}
          </div>
          <div className="abs-budget-col">
            <div className="abs-budget-title econ-pos">Revenue {formatMoney(fiscal.revenue * Y)}</div>
            <div title="Income tax on all wages and profits"><span>Tax revenue</span><span>{formatMoney(fiscal.revenue * Y)}</span></div>
            <div className="eco-tax-row" title="The income tax rate — your main revenue lever">
              <span>Tax rate</span>
              <span className="econ-control">
                <button type="button" title="Lower taxes by 5 points" onClick={() => setTaxRate(country.id, country.taxRate - 0.05)}>−</button>
                <span className="econ-control-value">{Math.round(country.taxRate * 100)}%</span>
                <button type="button" title="Raise taxes by 5 points" onClick={() => setTaxRate(country.id, country.taxRate + 0.05)}>+</button>
              </span>
            </div>
          </div>
        </div>
        <BudgetFlowChart h={h} tick={tick} />
        <div className="cb-facts" style={{ marginTop: 4 }}>
          <div><span className="inspect-label">Treasury</span><span className={fiscal.treasury < 0 ? 'econ-neg' : ''}>{formatMoney(fiscal.treasury)}</span></div>
          <div><span className="inspect-label">National debt</span><span>{formatMoney(fiscal.debt)}</span></div>
          <div><span className="inspect-label">Debt / GDP</span><span>{pct(fiscal.debtToGdp, 0)}</span></div>
          <div><span className="inspect-label">Credit rating</span><span className={`rating-${fiscal.rating}`}>{fiscal.rating}</span></div>
        </div>
        <TreasuryDebtChart h={h} tick={tick} />
      </Section>

      <Section title="Money & central bank" category="Central Bank" sub="Monetary Policy">
        {cb ? (
          <>
            <div className="cb-facts">
              {fiscal.policyRate !== undefined && <div><span className="inspect-label">Policy rate</span><span>{pct(fiscal.policyRate, 2)}</span></div>}
              {fiscal.realRate !== undefined && <div><span className="inspect-label">Real rate</span><span>{pct(fiscal.realRate, 2)}</span></div>}
              {fiscal.inflationExpectation !== undefined && <div><span className="inspect-label">Expectations</span><span>{pct(fiscal.inflationExpectation, 1)}</span></div>}
              {money && <div><span className="inspect-label">Broad money (M2)</span><span>{formatMoney(money.broadMoney)}</span></div>}
              <div><span className="inspect-label">Regime</span><span>{exchangeRateRegimeDef(cb.exchangeRegime).name}</span></div>
              <div><span className="inspect-label">FX reserves</span><span>{formatMoney(cb.fxReserves)}</span></div>
            </div>
            <div className="cb-governance">
              <Meter label="Credibility" value={cb.credibility} title="How much markets trust the bank to hold its mandate." />
              <Meter label="Independence" value={effectiveIndependence(cb)} title="How far the bank is insulated from the government." />
            </div>
          </>
        ) : (
          <div className="abs-dim">No central bank — nobody steers interest rates or the money supply.</div>
        )}
      </Section>

      <Section title="Trade & logistics" category="Economy" sub="Trade">
        <div className="cb-facts">
          <div title="Goods shipped between your worlds this month"><span className="inspect-label">Trade volume</span><span>{fiscal.tradeVolume.toFixed(0)}</span></div>
          <div title="How much freight your logistics can move a month"><span className="inspect-label">Freight capacity</span><span>{fiscal.logisticsCapacity.toFixed(0)}</span></div>
          {country.currency && <div><span className="inspect-label">Exchange rate</span><span>{country.currency.rate.toFixed(3)} TSC</span></div>}
          <div title="Private capital pooled to finance construction"><span className="inspect-label">Investment pool</span><span>{formatMoney(country.investmentPool)}</span></div>
        </div>
      </Section>

      <div className="econ-subtitle" style={{ marginTop: 12 }}>Economic warning signs</div>
      <div className="abs-warnings">
        {signs.map((w) => (
          <div key={w.label} className={`abs-warning${w.on ? ' on' : ''}`}>{w.label}</div>
        ))}
      </div>
    </div>
  )
}
