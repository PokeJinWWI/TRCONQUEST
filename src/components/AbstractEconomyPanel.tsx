import { useState } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { useAbstractEconomyStore, type AbstractHistoryPoint } from '../state/abstractEconomyStore'
import { ECONOMY_TYPES, economyTypeLabel, type AbstractEconomyState, type AbstractReport } from '../economy-abstract/abstractEconomy'
import { formatMoney, formatPop } from '../economy/format'

// A tiny inline sparkline (TNO-style stat graph) over a history series.
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="abs-spark abs-spark-empty">—</div>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const w = 100
  const h = 34
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * h}`).join(' ')
  return (
    <svg className="abs-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

function StatCard({ label, value, color, series }: { label: string; value: string; color: string; series: number[] }) {
  return (
    <div className="abs-statcard">
      <div className="abs-statcard-head" style={{ color }}>{label}</div>
      <div className="abs-statcard-value">{value}</div>
      <Sparkline values={series} color={color} />
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  const tone = value >= 0.6 ? '#4ade80' : value >= 0.35 ? '#ffd23f' : '#ff6b4a'
  return (
    <div className="cb-meter" title="Order and contentment. Consumer-goods shortfalls and inflation erode it; low stability drags production and growth.">
      <div className="cb-meter-head"><span>{label}</span><span className="cb-meter-val">{pct}%</span></div>
      <div className="cb-meter-track"><div className="cb-meter-fill" style={{ width: `${pct}%`, background: tone }} /></div>
    </div>
  )
}

// Economic warning signs — the derived red flags (TNO-style).
function WarningSigns({ s, r }: { s: AbstractEconomyState; r: AbstractReport }) {
  const signs: { label: string; on: boolean }[] = [
    { label: 'Negative real growth', on: r.realGrowth < 0 },
    { label: 'Inflation critical', on: s.inflation > 0.08 },
    { label: 'Extremely high deficit', on: r.deficitPctGdp < -0.05 },
    { label: 'Critical debt', on: r.debtToGdp > r.debtCeilingPct * 0.9 },
    { label: 'Bloated reserves', on: s.reserves > r.revenue && r.revenue > 0 },
    { label: 'Fiscal crisis', on: r.debtToGdp > r.debtCeilingPct || r.rating === 'CCC' },
  ]
  return (
    <div className="abs-warnings">
      {signs.map((w) => (
        <div key={w.label} className={`abs-warning${w.on ? ' on' : ''}`}>{w.label}</div>
      ))}
    </div>
  )
}

// The Abstract-Simplistic economy — a macro national screen for the player's nation.
export function AbstractEconomyPanel() {
  const [tab, setTab] = useState<'Macro' | 'Social' | 'Trade'>('Macro')
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const state = useAbstractEconomyStore((s) => (countryId ? s.byCountry[countryId] : undefined))
  const report = useAbstractEconomyStore((s) => (countryId ? s.reports[countryId] : undefined))
  const history = useAbstractEconomyStore((s) => (countryId ? s.history[countryId] : undefined)) as AbstractHistoryPoint[] | undefined
  const setTaxRate = useAbstractEconomyStore((s) => s.setTaxRate)
  const setEconomyType = useAbstractEconomyStore((s) => s.setEconomyType)
  const setMoneyCreation = useAbstractEconomyStore((s) => s.setMoneyCreation)
  const setWarTaxes = useAbstractEconomyStore((s) => s.setWarTaxes)
  const setAllocation = useAbstractEconomyStore((s) => s.setAllocation)
  const invest = useAbstractEconomyStore((s) => s.invest)
  const payDebt = useAbstractEconomyStore((s) => s.payDebt)

  if (!countryId || !state || !report) return <div className="nav-placeholder">No national economy in context.</div>
  const h = history ?? []
  const alloc = state.allocation
  const consumerShort = report.consumerBalance < 0

  return (
    <div className="econ-panel">
      <div className="abs-tabs">
        {(['Macro', 'Social', 'Trade'] as const).map((t) => (
          <button key={t} type="button" className={`abs-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab !== 'Macro' ? (
        <div className="ship-panel-hint" style={{ marginTop: 10 }}>
          {tab === 'Social' ? 'Social policy — welfare, stability measures and demographics.' : 'Trade — resource imports/exports and trade agreements.'} (Coming online; the Macro tab is the live economy.)
        </div>
      ) : (
        <>
          {/* Headline: economy type + credit rating */}
          <div className="abs-headline">
            <span className="abs-econtype">{economyTypeLabel(state.economyType)}</span>
            <span className={`abs-rating rating-${report.rating}`}>{report.rating}</span>
          </div>

          {/* Three stat graphs */}
          <div className="abs-statcards">
            <StatCard label="INFLATION" value={`${(state.inflation * 100).toFixed(2)}%`} color="#ff6b6b" series={h.map((p) => p.inflation)} />
            <StatCard label="GDP" value={formatMoney(state.gdp)} color="#4ade80" series={h.map((p) => p.gdp)} />
            <StatCard label="DEBT / GDP" value={`${(report.debtToGdp * 100).toFixed(1)}%`} color="#ff9a6b" series={h.map((p) => p.debtToGdp)} />
          </div>

          <div className="cb-facts">
            <div><span className="inspect-label">Nominal growth</span><span>{(report.nominalGrowth * 100).toFixed(2)}%</span></div>
            <div><span className="inspect-label">Real growth</span><span className={report.realGrowth >= 0 ? 'econ-pos' : 'econ-neg'}>{(report.realGrowth * 100).toFixed(2)}%</span></div>
            <div><span className="inspect-label">Population</span><span>{formatPop(state.population)}</span></div>
            <div><span className="inspect-label">Debt ceiling</span><span>{Math.round(report.debtCeilingPct * 100)}% GDP</span></div>
          </div>

          <div className="cb-governance" style={{ marginTop: 8 }}><Meter label="Stability" value={state.stability} /></div>

          {/* Money creation slider */}
          <label className="econ-control-row" title="Cover this share of any budget deficit by printing money instead of borrowing. Fast cash, but it fuels inflation.">
            <span className="inspect-label">Money creation</span>
            <span>
              <input type="range" min={0} max={1} step={0.05} value={state.moneyCreation} onChange={(e) => setMoneyCreation(countryId, Number(e.target.value))} />
              <b style={{ marginLeft: 8, color: '#cdeeff' }}>{Math.round(state.moneyCreation * 100)}%</b>
            </span>
          </label>

          {/* Deficit */}
          <div className="abs-deficit">
            <span>Yearly balance</span>
            <span className={report.balance >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(report.balance)} ({(report.deficitPctGdp * 100).toFixed(1)}% GDP)</span>
          </div>

          {/* Expenditure & revenue breakdown */}
          <div className="abs-budget-cols">
            <div className="abs-budget-col">
              <div className="abs-budget-title econ-neg">Expenditure {formatMoney(report.spending)}</div>
              <div><span>Military</span><span>{formatMoney(report.expMilitary)}</span></div>
              <div><span>Civil</span><span>{formatMoney(report.expCivil)}</span></div>
              <div><span>Debt servicing</span><span>{formatMoney(report.expDebt)}</span></div>
              <div><span>Other</span><span>{formatMoney(report.expOther)}</span></div>
            </div>
            <div className="abs-budget-col">
              <div className="abs-budget-title econ-pos">Revenue {formatMoney(report.revenue)}</div>
              <div><span>Income tax</span><span>{formatMoney(report.revIncome)}</span></div>
              <div><span>Business tax</span><span>{formatMoney(report.revBusiness)}</span></div>
              <div><span>Excise</span><span>{formatMoney(report.revExcise)}</span></div>
              <div><span>Other</span><span>{formatMoney(report.revOther)}</span></div>
            </div>
          </div>

          {/* Reserves + war taxes */}
          <div className="cb-facts" style={{ marginTop: 6 }}>
            <div><span className="inspect-label">Treasury</span><span>{formatMoney(state.treasury)}</span></div>
            <div><span className="inspect-label">Reserves</span><span>{formatMoney(state.reserves)}</span></div>
            <div><span className="inspect-label">National debt</span><span>{formatMoney(state.debt)}</span></div>
          </div>
          <div className="econ-control-row">
            <span className="inspect-label">Reserves</span>
            <span>
              <button type="button" className="laws-enact-btn" onClick={() => invest(countryId, state.treasury * 0.25)}>Invest</button>{' '}
              <button type="button" className="laws-enact-btn" onClick={() => payDebt(countryId, state.reserves + state.treasury * 0.25)}>Pay Debt</button>
            </span>
          </div>
          <label className="econ-control-row" style={{ cursor: 'pointer' }} title="Emergency wartime revenue (+25%) at a standing stability cost.">
            <span className="inspect-label">War taxes {state.warTaxes ? '(active)' : ''}</span>
            <input type="checkbox" checked={state.warTaxes} onChange={(e) => setWarTaxes(countryId, e.target.checked)} />
          </label>

          {/* Production allocation */}
          <div className="econ-subtitle" style={{ marginTop: 12 }}>Production ({report.productionUnits.toFixed(0)} units/mo)</div>
          {([
            { leg: 'civilian' as const, label: 'Civilian', value: report.civilianProduction },
            { leg: 'military' as const, label: 'Military', value: report.militaryProduction },
            { leg: 'consumer' as const, label: 'Consumer goods', value: report.consumerProduction },
          ]).map(({ leg, label, value }) => (
            <label key={leg} className="econ-control-row">
              <span className="inspect-label">{label}</span>
              <span>
                <input type="range" min={0} max={1} step={0.05} value={alloc[leg]} onChange={(e) => setAllocation(countryId, leg, Number(e.target.value))} />
                <b style={{ marginLeft: 8, color: '#cdeeff' }}>{Math.round(alloc[leg] * 100)}%</b>
                <span style={{ marginLeft: 8, opacity: 0.6 }}>{value.toFixed(0)}</span>
              </span>
            </label>
          ))}
          <div className="abs-deficit">
            <span>Consumer demand</span>
            <span>{report.consumerProduction.toFixed(0)} / {report.consumerDemand.toFixed(0)} <span className={consumerShort ? 'econ-neg' : 'econ-pos'}>({consumerShort ? 'shortfall' : 'met'})</span></span>
          </div>

          {/* Policy */}
          <div className="econ-subtitle" style={{ marginTop: 12 }}>Policy</div>
          <label className="econ-control-row">
            <span className="inspect-label">Tax rate</span>
            <span>
              <input type="range" min={0} max={0.5} step={0.01} value={state.taxRate} onChange={(e) => setTaxRate(countryId, Number(e.target.value))} />
              <b style={{ marginLeft: 8, color: '#cdeeff' }}>{Math.round(state.taxRate * 100)}%</b>
            </span>
          </label>
          <div className="econ-control-row">
            <span className="inspect-label" title="Capitalism / corporatism / planned — each favors different sectors.">Economy type</span>
            <span>
              {ECONOMY_TYPES.map((t) => (
                <button key={t} type="button" className={`laws-enact-btn${state.economyType === t ? ' active' : ''}`} style={{ marginLeft: 4, ...(state.economyType === t ? { background: 'rgba(111,227,255,0.25)', color: '#fff' } : {}) }} onClick={() => setEconomyType(countryId, t)}>
                  {economyTypeLabel(t)}
                </button>
              ))}
            </span>
          </div>

          {/* Warning signs */}
          <div className="econ-subtitle" style={{ marginTop: 12 }}>Economic warning signs</div>
          <WarningSigns s={state} r={report} />

          <div className="ship-panel-hint" style={{ marginTop: 8, opacity: 0.7 }}>
            (Spending on ships, buildings and tech draws on this economy next.)
          </div>
        </>
      )}
    </div>
  )
}
