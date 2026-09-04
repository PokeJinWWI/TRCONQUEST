import { ECONOMIC_SYSTEMS, economicSystemDef, HEALTHCARE_SYSTEMS, healthcareSystemDef, FOREIGN_INVESTMENT_POLICIES, foreignInvestmentPolicyDef } from '../economy/laws'
import { useEconomyStore } from '../state/economyStore'
import { useConfirmStore } from '../state/confirmStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'

// Government → Laws. The nation's standing laws — enacted here, not toggled on a
// whim from a building screen. The first law with real teeth is the Economic
// System, which governs how much the state may direct private industry (and the
// penalty for overriding a private building's production method — see
// economy/laws.ts and the interference malus in economyTick).
export function LawsPanel() {
  const { country } = usePlayerEconomy()
  const setEconomicSystem = useEconomyStore((s) => s.setEconomicSystem)
  const setHealthcareSystem = useEconomyStore((s) => s.setHealthcareSystem)
  const setForeignInvestmentPolicy = useEconomyStore((s) => s.setForeignInvestmentPolicy)
  const setForeignInvestmentAutoApprove = useEconomyStore((s) => s.setForeignInvestmentAutoApprove)
  const approveForeignInvestment = useEconomyStore((s) => s.approveForeignInvestment)
  const rejectForeignInvestment = useEconomyStore((s) => s.rejectForeignInvestment)
  const allCorps = useEconomyStore((s) => s.corporations)
  const requestConfirm = useConfirmStore((s) => s.requestConfirm)

  if (!country) return <div className="nav-placeholder">No national government in context.</div>
  const current = economicSystemDef(country.economicSystem)

  return (
    <div className="econ-panel">
      <div className="econ-subtitle">Economic System</div>
      <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
        Current law: <b style={{ color: '#cdeeff' }}>{current.name}</b>. Enacting a new economic system changes how the
        state and private owners share control of industry.
      </div>
      <div className="laws-option-list">
        {ECONOMIC_SYSTEMS.map((id) => {
          const def = economicSystemDef(id)
          const active = id === country.economicSystem
          const malusPct = Math.round((1 - def.interferenceMalus) * 100)
          return (
            <div key={id} className={`laws-option${active ? ' active' : ''}`}>
              <div className="laws-option-head">
                <span className="laws-option-name">{def.name}</span>
                {active ? (
                  <span className="laws-option-current">In force</span>
                ) : (
                  <button
                    type="button"
                    className="laws-enact-btn"
                    onClick={() =>
                      requestConfirm({
                        title: `Enact ${def.name}?`,
                        body: def.description,
                        effects: [
                          def.ownerAutonomy ? 'Private owners will run their own buildings' : 'The state directs all production',
                          malusPct > 0 ? `Overriding a private building's method costs −${malusPct}% output` : "Overriding a private building's method has no penalty",
                        ],
                        confirmLabel: 'Enact',
                        onConfirm: () => setEconomicSystem(country.id, id),
                      })
                    }
                  >
                    Enact
                  </button>
                )}
              </div>
              <div className="laws-option-desc">{def.description}</div>
              <div className="laws-option-effects">
                <span>{def.ownerAutonomy ? 'Private owners self-optimize' : 'State directs production'}</span>
                <span>
                  {malusPct > 0 ? `Overriding a private method: −${malusPct}% output` : 'Overriding a private method: no penalty'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="econ-subtitle" style={{ marginTop: 12 }}>
        Healthcare
      </div>
      <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
        Current law: <b style={{ color: '#cdeeff' }}>{healthcareSystemDef(country.healthcareSystem).name}</b>. How much of the
        population's healthcare the state pays for.
      </div>
      <div className="laws-option-list">
        {HEALTHCARE_SYSTEMS.map((id) => {
          const def = healthcareSystemDef(id)
          const active = id === country.healthcareSystem
          return (
            <div key={id} className={`laws-option${active ? ' active' : ''}`}>
              <div className="laws-option-head">
                <span className="laws-option-name">{def.name}</span>
                {active ? (
                  <span className="laws-option-current">In force</span>
                ) : (
                  <button
                    type="button"
                    className="laws-enact-btn"
                    onClick={() =>
                      requestConfirm({
                        title: `Enact ${def.name}?`,
                        body: def.description,
                        effects: [
                          `The state will fund ${Math.round(def.publicFunding * 100)}% of the population's healthcare`,
                          def.publicFunding > 0 ? 'Higher healthcare coverage, but a larger budget burden (deficit pressure)' : 'No healthcare cost to the state — the poor may go without',
                        ],
                        confirmLabel: 'Enact',
                        onConfirm: () => setHealthcareSystem(country.id, id),
                      })
                    }
                  >
                    Enact
                  </button>
                )}
              </div>
              <div className="laws-option-desc">{def.description}</div>
              <div className="laws-option-effects">
                <span>State funds {Math.round(def.publicFunding * 100)}% of healthcare</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="econ-subtitle" style={{ marginTop: 12 }}>
        Foreign investment
      </div>
      <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
        Current law: <b style={{ color: '#cdeeff' }}>{foreignInvestmentPolicyDef(country.foreignInvestmentPolicy).name}</b>. Whether foreign
        governments and companies may own equity in YOUR corporations (their profits are then repatriated abroad).
      </div>
      <div className="laws-option-list">
        {FOREIGN_INVESTMENT_POLICIES.map((id) => {
          const def = foreignInvestmentPolicyDef(id)
          const active = id === country.foreignInvestmentPolicy
          return (
            <div key={id} className={`laws-option${active ? ' active' : ''}`}>
              <div className="laws-option-head">
                <span className="laws-option-name">{def.name}</span>
                {active ? (
                  <span className="laws-option-current">In force</span>
                ) : (
                  <button
                    type="button"
                    className="laws-enact-btn"
                    onClick={() =>
                      requestConfirm({
                        title: `Enact ${def.name}?`,
                        body: def.description,
                        effects: [
                          id === 'closed' ? 'Foreign capital can no longer buy into your companies' : 'Foreign governments/companies may take equity stakes in your corporations',
                          id !== 'closed' ? 'Attracts foreign capital, but profits on those stakes leave the country' : 'Keeps ownership domestic',
                        ],
                        confirmLabel: 'Enact',
                        onConfirm: () => setForeignInvestmentPolicy(country.id, id),
                      })
                    }
                  >
                    Enact
                  </button>
                )}
              </div>
              <div className="laws-option-desc">{def.description}</div>
            </div>
          )
        })}
      </div>
      {country.foreignInvestmentPolicy === 'approval' && (
        <>
          <label className="econ-control-row" style={{ cursor: 'pointer' }} title="When on, incoming foreign investments are approved automatically instead of waiting in the queue below.">
            <span className="inspect-label">Auto-approve foreign investments</span>
            <input type="checkbox" checked={country.foreignInvestmentAutoApprove} onChange={(e) => setForeignInvestmentAutoApprove(country.id, e.target.checked)} />
          </label>
          {country.pendingForeignInvestment.length > 0 && (
            <>
              <div className="ship-panel-hint" style={{ marginBottom: 4 }}>Pending foreign investments into your companies:</div>
              {country.pendingForeignInvestment.map((o) => {
                const target = allCorps.find((c) => c.id === o.targetCorpId)
                return (
                  <div key={o.id} className="econ-build-row">
                    <span className="econ-build-name">
                      {o.investorName} → {o.shares} shares of {target?.name ?? o.targetCorpId} <span style={{ opacity: 0.6 }}>({o.investorKind === 'state' ? 'foreign government' : 'foreign company'})</span>
                    </span>
                    <button type="button" className="laws-enact-btn" onClick={() => approveForeignInvestment(country.id, o.id)}>Approve</button>
                    <button type="button" className="econ-build-cancel" onClick={() => rejectForeignInvestment(country.id, o.id)} aria-label="Reject">×</button>
                  </div>
                )
              })}
            </>
          )}
        </>
      )}
      <div className="ship-panel-hint">More laws (tax, trade, labor) will be enacted here as the government layer deepens.</div>
    </div>
  )
}
