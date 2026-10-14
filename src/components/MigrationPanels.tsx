import { Bi } from './Bi'
import { useMemo } from 'react'
import { EMIGRATION_POLICIES, EMIGRATION_POLICY_DEFS, MIGRATION_POLICIES, MIGRATION_POLICY_DEFS, type EmigrationPolicy, type MigrationPolicy } from '../economy/migrationRules'
import { lawsOfNation, useMigrationStore } from '../state/migrationStore'
import { attractionBreakdownOf } from '../scene/migrationView'
import { useConfirmStore } from '../state/confirmStore'
import { TimeChart } from './TimeChart'

// The two migration laws of a nation (both economy modes): who may settle here, and whether our own people may leave.
export function MigrationLawsSection({ nationId }: { nationId: string }) {
  const laws = useMigrationStore((s) => s.laws)
  const mine = lawsOfNation(nationId, laws)
  const requestConfirm = useConfirmStore((s) => s.requestConfirm)
  const setImmigration = (id: MigrationPolicy) => useMigrationStore.getState().setImmigration(nationId, id)
  const setEmigration = (id: EmigrationPolicy) => useMigrationStore.getState().setEmigration(nationId, id)
  return (
    <>
      <div className="econ-subtitle" style={{ marginTop: 12 }}>Migration</div>
      <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
        Current laws: <b style={{ color: '#cdeeff' }}>{MIGRATION_POLICY_DEFS[mine.immigration].name}</b> · <b style={{ color: '#cdeeff' }}>{EMIGRATION_POLICY_DEFS[mine.emigration].name}</b>. People move from where life is worse to where it is better, a small share a month, along paths these laws and migration treaties open.
      </div>
      <div className="laws-option-list">
        {MIGRATION_POLICIES.map((id) => {
          const def = MIGRATION_POLICY_DEFS[id]
          const active = id === mine.immigration
          return (
            <div key={id} className={`laws-option${active ? ' active' : ''}`}>
              <div className="laws-option-head">
                <span className="laws-option-name">{def.name}</span>
                {active ? (
                  <span className="laws-option-current"><Bi en="In force" /></span>
                ) : (
                  <button type="button" className="laws-enact-btn" onClick={() => requestConfirm({ title: `Enact ${def.name}?`, body: def.description, effects: [], confirmLabel: 'Enact', onConfirm: () => setImmigration(id) })}>
                    Enact
                  </button>
                )}
              </div>
              <div className="laws-option-desc">{def.description}</div>
            </div>
          )
        })}
      </div>
      <div className="laws-option-list" style={{ marginTop: 6 }}>
        {EMIGRATION_POLICIES.map((id) => {
          const def = EMIGRATION_POLICY_DEFS[id]
          const active = id === mine.emigration
          return (
            <div key={id} className={`laws-option${active ? ' active' : ''}`}>
              <div className="laws-option-head">
                <span className="laws-option-name">{def.name}</span>
                {active ? <span className="laws-option-current"><Bi en="In force" /></span> : <button type="button" className="laws-enact-btn" onClick={() => setEmigration(id)}><Bi en="Enact" /></button>}
              </div>
              <div className="laws-option-desc">{def.description}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// The Population tab's Migration card: what draws people to this world, who came and left, and a chart of the net flow.
export function MigrationCard({ bodyName }: { bodyName: string }) {
  const history = useMigrationStore((s) => s.history)
  const view = useMemo(() => attractionBreakdownOf(bodyName), [bodyName, history.length])
  const series = useMemo(() => {
    const net = history.map((h) => h.flows.reduce((n, f) => n + (f.to === bodyName ? f.amount : 0) - (f.from === bodyName ? f.amount : 0), 0))
    return net
  }, [history, bodyName])
  const last = history[history.length - 1]
  const inbound = (last?.flows ?? []).filter((f) => f.to === bodyName)
  const outbound = (last?.flows ?? []).filter((f) => f.from === bodyName)
  return (
    <div className="migration-card">
      <div className="inspect-divider" />
      <div className="inspect-label" title="People move from where life is worse to where it is better. A world's pull is the sum of these terms (Simple mode has no standard of living)."><Bi en="Migration" /></div>
      {view && (
        <>
          <div className="inspect-row" title="Weighted sum of the terms below: higher draws people in"><span className="inspect-label"><Bi en="Attraction" /></span><span className="inspect-value">{Math.round(view.total * 100)}%</span></div>
          {view.terms.map((t) => (
            <div key={t.label} className="inspect-row" title={t.note}>
              <span className="inspect-label">  {t.label}</span>
              <span className="inspect-value">{t.value === null ? 'n/a' : `${Math.round(t.value * 100)}%`}</span>
            </div>
          ))}
        </>
      )}
      {inbound.map((f) => (
        <div key={`in-${f.from}`} className="inspect-row" title={f.reason}><span className="inspect-label">From {f.from}</span><span className="inspect-value econ-pos">+{f.amount.toFixed(3)}M{f.wave ? ' (refugees)' : ''}</span></div>
      ))}
      {outbound.map((f) => (
        <div key={`out-${f.to}`} className="inspect-row" title={f.reason}><span className="inspect-label">To {f.to}</span><span className="inspect-value econ-neg">−{f.amount.toFixed(3)}M{f.wave ? ' (refugees)' : ''}</span></div>
      ))}
      {inbound.length === 0 && outbound.length === 0 && <div className="abs-dim" style={{ fontSize: 11 }}>No one moved in or out last month.</div>}
      {series.some((v) => v !== 0) && (
        <TimeChart title="Net migration (millions a month)" endTick={history[history.length - 1].tick} includeZero format={(v) => `${v.toFixed(3)}M`} series={[{ label: 'Net', color: '#8fe3b0', values: series }]} />
      )}
    </div>
  )
}
