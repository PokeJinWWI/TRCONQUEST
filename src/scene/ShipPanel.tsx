import { useShipStore } from '../state/shipStore'
import { ALLEGIANCE_LABELS, SHIP_CLASSES, describeFtlDrive, type HyperDrive } from '../data/shipData'
import {
  COMPONENT_KINDS,
  COMPONENT_LABELS,
  DAMAGE_TYPE_LABELS,
  type CombatProfile,
} from '../data/combatData'
import {
  getShipStatusText,
  hyperdriveCooldownRemainingDays,
  warpCooldownRemainingDays,
  hyperdriveLossChance,
  warpEscapeLossChance,
  coreHealthFraction,
} from './shipPhysics'
import { activeEnemyContacts, overallHealthFraction } from './combatResolution'
import { useCombatStore } from '../state/combatStore'
import { useViewStore } from '../state/viewStore'
import { simDaysToSeconds, useGameTimeStore } from '../state/gameTimeStore'
import { DraggableWindow } from '../components/DraggableWindow'

function formatCooldown(label: string, remainingDays: number): string {
  return remainingDays > 0 ? `${label} ${remainingDays.toFixed(1)}d` : `${label} Ready`
}

function formatPercent(chance: number): string {
  return `${Math.round(chance * 100)}%`
}

// A labelled bar. `tone` drives the color band so the three component bars
// read as one family, distinct from the two consumable defense pools above
// them — shields and armor are buffers that come and go, components are the
// ship itself.
function HealthBar({
  label,
  value,
  max,
  tone,
}: {
  label: string
  value: number
  max: number
  tone: 'overall' | 'component' | 'shield' | 'armor'
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="health-bar-row">
      <span className="health-bar-label">{label}</span>
      <span className={`health-bar-track tone-${tone}`}>
        <span className="health-bar-fill" style={{ width: `${fraction * 100}%` }} />
      </span>
      <span className="health-bar-value">
        {Math.ceil(Math.max(0, value))}/{Math.round(max)}
      </span>
    </div>
  )
}

// Groups a hull's mounts by archetype so a Cruiser reads "2x Laser · 2x Mass
// Driver · 1x Heavy Beam" rather than listing five near-identical lines.
function summarizeWeapons(profile: CombatProfile): string {
  const counts = new Map<string, { name: string; type: string; count: number }>()
  for (const weapon of profile.weapons) {
    const entry = counts.get(weapon.id)
    if (entry) entry.count++
    else counts.set(weapon.id, { name: weapon.name, type: DAMAGE_TYPE_LABELS[weapon.damageType], count: 1 })
  }
  return [...counts.values()].map((w) => `${w.count}x ${w.name}`).join(' · ')
}

interface ShipPanelProps {
  /** Present only when the selected ship is actually trackable in the
   * current scene (see each scene's own `trackedShip`) — flies the camera
   * to it, independent of the lockOnEnabled toggle (which only governs
   * *continuous* follow). Omitted entirely — no button rendered — when
   * there's nowhere for "Go To" to send the camera, e.g. the ship is
   * selected but actually elsewhere (a different system, still travelling
   * through a view that doesn't render it). */
  onGoTo?: () => void
  goToPending?: boolean
  /** Starting position offset — used by the combat view, which shows this
   * alongside its own order panel and would otherwise stack the two exactly
   * on top of each other. */
  initialOffset?: { x: number; y: number }
}

