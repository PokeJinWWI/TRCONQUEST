import { useState } from 'react'
import {
  COMPONENT_KINDS,
  COMPONENT_LABELS,
  DAMAGE_PROFILES,
  DAMAGE_TYPE_LABELS,
  type CombatProfile,
  type DamageType,
} from '../data/combatData'
import { ALLEGIANCE_LABELS, SHIP_CLASSES, describeFtlDrive, type ShipClass } from '../data/shipData'
import { overallHealthFraction, shipCombatProfile } from '../scene/combatResolution'
import { getShipStatusText } from '../scene/shipPhysics'
import { useCombatStore } from '../state/combatStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'

export type FleetTab = 'manager' | 'designer' | 'strategizer'

export const FLEET_TABS: { id: FleetTab; label: string }[] = [
  { id: 'manager', label: 'Fleet Manager' },
  { id: 'designer', label: 'Ship Designer' },
  { id: 'strategizer', label: 'Strategizer' },
]

// Damage-per-second at full weapons health, ignoring range and the defense
// matrix. A deliberately crude number — it's the only way to compare two
// loadouts at a glance, but it says nothing about *what* the damage is good
// against, which is the actual point of the weapon types. Labelled "raw" in
// the UI for exactly that reason.
function rawDps(profile: CombatProfile): number {
  return profile.weapons.reduce((sum, w) => sum + w.damage / w.cooldownSeconds, 0)
}

// Which damage types a hull can bring, in roster order — the genuinely
// decision-relevant summary, since the counter-matrix is what decides fights.
function damageTypesOf(profile: CombatProfile): DamageType[] {
  const seen: DamageType[] = []
  for (const w of profile.weapons) if (!seen.includes(w.damageType)) seen.push(w.damageType)
  return seen
}

function totalHp(profile: CombatProfile): number {
  return (
    COMPONENT_KINDS.reduce((sum, k) => sum + profile.components[k], 0) +
    profile.defenses.shieldHp +
    profile.defenses.armorHp
  )
}

// --- Fleet Manager --------------------------------------------------------

// Every ship that actually exists, with live condition and what it's doing.
// The counterpart to the Outliner's flat fleet list: this is where you read
// the *state* of your navy rather than navigate to one ship.
function FleetManager() {
  const ships = useShipStore((s) => s.ships)
  const selectShip = useShipStore((s) => s.selectShip)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const engagements = useCombatStore((s) => s.engagements)
  const simDays = useGameTimeStore((s) => s.simDays)

  if (ships.length === 0) {
    return <div className="nav-placeholder">No ships in service.</div>
  }

  const engagedIds = new Set(engagements.flatMap((e) => e.participants.map((p) => p.shipId)))

  return (
    <div className="fleet-list">
      {ships.map((ship) => {
        const shipClass = SHIP_CLASSES.find((c) => c.id === ship.classId)
        const profile = shipCombatProfile(ship)
        const health = profile ? overallHealthFraction(ship.combat, profile) : 0
        return (
          <button
            key={ship.id}
            type="button"
            className={`fleet-row${ship.id === selectedShipId ? ' selected' : ''}`}
            onClick={() => selectShip(ship.id)}
          >
            <div className="fleet-row-head">
              <span className="fleet-row-name">{ship.name}</span>
              <span className="fleet-row-class">{shipClass?.name ?? 'Unknown'}</span>
              <span className="fleet-row-allegiance">{ALLEGIANCE_LABELS[ship.allegiance]}</span>
              {engagedIds.has(ship.id) && <span className="combat-roster-tag">IN COMBAT</span>}
            </div>
            <div className="fleet-row-bar">
              <span className="health-bar-track tone-overall combat-roster-bar">
                <span className="health-bar-fill" style={{ width: `${health * 100}%` }} />
              </span>
              <span className="combat-roster-pct">{Math.round(health * 100)}%</span>
            </div>
            <div className="fleet-row-status">{getShipStatusText(ship, simDays, ships)}</div>
          </button>
        )
      })}
    </div>
  )
}

// --- Ship Designer --------------------------------------------------------

