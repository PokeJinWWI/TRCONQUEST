import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { formatMoney } from '../economy/format'

// Top-bar readouts for the player's country: the treasury balance (and whether
// it's running a surplus or deficit) and the bureaucracy stock. These are the
// two numbers a ruler watches constantly, so they live in the header.
export function FiscalIndicators() {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const reports = useEconomyStore((s) => s.countryReports)
  const countries = useEconomyStore((s) => s.countries)
  if (!countryId) return null
  const f = reports[countryId]
  const country = countries.find((c) => c.id === countryId)
  const treasury = f?.treasury ?? country?.treasury ?? 0
  const balance = f?.balance ?? 0
  const bureaucracy = f?.bureaucracy ?? country?.bureaucracy ?? 0
  const capacity = f?.bureaucracyCapacity ?? 0
  const burNet = (f?.bureaucracyProduced ?? 0) - (f?.bureaucracyConsumed ?? 0)

  return (
    <div className="fiscal-indicators">
      <div className="fiscal-ind" title="National treasury (negative = overdraft; issue bonds to cover it)">
        <span className="fiscal-ind-label">Treasury</span>
        <span className={`fiscal-ind-val ${treasury >= 0 ? 'econ-pos' : 'econ-neg'}`}>{formatMoney(treasury)}</span>
      </div>
      <div className="fiscal-ind" title="Budget balance per month (revenue − spending)">
        <span className="fiscal-ind-label">Balance</span>
        <span className={`fiscal-ind-val ${balance >= 0 ? 'econ-pos' : 'econ-neg'}`}>
          {balance >= 0 ? '+' : ''}
          {formatMoney(balance)}/mo
        </span>
      </div>
      <div className="fiscal-ind" title="Bureaucracy — administrative capacity. Produced by government buildings, consumed by state-run enterprises, institutions and decrees. Running dry hobbles your state enterprises.">
        <span className="fiscal-ind-label">Bureaucracy</span>
        <span className={`fiscal-ind-val ${bureaucracy > 0 ? '' : 'econ-neg'}`}>
          {Math.round(bureaucracy).toLocaleString()}
          <span className="fiscal-ind-sub">
            /{Math.round(capacity).toLocaleString()} ({burNet >= 0 ? '+' : ''}
            {Math.round(burNet)})
          </span>
        </span>
      </div>
    </div>
  )
}
