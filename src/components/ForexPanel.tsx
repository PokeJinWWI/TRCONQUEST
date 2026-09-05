import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { getCountry } from '../data/countryData'
import { formatMoney } from '../economy/format'
import { exchangeRateRegimeDef } from '../economy/centralBank'
import { convert } from '../economy/fx'

// Markets → Forex. The interstellar currency market: every nation's currency,
// its exchange rate against the Terra Standard Credit (TSC), its regime, and the
// reserves its central bank holds to defend it. Rates against YOUR currency are
// shown too, so you can read what a cross-border deal really costs. Read-only —
// currency policy is set on your own Central Bank panel.
export function ForexPanel() {
  const countries = useEconomyStore((s) => s.countries)
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const player = countries.find((c) => c.id === playerId)
  const home = player?.currency

  const withCur = countries.filter((c) => c.currency)
  if (withCur.length === 0) return <div className="nav-placeholder">No currencies in circulation.</div>

  // Strongest first.
  const rows = [...withCur].sort((a, b) => (b.currency!.rate - a.currency!.rate))

  return (
    <div className="econ-panel">
      <div className="econ-subtitle">Foreign Exchange</div>
      <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
        1 TSC = the Terra Standard Credit, the common reference. A higher rate is a stronger currency.
        {home ? ` Prices are also shown in your ${home.code}.` : ''}
      </div>
      <table className="fx-table">
        <thead>
          <tr>
            <th>Nation</th>
            <th>Currency</th>
            <th style={{ textAlign: 'right' }}>Rate (TSC)</th>
            {home && <th style={{ textAlign: 'right' }}>Per {home.code}</th>}
            <th>Regime</th>
            <th style={{ textAlign: 'right' }}>FX reserves</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const cur = c.currency!
            const isHome = c.id === playerId
            const cb = c.centralBank
            const pegged = cb && cb.exchangeRegime !== 'float'
            const belowPeg = pegged && cur.rate < cur.target
            // How many units of THIS currency one unit of the player's buys.
            const perHome = home ? convert(1, home.rate, cur.rate) : 0
            return (
              <tr key={c.id} className={isHome ? 'fx-row-home' : undefined}>
                <td>{getCountry(c.id)?.name ?? c.id}{isHome ? ' ★' : ''}</td>
                <td>{cur.code}</td>
                <td style={{ textAlign: 'right' }}>{cur.rate.toFixed(3)}</td>
                {home && <td style={{ textAlign: 'right' }}>{isHome ? '—' : perHome.toFixed(3)}</td>}
                <td>{cb ? exchangeRateRegimeDef(cb.exchangeRegime).name : '—'}{belowPeg ? ' ⚠' : ''}</td>
                <td style={{ textAlign: 'right' }}>{cb ? formatMoney(cb.fxReserves) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="ship-panel-hint" style={{ marginTop: 8 }}>
        ⚠ = a pegged currency trading below its target (under pressure). Set your own currency’s regime on the Central Bank panel.
      </div>
    </div>
  )
}
