import { useEconomyStore } from '../state/economyStore'
import { useConfirmStore } from '../state/confirmStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import {
  CENTRAL_BANK_STATUSES,
  centralBankStatusDef,
  BANK_STRUCTURES,
  bankStructureDef,
  POLICY_AUTHORITIES,
  policyAuthorityDef,
  GOVERNOR_APPOINTMENTS,
  governorAppointmentDef,
  CENTRAL_BANK_MANDATES,
  centralBankMandateDef,
  DEBT_FINANCING_REGIMES,
  debtFinancingRegimeDef,
  EXCHANGE_RATE_REGIMES,
  exchangeRateRegimeDef,
  centralBankModelLabel,
  effectiveIndependence,
  governmentControlsPolicy,
  hasCentralBank,
} from '../economy/centralBank'

// A small meter (0..1) — independence, credibility, pressure.
function Meter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const pct = Math.round(value * 100)
  return (
    <div className="cb-meter" title={hint}>
      <div className="cb-meter-head">
        <span>{label}</span>
        <span className="cb-meter-val">{pct}%</span>
      </div>
      <div className="cb-meter-track">
        <div className="cb-meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// A single law family: a list of options, the current one marked, click to
// enact. `defs` maps an id to its {name, description}.
function LawSection<T extends string>({
  title,
  hint,
  ids,
  current,
  def,
  onEnact,
}: {
  title: string
  hint?: string
  ids: readonly T[]
  current: T
  def: (id: T) => { name: string; description: string }
  onEnact: (id: T) => void
}) {
  return (
    <>
      <div className="econ-subtitle" style={{ marginTop: 12 }}>{title}</div>
      {hint && <div className="ship-panel-hint" style={{ marginBottom: 8 }}>{hint}</div>}
      <div className="laws-option-list">
        {ids.map((id) => {
          const d = def(id)
          const active = id === current
          return (
            <div key={id} className={`laws-option${active ? ' active' : ''}`}>
              <div className="laws-option-head">
                <span className="laws-option-name">{d.name}</span>
                {active ? (
                  <span className="laws-option-current">In force</span>
                ) : (
                  <button type="button" className="laws-enact-btn" onClick={() => onEnact(id)}>Enact</button>
                )}
              </div>
              <div className="laws-option-desc">{d.description}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// Government → Institutions → Central Bank. The country's monetary institution:
// its model and governance up top, then the policy levers (usable directly only
// if the government controls the bank), then the seven institutional laws.
export function CentralBankPanel() {
  const { country } = usePlayerEconomy()
  const establishCentralBank = useEconomyStore((s) => s.establishCentralBank)
  const setCentralBankStatus = useEconomyStore((s) => s.setCentralBankStatus)
  const setBankStructure = useEconomyStore((s) => s.setBankStructure)
  const setPolicyAuthority = useEconomyStore((s) => s.setPolicyAuthority)
  const setGovernorAppointment = useEconomyStore((s) => s.setGovernorAppointment)
  const setCentralBankMandate = useEconomyStore((s) => s.setCentralBankMandate)
  const setDebtFinancingRegime = useEconomyStore((s) => s.setDebtFinancingRegime)
  const setExchangeRateRegime = useEconomyStore((s) => s.setExchangeRateRegime)
  const setPolicyRate = useEconomyStore((s) => s.setPolicyRate)
  const setReserveRequirement = useEconomyStore((s) => s.setReserveRequirement)
  const pressureCentralBank = useEconomyStore((s) => s.pressureCentralBank)
  const requestConfirm = useConfirmStore((s) => s.requestConfirm)

  if (!country) return <div className="nav-placeholder">No national government in context.</div>

  const cb = country.centralBank
  // No record, or a record explicitly set to 'no-bank' — offer to establish one.
  if (!cb || !hasCentralBank(cb)) {
    return (
      <div className="econ-panel">
        <div className="econ-subtitle">Central Bank</div>
        <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
          {country.id} has no central bank. Money and credit are left to private banks and the treasury — the state has no
          lever over interest rates or the money supply.
        </div>
        <button type="button" className="laws-enact-btn" onClick={() => establishCentralBank(country.id)}>
          Establish a Central Bank
        </button>
      </div>
    )
  }

  const govControls = governmentControlsPolicy(cb)
  const indep = effectiveIndependence(cb)

  const enactStatus = (id: (typeof CENTRAL_BANK_STATUSES)[number]) => {
    if (id === 'no-bank') {
      requestConfirm({
        title: 'Abolish the central bank?',
        body: 'Dissolving the central bank surrenders all monetary policy — interest rates, the money supply, lending backstops and currency management. This is hard to undo cleanly.',
        effects: ['No policy rate, reserve requirement, or open-market operations', 'No lender of last resort in a banking crisis'],
        confirmLabel: 'Abolish',
        onConfirm: () => setCentralBankStatus(country.id, id),
      })
      return
    }
    setCentralBankStatus(country.id, id)
  }

  return (
    <div className="econ-panel">
      <div className="econ-subtitle">{cb.name}</div>
      <div className="cb-model">{centralBankModelLabel(cb)}</div>

      <div className="cb-governance">
        <Meter label="Independence" value={indep} hint="How far the bank is insulated from government control. Set by its status and governor-appointment law, reduced by standing government pressure." />
        <Meter label="Credibility" value={cb.credibility} hint="Monetary credibility — how much markets and pops trust the bank to hold its mandate. Eroded by political pressure and money-printing." />
        {cb.governmentPressure > 0 && (
          <Meter label="Govt. pressure" value={cb.governmentPressure} hint="How hard the government is currently leaning on the bank for easy money." />
        )}
      </div>

      <div className="cb-facts">
        <div><span className="inspect-label">Governor</span><span>{cb.governorName}</span></div>
        <div><span className="inspect-label">Mandate</span><span>{centralBankMandateDef(cb.mandate).name}</span></div>
        <div><span className="inspect-label">Policy authority</span><span>{policyAuthorityDef(cb.policyAuthority).name}</span></div>
        <div><span className="inspect-label">Control</span><span>{govControls ? 'Government-directed' : 'Bank-independent'}</span></div>
      </div>

      {/* Policy levers */}
      <div className="econ-subtitle" style={{ marginTop: 12 }}>Monetary policy</div>
      {govControls ? (
        <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
          The government directs this bank — you may set policy directly. (Transmission to the wider economy arrives in a
          later stage; these values are stored now.)
        </div>
      ) : (
        <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
          This bank is independent — the government cannot set its rate directly. Pursue lower rates by appointing a
          friendlier board, reforming its status, or applying political pressure (at a credibility cost).
        </div>
      )}

      <label className="econ-control-row">
        <span className="inspect-label">Policy interest rate</span>
        <span>
          <input
            type="range"
            min={0}
            max={0.2}
            step={0.0025}
            value={cb.policyRate}
            disabled={!govControls}
            onChange={(e) => setPolicyRate(country.id, Number(e.target.value))}
          />
          <b style={{ marginLeft: 8, color: '#cdeeff' }}>{(cb.policyRate * 100).toFixed(2)}%</b>
        </span>
      </label>
      <label className="econ-control-row">
        <span className="inspect-label">Reserve requirement</span>
        <span>
          <input
            type="range"
            min={0}
            max={0.3}
            step={0.005}
            value={cb.reserveRequirement}
            disabled={!govControls}
            onChange={(e) => setReserveRequirement(country.id, Number(e.target.value))}
          />
          <b style={{ marginLeft: 8, color: '#cdeeff' }}>{(cb.reserveRequirement * 100).toFixed(1)}%</b>
        </span>
      </label>

      {!govControls && (
        <button
          type="button"
          className="laws-enact-btn"
          style={{ marginTop: 4 }}
          onClick={() =>
            requestConfirm({
              title: 'Pressure the central bank?',
              body: 'Publicly leaning on the bank for easier money raises standing government pressure and erodes its credibility. Sustained pressure can bend even an independent bank to the government’s will.',
              effects: ['Raises government pressure (lowers effective independence)', 'Costs monetary credibility'],
              confirmLabel: 'Apply pressure',
              onConfirm: () => pressureCentralBank(country.id, 0.15),
            })
          }
        >
          Pressure the bank for easier money
        </button>
      )}

      {/* Institutional laws */}
      <LawSection
        title="Central Bank Status"
        hint="How far the bank is removed from the treasury. The single biggest driver of independence and credibility."
        ids={CENTRAL_BANK_STATUSES}
        current={cb.status}
        def={centralBankStatusDef}
        onEnact={enactStatus}
      />
      <LawSection
        title="Organizational Structure"
        hint="A single bank, a bank with branches, or a federal reserve system of regional banks."
        ids={BANK_STRUCTURES}
        current={cb.structure}
        def={bankStructureDef}
        onEnact={(id) => setBankStructure(country.id, id)}
      />
      <LawSection
        title="Monetary Policy Authority"
        hint="Who has final say over policy. Government/finance-ministry authority means the state pulls the levers; a governor, board or committee means the bank decides."
        ids={POLICY_AUTHORITIES}
        current={cb.policyAuthority}
        def={policyAuthorityDef}
        onEnact={(id) => setPolicyAuthority(country.id, id)}
      />
      <LawSection
        title="Governor Appointment"
        hint="How the governor is chosen — longer, more insulated appointments raise independence."
        ids={GOVERNOR_APPOINTMENTS}
        current={cb.appointment}
        def={(id) => {
          const d = governorAppointmentDef(id)
          return { name: d.name, description: `${d.description} (term ${Math.round(d.termTicks / 12)} yr)` }
        }}
        onEnact={(id) => setGovernorAppointment(country.id, id)}
      />
      <LawSection
        title="Central Bank Mandate"
        hint="What the bank prioritizes when setting policy — price stability, employment, the currency, financial stability, or state development."
        ids={CENTRAL_BANK_MANDATES}
        current={cb.mandate}
        def={centralBankMandateDef}
        onEnact={(id) => setCentralBankMandate(country.id, id)}
      />
      <LawSection
        title="Government Debt Financing"
        hint="Whether — and how far — the bank may fund the government. Direct monetary financing is powerful but a standing inflation and credibility risk."
        ids={DEBT_FINANCING_REGIMES}
        current={cb.debtFinancing}
        def={debtFinancingRegimeDef}
        onEnact={(id) => setDebtFinancingRegime(country.id, id)}
      />
      <LawSection
        title="Exchange-Rate Regime"
        hint="How the currency's external value is managed. Fully wired with the currency system in a later stage."
        ids={EXCHANGE_RATE_REGIMES}
        current={cb.exchangeRegime}
        def={exchangeRateRegimeDef}
        onEnact={(id) => setExchangeRateRegime(country.id, id)}
      />
    </div>
  )
}
