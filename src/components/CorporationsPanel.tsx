import { useState } from 'react'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { useConfirmStore } from '../state/confirmStore'
import { corporationValue, sharePrice } from '../economy/economyTick'
import { formatMoney } from '../economy/format'
import type { Corporation } from '../economy/economyTypes'

// Corporations category. Two tabs: State Owned and Private. The state can found
// new corporations of either kind, nationalise a company (fold it into the
// state), or privatise a state corporation (float it on the exchange).
export function CorporationsPanel({ subcategory }: { subcategory: string | null }) {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const corporations = useEconomyStore((s) => s.corporations)
  const characters = useEconomyStore((s) => s.characters)
  const worlds = useEconomyStore((s) => s.worlds)
  const countries = useEconomyStore((s) => s.countries)
  const createCorporation = useEconomyStore((s) => s.createCorporation)
  const nationaliseCorporation = useEconomyStore((s) => s.nationaliseCorporation)
  const privatiseCorporation = useEconomyStore((s) => s.privatiseCorporation)
  const setSubsidyForCorporation = useEconomyStore((s) => s.setSubsidyForCorporation)
  const requestConfirm = useConfirmStore((s) => s.requestConfirm)
  const country = countries.find((c) => c.id === countryId)
  const [name, setName] = useState('')
  const [sector, setSector] = useState('Industry')

  const kind: Corporation['kind'] = subcategory === 'Private' ? 'private' : subcategory === 'Financial Districts' ? 'financial' : 'state'
  if (!countryId) return <div className="nav-placeholder">No nation selected.</div>
  const mine = corporations.filter((c) => c.countryId === countryId && c.kind === kind)

  const buildingsOf = (corpId: string) => {
    let n = 0
    for (const w of worlds) for (const b of w.buildings) if (b.owner.kind === 'corporation' && b.owner.corporationId === corpId) n++
    return n
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || kind === 'financial') return
    createCorporation(countryId, trimmed, kind, sector)
    setName('')
  }

  return (
    <div className="econ-panel">
      <div className="econ-subtitle">{kind === 'state' ? 'State-Owned Corporations' : kind === 'financial' ? 'Financial Districts' : 'Private Corporations'}</div>
      {kind === 'financial' && (
        <div className="ship-panel-hint" style={{ marginBottom: 6 }}>
          Financial districts auto-form on a populous world. They own a Financial Center and hold stakes in local
          companies — a co-op-like institutional investor, not a normal company.
        </div>
      )}
      {mine.length === 0 ? (
        <div className="nav-placeholder">No {kind === 'state' ? 'state-owned' : kind === 'financial' ? 'financial districts' : 'private'} corporations yet.</div>
      ) : (
        mine.map((c) => {
          const leader = characters.find((ch) => ch.id === c.leaderId)
          const price = sharePrice(c, worlds)
          const stateStake = c.shares.find((s) => s.holder.kind === 'state')?.shares ?? 0
          return (
            <div key={c.id} className="corp-card">
              <div className="corp-card-head">
                <span className="corp-card-name">{c.name}</span>
                <span className="corp-card-sector">{c.sector}</span>
              </div>
              <div className="corp-card-stats">
                <span>
                  Cash <b className={c.cash >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(c.cash)}</b>
                </span>
                <span>
                  Profit/tick <b className={c.lastProfit >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(c.lastProfit)}</b>
                </span>
                <span>
                  Value <b>{formatMoney(corporationValue(c, worlds))}</b>
                </span>
                <span>Buildings {buildingsOf(c.id)}</span>
                <span>Share {formatMoney(price)}</span>
                <span>State stake {Math.round((stateStake / c.totalShares) * 100)}%</span>
              </div>
              <div className="corp-card-leader">
                Leader: <b>{leader?.name ?? '—'}</b>
                {leader && <span className="corp-card-traits"> · {leader.traits.join(', ')}</span>}
              </div>
              {kind !== 'financial' && country && (
                <div className="econ-control-row" title="A standing per-tick treasury payment to this company's cash — a real, ongoing budget cost, not free money.">
                  <span className="inspect-label">Subsidize/tick</span>
                  <span className="econ-control">
                    <button
                      type="button"
                      onClick={() => setSubsidyForCorporation(countryId, c.id, (country.subsidies.corporations[c.id] ?? 0) - 50)}
                    >
                      −
                    </button>
                    <span className="econ-control-value">{formatMoney(country.subsidies.corporations[c.id] ?? 0)}</span>
                    <button
                      type="button"
                      onClick={() => setSubsidyForCorporation(countryId, c.id, (country.subsidies.corporations[c.id] ?? 0) + 50)}
                    >
                      +
                    </button>
                  </span>
                </div>
              )}
              <div className="corp-card-actions">
                {kind === 'financial' ? null : kind === 'private' ? (
                  <button
                    type="button"
                    className="corp-btn corp-btn-danger"
                    onClick={() =>
                      requestConfirm({
                        title: `Nationalise ${c.name}?`,
                        body: 'The company becomes a state-owned enterprise you control directly.',
                        effects: [
                          `Pay shareholders ${formatMoney(corporationValue(c, worlds) * 0.6)} in compensation from the treasury`,
                          `Lose ~${400 + buildingsOf(c.id) * 300} bureaucracy (administrative takeover)`,
                          `Gain full control of ${buildingsOf(c.id)} building(s) and the company's cash`,
                          'It moves to the State Owned tab',
                        ],
                        confirmLabel: 'Nationalise',
                        onConfirm: () => nationaliseCorporation(c.id),
                      })
                    }
                  >
                    Nationalise
                  </button>
                ) : (
                  <button
                    type="button"
                    className="corp-btn"
                    onClick={() =>
                      requestConfirm({
                        title: `Privatise ${c.name}?`,
                        body: 'Float this state enterprise on the exchange.',
                        effects: [
                          `Sell 70% to the public, banking ${formatMoney(sharePrice(c, worlds) * c.totalShares * 0.7)} to the treasury`,
                          'The state keeps a 30% stake',
                          'It moves to the Private tab and its owners run it themselves',
                        ],
                        confirmLabel: 'Privatise',
                        onConfirm: () => privatiseCorporation(c.id),
                      })
                    }
                  >
                    Privatise
                  </button>
                )}
              </div>
            </div>
          )
        })
      )}

      {kind !== 'financial' && (
        <>
          <div className="econ-subtitle" style={{ marginTop: 10 }}>
            Found a {kind === 'state' ? 'state' : 'private'} corporation
          </div>
          <div className="corp-create">
            <input className="corp-input" placeholder="Corporation name" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="econ-method-select" value={sector} onChange={(e) => setSector(e.target.value)}>
              {['Agriculture', 'Mining', 'Energy', 'Industry', 'Technology', 'Finance'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button type="button" className="corp-btn" onClick={submit} disabled={!name.trim()}>
              Found
            </button>
          </div>
          <div className="ship-panel-hint">
            Founding capital is drawn from the treasury. Assign it buildings via Economy → Construction (fund with the
            company), or nationalise an existing one.
          </div>
        </>
      )}
    </div>
  )
}
