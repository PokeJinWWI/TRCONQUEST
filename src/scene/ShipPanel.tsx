import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { useEffect, useMemo, useState } from 'react'
import { destinationLabel } from './shipPhysics'
import { replanForWarpWhenReady } from './warpReplan'
import { ShipSurveySection } from './ShipSurveySection'
import { ShipAutomationToggle } from './ShipAutomationToggle'
import { ShipCargoSection } from './ShipCargoSection'
import { anyCivilian, mergeCheck } from './fleetRules'
import { startFleetMerge } from './fleetMerge'
import { viewShip } from './shipNav'
import { useShipStore } from '../state/shipStore'
import { RELATION_COLORS, RELATION_LABELS, describeFtlDrive, JUMP_RISK_MAX_FACTOR, JUMP_RISK_MIN_FACTOR, type HyperDrive } from '../data/shipData'
import { ownerDisplay } from '../data/countryRoster'
import { isPlayerOwned, shipsHostile, useRelationFn, useRelationTo } from '../state/shipRelations'
import { resolveShipClass } from '../state/shipClassResolver'
import {
  COMBAT_STANCES,
  STANCE_LABELS,
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
import { activeEnemyContacts, overallHealthFraction, createSoloEngagement, rangeFavor } from './combatResolution'
import { engagementIntel, playerCommsDelayToShip, queueStance, shipsIntel, unknownShipsMessage } from './commsVisual'
import { useCombatStore, combatLocationKey, engagementIsContested } from '../state/combatStore'
import { useFleetStore } from '../state/fleetStore'
import { useViewStore } from '../state/viewStore'
import { simDaysToSeconds } from '../state/gameTimeStore'
import { DraggableWindow } from '../components/DraggableWindow'
import { TransportCargo } from '../components/ArmyViews'
import { ShipColonySection, ShipPatrolToggle } from './ShipColonySection'

function formatCooldown(label: string, remainingDays: number): string {
  return remainingDays > 0 ? `${label} ${remainingDays.toFixed(1)}d` : `${label} Ready`
}

function formatPercent(chance: number): string {
  return `${Math.round(chance * 100)}%`
}

// Comms delay spans a huge range depending on tier/distance — a few hours
// in-system on light speed up to several years crossing to another star —
// so this picks whichever unit actually reads as a number, rather than
// showing "0.0d" for anything under a day or "1500.3d" for anything over a
// year.
function formatCommsDelay(days: number): string {
  if (days >= 365.25) return `${(days / 365.25).toFixed(1)}y`
  if (days >= 1) return `${days.toFixed(1)}d`
  return `${(days * 24).toFixed(1)}h`
}

// A labeled bar. `tone` drives the color band so the three component bars
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
   * selected but actually elsewhere (a different system, still traveling
   * through a view that doesn't render it). */
  onGoTo?: () => void
  goToPending?: boolean
  /** Starting position offset — used by the combat view, which shows this
   * alongside its own order panel and would otherwise stack the two exactly
   * on top of each other. */
  initialOffset?: { x: number; y: number }
  /** Pins the window to a screen edge — the combat view passes 'right' so
   * this sits opposite the engagement roster instead of over the arena. See
   * DraggableWindow's own `anchor` prop. */
  anchor?: 'left' | 'right'
}

// The selected ship's info window — subscribes to simDays directly (same
// pattern TimeControls already uses) so the "Current Action" line stays live
// while traveling, not just at the moment it was opened. Selecting a ship
// is always allowed regardless of owner (see shipStore.selectShip), so
// this doubles as a read-only intel view for other nations' fleets —
// the right-click-to-redirect hint only applies to a ship the player
// actually owns; planMove refuses to plan a move for any other ship anyway.
export function ShipPanel(props: ShipPanelProps) {
  const multi = useShipStore((s) => s.selectedShipIds.length > 1)
  return multi ? <SelectionGroupPanel {...props} /> : <SingleShipPanel {...props} />
}

// Several ships selected (Shift/Ctrl/Cmd-click): what's selected, grouped by
// fleet, with the fleet's pace and the orders that apply to all of them at
// once. Right-clicking on the map moves every selected fleet; in the arena,
// every selected ship. Click a row to go back to one ship.
function SelectionGroupPanel({ initialOffset, anchor }: ShipPanelProps) {
  const idsKey = useShipStore((s) => s.selectedShipIds.join('|'))
  const ships = useShipStore((s) => s.ships)
  const selectShip = useShipStore((s) => s.selectShip)
  const fleets = useFleetStore((s) => s.fleets)
  const relationOf = useRelationFn()
  const selected = useMemo(() => {
    const ids = new Set(idsKey.split('|'))
    return ships.filter((s) => ids.has(s.id))
  }, [idsKey, ships])
  // In selection order: the first fleet picked is the one "on top" — the lead a
  // merge gathers the others onto.
  const byFleet = useMemo(() => {
    const order = idsKey.split('|')
    const groups = new Map<string, typeof selected>()
    for (const s of [...selected].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))) groups.set(s.fleetId, [...(groups.get(s.fleetId) ?? []), s])
    return [...groups.entries()]
  }, [selected, idsKey])
  const mine = selected.filter((s) => isPlayerOwned(s))
  const selectShips = useShipStore((s) => s.selectShips)
  // Merging works on whole fleets (a marker or list row selects a fleet by its
  // lead ship): every fleet with a selected ship heads for the fleet on top and
  // joins it; the fleet on top carries on with whatever it is doing.
  const selectedFleetIds = byFleet.map(([fleetId]) => fleetId)
  const merge = mergeCheck(
    selectedFleetIds.map((id) => ships.filter((s) => s.fleetId === id)),
    (s) => isPlayerOwned(s),
  )
  const handleMerge = () => {
    if (!merge.ok) return
    const [lead, ...rest] = selectedFleetIds
    startFleetMerge(lead, rest)
  }
  // Puts a fleet's ships first in the selection, making it the one on top.
  const makeLead = (fleetId: string) => {
    const first = ships.filter((s) => s.fleetId === fleetId && idsKey.split('|').includes(s.id)).map((s) => s.id)
    selectShips([...first, ...idsKey.split('|').filter((id) => !first.includes(id))])
  }

  return (
    <DraggableWindow title={`${selected.length} ships selected`} memoryKey="ships" onClose={() => selectShip(null)} initialOffset={initialOffset} anchor={anchor}>
      {byFleet.map(([fleetId, members]) => {
        const fleetMembers = ships.filter((s) => s.fleetId === fleetId)
        const relation = relationOf(members[0].ownerId)
        return (
          <div key={fleetId} className="army-group">
            <div className="army-group-label" style={{ color: RELATION_COLORS[relation] }}>
              {fleets.find((f) => f.id === fleetId)?.name ?? 'Fleet'} · {ownerDisplay(members[0].ownerId).name}
              {byFleet.length > 1 && byFleet[0][0] === fleetId && <span className="fleet-lead-tag" title="A merge gathers the other fleets onto this one; it keeps doing what it is doing"> · on top</span>}
              {byFleet.length > 1 && byFleet[0][0] !== fleetId && (
                <button type="button" className="ship-panel-unfollow-btn" onClick={() => makeLead(fleetId)} title="Put this fleet on top: the others merge onto it">
                  Make top
                </button>
              )}
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Moves at</span>
              <span className="inspect-value">{fleetPaceLabel(fleetMembers)}</span>
            </div>
            {members.map((m) => (
              <button key={m.id} type="button" className="combat-roster-row" onClick={() => selectShip(m.id)}>
                <span className="combat-roster-name">{m.name}</span>
                <span className="combat-roster-pct">{resolveShipClass(m.classId)?.name}</span>
              </button>
            ))}
          </div>
        )
      })}
      {mine.length > 0 && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-row">
            <span className="inspect-label">Stance (all yours)</span>
          </div>
          <div className="dip-actions">
            {COMBAT_STANCES.map((stance) => (
              <button key={stance} type="button" className="detail-view-btn" onClick={() => mine.forEach((s) => queueStance(s, stance))}>
                {STANCE_LABELS[stance]}
              </button>
            ))}
          </div>
          {byFleet.length > 1 && (
            <>
              <div className="dip-actions">
                <button type="button" className="detail-view-btn" disabled={!merge.ok} onClick={handleMerge} title={merge.ok ? 'The other fleets fly to the fleet on top and join it; it keeps doing what it is doing' : merge.reason}>
                  Merge onto the top fleet
                </button>
              </div>
              {!merge.ok && <div className="ship-panel-hint">{merge.reason}.</div>}
            </>
          )}
          <div className="ship-panel-hint">Right-click a destination to move every selected fleet, each at its slowest ship's pace.</div>
        </>
      )}
    </DraggableWindow>
  )
}

