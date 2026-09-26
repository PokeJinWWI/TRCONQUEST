import { Fragment, useState } from 'react'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { BudgetFlowChart, DebtToGdpChart, GdpChart, GdpPerCapitaChart, PriceLevelChart, gdpPerCapita } from './complexCharts'
import { GOOD_IDS, GOODS, type GoodId } from '../economy/goods'
import { RECIPES, getMethod } from '../economy/recipes'
import { NEED_TIERS, SPECIES_TEMPLATES } from '../economy/species'
import { MONTHS_PER_YEAR, formatPop, formatMoney, formatPrice } from '../economy/format'
import type { Country, World } from '../economy/economyTypes'

// For a good on a world: which buildings produce it (sellers) and which
// buildings + household needs consume it (buyers).
// A plain-language label for a welfare level (the per-person monthly benefit),
// so the number isn't a bare figure — you can see at a glance how generous your
// social policy is.
function welfareTier(perCapita: number): string {
  if (perCapita <= 0) return 'None'
  if (perCapita < 1) return 'Minimal'
  if (perCapita < 2.5) return 'Basic'
  if (perCapita < 4.5) return 'Generous'
  return 'Comprehensive'
}

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
    return sp && NEED_TIERS.some((t) => sp.needs[t].some((group) => group.goods.some((g) => g.good === good)))
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

// Per-tick (monthly) simulation flows shown per year, like the Overview.
const perYear = (perTick: number | undefined) => (perTick === undefined ? undefined : perTick * MONTHS_PER_YEAR)

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
  const economyTick = useEconomyStore((s) => s.tick)
  const allWorlds = useEconomyStore((s) => s.worlds)
  const setTaxRate = useEconomyStore((s) => s.setTaxRate)
  const setWelfare = useEconomyStore((s) => s.setWelfare)
  const setPublicServiceCoverage = useEconomyStore((s) => s.setPublicServiceCoverage)

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
        <div className="ship-panel-hint" style={{ marginBottom: 6 }}>All flows are per year (the Overview and Finance use the same figures).</div>
        <div className="econ-subtitle">Revenue (per year)</div>
        <FiscalRow label="Tax revenue" value={perYear(fiscal?.revenue)} tone="pos" />
        <div className="econ-subtitle" style={{ marginTop: 8 }}>
          Expenditure (per year)
        </div>
        <FiscalRow label="Welfare (pensions)" value={perYear(fiscal?.welfare)} tone="neg" />
        <FiscalRow label="Public services" value={perYear(fiscal?.services)} tone="neg" />
        <FiscalRow label="Admin & defense" value={perYear(fiscal?.admin)} tone="neg" />
        <FiscalRow label="Subsidies" value={perYear(fiscal?.subsidiesSpent)} tone="neg" />
        <FiscalRow label="Construction" value={perYear(fiscal?.construction)} tone="neg" />
        <FiscalRow label="Stockpile purchases" value={perYear(fiscal?.stockpileSpend)} tone="neg" />
        <FiscalRow label="Debt interest" value={perYear(fiscal?.interest)} tone="neg" />
        <FiscalRow label="Total spending" value={perYear(fiscal?.expenditure)} tone="neg" />
        <div className="inspect-divider" />
        <FiscalRow label="Balance (per year)" value={perYear(fiscal?.balance)} tone="signed" />
        <FiscalRow label="Treasury" value={fiscal?.treasury} tone="signed" />
        <FiscalRow label="National debt" value={fiscal?.debt} tone="neg" />
        <FiscalRow label="Private investment pool" value={country.investmentPool} tone="pos" />

        <div className="inspect-divider" />
        <div className="econ-subtitle">Controls</div>
        <div className="econ-control-row" title="The income tax rate on all wages and profits — your main revenue lever.">
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
        <div className="econ-control-row" title="A social benefit paid to every person each month (like a pension/UBI) — so total spending scales with population. This sets the per-person amount; the total is the Welfare line above.">
          <span className="inspect-label">Pension — {welfareTier(country.welfarePerCapita)}</span>
          <span className="econ-control">
            <button type="button" onClick={() => setWelfare(country.id, country.welfarePerCapita - 0.5)}>
              −
            </button>
            <span className="econ-control-value">{formatMoney(country.welfarePerCapita)}/person</span>
            <button type="button" onClick={() => setWelfare(country.id, country.welfarePerCapita + 0.5)}>
              +
            </button>
          </span>
        </div>

        <div className="econ-subtitle" style={{ marginTop: 10 }}>Public services</div>
        <div className="ship-panel-hint" style={{ marginBottom: 6 }}>
          Each slider is the share of what pops <b>actually spend</b> on that service that the state covers for them. The
          live dollar cost is shown below each — that's the real amount coming out of the budget. <b>Rec</b> sets a
          recommended level.
        </div>
        {([
          { good: 'healthcare' as const, label: 'Healthcare', rec: 1 },
          { good: 'dental' as const, label: 'Dental care', rec: 0.5 },
          { good: 'education' as const, label: 'Education', rec: 0.75 },
        ]).map(({ good, label, rec }) => {
          const cov = country.publicServices?.[good] ?? 0
          const gross = fiscal?.serviceValueByGood?.[good] ?? 0
          const cost = fiscal?.servicesByGood?.[good] ?? 0
          const atRec = cov === rec
          return (
            <div key={good} className="welfare-service">
              <label className="econ-control-row" style={{ marginBottom: 2 }}>
                <span className="inspect-label">{label}</span>
                <span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={cov}
                    onChange={(e) => setPublicServiceCoverage(country.id, good, Number(e.target.value))}
                  />
                  <b style={{ marginLeft: 8, color: '#cdeeff' }}>{Math.round(cov * 100)}%</b>
                </span>
              </label>
              <div className="welfare-service-detail">
                <span>
                  State pays <b className="econ-neg">{formatMoney(cost)}/mo</b>
                  {gross > 0 ? <span style={{ opacity: 0.6 }}> of {formatMoney(gross)} pops spend</span> : <span style={{ opacity: 0.6 }}> (advance time for live cost)</span>}
                </span>
                <button
                  type="button"
                  className="laws-enact-btn"
                  disabled={atRec}
                  title={`Recommended coverage for ${label}: ${Math.round(rec * 100)}%`}
                  onClick={() => setPublicServiceCoverage(country.id, good, rec)}
                >
                  {atRec ? `Rec ✓` : `Rec ${Math.round(rec * 100)}%`}
                </button>
              </div>
            </div>
          )
        })}

        <div className="ship-panel-hint">
          Pension is a flat <b>per-person</b> cash benefit; public services fund a <b>share</b> of pops' spending on that
          service. Both are real budget costs — the totals feed the Welfare line above.
        </div>
      </div>
    )
  }

  if (subcategory === 'Finance') {
    return (
      <div className="econ-panel">
        <div className="econ-fiscal-headline">
          <span>
            GDP/yr <b>{fiscal ? formatMoney(fiscal.gdp * MONTHS_PER_YEAR) : '—'}</b>
          </span>
          <span>
            GDP/capita <b>{fiscal && gdpPerCapita(fiscal.gdp * MONTHS_PER_YEAR, fiscal.population) !== undefined ? formatMoney(gdpPerCapita(fiscal.gdp * MONTHS_PER_YEAR, fiscal.population)!) : '—'}</b>
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
        <GdpChart h={series} tick={economyTick} />
        <GdpPerCapitaChart h={series} tick={economyTick} />
        <PriceLevelChart h={series} tick={economyTick} />
        <BudgetFlowChart h={series} tick={economyTick} />
        <DebtToGdpChart h={series} tick={economyTick} />
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
