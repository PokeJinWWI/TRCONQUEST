import { Bi } from './Bi'
import { POP_LAW_OPTIONS, type PopLaws } from '../economy/popRules'
import { setPopLaw, usePopLaws } from '../state/popLaws'

// The laws on who works (economy/popRules.ts), in the Laws panel of both modes: rights of women, child labour, retirement age. They set the
// share of the people who are workforce rather than dependents; a pop's share moves toward it a little each month.
export function PopLawsSection({ nationId }: { nationId: string }) {
  const laws = usePopLaws(nationId)
  return (
    <>
      <div className="econ-subtitle" style={{ marginTop: 12 }}><Bi en="Workforce laws" /></div>
      <div className="ship-panel-hint" style={{ marginBottom: 8 }}>
        These laws decide how many of your people are workforce and how many are dependents (children, the elderly, carers: they need half as much and do not staff jobs). A pop's workforce share moves toward what your laws allow a little each month.
      </div>
      {POP_LAW_OPTIONS.map((law) => (
        <div key={law.key} style={{ marginBottom: 8 }}>
          <div className="abs-dim" title={law.blurb}>{law.label}</div>
          <div className="laws-option-list">
            {law.options.map((o) => {
              const active = laws[law.key as keyof PopLaws] === o.value
              return (
                <div key={o.value} className={`laws-option${active ? ' active' : ''}`}>
                  <div className="laws-option-head">
                    <span className="laws-option-name">{o.label}</span>
                    {active ? <span className="laws-option-current"><Bi en="In force" /></span> : <button type="button" className="laws-enact-btn" onClick={() => setPopLaw(nationId, law.key, o.value)}><Bi en="Enact" /></button>}
                  </div>
                  <div className="laws-option-desc">{o.blurb}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}
