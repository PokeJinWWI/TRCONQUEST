import { useEconomyStore } from '../state/economyStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { FOREIGN_BOND_POLICIES, foreignBondPolicyDef } from '../economy/laws'
import { formatMoney } from '../economy/format'

const BLOCK = 20000 // internal-unit block of bonds issued/redeemed per click

// Economy → Debt: the national debt and the bond market. The state finances
// deficits by selling bonds to pops, companies or (law permitting) foreign
// investors, and services the debt with a coupon each month. A law governs
// whether foreigners may buy at all, and a setting governs whether their
// purchases need the government's approval.
export function DebtPanel() {
  const { country } = usePlayerEconomy()
  const reports = useEconomyStore((s) => s.countryReports)
  const issueBonds = useEconomyStore((s) => s.issueBonds)
  const redeemBonds = useEconomyStore((s) => s.redeemBonds)
  const setForeignBondPolicy = useEconomyStore((s) => s.setForeignBondPolicy)
  const setForeignApproval = useEconomyStore((s) => s.setForeignApproval)
  const approveForeignOffer = useEconomyStore((s) => s.approveForeignOffer)
  const rejectForeignOffer = useEconomyStore((s) => s.rejectForeignOffer)

  if (!country) return <div className="nav-placeholder">No national government in context.</div>
  const f = reports[country.id]
  const total = country.bonds.pops + country.bonds.corporations + country.bonds.foreign
  const foreignAllowed = country.foreignBondPolicy !== 'closed'

  return (
    <div className="econ-panel">
      <div className="econ-fiscal-headline">
        <span>
          Treasury <b className={country.treasury >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(country.treasury)}</b>
        </span>
        <span>
          National debt <b className="econ-neg">{formatMoney(total)}</b>
        </span>
        <span>
          Debt/GDP <b>{f ? `${(f.debtToGdp * 100).toFixed(0)}%` : '—'}</b>
        </span>
        <span>
          Rating <b className={`rating-${f?.rating ?? 'AAA'}`}>{f?.rating ?? '—'}</b>
        </span>
        <span>
          Interest/mo <b className="econ-neg">{f ? formatMoney(f.interest) : '—'}</b>
        </span>
      </div>

      <div className="econ-subtitle">Bonds outstanding, by holder</div>
      <div className="inspect-row">
        <span className="inspect-label">Domestic pops</span>
        <span className="inspect-value">{formatMoney(country.bonds.pops)}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Corporations</span>
        <span className="inspect-value">{formatMoney(country.bonds.corporations)}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Foreign holders</span>
        <span className="inspect-value">{formatMoney(country.bonds.foreign)}</span>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 8 }}>
        Issue bonds (raise {formatMoney(BLOCK)})
      </div>
      <div className="econ-build-buttons">
        <button type="button" className="corp-btn" onClick={() => issueBonds(country.id, BLOCK, 'pops')}>
          Sell to Pops
        </button>
        <button type="button" className="corp-btn" onClick={() => issueBonds(country.id, BLOCK, 'corporations')}>
          Sell to Companies
        </button>
        <button
          type="button"
          className="corp-btn"
          disabled={!foreignAllowed}
          title={foreignAllowed ? 'Sell bonds abroad' : 'Foreign bond sales are closed by law'}
          onClick={() => issueBonds(country.id, BLOCK, 'foreign')}
        >
          Sell to Foreign
        </button>
        <button type="button" className="corp-btn corp-btn-danger" disabled={total <= 0 || country.treasury <= 0} onClick={() => redeemBonds(country.id, BLOCK)}>
          Redeem
        </button>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 8 }}>
        Foreign bond law
      </div>
      <div className="econ-econsystem">
        <span>Policy:</span>
        <select className="econ-method-select" value={country.foreignBondPolicy} onChange={(e) => setForeignBondPolicy(country.id, e.target.value as (typeof FOREIGN_BOND_POLICIES)[number])}>
          {FOREIGN_BOND_POLICIES.map((p) => (
            <option key={p} value={p}>
              {foreignBondPolicyDef(p).name}
            </option>
          ))}
        </select>
      </div>
      <div className="ship-panel-hint">{foreignBondPolicyDef(country.foreignBondPolicy).description}</div>
      <label className="debt-setting">
        <input type="checkbox" checked={country.requireForeignApproval} onChange={(e) => setForeignApproval(country.id, e.target.checked)} />
        Require government approval for foreign purchases
      </label>

      {country.pendingForeign.length > 0 && (
        <>
          <div className="econ-subtitle" style={{ marginTop: 8 }}>
            Pending foreign offers
          </div>
          {country.pendingForeign.map((o) => (
            <div key={o.id} className="debt-offer">
              <span className="debt-offer-text">
                {o.investor} offers to buy {formatMoney(o.amount)} in bonds
              </span>
              <span className="debt-offer-actions">
                <button type="button" className="stock-btn stock-buy" onClick={() => approveForeignOffer(country.id, o.id)}>
                  Accept
                </button>
                <button type="button" className="stock-btn stock-sell" onClick={() => rejectForeignOffer(country.id, o.id)}>
                  Reject
                </button>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
