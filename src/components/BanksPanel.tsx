import { useEconomyStore } from '../state/economyStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { formatMoney } from '../economy/format'
import { bankCapital, capitalRatio } from '../economy/banking'

// Economy → Banking. The country's commercial banks (Stage 2 central banking) —
// distinct institutions with their own balance sheets. They take deposits, hold
// reserves at the central bank, make loans (creating deposits — broad money),
// hold government securities, and borrow from the discount window when short of
// reserves. Their lending is gated by the central bank's reserve requirement and
// their own capital; run by the bank AI. Read-only for now — the player steers
// them indirectly through monetary policy (Government → Institutions).
export function BanksPanel() {
  const { country } = usePlayerEconomy()
  const banks = useEconomyStore((s) => s.banks)
  const money = useEconomyStore((s) => (country ? s.moneyReports[country.id] : undefined))

  if (!country) return <div className="nav-placeholder">No national government in context.</div>
  const mine = banks.filter((b) => b.countryId === country.id)

  if (mine.length === 0) {
    return (
      <div className="econ-panel">
        <div className="econ-subtitle">Commercial Banks</div>
        <div className="ship-panel-hint">This nation has no commercial banks.</div>
      </div>
    )
  }

  return (
    <div className="econ-panel">
      <div className="econ-subtitle">Commercial Banks</div>
      <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
        Distinct institutions with their own balance sheets. They lend within the central bank’s reserve requirement and
        their own capital — steer them through monetary policy (Government → Institutions), not directly.
      </div>

      {money && (
        <div className="cb-facts" style={{ marginBottom: 10 }}>
          <div><span className="inspect-label">System deposits</span><span>{formatMoney(money.deposits)}</span></div>
          <div><span className="inspect-label">System loans</span><span>{formatMoney(money.loans)}</span></div>
          <div><span className="inspect-label">System capital</span><span>{formatMoney(money.bankCapital)}</span></div>
          <div><span className="inspect-label">Discount borrowing</span><span>{formatMoney(money.cbBorrowings)}</span></div>
        </div>
      )}

      {mine.map((b) => {
        const cap = bankCapital(b)
        const ratio = capitalRatio(b)
        const stressed = ratio < 0.08
        return (
          <div key={b.id} className={`bank-card${stressed ? ' bank-stressed' : ''}`}>
            <div className="bank-card-head">
              <span className="bank-name">{b.name}</span>
              <span className={`bank-ratio${stressed ? ' bank-ratio-low' : ''}`} title="Capital as a fraction of loans. Below 8% is stressed.">
                {(ratio * 100).toFixed(1)}% cap
              </span>
            </div>
            <div className="bank-sheet">
              <div className="bank-col">
                <div className="bank-col-title">Assets</div>
                <div><span>Reserves</span><span>{formatMoney(b.reserves)}</span></div>
                <div><span>Loans</span><span>{formatMoney(b.loans)}</span></div>
                <div><span>Securities</span><span>{formatMoney(b.securities)}</span></div>
              </div>
              <div className="bank-col">
                <div className="bank-col-title">Liabilities</div>
                <div><span>Deposits</span><span>{formatMoney(b.deposits)}</span></div>
                <div><span>CB borrowing</span><span>{formatMoney(b.cbBorrowings)}</span></div>
                <div><span>Capital</span><span>{formatMoney(cap)}</span></div>
              </div>
            </div>
            <div className="bank-foot">
              <span>Profit / tick <b className={b.lastProfit >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(b.lastProfit)}</b></span>
              <span>Risk appetite <b>{Math.round(b.riskAppetite * 100)}%</b></span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
