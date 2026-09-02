import { Fragment, useState } from 'react'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { LineGraph } from './LineGraph'
import { GOOD_IDS, GOODS, type GoodId } from '../economy/goods'
import { RECIPES, getMethod } from '../economy/recipes'
import { NEED_TIERS, SPECIES_TEMPLATES } from '../economy/species'
import { formatPop, formatMoney, formatPrice } from '../economy/format'
import type { Country, World } from '../economy/economyTypes'

// For a good on a world: which buildings produce it (sellers) and which
// buildings + household needs consume it (buyers).
function marketParticipants(world: World, good: GoodId) {
  const sellers: string[] = []
  const buyers: string[] = []
  for (const b of world.buildings) {
    const method = getMethod(b.recipeId, b.methodId)
    if (!method) continue
    const label = RECIPES[b.recipeId]?.label ?? b.recipeId
    if (method.outputs.some((o) => o.good === good)) sellers.push(`${label} (L${b.level})`)
    if (method.inputs.some((i) => i.good === good)) buyers.push(`${label} (L${b.level})`)
  }
  // Households consume it if any species on the world needs it.
  const speciesIds = [...new Set(world.pops.map((p) => p.speciesTemplateId))]
  const householdNeeds = speciesIds.some((id) => {
    const sp = SPECIES_TEMPLATES[id]
    return sp && NEED_TIERS.some((t) => sp.needs[t].some((n) => n.good === good))
  })
  if (householdNeeds) buyers.push('Households')
  return { sellers, buyers }
}

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
  const [expandedGood, setExpandedGood] = useState<GoodId | null>(null)
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
              const open = expandedGood === g
              const parts = open ? marketParticipants(world, g) : null
              return (
                <Fragment key={g}>
                  <tr className="market-row" onClick={() => setExpandedGood(open ? null : g)} title="Click to see buyers & sellers">
                    <td>
                      <span className="market-caret">{open ? '▾' : '▸'}</span>
                      {GOODS[g].label}
                    </td>
                    <td>{formatPrice(world.market.prices[g])}</td>
                    <td>{r ? r.supply.toFixed(0) : '—'}</td>
                    <td>{r ? r.demand.toFixed(0) : '—'}</td>
                  </tr>
                  {open && parts && (
                    <tr className="market-detail-row">
                      <td colSpan={4}>
                        <div className="market-detail">
                          <div>
                            <span className="market-detail-label econ-pos">Sellers:</span> {parts.sellers.length ? parts.sellers.join(', ') : 'none on this world'}
                          </div>
                          <div>
                            <span className="market-detail-label econ-neg">Buyers:</span> {parts.buyers.length ? parts.buyers.join(', ') : 'none on this world'}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        <div className="ship-panel-hint">Prices clear each tick against what pops and buildings can actually buy. Click a good for its buyers & sellers.</div>
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
        <FiscalRow label="Public services (healthcare)" value={fiscal?.services} tone="neg" />
        <FiscalRow label="Administration & defense" value={fiscal?.admin} tone="neg" />
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
            GDP <b>{fiscal ? formatMoney(fiscal.gdp) : '—'}</b>
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
        <LineGraph title="GDP (USD)" series={[{ values: series.map((s) => s.gdp), color: GDP_COLOR, label: 'GDP' }]} format={formatMoney} />
        <LineGraph title="Price level (CPI, 1.00 = base)" series={[{ values: series.map((s) => s.priceLevel), color: PRICE_COLOR, label: 'CPI' }]} format={(v) => v.toFixed(2)} />
        <LineGraph
          title="Revenue vs Expenditure / tick (USD)"
          includeZero
          series={[
            { values: series.map((s) => s.revenue), color: REVENUE_COLOR, label: 'Rev' },
            { values: series.map((s) => s.expenditure), color: EXPENDITURE_COLOR, label: 'Exp' },
          ]}
          format={formatMoney}
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
      <span className={`inspect-value ${cls}`}>{value === undefined ? '—' : formatMoney(value)}</span>
    </div>
  )
}