function DesignDetail({ shipClass }: { shipClass: ShipClass }) {
  const profile = shipClass.combat
  const types = damageTypesOf(profile)

  return (
    <div className="design-detail">
      <div className="inspect-row">
        <span className="inspect-label">Role</span>
        <span className="inspect-value">{shipClass.role === 'warship' ? 'Warship' : 'Civilian'}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Drives</span>
        <span className="inspect-value">
          Reaction{shipClass.ftlDrives.length ? `, ${shipClass.ftlDrives.map(describeFtlDrive).join(', ')}` : ''}
        </span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Sublight</span>
        <span className="inspect-value">{profile.maneuverUnitsPerSecond.toFixed(2)} arena units/s</span>
      </div>

      <div className="inspect-divider" />
      <div className="combat-orders-title">Hull</div>
      {COMPONENT_KINDS.map((kind) => (
        <div className="inspect-row" key={kind}>
          <span className="inspect-label">{COMPONENT_LABELS[kind]}</span>
          <span className="inspect-value">{profile.components[kind]} HP</span>
        </div>
      ))}
      <div className="inspect-row">
        <span className="inspect-label">Shields</span>
        <span className="inspect-value">
          {profile.defenses.shieldHp} HP · +{profile.defenses.shieldRegenPerSecond}/s
        </span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Armor</span>
        <span className="inspect-value">{profile.defenses.armorHp} HP</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Point Defense</span>
        <span className="inspect-value">
          {profile.defenses.pointDefenseRating > 0
            ? `${Math.round(profile.defenses.pointDefenseRating * 100)}% intercept`
            : 'None'}
        </span>
      </div>

      <div className="inspect-divider" />
      <div className="combat-orders-title">Armament</div>
      {profile.weapons.length === 0 ? (
        <div className="nav-placeholder">Unarmed.</div>
      ) : (
        <>
          <table className="design-table">
            <thead>
              <tr>
                <th>Mount</th>
                <th>Type</th>
                <th>Dmg</th>
                <th>Rate</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {profile.weapons.map((w, i) => (
                <tr key={`${w.id}-${i}`}>
                  <td>{w.name}</td>
                  <td>{DAMAGE_TYPE_LABELS[w.damageType]}</td>
                  <td>{w.damage}</td>
                  <td>{w.cooldownSeconds}s</td>
                  <td>{w.rangeUnits}u</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="inspect-row">
            <span className="inspect-label">Raw DPS</span>
            <span className="inspect-value" title="Before the defense matrix and before range — comparison only">
              {rawDps(profile).toFixed(1)}
            </span>
          </div>
        </>
      )}

      {types.length > 0 && (
        <>
          <div className="inspect-divider" />
          <div className="combat-orders-title">Matchups</div>
          {/* The genuinely decision-relevant readout: raw DPS says nothing
              about what a loadout is good *against*, and the counter-matrix
              is what actually decides fights. */}
          {types.map((t) => {
            const d = DAMAGE_PROFILES[t]
            const vsShields = d.bypassesShields ? 'bypasses shields' : `${d.shields}x vs shields`
            return (
              <div className="inspect-row" key={t}>
                <span className="inspect-label">{DAMAGE_TYPE_LABELS[t]}</span>
                <span className="inspect-value">
                  {vsShields} · {d.armor}x vs armor{d.interceptable ? ' · interceptable' : ''}
                </span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// A read-only catalog of the preset hulls. Editing isn't wired up yet (no
// resource or refit system exists to make a custom design mean anything), but
// the underlying data is already a per-hull list of independent mounts and
// defense values — so a designer that *builds* loadouts drops onto this same
// model rather than needing a rewrite.
function ShipDesigner() {
  const [selectedId, setSelectedId] = useState(SHIP_CLASSES.find((c) => c.role === 'warship')?.id ?? SHIP_CLASSES[0].id)
  const selected = SHIP_CLASSES.find((c) => c.id === selectedId) ?? SHIP_CLASSES[0]

  const warships = SHIP_CLASSES.filter((c) => c.role === 'warship')
  const civilians = SHIP_CLASSES.filter((c) => c.role === 'civilian')

  const renderGroup = (label: string, group: ShipClass[]) => (
    <div className="combat-side">
      <div className="combat-side-label">{label}</div>
      {group.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`combat-roster-row${c.id === selectedId ? ' selected' : ''}`}
          onClick={() => setSelectedId(c.id)}
        >
          <span className="combat-roster-name">{c.name}</span>
          <span className="combat-roster-pct">{totalHp(c.combat)}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="designer-layout">
      <div className="designer-list">
        {renderGroup('Warships', warships)}
        {renderGroup('Civilian', civilians)}
        <div className="ship-panel-hint">Presets only — loadout editing is not yet available.</div>
      </div>
      <div className="designer-detail">
        <div className="designer-title">{selected.name}</div>
        <DesignDetail shipClass={selected} />
      </div>
    </div>
  )
}

// --- Root -----------------------------------------------------------------

export function FleetManagement() {
  const [tab, setTab] = useState<FleetTab>('manager')

  return (
    <div className="fleet-management">
      <div className="fleet-tabs">
        {FLEET_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`fleet-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'manager' && <FleetManager />}
      {tab === 'designer' && <ShipDesigner />}
      {/* Deliberately empty per the design brief — the tab is reserved, not
          filled with invented content. Same "reserve the spot, don't invent
          content" spirit as the other NavBar placeholders. */}
      {tab === 'strategizer' && <div className="nav-placeholder">Not yet available</div>}
    </div>
  )
}
