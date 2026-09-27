import { useState } from 'react'
import { HOLDING_DEFS, HOLDING_KINDS, type HoldingKind } from '../../data/holdingsData'
import { ownerDisplay } from '../../data/countryRoster'
import { useHoldingsStore } from '../../state/holdingsStore'
import { useGameTimeStore } from '../../state/gameTimeStore'
import { useTerritoryStore } from '../../state/territoryStore'
import { canOpen } from '../../scene/holdings'
import { holdingContext, worldGdpYearOf } from '../../state/nationEconomy'
import { BRANCH_PROFIT_SHARE } from '../../data/holdingsData'
import { formatMoney } from '../../economy/format'
import { PlanetIcon } from './PlanetIcons'

// Foreign buildings in a world's Urban district (both economy modes): a tile
// per embassy / branch office with its owner's colour, closable by the host
// (expel) or the owner; and, for a player looking at someone else's world, the
// tiles to open their own. Used inside the Urban district card of both modes'
// Districts & Buildings tab.
export function ForeignHoldingsRow({ bodyName, playerId }: { bodyName: string; playerId: string | null }) {
  const holdings = useHoldingsStore((s) => s.holdings)
  const open = useHoldingsStore((s) => s.open)
  const close = useHoldingsStore((s) => s.close)
  const simDays = useGameTimeStore((s) => s.simDays)
  const host = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const [message, setMessage] = useState<string | null>(null)
  const here = holdings.filter((h) => h.bodyName === bodyName)
  const isHost = !!playerId && host === playerId
  const ctx = holdingContext()
  const offers = playerId && host && host !== playerId ? HOLDING_KINDS.map((k) => ({ kind: k, check: canOpen(k, playerId, bodyName, holdings, ctx) })) : []
  const doOpen = (kind: HoldingKind) => {
    if (!playerId) return
    const res = open(playerId, bodyName, kind, simDays)
    setMessage(res.ok ? null : res.reason)
  }
  return (
    <>
      {message && <div className="econ-neg pl-message">{message}</div>}
      <div className="pl-grid">
        {here.map((h) => {
          const owner = ownerDisplay(h.ownerId)
          const def = HOLDING_DEFS[h.kind]
          const mine = h.ownerId === playerId
          const income = h.kind === 'branchOffice' ? worldGdpYearOf(bodyName) * BRANCH_PROFIT_SHARE : 0
          return (
            <div key={h.id} className="pl-tile foreign" style={{ borderColor: owner.color, color: owner.color }}
              title={`${owner.name}'s ${def.name}\n${def.description}${income > 0 ? `\nEarns its owner about ${formatMoney(income)} a year` : ''}`}>
              <PlanetIcon id={h.kind} size={22} />
              <span className="pl-tile-name">{def.name}</span>
              <span className="pl-flag" style={{ background: owner.color }} />
              {(isHost || mine) && (
                <button type="button" className="abs-x pl-tile-x" title={isHost ? `Expel ${owner.name}'s ${def.name}` : `Close your ${def.name}`} onClick={() => close(h.id)}>×</button>
              )}
            </div>
          )
        })}
        {offers.map(({ kind, check }) => (
          <button key={kind} type="button" className="pl-tile empty" disabled={!check.ok}
            title={check.ok ? `Open a ${HOLDING_DEFS[kind].name} here — costs ${formatMoney(check.cost)}\n${HOLDING_DEFS[kind].description}` : `${HOLDING_DEFS[kind].name}: ${(check as { reason: string }).reason}`}
            onClick={() => doOpen(kind)}>
            <PlanetIcon id={kind} size={18} />
            <span className="pl-tile-name">Open {HOLDING_DEFS[kind].name}</span>
          </button>
        ))}
        {here.length === 0 && offers.length === 0 && <div className="abs-dim pl-urban-note">No foreign embassies or firms here yet.</div>}
      </div>
    </>
  )
}

// The player's own embassies and branch offices abroad (Simple: Industry tab;
// Complex: Economy › Overview).
export function HoldingsAbroad({ playerId }: { playerId: string }) {
  const holdings = useHoldingsStore((s) => s.holdings)
  const close = useHoldingsStore((s) => s.close)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const mine = holdings.filter((h) => h.ownerId === playerId)
  return (
    <div className="pl-abroad">
      {mine.length === 0 ? (
        <div className="abs-dim">None yet — open an embassy or branch office from another nation's world (its Districts & Buildings tab, Urban district).</div>
      ) : (
        mine.map((h) => {
          const host = owners[h.bodyName]
          const income = h.kind === 'branchOffice' ? worldGdpYearOf(h.bodyName) * BRANCH_PROFIT_SHARE : 0
          return (
            <div key={h.id} className="abs-order" title={HOLDING_DEFS[h.kind].description}>
              <span>
                <PlanetIcon id={h.kind} size={12} /> {HOLDING_DEFS[h.kind].name} — {h.bodyName}
                <span className="abs-dim"> ({host ? ownerDisplay(host).name : '—'})</span>
              </span>
              <span className="abs-dim">{h.kind === 'branchOffice' ? `+${formatMoney(income)}/yr` : 'opinion ↑'}</span>
              <span />
              <button type="button" className="abs-x" title="Close it" onClick={() => close(h.id)}>×</button>
            </div>
          )
        })
      )}
    </div>
  )
}
