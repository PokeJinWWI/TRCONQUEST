import { useEconomyStore } from '../state/economyStore'
import { useConfirmStore } from '../state/confirmStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { formatMoney, formatPop } from '../economy/format'
import { centralBankEquity } from '../economy/centralBank'
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
  const openMarketOperation = useEconomyStore((s) => s.openMarketOperation)
  const money = useEconomyStore((s) => (country ? s.moneyReports[country.id] : undefined))
  const fiscal = useEconomyStore((s) => (country ? s.countryReports[country.id] : undefined))
  const events = useEconomyStore((s) => s.centralBankEvents)
  const allWorlds = useEconomyStore((s) => s.worlds)
  const worldReports = useEconomyStore((s) => s.worldReports)
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

      {(() => {
        const mine = events.filter((e) => e.countryId === country.id).slice(-4).reverse()
        if (mine.length === 0) return null
        return (
          <div className="cb-events">
            {mine.map((e) => (
              <div key={e.id} className={`cb-event cb-event-${e.kind}`}>{e.text}</div>
            ))}
          </div>
        )
      })()}

      <div className="cb-facts">
        <div><span className="inspect-label">Governor</span><span>{cb.governorName}</span></div>
        <div><span className="inspect-label">Mandate</span><span>{centralBankMandateDef(cb.mandate).name}</span></div>
        <div><span className="inspect-label">Policy authority</span><span>{policyAuthorityDef(cb.policyAuthority).name}</span></div>
        <div><span className="inspect-label">Control</span><span>{govControls ? 'Government-directed' : 'Bank-independent'}</span></div>
      </div>

      {/* Currency & exchange rate (Stage 3 FX) */}
      {country.currency && (
        <>
          <div className="econ-subtitle" style={{ marginTop: 12 }}>Currency & exchange rate</div>
          <div className="cb-facts">
            <div><span className="inspect-label">Currency</span><span>{country.currency.name} ({country.currency.code})</span></div>
            <div><span className="inspect-label">Exchange rate</span><span>{country.currency.rate.toFixed(3)} TSC</span></div>
            <div><span className="inspect-label">Regime</span><span>{exchangeRateRegimeDef(cb.exchangeRegime).name}</span></div>
            {cb.exchangeRegime !== 'float' && (
              <div>
                <span className="inspect-label">Peg target</span>
                <span>
                  {country.currency.target.toFixed(3)} TSC{' '}
                  <span style={{ opacity: 0.6 }}>
                    ({country.currency.rate >= country.currency.target ? 'held' : `−${(((country.currency.target - country.currency.rate) / country.currency.target) * 100).toFixed(1)}%`})
                  </span>
                </span>
              </div>
            )}
            <div><span className="inspect-label">FX reserves</span><span>{formatMoney(cb.fxReserves)}</span></div>
          </div>
          <div className="ship-panel-hint" style={{ marginTop: 2 }}>
            1 TSC = the Terra Standard Credit, the interstellar reference. A higher rate is a stronger currency; cross-border
            trade, dividends and investment convert through it.
          </div>
        </>
      )}

      {/* Federal / regional readout (Stage 5) — regional reserve banks monitor
          local conditions, though policy stays national. */}
      {bankStructureDef(cb.structure).regional && (() => {
        const worlds = allWorlds.filter((w) => w.ownerId === country.id)
        if (worlds.length === 0) return null
        return (
          <>
            <div className="econ-subtitle" style={{ marginTop: 12 }}>Regional reserve banks</div>
            <div className="ship-panel-hint" style={{ marginBottom: 6 }}>
              {bankStructureDef(cb.structure).name} — regional banks report local conditions; monetary policy remains national.
            </div>
            <div className="cb-facts">
              {worlds.map((w) => {
                const rep = worldReports[w.id]
                const labor = rep ? Object.values(rep.labor) : []
                const emp = labor.length > 0 ? labor.reduce((s, l) => s + l.employmentRate, 0) / labor.length : undefined
                const pop = w.pops.reduce((s, p) => s + p.populationSize, 0)
                return (
                  <div key={w.id}>
                    <span className="inspect-label">{w.name}</span>
                    <span>{formatPop(pop)}{emp !== undefined ? ` · ${Math.round(emp * 100)}% emp` : ''}</span>
                  </div>
                )
              })}
            </div>
          </>
        )
      })()}

      {/* Policy levers */}
      <div className="econ-subtitle" style={{ marginTop: 12 }}>Monetary policy</div>
      {govControls ? (
        <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
          The government directs this bank — you set policy directly. Loose rates and money-printing stoke inflation with a
          lag; there is no free lunch.
        </div>
      ) : (
        <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
          This bank is independent — it sets its own rate against its mandate (it will lean against inflation on its own).
          The government cannot order it: reform its status, appoint a friendlier board, or apply pressure.
        </div>
      )}

      {/* Monetary conditions (Stage 4 transmission readout) */}
      {fiscal && fiscal.policyRate !== undefined && (
        <div className="cb-facts" style={{ marginBottom: 8 }}>
          <div>
            <span className="inspect-label">Inflation</span>
            <span className={fiscal.inflation > 0.05 ? 'econ-neg' : fiscal.inflation < 0 ? 'econ-neg' : 'econ-pos'}>
              {(fiscal.inflation * 100).toFixed(1)}% <span style={{ opacity: 0.5 }}>(target 2%)</span>
            </span>
          </div>
          <div><span className="inspect-label">Expectations</span><span>{((fiscal.inflationExpectation ?? 0) * 100).toFixed(1)}%</span></div>
          <div><span className="inspect-label">Real rate</span><span>{((fiscal.realRate ?? 0) * 100).toFixed(1)}%</span></div>
          <div>
            <span className="inspect-label">Output gap</span>
            <span className={(fiscal.outputGap ?? 0) >= 0 ? 'econ-pos' : 'econ-neg'}>{((fiscal.outputGap ?? 0) * 100).toFixed(1)}%</span>
          </div>
          {(fiscal.monetaryFinanced ?? 0) > 0 && (
            <div><span className="inspect-label">Money-financed deficit</span><span className="econ-neg">{formatMoney(fiscal.monetaryFinanced ?? 0)}/mo</span></div>
          )}
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

      {/* Open-market operations (Stage 4) — the day-to-day loosen/tighten lever. */}
      {govControls && debtFinancingRegimeDef(cb.debtFinancing).secondaryMarket && (
        <div className="econ-control-row" style={{ marginTop: 6 }}>
          <span className="inspect-label" title="Buying securities injects bank reserves (loosens); selling drains them (tightens).">Open-market ops</span>
          <span>
            <button type="button" className="laws-enact-btn" onClick={() => openMarketOperation(country.id, 5000)}>Buy (loosen)</button>{' '}
            <button type="button" className="econ-build-cancel" style={{ padding: '2px 8px' }} onClick={() => openMarketOperation(country.id, -5000)}>Sell (tighten)</button>
          </span>
        </div>
      )}

      {/* Balance sheet & money supply (Stage 2) */}
      <div className="econ-subtitle" style={{ marginTop: 12 }}>Balance sheet & money</div>
      {money ? (
        <>
          <div className="cb-facts">
            <div><span className="inspect-label">Base money (M0)</span><span>{formatMoney(money.baseMoney)}</span></div>
            <div><span className="inspect-label">Broad money (M2)</span><span>{formatMoney(money.broadMoney)}</span></div>
            <div><span className="inspect-label">Currency in circulation</span><span>{formatMoney(money.currency)}</span></div>
            <div><span className="inspect-label">Bank deposits</span><span>{formatMoney(money.deposits)}</span></div>
            <div><span className="inspect-label">Bank reserves</span><span>{formatMoney(money.bankReserves)}</span></div>
            <div><span className="inspect-label">Loans outstanding</span><span>{formatMoney(money.loans)}</span></div>
            <div><span className="inspect-label">Reserve ratio</span><span>{(money.reserveRatio * 100).toFixed(1)}% <span style={{ opacity: 0.5 }}>(req {(cb.reserveRequirement * 100).toFixed(0)}%)</span></span></div>
            <div><span className="inspect-label">Loan / deposit</span><span>{(money.loanToDeposit * 100).toFixed(0)}%</span></div>
          </div>
          <div className="ship-panel-hint" style={{ margin: '6px 0 2px' }}>Central bank balance sheet</div>
          <div className="cb-facts">
            <div><span className="inspect-label">Gov. securities</span><span>{formatMoney(cb.govSecurities)}</span></div>
            <div><span className="inspect-label">FX reserves</span><span>{formatMoney(cb.fxReserves)}</span></div>
            <div><span className="inspect-label">Loans to banks</span><span>{formatMoney(cb.loansToBanks)}</span></div>
            <div><span className="inspect-label">CB equity</span><span>{formatMoney(centralBankEquity(cb, money.bankReserves))}</span></div>
          </div>
        </>
      ) : (
        <div className="ship-panel-hint" style={{ marginBottom: 8 }}>Advance time to populate the money supply and balance sheet.</div>
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