// The selected ship's info window — subscribes to simDays directly (same
// pattern TimeControls already uses) so the "Current Action" line stays live
// while travelling, not just at the moment it was opened. Selecting a ship
// is always allowed regardless of allegiance (see shipStore.selectShip), so
// this doubles as a read-only intel view for enemy/neutral/friendly fleets —
// the right-click-to-redirect hint only applies to a ship the player
// actually owns; planMove refuses to plan a move for any other ship anyway.
export function ShipPanel({ onGoTo, goToPending, initialOffset }: ShipPanelProps) {
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const ship = useShipStore((s) => s.ships.find((sh) => sh.id === s.selectedShipId))
  const ships = useShipStore((s) => s.ships)
  const selectShip = useShipStore((s) => s.selectShip)
  const setWarpEnabled = useShipStore((s) => s.setWarpEnabled)
  const setWarpWhenReady = useShipStore((s) => s.setWarpWhenReady)
  const setFollowing = useShipStore((s) => s.setFollowing)
  const engagements = useCombatStore((s) => s.engagements)
  const enterCombat = useViewStore((s) => s.enterCombat)
  const level = useViewStore((s) => s.level)
  const simDays = useGameTimeStore((s) => s.simDays)

  if (!selectedShipId || !ship) return null

  const shipClass = SHIP_CLASSES.find((c) => c.id === ship.classId)
  const statusText = getShipStatusText(ship, simDays, ships)
  const owned = ship.allegiance === 'player'
  const hyperDrive = shipClass?.ftlDrives.find((d): d is HyperDrive => d.kind === 'hyperdrive')
  const hasHyperdrive = !!hyperDrive
  const hasWarp = shipClass?.ftlDrives.some((d) => d.kind === 'warp') ?? false
  const cooldownParts = [
    hasHyperdrive ? formatCooldown('Hyperdrive', hyperdriveCooldownRemainingDays(ship, simDays)) : null,
    hasWarp ? formatCooldown('Warp', warpCooldownRemainingDays(ship, simDays)) : null,
  ].filter((part): part is string => part !== null)
  const followedShip = ship.followingShipId ? ships.find((s) => s.id === ship.followingShipId) : undefined

  const combatProfile = shipClass?.combat
  const engagement = engagements.find((e) => e.participants.some((p) => p.shipId === ship.id))
  const participant = engagement?.participants.find((p) => p.shipId === ship.id)
  // "In combat" (part of an Engagement — the row below) and "actively
  // engaged" (has a live target right now) are different questions: a fleet
  // fight can easily include ships sitting outside anyone's range or blocked
  // by a body, present in the battle but not actually fighting anyone. This
  // is the narrower, live-contact count, and it's also exactly what should
  // (and shouldn't) move FTL risk — see the Jump/Warp Risk rows below.
  const activeContacts = engagement && participant ? activeEnemyContacts(participant, engagement, ships, simDays) : []
  const activelyEngaged = activeContacts.length > 0
  const coreFraction = shipClass ? coreHealthFraction(ship, shipClass) : 1
  const riskElevated = activelyEngaged || coreFraction < 1
  // Two figures rather than one live number — there's no "selected
  // destination" context in this panel to know whether a specific jump
  // would land on an already-charted lane, so this shows both of the
  // drive's own fixed rates (see hyperdriveLossChance) as ship-level info,
  // same spirit as the Cooldowns row above. Collapses to a single number
  // when both rates are equal (e.g. a Turing Scout's 0% override, which
  // ignores lane state entirely). Both figures already fold in the current
  // core-damage and active-engagement modifiers, so what's shown here is
  // exactly what a jump attempted right now would actually roll against.
  const jumpRiskNew = hyperDrive ? hyperdriveLossChance(hyperDrive, false, coreFraction, activelyEngaged) : undefined
  const jumpRiskLane = hyperDrive ? hyperdriveLossChance(hyperDrive, true, coreFraction, activelyEngaged) : undefined
  // Warp has no risk at all for an ordinary trip — see warpEscapeLossChance —
  // so this only ever comes back nonzero while there's something to show:
  // combat damage or an active fight. A permanent "Warp Risk: 0%" row on
  // every peaceful warp-capable ship would just be noise.
  const warpRisk = hasWarp ? warpEscapeLossChance(coreFraction, activelyEngaged) : undefined

  const charge = ship.combat.ftlCharge
  // Counted down in *seconds*, not days — a 5-second hyperdrive spool is the
  // one deadline in this game short enough that a "0.0d" readout would be
  // useless.
  const chargeSecondsLeft = charge ? Math.max(0, simDaysToSeconds(charge.readySimDays - simDays)) : 0

  return (
    <DraggableWindow title={ship.name} onClose={() => selectShip(null)} initialOffset={initialOffset}>
      <div className="inspect-row">
        <span className="inspect-label">Class</span>
        <span className="inspect-value">{shipClass?.name ?? 'Unknown'}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Allegiance</span>
        <span className="inspect-value">{ALLEGIANCE_LABELS[ship.allegiance]}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Drives</span>
        <span className="inspect-value">
          Reaction{shipClass ? `, ${shipClass.ftlDrives.map(describeFtlDrive).join(', ')}` : ''}
        </span>
      </div>
      {cooldownParts.length > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Cooldowns</span>
          <span className="inspect-value">{cooldownParts.join(' · ')}</span>
        </div>
      )}
      {jumpRiskNew !== undefined && jumpRiskLane !== undefined && (
        <div className="inspect-row">
          <span className="inspect-label">Jump Risk</span>
          <span className="inspect-value">
            {jumpRiskNew === jumpRiskLane
              ? formatPercent(jumpRiskNew)
              : `${formatPercent(jumpRiskNew)} new · ${formatPercent(jumpRiskLane)} charted`}
            {riskElevated && <span className="ship-panel-combat"> (elevated)</span>}
          </span>
        </div>
      )}
      {/* Warp itself has no baseline risk for an ordinary trip — this only
          ever appears once there's actually something raising it (core
          damage, or fleeing a live fight), which is also why it's absent
          from every peaceful ship's panel. */}
      {warpRisk !== undefined && warpRisk > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Warp Risk</span>
          <span className="inspect-value ship-panel-combat">{formatPercent(warpRisk)} (elevated)</span>
        </div>
      )}
      {hasWarp && owned && (
        <>
          <label className="ship-panel-checkbox-row">
            <input
              type="checkbox"
              checked={ship.warpEnabled}
              onChange={(e) => setWarpEnabled(ship.id, e.target.checked)}
            />
            Use Warp Drive
          </label>
          <label className="ship-panel-checkbox-row">
            <input
              type="checkbox"
              checked={ship.warpWhenReady}
              onChange={(e) => setWarpWhenReady(ship.id, e.target.checked)}
            />
            Warp When Ready
          </label>
        </>
      )}
      {ship.followingShipId && (
        <div className="inspect-row">
          <span className="inspect-label">Following</span>
          <span className="inspect-value">
            {followedShip?.name ?? 'Unknown fleet'}
            {owned && (
              <button type="button" className="ship-panel-unfollow-btn" onClick={() => setFollowing(ship.id, null)}>
                Stop
              </button>
            )}
          </span>
        </div>
      )}
      {combatProfile && (
        <>
          <div className="inspect-divider" />
          {/* Overall first, as the at-a-glance readout, then the two
              consumable defense pools, then the three components it actually
              summarizes — see OVERALL_COMPONENT_WEIGHTS for why shields and
              armor are excluded from the blend. */}
          <HealthBar
            label="Integrity"
            value={overallHealthFraction(ship.combat, combatProfile) * 100}
            max={100}
            tone="overall"
          />
          {combatProfile.defenses.shieldHp > 0 && (
            <HealthBar label="Shields" value={ship.combat.shieldHp} max={combatProfile.defenses.shieldHp} tone="shield" />
          )}
          {combatProfile.defenses.armorHp > 0 && (
            <HealthBar label="Armor" value={ship.combat.armorHp} max={combatProfile.defenses.armorHp} tone="armor" />
          )}
          {COMPONENT_KINDS.map((kind) => (
            <HealthBar
              key={kind}
              label={COMPONENT_LABELS[kind]}
              value={ship.combat.componentHp[kind]}
              max={combatProfile.components[kind]}
              tone="component"
            />
          ))}
          <div className="inspect-row">
            <span className="inspect-label">Armament</span>
            <span className="inspect-value">
              {combatProfile.weapons.length > 0 ? summarizeWeapons(combatProfile) : 'Unarmed'}
            </span>
          </div>
          {combatProfile.defenses.pointDefenseRating > 0 && (
            <div className="inspect-row">
              <span className="inspect-label">Point Defense</span>
              <span className="inspect-value">{formatPercent(combatProfile.defenses.pointDefenseRating)} intercept</span>
            </div>
          )}
        </>
      )}
      {engagement && (
        <>
          <div className="inspect-row">
            <span className="inspect-label">Engagement</span>
            <span className="inspect-value ship-panel-combat">
              In combat at {engagement.locationLabel}
              {/* The way into the arena. Offered rather than forced — the
                  clock already switches itself to tactical when a fight
                  starts, and yanking the player's camera somewhere else on
                  top of that would be one automatic disruption too many.
                  Hidden when already in the combat view, where it would be a
                  no-op. */}
              {level !== 'combat' && (
                <button type="button" className="ship-panel-unfollow-btn" onClick={() => enterCombat(engagement.id)}>
                  Enter Combat
                </button>
              )}
            </span>
          </div>
          {/* Distinct from the row above on purpose — a ship can be "in
              combat" (present in this Engagement) without being "actively
              engaged" (in range and line of fire of anyone). This is the
              narrower, live-contact count, and works for a selected enemy
              ship too, not just an owned one. */}
          <div className="inspect-row">
            <span className="inspect-label">Engaged Against</span>
            <span className="inspect-value">
              {activelyEngaged
                ? `${activeContacts.length} enemy ship${activeContacts.length === 1 ? '' : 's'}`
                : 'None in range'}
            </span>
          </div>
        </>
      )}
      {charge && (
        <div className="inspect-row">
          <span className="inspect-label">FTL Charge</span>
          <span className="inspect-value ship-panel-combat">
            {charge.kind === 'hyperdrive' ? 'Hyperdrive' : 'Warp'} spooling — {chargeSecondsLeft.toFixed(1)}s (weapons offline)
          </span>
        </div>
      )}
      <div className="inspect-divider" />
      <div className="inspect-row">
        <span className="inspect-label">Current Action</span>
      </div>
      <div className="ship-panel-status">{statusText}</div>
      {onGoTo && (
        <button type="button" className="detail-view-btn" onClick={onGoTo} disabled={goToPending}>
          {goToPending ? 'Going to…' : 'Go To'}
        </button>
      )}
      {owned ? (
        ship.order && <div className="ship-panel-hint">Right-click a new destination to redirect.</div>
      ) : (
        <div className="ship-panel-hint">Not under your command.</div>
      )}
    </DraggableWindow>
  )
}