// A fleet travels at its slowest member's pace: its slowest FTL (a hull with
// no warp holds warp ships to reaction speed in-system), shown as a label.
function fleetPaceLabel(members: { classId: string }[]): string {
  const warps = members.map((m) => resolveShipClass(m.classId)?.ftlDrives.find((d) => d.kind === 'warp'))
  const hypers = members.map((m) => resolveShipClass(m.classId)?.ftlDrives.some((d) => d.kind === 'hyperdrive') ?? false)
  const allWarp = warps.every((w) => !!w)
  if (allWarp) return `Warp ${Math.min(...warps.map((w) => (w && w.kind === 'warp' ? w.speedC : 0)))}c`
  if (hypers.every(Boolean)) return 'Hyperdrive jumps (in-system: reaction drive)'
  return 'Reaction drive (mixed drives; jump ships wait for the fleet)'
}

function SingleShipPanel({ onGoTo, goToPending, initialOffset, anchor }: ShipPanelProps) {
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const ship = useShipStore((s) => s.ships.find((sh) => sh.id === s.selectedShipId))
  const ships = useShipStore((s) => s.ships)
  const selectShip = useShipStore((s) => s.selectShip)
  const setWarpEnabled = useShipStore((s) => s.setWarpEnabled)
  const setWarpWhenReady = useShipStore((s) => s.setWarpWhenReady)
  const setFollowing = useShipStore((s) => s.setFollowing)
  const mergeFleets = useShipStore((s) => s.mergeFleets)
  const splitFleet = useShipStore((s) => s.splitFleet)
  const fleets = useFleetStore((s) => s.fleets)
  const engagements = useCombatStore((s) => s.engagements)
  const addEngagement = useCombatStore((s) => s.addEngagement)
  const enterCombat = useViewStore((s) => s.enterCombat)
  const level = useViewStore((s) => s.level)
  const simDays = useThrottledSimDays()
  // Which roster members are checked for a Split Off — see the Fleet row
  // below. Reset whenever the selection changes fleets, so a stale check
  // from one fleet's roster can't silently apply to a different one.
  const [splitPicks, setSplitPicks] = useState<Set<string>>(new Set())
  useEffect(() => setSplitPicks(new Set()), [ship?.fleetId])
  // How the player relates to this ship's nation — before the early return,
  // since hooks can't be called conditionally.
  const relation = useRelationTo(ship?.ownerId ?? '')

  if (!selectedShipId || !ship) return null

  const shipClass = resolveShipClass(ship.classId)
  // Comms-delay-aware display (see commsVisual.ts) — ONLY for the
  // informational readouts below (status text, the health bars): a ship
  // that's actually part of a contested fight is already being watched
  // live in the arena (engagementIsContested, computed just below), so it
  // never gets the stale treatment regardless of comms tier. Deliberately
  // NOT applied to anything below that feeds an actual decision (jump/warp
  // risk, merge/split eligibility, cooldowns) — those numbers are exactly
  // what a real order will be evaluated against once it actually arrives
  // (see commsVisual.ts's queueMoveOrder/applyMoveDestination, which always
  // recomputes fresh at arrival time), so showing stale versions of THOSE
  // would mislead a player's own click rather than model anything real.
  // A fight the player hasn't heard about yet (its news is still travelling —
  // commsVisual.engagementKnownToPlayer) isn't shown, and can't be entered.
  const rawEngagement = engagements.find((e) => e.participants.some((p) => p.shipId === ship.id))
  // What the player knows of the ships here: the fight is entered only when
  // every ship present is known (commsVisual.shipsIntel); until then the
  // button says why instead of hiding or throwing them out.
  const hereKey = combatLocationKey(ship.location)
  const presentIntel = rawEngagement
    ? engagementIntel(rawEngagement, ships, simDays)
    : shipsIntel(hereKey ? ships.filter((s) => !s.order && combatLocationKey(s.location) === hereKey) : [ship], simDays)
  const engagementForDisplay = rawEngagement && presentIntel.aware ? rawEngagement : undefined
  const contestedForDisplay =
    !!engagementForDisplay && engagementIsContested(engagementForDisplay, (id) => ships.some((s) => s.id === id))
  const displayDelayDays = contestedForDisplay ? 0 : playerCommsDelayToShip(ship, simDays)
  // What the panel shows is live: signal delay never staggers the readouts, it
  // only delays orders and reports (the Signal Delay row below says how long).
  const displayCombat = ship.combat
  const statusText = getShipStatusText(ship, simDays, ships)
  const owned = isPlayerOwned(ship)
  const hyperDrive = shipClass?.ftlDrives.find((d): d is HyperDrive => d.kind === 'hyperdrive')
  const hasHyperdrive = !!hyperDrive
  const hasWarp = shipClass?.ftlDrives.some((d) => d.kind === 'warp') ?? false
  const cooldownParts = [
    hasHyperdrive ? formatCooldown('Hyperdrive', hyperdriveCooldownRemainingDays(ship, simDays)) : null,
    hasWarp ? formatCooldown('Warp', warpCooldownRemainingDays(ship, simDays)) : null,
  ].filter((part): part is string => part !== null)
  const followedShip = ship.followingShipId ? ships.find((s) => s.id === ship.followingShipId) : undefined

  const combatProfile = shipClass?.combat
  // Same engagement/contested check already computed above for the display
  // lens — reused here rather than recomputed, they're the same question.
  const engagement = engagementForDisplay
  const engagementContested = contestedForDisplay
  // The "no fight" Arena button and the real Engagement row are mutually
  // exclusive, but the resolver's own tick (which turns a hostile encounter
  // into an actual Engagement) can lag a frame behind a ship just having
  // arrived or spawned. Checking for a hostile here directly — the same
  // same-location + at-war test the resolver itself uses — means the
  // button reads "Enter Combat" the instant that's true, rather than only
  // once syncEngagements has caught up.
  const locationKey = combatLocationKey(ship.location)
  const hostilePresent =
    !engagement &&
    locationKey !== null &&
    ships.some((s) => s.id !== ship.id && combatLocationKey(s.location) === locationKey && shipsHostile(ship, s))
  // Every other hull sharing this ship's fleet — see ShipInstance.fleetId.
  // Shown whenever there's more than just this ship, so the roster is
  // reachable from any member, not only whichever one happens to be "lead"
  // on the marker.
  const fleet = fleets.find((f) => f.id === ship.fleetId)
  const fleetMates = ships.filter((s) => s.fleetId === ship.fleetId)
  // A same-nation fleet already resting at this exact spot — the thing
  // Merge Fleets combines this one with. Requires this ship to itself be at
  // rest (mid-order, there's no stable "here" to compare against) and uses
  // the same combatLocationKey test as every other co-location check in this
  // project (spawning, arrival auto-join, the arena's own contested check).
  // Civilian hulls never join a fleet, so neither side of a merge may hold one.
  const mergeableFleetId =
    !ship.order && locationKey !== null && !anyCivilian(fleetMates)
      ? ships.find(
          (s) =>
            s.fleetId !== ship.fleetId &&
            s.ownerId === ship.ownerId &&
            !s.order &&
            combatLocationKey(s.location) === locationKey &&
            !anyCivilian(ships.filter((m) => m.fleetId === s.fleetId)),
        )?.fleetId
      : undefined
  const participant = engagement?.participants.find((p) => p.shipId === ship.id)
  // "In combat" (part of an Engagement — the row below) and "actively
  // engaged" (has a live target right now) are different questions: a fleet
  // fight can easily include ships sitting outside anyone's range or blocked
  // by a body, present in the battle but not actually fighting anyone. This
  // is the narrower, live-contact count, and it's also exactly what should
  // (and shouldn't) move FTL risk — see the Jump/Warp Risk rows below.
  const activeContacts = engagement && participant ? activeEnemyContacts(participant, engagement, ships, simDays) : []
  const activelyEngaged = activeContacts.length > 0
  // Whether THIS ship is coming out ahead on range right now, not just how
  // many contacts it has — see combatResolution.rangeFavor, the same
  // per-pair question CombatEngagementLine's line colors answer, rolled up
  // into one read here. Works the same for an enemy ship you're inspecting
  // as for your own — "favored" always means the ship this panel is showing.
  const favor = engagement && participant ? rangeFavor(participant, engagement, ships, simDays) : 'even'
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
    <DraggableWindow title={ship.name} memoryKey="ship" onClose={() => selectShip(null)} initialOffset={initialOffset} anchor={anchor}>
      {/* Only shown once there's an actual fleet to talk about — a solo
          hull's own name already says everything this row would. */}
      {fleetMates.length > 1 && (
        <div className="inspect-row">
          <span className="inspect-label">Fleet</span>
          <span className="inspect-value">
            {fleet?.name ?? 'Fleet'} ({fleetMates.length})
            <div className="ship-panel-fleet-roster">
              {fleetMates.map((mate) => (
                <span key={mate.id} className="ship-panel-fleet-mate-row">
                  {/* Splitting is a player action — a hostile/neutral fleet's
                      roster is still browsable (selectShip below), just not
                      reorganizable. */}
                  {owned && (
                    <input
                      type="checkbox"
                      checked={splitPicks.has(mate.id)}
                      onChange={(e) =>
                        setSplitPicks((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(mate.id)
                          else next.delete(mate.id)
                          return next
                        })
                      }
                      aria-label={`Select ${mate.name} to split off`}
                    />
                  )}
                  <button
                    type="button"
                    className={`ship-panel-fleet-mate${mate.id === ship.id ? ' active' : ''}`}
                    onClick={() => selectShip(mate.id)}
                  >
                    {mate.name}
                  </button>
                </span>
              ))}
            </div>
            {owned && (
              <button
                type="button"
                className="ship-panel-unfollow-btn"
                onClick={() => {
                  const ids = splitPicks.size > 0 ? Array.from(splitPicks) : [ship.id]
                  splitFleet(ids)
                  setSplitPicks(new Set())
                }}
              >
                {splitPicks.size > 0 ? `Split Off (${splitPicks.size})` : 'Split Off This Ship'}
              </button>
            )}
          </span>
        </div>
      )}
      {owned && mergeableFleetId && (
        <div className="inspect-row">
          <span className="inspect-label">Nearby</span>
          <span className="inspect-value">
            Another fleet is here
            <button type="button" className="ship-panel-unfollow-btn" onClick={() => mergeFleets(ship.fleetId, mergeableFleetId)}>
              Merge Fleets
            </button>
          </span>
        </div>
      )}
      <div className="inspect-row">
        <span className="inspect-label">Class</span>
        <span className="inspect-value">{shipClass?.name ?? 'Unknown'}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Owner</span>
        <span className="inspect-value">
          {ownerDisplay(ship.ownerId).name}{' '}
          <span style={{ color: RELATION_COLORS[relation] }}>({RELATION_LABELS[relation]})</span>
        </span>
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
          <span
            className="inspect-label"
            title={`Chance the ship is lost on a hyperdrive jump of average length to an average star. A real jump runs from ${JUMP_RISK_MIN_FACTOR}x to ${JUMP_RISK_MAX_FACTOR}x this: longer jumps and heavier destinations are riskier. Point at a star on the interstellar map to see that jump's risk.`}
          >
            Jump Risk
          </span>
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
              onChange={(e) => {
                setWarpEnabled(ship.id, e.target.checked)
                if (e.target.checked) replanForWarpWhenReady(ship.id)
              }}
            />
            Use Warp Drive
          </label>
          {/* Only meaningful while the warp drive is in use — planMove ignores
              the flag otherwise — so it isn't offered (and shows unticked)
              until "Use Warp Drive" is on. */}
          <label
            className="ship-panel-checkbox-row"
            title={ship.warpEnabled ? 'Engage warp mid-flight as soon as the drive is ready, even on an order already underway' : 'Needs "Use Warp Drive" turned on'}
          >
            <input
              type="checkbox"
              checked={ship.warpEnabled && ship.warpWhenReady}
              disabled={!ship.warpEnabled}
              onChange={(e) => {
                setWarpWhenReady(ship.id, e.target.checked)
                if (e.target.checked) replanForWarpWhenReady(ship.id)
              }}
            />
            Warp When Ready
          </label>
        </>
      )}
      {owned && <ShipPatrolToggle ship={ship} />}
      {owned && <ShipAutomationToggle ship={ship} />}
      {owned && <ShipSurveySection ship={ship} />}
      {owned && <ShipColonySection ship={ship} />}
      {owned && <ShipCargoSection ship={ship} />}
      {ship.followingShipId && (
        <div className="inspect-row">
          <span className="inspect-label">{ship.attackTargetShipId === ship.followingShipId ? 'Attacking' : 'Following'}</span>
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
            value={overallHealthFraction(displayCombat, combatProfile) * 100}
            max={100}
            tone="overall"
          />
          {combatProfile.defenses.shieldHp > 0 && (
            <HealthBar label="Shields" value={displayCombat.shieldHp} max={combatProfile.defenses.shieldHp} tone="shield" />
          )}
          {combatProfile.defenses.armorHp > 0 && (
            <HealthBar label="Armor" value={displayCombat.armorHp} max={combatProfile.defenses.armorHp} tone="armor" />
          )}
          {COMPONENT_KINDS.map((kind) => (
            <HealthBar
              key={kind}
              label={COMPONENT_LABELS[kind]}
              value={displayCombat.componentHp[kind]}
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
      {/* No fight required — opens (or rejoins) the arena at wherever this
          ship is resting, purely to look around or pre-position a fleet.
          Gated the same way createSoloEngagement itself is: the ship has to
          actually be at a real rest location (not mid-order), and only
          shown when there's no live Engagement already covering it (that
          case is the row below instead). */}
      {!engagement && !ship.order && level !== 'combat' && (
        <>
          <div className="inspect-row">
            <span className="inspect-label">{hostilePresent || rawEngagement ? 'Combat' : 'Arena'}</span>
            <span className="inspect-value">
              <button
                type="button"
                className="ship-panel-unfollow-btn"
                disabled={!presentIntel.allKnown}
                title={presentIntel.allKnown ? undefined : unknownShipsMessage(presentIntel)}
                onClick={() => {
                  if (rawEngagement) {
                    enterCombat(rawEngagement.id)
                    return
                  }
                  const solo = createSoloEngagement(ship, ships, simDays)
                  if (!solo) return
                  addEngagement(solo)
                  enterCombat(solo.id)
                }}
              >
                {hostilePresent || rawEngagement ? 'Enter Combat' : 'Enter Arena'}
              </button>
            </span>
          </div>
          {!presentIntel.allKnown && <div className="ship-panel-hint">{unknownShipsMessage(presentIntel)}</div>}
        </>
      )}
      {engagement && (
        <>
          <div className="inspect-row">
            <span className="inspect-label">Engagement</span>
            <span className={`inspect-value${engagementContested ? ' ship-panel-combat' : ''}`}>
              {engagementContested ? 'In combat at' : 'In the arena at'} {engagement.locationLabel}
              {/* The way into the arena. Offered rather than forced — the
                  clock already switches itself to tactical when a fight
                  starts, and yanking the player's camera somewhere else on
                  top of that would be one automatic disruption too many.
                  Hidden when already in the combat view, where it would be a
                  no-op. */}
              {level !== 'combat' && (
                <button
                  type="button"
                  className="ship-panel-unfollow-btn"
                  disabled={!presentIntel.allKnown}
                  title={presentIntel.allKnown ? undefined : unknownShipsMessage(presentIntel)}
                  onClick={() => enterCombat(engagement.id)}
                >
                  {engagementContested ? 'Enter Combat' : 'Enter Arena'}
                </button>
              )}
            </span>
          </div>
          {level !== 'combat' && !presentIntel.allKnown && <div className="ship-panel-hint">{unknownShipsMessage(presentIntel)}</div>}
          {/* Distinct from the row above on purpose — a ship can be "in
              combat" (present in this Engagement) without being "actively
              engaged" (in range and line of fire of anyone). This is the
              narrower, live-contact count, and works for a selected enemy
              ship too, not just an owned one. */}
          <div className="inspect-row">
            <span className="inspect-label">Engaged Against</span>
            <span className="inspect-value">
              {activelyEngaged ? (
                <>
                  {activeContacts.length} enemy ship{activeContacts.length === 1 ? '' : 's'}
                  {/* Whether THIS ship is winning the range question right
                      now, not just how many contacts it has — see
                      combatResolution.rangeFavor. Silent on a tie (mutual
                      range, or no asymmetric contact at all) rather than
                      claiming an edge that isn't there. */}
                  {favor === 'favored' && <span className="ship-panel-favor-good"> (favored)</span>}
                  {favor === 'unfavored' && <span className="ship-panel-favor-bad"> (unfavored)</span>}
                </>
              ) : (
                'None in range'
              )}
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
      {displayDelayDays > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Signal Delay</span>
          <span className="inspect-value ship-panel-comms-delay" title="FTL comms haven't caught up — status below is from that long ago, not live.">
            {formatCommsDelay(displayDelayDays)}
          </span>
        </div>
      )}
      <div className="inspect-row">
        <span className="inspect-label">Current Action</span>
      </div>
      <div className="ship-panel-status">{statusText}</div>
      {owned && ((ship.orderQueue?.length ?? 0) > 0 || (ship.pendingQueueAdds?.length ?? 0) > 0) && (
        <div className="ship-panel-status" title="Shift + right-click adds to this list; a plain right-click replaces it">
          Then: {[...(ship.orderQueue ?? []).map((d) => destinationLabel(d)), ...(ship.pendingQueueAdds ?? []).map((a) => `${destinationLabel(a.destination)} (signal in transit)`)].join(' → ')}
        </div>
      )}
      {/* In the current view the camera flies to it; if the ship is somewhere
          else (another system, deep space) this takes you there. */}
      <button
        type="button"
        className="detail-view-btn"
        onClick={onGoTo ?? (() => viewShip(ship))}
        disabled={!!onGoTo && goToPending}
        title={onGoTo ? 'Fly the camera to this ship' : 'Open the map where this ship is'}
      >
        {onGoTo && goToPending ? 'Going to…' : 'Go To'}
      </button>
      {owned && <TransportCargo ship={ship} />}
      {owned ? (
        ship.order && <div className="ship-panel-hint">Right-click a new destination to redirect.</div>
      ) : (
        <div className="ship-panel-hint">Not under your command.</div>
      )}
    </DraggableWindow>
  )
}
