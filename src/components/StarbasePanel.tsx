import { DraggableWindow } from './DraggableWindow'
import { useStarbaseStore } from '../state/starbaseStore'
import { useStarbasePanelStore } from '../state/starbasePanelStore'
import { usePlayerStore } from '../state/playerStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { findStar } from '../data/starData'
import { ownerDisplay } from '../data/countryRoster'
import {
  STARBASE_TIERS,
  STARBASE_TIER_ORDER,
  STARBASE_MODULES,
  STARBASE_MODULE_ORDER,
  type StarbaseModuleType,
} from '../data/starbaseData'
import { starbaseTierOf, starbaseModulesOf, freeModuleSlots, starbaseMaxIntegrity, starbaseFirepower, isStarbaseActive } from '../scene/starbaseLogic'
import { useState } from 'react'

// Manage one Starbase: its tier, modules, and the upgrade / build actions (own
// bases only). Opened from the Outliner's Starbase list.
export function StarbasePanel() {
  const openId = useStarbasePanelStore((s) => s.openId)
  const starbases = useStarbaseStore((s) => s.starbases)
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const [message, setMessage] = useState<string | null>(null)
  const sb = starbases.find((s) => s.id === openId)
  if (!sb) return null

  const sim = useGameTimeStore.getState().simDays
  const tier = starbaseTierOf(sb)
  const tierDef = STARBASE_TIERS[tier]
  const modules = starbaseModulesOf(sb)
  const own = sb.ownerId === playerId
  const star = findStar(sb.starId)
  const active = isStarbaseActive(sb, sim)
  const nextTier = STARBASE_TIER_ORDER[STARBASE_TIER_ORDER.indexOf(tier) + 1]

  const doUpgrade = () => {
    const r = useStarbaseStore.getState().upgradeTier(sb.id, useGameTimeStore.getState().simDays)
    setMessage(r.ok ? `Upgraded to ${STARBASE_TIERS[nextTier!].label}` : r.reason)
  }
  const doBuild = (m: StarbaseModuleType) => {
    const r = useStarbaseStore.getState().buildModule(sb.id, m, useGameTimeStore.getState().simDays)
    setMessage(r.ok ? `Built ${STARBASE_MODULES[m].label}` : r.reason)
  }

  return (
    <DraggableWindow title={`${star?.name ?? sb.starId} — ${tierDef.label}`} memoryKey="starbase" anchor="right" onClose={() => useStarbasePanelStore.getState().close()}>
      <div className="dip-list">
        <div className="dip-card">
          <div className="dip-card-head">
            <span className="dip-swatch" style={{ background: ownerDisplay(sb.ownerId).color }} />
            <span className="dip-card-name">{tierDef.label}</span>
            {!active && <span className="dip-status">Under construction</span>}
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Owner</span>
            <span className="inspect-value">{ownerDisplay(sb.ownerId).name}{own ? ' (you)' : ''}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Integrity</span>
            <span className="inspect-value">{Math.round(sb.integrity)} / {starbaseMaxIntegrity(sb)}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Firepower</span>
            <span className="inspect-value">{starbaseFirepower(sb) || 'None'}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Module slots</span>
            <span className="inspect-value">{modules.length} / {tierDef.moduleSlots}</span>
          </div>
        </div>

        <div className="dip-card">
          <div className="dip-card-head">
            <span className="dip-card-name">Modules</span>
          </div>
          {STARBASE_MODULE_ORDER.map((m) => {
            const have = modules.includes(m)
            const def = STARBASE_MODULES[m]
            return (
              <div key={m} className="inspect-row" title={def.description}>
                <span className="inspect-label">{def.label}{have ? ' ✓' : ''}</span>
                {own && !have && (
                  <button type="button" className="detail-view-btn" disabled={freeModuleSlots(sb) <= 0} onClick={() => doBuild(m)}>
                    Build ({Object.entries(def.cost).map(([id, n]) => `${n} ${id}`).join(', ')})
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {own && nextTier && (
          <div className="dip-card">
            <div className="dip-actions">
              <button type="button" className="detail-view-btn" onClick={doUpgrade}>
                Upgrade to {STARBASE_TIERS[nextTier].label} ({Object.entries(STARBASE_TIERS[nextTier].upgradeCost).map(([id, n]) => `${n} ${id}`).join(', ') || 'free'})
              </button>
            </div>
          </div>
        )}
        {message && <div className="inspect-status">{message}</div>}
      </div>
    </DraggableWindow>
  )
}
