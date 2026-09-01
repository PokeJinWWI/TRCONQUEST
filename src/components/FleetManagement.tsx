import { useMemo, useState } from 'react'
import {
  COMBAT_STANCES,
  COMPONENT_KINDS,
  COMPONENT_LABELS,
  DAMAGE_PROFILES,
  DAMAGE_TYPE_LABELS,
  FLEET_STRATEGIES,
  FLEET_STRATEGY_DESCRIPTIONS,
  FLEET_STRATEGY_LABELS,
  STANCE_DESCRIPTIONS,
  STANCE_LABELS,
  type CombatProfile,
  type DamageType,
} from '../data/combatData'
import { ALLEGIANCE_LABELS, SHIP_CLASSES, describeFtlDrive, type ShipClass } from '../data/shipData'
import { overallHealthFraction, shipCombatProfile, totalHitPoints } from '../scene/combatResolution'
import { getShipStatusText } from '../scene/shipPhysics'
import { useCombatStore } from '../state/combatStore'
import { useFleetStore, type Fleet } from '../state/fleetStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore, type ShipInstance } from '../state/shipStore'

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

// --- Fleet Manager --------------------------------------------------------

// Every ship the player actually owns, with live condition and what it's
// doing — grouped by fleet (see ShipInstance.fleetId) rather than one flat
// row per hull, same reasoning as the Outliner's own fleet list: a hundred
// ships reads as a hundred rows of noise until they're grouped, a handful of
// fleets doesn't. The counterpart to that list: this is where you read the
// *state* of your navy rather than navigate to one ship — same player-only
// scope as that list, for the same reason (this is "my navy," not a sensor
// sweep of every hull that exists).
function FleetManager() {
  const allShips = useShipStore((s) => s.ships)
  const fleets = useFleetStore((s) => s.fleets)
  const ships = useMemo(() => allShips.filter((ship) => ship.allegiance === 'player'), [allShips])
  const selectShip = useShipStore((s) => s.selectShip)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const engagements = useCombatStore((s) => s.engagements)
  const simDays = useGameTimeStore((s) => s.simDays)

  if (ships.length === 0) {
    return <div className="nav-placeholder">No ships in service.</div>
  }

  const engagedIds = new Set(engagements.flatMap((e) => e.participants.map((p) => p.shipId)))

  const groups = new Map<string, ShipInstance[]>()
  for (const ship of ships) {
    const arr = groups.get(ship.fleetId) ?? []
    arr.push(ship)
    groups.set(ship.fleetId, arr)
  }

  return (
    <div className="fleet-list">
      {Array.from(groups.entries()).map(([fleetId, members]) => (
        <div key={fleetId} className="fleet-group">
          {/* A solo fleet's own name would just repeat its one ship's name
              right below it — the header only earns its place once there's
              actually more than one hull to introduce. */}
          {members.length > 1 && (
            <div className="fleet-group-header">
              {fleets.find((f) => f.id === fleetId)?.name ?? 'Fleet'} · {members.length} ships
            </div>
          )}
          {members.map((ship) => {
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
      ))}
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
          <span className="combat-roster-pct">{totalHitPoints(c.combat)}</span>
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

// --- Strategizer ----------------------------------------------------------

// Standing auto-combat doctrine, per ship. Set here rather than only inside
// a fight because that's the point of a doctrine — you decide how a hull
// fights before it's shooting, and the setting carries from one engagement
// to the next (see ShipInstance.stance).
//
// Only player-owned ships are listed: these are orders, and the same
// ownership rule that gates move orders gates these.
// One ship's own row — its individually-selectable stances, plus 'Fleet'
// tacked on ONLY while its fleet actually has a coordinated strategy
// running (see CombatStance's own comment on why 'fleet' is never just a
// free-standing option). Picking anything else here is what makes an
// individual choice override the fleet-wide order — there's no separate
// "detached" flag, the ship's own stance no longer being 'fleet' IS the
// override.
function ShipStrategyRow({
  ship,
  fleet,
  selectedShipId,
  selectShip,
  setStance,
}: {
  ship: ShipInstance
  fleet: Fleet | undefined
  selectedShipId: string | null
  selectShip: (id: string | null) => void
  setStance: (id: string, stance: (typeof COMBAT_STANCES)[number] | 'fleet') => void
}) {
  const shipClass = SHIP_CLASSES.find((c) => c.id === ship.classId)
  const stanceOptions = fleet?.strategy != null ? [...COMBAT_STANCES, 'fleet' as const] : COMBAT_STANCES
  return (
    <div className={`fleet-row${ship.id === selectedShipId ? ' selected' : ''}`}>
      <div className="fleet-row-head">
        <button type="button" className="strategizer-name" onClick={() => selectShip(ship.id)}>
          {ship.name}
        </button>
        <span className="fleet-row-class">{shipClass?.name ?? 'Unknown'}</span>
      </div>
      <div className="combat-density-row">
        {stanceOptions.map((stance) => (
          <button
            key={stance}
            type="button"
            className={`combat-density-btn${ship.stance === stance ? ' active' : ''}`}
            onClick={() => setStance(ship.id, stance)}
            title={STANCE_DESCRIPTIONS[stance]}
          >
            {STANCE_LABELS[stance]}
          </button>
        ))}
      </div>
      <div className="fleet-row-status">
        {ship.stance === 'fleet' && fleet?.strategy
          ? `Following ${fleet.name}: ${FLEET_STRATEGY_DESCRIPTIONS[fleet.strategy]}`
          : STANCE_DESCRIPTIONS[ship.stance]}
      </div>
    </div>
  )
}

function Strategizer() {
  const ships = useShipStore((s) => s.ships)
  const setStance = useShipStore((s) => s.setStance)
  const setFleetStrategy = useShipStore((s) => s.setFleetStrategy)
  const selectShip = useShipStore((s) => s.selectShip)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const fleets = useFleetStore((s) => s.fleets)

  const owned = ships.filter((s) => s.allegiance === 'player')
  if (owned.length === 0) {
    return <div className="nav-placeholder">No ships under your command.</div>
  }

  const groups = new Map<string, ShipInstance[]>()
  for (const ship of owned) {
    const arr = groups.get(ship.fleetId) ?? []
    arr.push(ship)
    groups.set(ship.fleetId, arr)
  }

  return (
    <div className="fleet-list">
      <div className="ship-panel-hint strategizer-intro">
        Auto-combat doctrine. Applies whenever a ship isn't under a manual move order — issuing one in the combat view
        overrides it until you resume auto.
      </div>
      {Array.from(groups.entries()).map(([fleetId, members]) => {
        const fleet = fleets.find((f) => f.id === fleetId)
        return (
          <div key={fleetId} className="fleet-group">
            {/* A solo hull has nothing to coordinate — Divide/Condense/
                Screen only mean anything for a group, and a fleet-wide
                Balanced/Swarm/etc. on one ship is just that ship's own
                stance with extra steps. The whole fleet-wide control only
                earns its place once there's actually more than one hull. */}
            {members.length > 1 && (
              <>
                <div className="fleet-group-header">
                  {fleet?.name ?? 'Fleet'} · {members.length} ships
                </div>
                <div className="strategizer-fleet-strategy">
                  <div className="combat-density-row">
                    {FLEET_STRATEGIES.map((strategy) => (
                      <button
                        key={strategy}
                        type="button"
                        className={`combat-density-btn${fleet?.strategy === strategy ? ' active' : ''}`}
                        onClick={() => setFleetStrategy(fleetId, fleet?.strategy === strategy ? null : strategy)}
                        title={FLEET_STRATEGY_DESCRIPTIONS[strategy]}
                      >
                        {FLEET_STRATEGY_LABELS[strategy]}
                      </button>
                    ))}
                  </div>
                  <div className="fleet-row-status">
                    {fleet?.strategy
                      ? FLEET_STRATEGY_DESCRIPTIONS[fleet.strategy]
                      : 'No fleet-wide strategy active — every ship below follows its own choice. Click a strategy above to set it for the whole fleet.'}
                  </div>
                  <div className="strategizer-disclaimer">
                    Setting a fleet-wide strategy puts every ship below on Fleet. Changing one ship's own strategy overrides
                    it for that ship only — the rest of the fleet keeps coordinating.
                  </div>
                </div>
              </>
            )}
            {members.map((ship) => (
              <ShipStrategyRow
                key={ship.id}
                ship={ship}
                fleet={fleet}
                selectedShipId={selectedShipId}
                selectShip={selectShip}
                setStance={setStance}
              />
            ))}
          </div>
        )
      })}
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
      {tab === 'strategizer' && <Strategizer />}
    </div>
  )
}
