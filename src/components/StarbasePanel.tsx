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
import { starbaseTierOf, starbaseModulesOf, freeModuleSlots, starbaseMaxIntegrity, starbaseFirepower, isStarbaseActive, stationPower } from '../scene/starbaseLogic'
import { useTechStore } from '../state/techStore'
import { findTech } from '../data/techData'
import { useState } from 'react'

// Manage one Starbase: its tier, modules, and the upgrade / build actions (own
// bases only). Opened from the Outliner's Starbase list.
export function StarbasePanel() {
  const openId = useStarbasePanelStore((s) => s.openId)
  const starbases = useStarbaseStore((s) => s.starbases)
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const [message, setMessage] = useState<string | null>(null)
  const sb = starbases.find((s) => s.id === openId)
  const researched = useTechStore((st) => st.stateFor(sb?.ownerId ?? '').researched)
  if (!sb) return null

  const sim = useGameTimeStore.getState().simDays
  const tier = starbaseTierOf(sb)
  const tierDef = STARBASE_TIERS[tier]
  const modules = starbaseModulesOf(sb)
  const own = sb.ownerId === playerId
  const star = findStar(sb.starId)
  const active = isStarbaseActive(sb, sim)
  const nextTier = STARBASE_TIER_ORDER[STARBASE_TIER_ORDER.indexOf(tier) + 1]
  const power = stationPower(sb)
  const title = sb.name ?? (sb.zone ? `${sb.zone.slice(0, sb.zone.lastIndexOf('~'))} ${sb.zone.endsWith('~low') ? 'low' : 'high'} orbit station` : star?.name ?? sb.starId)

  const doUpgrade = () => {
    const r = useStarbaseStore.getState().upgradeTier(sb.id, useGameTimeStore.getState().simDays)
    setMessage(r.ok ? `Upgraded to ${STARBASE_TIERS[nextTier!].label}` : r.reason)
  }
  const doBuild = (m: StarbaseModuleType) => {
    const r = useStarbaseStore.getState().buildModule(sb.id, m, useGameTimeStore.getState().simDays)
    setMessage(r.ok ? `Built ${STARBASE_MODULES[m].label}` : r.reason)
  }

  return (
    <DraggableWindow title={`${title} — ${tierDef.label}`} memoryKey="starbase" onClose={() => useStarbasePanelStore.getState().close()}>
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
          <div className="inspect-row" title="Every module draws power; solar arrays and fusion reactors add to the hull's own supply. A module the supply cannot cover goes offline (the newest first).">
            <span className="inspect-label">Power</span>
            <span className={`inspect-value${power.demand > power.supply ? ' econ-neg' : ''}`}>{power.demand} of {power.supply} used</span>
          </div>
          {sb.zone && (
            <div className="inspect-row">
              <span className="inspect-label">Orbit</span>
              <span className="inspect-value">{sb.zone.replace('~', ' · ')}</span>
            </div>
          )}
          {own && (
            <div className="inspect-row">
              <span className="inspect-label">Name</span>
              <input className="ground-key-name-input" value={sb.name ?? ''} maxLength={40} placeholder={title} onChange={(e) => useStarbaseStore.getState().renameStation(sb.id, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </div>
          )}
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
            const count = modules.filter((x) => x === m).length
            const def = STARBASE_MODULES[m]
            const max = def.max ?? 1
            const needTech = def.requiresTech && !researched.has(def.requiresTech) ? findTech(def.requiresTech)?.name ?? def.requiresTech : null
            const offline = modules.reduce((n, x, idx) => n + (x === m && !power.online[idx] ? 1 : 0), 0)
            const tetherAtStar = m === 'space-elevator-tether' && !sb.zone
            const energy = def.energy > 0 ? `+${def.energy} power` : `${def.energy} power`
            return (
              <div key={m} className="inspect-row" title={`${def.description}\n${energy}${needTech ? `\nNeeds ${needTech}` : ''}`}>
                <span className="inspect-label">{def.label}{count > 0 ? ` ×${count}` : ''}{offline > 0 ? <span className="econ-neg"> · {offline} offline</span> : null}</span>
                {own && (
                  <span>
                    {count > 0 && (
                      <button type="button" className="detail-view-btn" title="Take one down (no refund)" onClick={() => setMessage((r => r.ok ? `Removed a ${def.label}` : r.reason)(useStarbaseStore.getState().removeModule(sb.id, m)))}>
                        −
                      </button>
                    )}
                    {count < max && (
                      <button type="button" className="detail-view-btn" disabled={freeModuleSlots(sb) <= 0 || !!needTech || tetherAtStar} title={needTech ? `Needs ${needTech}` : tetherAtStar ? 'A tether hangs from a station circling a world' : undefined} onClick={() => doBuild(m)}>
                        Build ({Object.entries(def.cost).map(([id, n]) => `${n} ${id}`).join(', ')}, {energy})
                      </button>
                    )}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {own && nextTier && (
          <div className="dip-card">
            <div className="dip-actions">
              <button type="button" className="detail-view-btn" onClick={doUpgrade}>
                Upgrade to {STARBASE_TIERS[nextTier].label}{STARBASE_TIERS[nextTier].requiresTech && !researched.has(STARBASE_TIERS[nextTier].requiresTech!) ? ` (needs ${findTech(STARBASE_TIERS[nextTier].requiresTech!)?.name})` : ''} ({Object.entries(STARBASE_TIERS[nextTier].upgradeCost).map(([id, n]) => `${n} ${id}`).join(', ') || 'free'})
              </button>
            </div>
          </div>
        )}
        {message && <div className="inspect-status">{message}</div>}
      </div>
    </DraggableWindow>
  )
}
