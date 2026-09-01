import { useEconomyStore } from '../state/economyStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { LineGraph } from './LineGraph'
import { GOOD_IDS, GOODS } from '../economy/goods'
import { NEED_TIERS } from '../economy/species'
import { formatPop } from '../economy/format'
import type { Country, World } from '../economy/economyTypes'

interface EconomyPanelProps {
  subcategory: string | null
  // Market comes from the WORLD; Budget/Finance/Welfare from the COUNTRY.
  worldName?: string
  world?: World
  country?: Country
}

const GDP_COLOR = '#6fe3ff'
const REVENUE_COLOR = '#4ade80'
const EXPENDITURE_COLOR = '#ff6b4a'
const PRICE_COLOR = '#ffd23f'
const DEBT_COLOR = '#c77dff'

// The nation-level Economy category reports on the player's own country + its
// capital world.
export function NationEconomyPanel({ subcategory }: { subcategory: string | null }) {
  const { country, world } = usePlayerEconomy()
  return <EconomyPanel subcategory={subcategory} worldName={world?.name} world={world} country={country} />
}

export function EconomyPanel({ subcategory, worldName, world, country }: EconomyPanelProps) {
  const worldReports = useEconomyStore((s) => s.worldReports)
  const countryReports = useEconomyStore((s) => s.countryReports)
  const history = useEconomyStore((s) => s.history)
  const allWorlds = useEconomyStore((s) => s.worlds)
  const setTaxRate = useEconomyStore((s) => s.setTaxRate)
  const setWelfare = useEconomyStore((s) => s.setWelfare)

  // Market is per-world; the fiscal tabs are national (per country).
  if (subcategory === 'Market') {
    if (!world) return <div className="nav-placeholder">{worldName ? `${worldName} is uninhabited — no market.` : 'No world in focus.'}</div>
    const report = worldReports[world.id]
    return (
      <div className="econ-panel">
        <div className="econ-subtitle">{world.name} market</div>
        <table className="econ-table">
          <thead>
            <tr>
              <th>Good</th>
              <th>Price</th>
              <th>Supply</th>
              <th>Demand</th>
            </tr>
          </thead>
          <tbody>
            {GOOD_IDS.map((g) => {
              const r = report?.goods[g]
              return (
                <tr key={g}>
                  <td>{GOODS[g].label}</td>
                  <td>{world.market.prices[g].toFixed(2)}</td>
                  <td>{r ? r.supply.toFixed(0) : '—'}</td>
                  <td>{r ? r.demand.toFixed(0) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="ship-panel-hint">Prices clear each tick against what pops and buildings can actually buy.</div>
      </div>
    )
  }

  if (!country) {
    return <div className="nav-placeholder">No national government in context.</div>
  }
  const fiscal = countryReports[country.id]
  const series = history[country.id] ?? []

  if (subcategory === 'Budget') {
    return (
      <div className="econ-panel">
        <div className="econ-subtitle">Revenue</div>
        <FiscalRow label="Tax revenue / tick" value={fiscal?.revenue} tone="pos" />
        <div className="econ-subtitle" style={{ marginTop: 8 }}>
          Expenditure
        </div>
        <FiscalRow label="Welfare" value={fiscal?.welfare} tone="neg" />
        <FiscalRow label="Administration" value={fiscal?.admin} tone="neg" />
        <FiscalRow label="Construction" value={fiscal?.construction} tone="neg" />
        <FiscalRow label="Debt interest" value={fiscal?.interest} tone="neg" />
        <div className="inspect-divider" />
        <FiscalRow label="Balance / tick" value={fiscal?.balance} tone="signed" />
        <FiscalRow label="Treasury" value={fiscal?.treasury} tone="signed" />
        <FiscalRow label="National debt" value={fiscal?.debt} tone="neg" />

        <div className="inspect-divider" />
        <div className="econ-subtitle">Controls</div>
        <div className="econ-control-row">
          <span className="inspect-label">Income tax</span>
          <span className="econ-control">
            <button type="button" onClick={() => setTaxRate(country.id, country.taxRate - 0.05)}>
              −
            </button>
            <span className="econ-control-value">{Math.round(country.taxRate * 100)}%</span>
            <button type="button" onClick={() => setTaxRate(country.id, country.taxRate + 0.05)}>
              +
            </button>
          </span>
        </div>
        <div className="econ-control-row">
          <span className="inspect-label">Welfare / capita</span>
          <span className="econ-control">
            <button type="button" onClick={() => setWelfare(country.id, country.welfarePerCapita - 0.02)}>
              −
            </button>
            <span className="econ-control-value">{country.welfarePerCapita.toFixed(2)}</span>
            <button type="button" onClick={() => setWelfare(country.id, country.welfarePerCapita + 0.02)}>
              +
            </button>
          </span>
        </div>
        <div className="ship-panel-hint">
          One national budget for the whole country. Spend past tax revenue and the deficit piles up as debt and
          downgrades your credit rating.
        </div>
      </div>
    )
  }

  if (subcategory === 'Finance') {
    return (
      <div className="econ-panel">
        <div className="econ-fiscal-headline">
          <span>
            GDP <b>{fiscal ? fiscal.gdp.toFixed(0) : '—'}</b>
          </span>
          <span>
            Pop <b>{fiscal ? formatPop(fiscal.population) : '—'}</b>
          </span>
          <span>
            Inflation <b>{fiscal ? `${(fiscal.inflation * 100).toFixed(2)}%` : '—'}</b>
          </span>
          <span>
            Debt/GDP <b>{fiscal ? `${(fiscal.debtToGdp * 100).toFixed(0)}%` : '—'}</b>
          </span>
          <span>
            Rating <b className={`rating-${fiscal?.rating ?? 'AAA'}`}>{fiscal?.rating ?? '—'}</b>
          </span>
        </div>
        <LineGraph title="GDP" series={[{ values: series.map((s) => s.gdp), color: GDP_COLOR, label: 'GDP' }]} format={(v) => v.toFixed(0)} />
        <LineGraph title="Price level (CPI, 1.00 = base)" series={[{ values: series.map((s) => s.priceLevel), color: PRICE_COLOR, label: 'CPI' }]} format={(v) => v.toFixed(2)} />
        <LineGraph
          title="Revenue vs Expenditure / tick"
          includeZero
          series={[
            { values: series.map((s) => s.revenue), color: REVENUE_COLOR, label: 'Rev' },
            { values: series.map((s) => s.expenditure), color: EXPENDITURE_COLOR, label: 'Exp' },
          ]}
          format={(v) => v.toFixed(0)}
        />
        <LineGraph title="Debt-to-GDP" includeZero series={[{ values: series.map((s) => s.debtToGdp), color: DEBT_COLOR, label: 'Debt/GDP' }]} format={(v) => `${(v * 100).toFixed(0)}%`} />
      </div>
    )
  }

  // Welfare — nation-wide needs satisfaction across all the country's worlds.
  const worlds = allWorlds.filter((w) => w.ownerId === country.id)
  const allPops = worlds.flatMap((w) => w.pops)
  const totalPop = allPops.reduce((s, p) => s + p.populationSize, 0)
  const avg = (tier: (typeof NEED_TIERS)[number]) =>
    totalPop > 0 ? allPops.reduce((s, p) => s + p.needsSatisfaction[tier] * p.populationSize, 0) / totalPop : 0
  return (
    <div className="econ-panel">
      <div className="econ-subtitle">National needs satisfaction</div>
      {NEED_TIERS.map((tier) => (
        <div className="inspect-row" key={tier}>
          <span className="inspect-label" style={{ textTransform: 'capitalize' }}>
            {tier}
          </span>
          <span className="inspect-value">{Math.round(avg(tier) * 100)}%</span>
        </div>
      ))}
      <div className="ship-panel-hint">Welfare (set in Budget) transfers money to pops each tick; how much of each need they then meet shows here.</div>
    </div>
  )
}

function FiscalRow({ label, value, tone }: { label: string; value: number | undefined; tone: 'pos' | 'neg' | 'signed' }) {
  const cls = value === undefined ? '' : tone === 'pos' ? 'econ-pos' : tone === 'neg' ? 'econ-neg' : value >= 0 ? 'econ-pos' : 'econ-neg'
  return (
    <div className="inspect-row">
      <span className="inspect-label">{label}</span>
      <span className={`inspect-value ${cls}`}>{value === undefined ? '—' : value.toFixed(0)}</span>
    </div>
  )
}
