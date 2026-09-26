import { useState } from 'react'
import { useEconomyStore } from '../state/economyStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { usePlayerStore } from '../state/playerStore'
import { formatMoney } from '../economy/format'
import { DraggableWindow } from './DraggableWindow'

type FiscalIndicatorId = 'treasury' | 'balance'

// Top-bar readouts for the player's country: the treasury balance and whether
// it's running a surplus or deficit — the two numbers a ruler watches
// constantly, so they live in the header (narrowed to just these two at the
// user's own request — Bureaucracy stays a real, computed number, just no
// longer shown here; it's still visible in BuildingsPanel/CorporationsPanel).
// Each one opens a small info window on click, same pattern ResourceBar's
// HUD resources already use.
export function FiscalIndicators() {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const abstractMode = usePlayerStore((s) => s.economyModel === 'abstract')
  const reports = useEconomyStore((s) => s.countryReports)
  const countries = useEconomyStore((s) => s.countries)
  const absState = useAbstractEconomyStore((s) => (countryId ? s.byCountry[countryId] : undefined))
  const absReport = useAbstractEconomyStore((s) => (countryId ? s.reports[countryId] : undefined))
  const sandbox = usePlayerStore((s) => s.sandbox)
  const [openId, setOpenId] = useState<FiscalIndicatorId | null>(null)
  // The sandbox has no nation, so no treasury to show.
  if (!countryId || sandbox) return null
  const f = reports[countryId]
  const country = countries.find((c) => c.id === countryId)
  // In abstract mode the top bar reads the abstract national economy; the
  // deep economy is idle. Balance is shown per-month there (its budget is annual).
  const treasury = abstractMode ? absState?.treasury ?? 0 : f?.treasury ?? country?.treasury ?? 0
  const balance = abstractMode ? (absReport?.balance ?? 0) / 12 : f?.balance ?? 0
  const debt = abstractMode ? absState?.debt ?? 0 : f?.debt ?? 0
  // Shown per month like the balance: Simple mode's budget is annual, Complex
  // mode's flows are already per tick (month).
  const revenue = abstractMode ? (absReport?.revenue ?? 0) / 12 : f?.revenue ?? 0
  const expenditure = abstractMode ? (absReport?.spending ?? 0) / 12 : f?.expenditure ?? 0
  const rating = abstractMode ? absReport?.rating : f?.rating

  return (
    <div className="fiscal-indicators">
      <button
        type="button"
        className="fiscal-ind"
        title="National treasury (negative = overdraft; issue bonds to cover it)"
        onClick={() => setOpenId('treasury')}
      >
        <span className="fiscal-ind-label">Treasury</span>
        <span className={`fiscal-ind-val ${treasury >= 0 ? 'econ-pos' : 'econ-neg'}`}>{formatMoney(treasury)}</span>
      </button>
      <button
        type="button"
        className="fiscal-ind"
        title="Budget balance per month (revenue − spending)"
        onClick={() => setOpenId('balance')}
      >
        <span className="fiscal-ind-label">Balance</span>
        <span className={`fiscal-ind-val ${balance >= 0 ? 'econ-pos' : 'econ-neg'}`}>
          {balance >= 0 ? '+' : ''}
          {formatMoney(balance)}/mo
        </span>
      </button>

      {openId === 'treasury' && (
        <DraggableWindow title="Treasury" onClose={() => setOpenId(null)} maximizable={false}>
          <div className="inspect-row">
            <span className="inspect-label">Treasury</span>
            <span className={`inspect-value${treasury >= 0 ? ' econ-pos' : ' econ-neg'}`}>{formatMoney(treasury)}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Monthly</span>
            <span className={`inspect-value${balance >= 0 ? ' econ-pos' : ' econ-neg'}`}>
              {balance >= 0 ? '+' : ''}
              {formatMoney(balance)}/mo
            </span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Debt</span>
            <span className={`inspect-value${debt > 0 ? ' econ-neg' : ''}`}>{formatMoney(debt)}</span>
          </div>
          {rating && (
            <div className="inspect-row">
              <span className="inspect-label">Credit Rating</span>
              <span className="inspect-value">{rating}</span>
            </div>
          )}
          <div className="inspect-divider" />
          <div className="resource-info-description">
            National treasury — total accumulated government funds. Running negative means an unfunded overdraft; issue
            bonds (Economy → Debt) to cover it. Credit rating reflects how safely the state can keep borrowing.
          </div>
        </DraggableWindow>
      )}

      {openId === 'balance' && (
        <DraggableWindow title="Balance" onClose={() => setOpenId(null)} maximizable={false}>
          <div className="inspect-row">
            <span className="inspect-label">Balance</span>
            <span className={`inspect-value${balance >= 0 ? ' econ-pos' : ' econ-neg'}`}>
              {balance >= 0 ? '+' : ''}
              {formatMoney(balance)}/mo
            </span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Revenue</span>
            <span className="inspect-value econ-pos">+{formatMoney(revenue)}/mo</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Expenditure</span>
            <span className="inspect-value econ-neg">−{formatMoney(expenditure)}/mo</span>
          </div>
          <div className="inspect-divider" />
          <div className="resource-info-description">
            Net monthly budget balance — revenue minus spending. A sustained deficit drains the treasury and eventually
            has to be financed with bonds.
          </div>
        </DraggableWindow>
      )}
    </div>
  )
}
