import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { useEconomyStore } from '../state/economyStore'
import { GOOD_IDS, GOODS } from '../economy/goods'
import { NEED_TIERS } from '../economy/species'

// Real read-only content for the left-sidebar Economy category's sub-tabs
// (Market / Budget / Welfare), driven by the live simulation. Every number
// here is computed by the economy tick (economyTick.ts), not authored.
export function EconomyPanel({ subcategory }: { subcategory: string | null }) {
  const econ = usePlayerEconomy()
  const reports = useEconomyStore((s) => s.reports)

  if (!econ) {
    return <div className="nav-placeholder">No developed economy on your capital yet.</div>
  }
  const report = reports[econ.id]

  if (subcategory === 'Budget') {
    return (
      <div className="econ-panel">
        <div className="inspect-row">
          <span className="inspect-label">Treasury</span>
          <span className="inspect-value">{econ.treasury.toFixed(1)}</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Tax rate</span>
          <span className="inspect-value">{Math.round(econ.taxRate * 100)}%</span>
        </div>
        <div className="ship-panel-hint">
          Taxes on building profit accrue here and are recirculated to pops as welfare each tick — the money loop that
          keeps prices from collapsing. Discretionary spending arrives with a later milestone.
        </div>
      </div>
    )
  }

  if (subcategory === 'Welfare') {
    const avg = (tier: (typeof NEED_TIERS)[number]) =>
      econ.pops.length ? econ.pops.reduce((s, p) => s + p.needsSatisfaction[tier], 0) / econ.pops.length : 0
    return (
      <div className="econ-panel">
        <div className="econ-subtitle">Population needs satisfaction</div>
        {NEED_TIERS.map((tier) => (
          <div className="inspect-row" key={tier}>
            <span className="inspect-label" style={{ textTransform: 'capitalize' }}>
              {tier}
            </span>
            <span className="inspect-value">{Math.round(avg(tier) * 100)}%</span>
          </div>
        ))}
        <div className="ship-panel-hint">
          Welfare currently recirculates the treasury to pops as a flat transfer. A real generosity slider splitting
          healthcare, pensions and unemployment comes later.
        </div>
      </div>
    )
  }

  // Default: Market.
  return (
    <div className="econ-panel">
      <div className="econ-subtitle">{econ.name} market</div>
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
                <td>{econ.market.prices[g].toFixed(2)}</td>
                <td>{r ? r.supply.toFixed(1) : '—'}</td>
                <td>{r ? r.demand.toFixed(1) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="ship-panel-hint">Prices are set each tick by the market clearing supply against what pops and buildings can actually buy.</div>
    </div>
  )
}
