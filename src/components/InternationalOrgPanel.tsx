import { useState } from 'react'
import { ownerDisplay } from '../data/countryRoster'
import { ORG_PRESETS, type OrgPillar, type AuthorityModel } from '../data/internationalOrgData'
import { useInternationalOrgStore } from '../state/internationalOrgStore'
import { usePlayerStore } from '../state/playerStore'
import { useGameTimeStore, simDaysToDate } from '../state/gameTimeStore'

// The International Organizations category (NavBar): a nation's memberships, the
// organizations it could join, and a form to found a new one. Orgs are a
// composable blend of federations and power blocs — see data/internationalOrgData.ts.

function nameOf(id: string): string {
  return ownerDisplay(id).name
}
function Swatch({ id }: { id: string }) {
  return <span className="dip-swatch" style={{ background: ownerDisplay(id).color }} />
}
function formatDate(simDays: number): string {
  const d = simDaysToDate(simDays)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

const PILLAR_LABEL: Record<OrgPillar, string> = {
  'economic-market': 'Common market (tariff-free trade)',
  'common-external-tariff': 'Common external tariff',
  'defense-pact': 'Defensive pact',
  'joint-command': 'Joint fleet command',
  'political-forum': 'Political forum',
  cultural: 'Cultural union',
}
const AUTHORITY_LABEL: Record<AuthorityModel, string> = {
  democratic: 'Democratic',
  authoritarian: 'Authoritarian',
  hybrid: 'Hybrid',
}

export function InternationalOrgPanel() {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const orgs = useInternationalOrgStore((s) => s.orgs)
  const [presetId, setPresetId] = useState('common-market')
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  if (!playerId) return null

  const store = useInternationalOrgStore.getState
  const mine = orgs.filter((o) => o.memberIds.includes(playerId))
  const joinable = orgs.filter((o) => !o.memberIds.includes(playerId))

  const found = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setMessage('Name required')
      return
    }
    store().founded(playerId, presetId, trimmed, useGameTimeStore.getState().simDays)
    setName('')
    setMessage(`Founded ${trimmed}`)
  }

  return (
    <div className="dip-list">
      {message && <div className="inspect-status">{message}</div>}

      {mine.length === 0 && <div className="inspect-status">You belong to no international organizations.</div>}
      {mine.map((org) => {
        const isLeader = org.leaderId === playerId
        const hasJointCommand = org.pillars.includes('joint-command')
        return (
          <div key={org.id} className="dip-card">
            <div className="dip-card-head">
              <Swatch id={org.leaderId} />
              <span className="dip-card-name">{org.name}</span>
              <span className="dip-status">{AUTHORITY_LABEL[org.authorityModel]}</span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Leader</span>
              <span className="inspect-value">
                {nameOf(org.leaderId)}
                {isLeader ? ' (you)' : ''}
              </span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Founded</span>
              <span className="inspect-value">{formatDate(org.foundedSimDays)}</span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Members</span>
              <span className="inspect-value">{org.memberIds.map(nameOf).join(', ')}</span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Pillars</span>
              <span className="inspect-value">{org.pillars.length > 0 ? org.pillars.map((p) => PILLAR_LABEL[p]).join(', ') : 'None'}</span>
            </div>
            {hasJointCommand && !isLeader && (
              <div className="inspect-row">
                <span className="inspect-label">Fleet command</span>
                <span className="inspect-value">{org.delegatedCommand[playerId] ? `Delegated to ${nameOf(org.leaderId)}` : 'Kept'}</span>
              </div>
            )}
            <div className="dip-actions">
              {hasJointCommand && !isLeader && (
                <button
                  type="button"
                  className="detail-view-btn"
                  title="With a joint-command pillar, you may let the organization's leader direct your fleets."
                  onClick={() => store().setDelegatedCommand(org.id, playerId, !org.delegatedCommand[playerId])}
                >
                  {org.delegatedCommand[playerId] ? 'Reclaim fleet command' : 'Delegate fleet command'}
                </button>
              )}
              {isLeader ? (
                <button type="button" className="detail-view-btn danger" onClick={() => store().disband(org.id)}>
                  Disband
                </button>
              ) : (
                <button type="button" className="detail-view-btn danger" onClick={() => store().leave(org.id, playerId)}>
                  Leave
                </button>
              )}
            </div>
          </div>
        )
      })}

      {joinable.length > 0 && (
        <div className="dip-card">
          <div className="dip-card-head">
            <span className="dip-card-name">Organizations you could join</span>
          </div>
          {joinable.map((org) => (
            <div key={org.id} className="inspect-row">
              <span className="inspect-label">
                <Swatch id={org.leaderId} /> {org.name}
              </span>
              <button type="button" className="detail-view-btn" onClick={() => store().join(org.id, playerId)}>
                Join
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="dip-card">
        <div className="dip-card-head">
          <span className="dip-card-name">Found a new organization</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Type</span>
          <span className="inspect-value">{ORG_PRESETS.find((p) => p.id === presetId)?.pillars.map((p) => PILLAR_LABEL[p]).join(', ') || 'No pillars (custom)'}</span>
        </div>
        <div className="dip-actions">
          <select className="econ-method-select" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {ORG_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input type="text" className="econ-method-select" placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="detail-view-btn" disabled={!name.trim()} onClick={found}>
            Found
          </button>
        </div>
      </div>
    </div>
  )
}
