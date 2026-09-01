import { COMPONENT_LABELS, CHAFF_DURATION_SECONDS, SCUTTLE_BLAST_RADIUS_UNITS, type ComponentKind } from '../data/combatData'
import { GRID_DENSITIES, GRID_DENSITY_LABELS, GRID_DIVISIONS, isInsideWindow } from '../scene/combatArena'
import { useEffect, useState } from 'react'
import { activeEnemyContacts, arenaWindowSpan, isChaffActive, overallHealthFraction, shipCombatProfile } from '../scene/combatResolution'
import { useCombatStore, type Engagement } from '../state/combatStore'
import { useShipStore } from '../state/shipStore'
import { simDaysToSeconds, useGameTimeStore } from '../state/gameTimeStore'
import { DraggableWindow } from './DraggableWindow'

const TARGET_COMPONENTS: (ComponentKind | null)[] = [null, 'weapons', 'utility', 'core']

// The combat view's two always-open windows are now pinned to OPPOSITE
// screen edges (see DraggableWindow's `anchor` prop) rather than nudged
// apart from a shared centre spot — this panel to the left, the selected
// ship's inspector to the right — so neither sits on top of the arena the
// player is trying to watch. That makes the old viewport-derived horizontal
// gap unnecessary: the edges themselves do the separating, at any width.
// Only a small vertical offset remains, purely so the two title bars don't
// line up at exactly the same height.
function combatPanelOffset() {
  return { x: 0, y: -60 }
}

// Kept for the ship inspector's matching vertical offset — see
// CombatViewScene, which pairs this panel's -60 with its own +40.
export function combatPanelVerticalOffset(): number {
  return 40
}

interface CombatPanelProps {
  engagement: Engagement
  /** Slides the arena window onto the selected ship. Omitted when there's no
   * commandable ship selected to centre on. */
  onRecenter?: () => void
}

// The combat view's order panel: the full roster with live integrity, and —
// for whichever player ship is selected — its firing target, which subsystem
// to concentrate on, and whether it's under manual movement control.
//
// Deliberately separate from ShipPanel rather than bolted onto it: ShipPanel
// is a per-ship *inspector* available at every view level, while this is a
// per-engagement *command* surface that only means anything inside the arena.
export function CombatPanel({ engagement, onRecenter }: CombatPanelProps) {
  const ships = useShipStore((s) => s.ships)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const simDays = useGameTimeStore((s) => s.simDays)
  const setParticipantTarget = useCombatStore((s) => s.setParticipantTarget)
  const setParticipantTargetComponent = useCombatStore((s) => s.setParticipantTargetComponent)
  const setHoldPosition = useCombatStore((s) => s.setHoldPosition)
  const setChasing = useCombatStore((s) => s.setChasing)
  const setInheritVelocityFrom = useCombatStore((s) => s.setInheritVelocityFrom)
  const setDensity = useCombatStore((s) => s.setDensity)
  const deployChaff = useShipStore((s) => s.deployChaff)
  const setChaffAutoDeploy = useShipStore((s) => s.setChaffAutoDeploy)
  const [scuttleArmed, setScuttleArmed] = useState(false)
  const setFleetTarget = useCombatStore((s) => s.setFleetTarget)
  const orderScuttle = useCombatStore((s) => s.orderScuttle)

  const shipsById = new Map(ships.map((s) => [s.id, s]))
  const selectedParticipant = engagement.participants.find((p) => p.shipId === selectedShipId)
  const selectedShip = selectedShipId ? shipsById.get(selectedShipId) : undefined
  const commandable = selectedShip?.allegiance === 'player' && selectedParticipant
  const selectedOutsideWindow =
    !!selectedParticipant && !isInsideWindow(selectedParticipant.position, engagement.center, arenaWindowSpan(engagement.obstacles))
  const chaffActive = !!selectedShip && isChaffActive(selectedShip.combat, simDays)
  // Reset the arm state whenever the selection moves, so an armed Scuttle
  // can never carry over onto a different ship.
  useEffect(() => setScuttleArmed(false), [selectedShipId])
  const selectedProfile = selectedShip ? shipCombatProfile(selectedShip) : null
  const scuttleYield =
    selectedShip && selectedProfile && selectedProfile.components.core > 0
      ? Math.max(0, Math.min(1, selectedShip.combat.componentHp.core / selectedProfile.components.core))
      : 0
  const chaffSecondsLeft =
    chaffActive && selectedShip?.combat.chaffActiveUntilSimDays
      ? Math.max(0, simDaysToSeconds(selectedShip.combat.chaffActiveUntilSimDays - simDays))
      : 0

  const sides: [typeof engagement.participants, typeof engagement.participants] = [
    engagement.participants.filter((p) => p.side === 0),
    engagement.participants.filter((p) => p.side === 1),
  ]

  // Every ship the player may actually give orders to — the roster for
  // fleet-wide focus fire below.
  const commandableShipIds = engagement.participants
    .filter((p) => shipsById.get(p.shipId)?.allegiance === 'player')
    .map((p) => p.shipId)

  // How many enemies are actually trading fire with each hull RIGHT NOW —
  // not how many are in the battle, but how many can presently shoot it (see
  // activeEnemyContacts, the same test the yellow engagement lines and the
  // FTL risk modifier use).
  //
  // This is the readout that makes splitting a fleet playable. Being
  // outnumbered 2v4 overall doesn't matter if you can arrange two 1v1s and a
  // pair of enemies stuck out of range or behind a planet — but you can't
  // steer toward that without being able to see, at a glance, which of your
  // ships is swamped and which is clear. Shown per row for BOTH sides, since
  // spotting an isolated enemy is half of the same decision.
  const engagedCounts = new Map<string, number>(
    engagement.participants.map((p) => [p.shipId, activeEnemyContacts(p, engagement, ships, simDays).length]),
  )

  // Right-click a Hostiles row: same "concentrate fire, right-click again to
  // release" gesture as right-clicking the marker in the arena itself (see
  // CombatViewScene.handleOrderTarget) — this is just a second way to reach
  // it, for a fleet fight where the enemy you want is easier to find by name
  // in the roster than by hunting for its marker.
  const handleRosterTarget = (targetShipId: string) => {
    if (!commandable || !selectedParticipant) return
    const target = engagement.participants.find((p) => p.shipId === targetShipId)
    if (!target || target.side === selectedParticipant.side) return
    const alreadyTargeted = selectedParticipant.targetShipId === targetShipId
    setParticipantTarget(engagement.id, selectedParticipant.shipId, alreadyTargeted ? null : targetShipId)
  }

  const renderSide = (label: string, group: typeof engagement.participants, targetable: boolean) => (
    <div className="combat-side">
      <div className="combat-side-label">{label}</div>
      {group.length === 0 && <div className="combat-side-empty">None</div>}
      {group.map((p) => {
        const ship = shipsById.get(p.shipId)
        if (!ship) return null
        const profile = shipCombatProfile(ship)
        const health = profile ? overallHealthFraction(ship.combat, profile) : 0
        const isTargetOfSelected = selectedParticipant?.targetShipId === p.shipId
        return (
          <button
            key={p.shipId}
            type="button"
            className={`combat-roster-row${p.shipId === selectedShipId ? ' selected' : ''}${
              isTargetOfSelected ? ' targeted' : ''
            }`}
            onClick={() => selectShip(p.shipId)}
            onContextMenu={
              targetable
                ? (e) => {
                    e.preventDefault()
                    handleRosterTarget(p.shipId)
                  }
                : undefined
            }
          >
            <span className="combat-roster-name">
              {ship.name}
              {ship.combat.ftlCharge && <span className="combat-roster-tag">FTL</span>}
              {isChaffActive(ship.combat, simDays) && <span className="combat-roster-tag chaff">CHAFF</span>}
              {isTargetOfSelected && <span className="combat-roster-tag target">TGT</span>}
              {/* Local odds. Absent (rather than "0") when nothing can shoot
                  this hull — a clear ship should read as quiet, not as a
                  statistic. */}
              {(engagedCounts.get(p.shipId) ?? 0) > 0 && (
                <span
                  className={`combat-roster-odds${(engagedCounts.get(p.shipId) ?? 0) > 1 ? ' outnumbered' : ''}`}
                  title={`${engagedCounts.get(p.shipId)} enemy ship(s) can shoot this one right now`}
                >
                  ×{engagedCounts.get(p.shipId)}
                </span>
              )}
            </span>
            <span className="health-bar-track tone-overall combat-roster-bar">
              <span className="health-bar-fill" style={{ width: `${health * 100}%` }} />
            </span>
            <span className="combat-roster-pct">{Math.round(health * 100)}%</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <DraggableWindow
      title={`Engagement — ${engagement.locationLabel}`}
      initialOffset={combatPanelOffset()}
      anchor="left"
    >
      {renderSide('Your Forces', sides[0], false)}
      {renderSide('Hostiles', sides[1], true)}

      <div className="inspect-divider" />

      {engagement.obstacles.length > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Terrain</span>
          <span className="inspect-value">
            {engagement.obstacles.map((o) => o.name).join(', ')} — blocks line of fire
          </span>
        </div>
      )}

      <div className="inspect-row">
        <span className="inspect-label">Grid</span>
        <span className="inspect-value combat-density-row">
          {GRID_DENSITIES.map((d) => (
            <button
              key={d}
              type="button"
              className={`combat-density-btn${engagement.density === d ? ' active' : ''}`}
              onClick={() => setDensity(engagement.id, d)}
              title={`${GRID_DIVISIONS[d]} subdivisions per axis`}
            >
              {GRID_DENSITY_LABELS[d]}
            </button>
          ))}
        </span>
      </div>

      {/* The arena cube is a window onto an unbounded lattice, not the edge
          of the world — recentring is how a ship travels beyond one window's
          width. Flagged loudly when the selected ship has left the frame,
          since that's the moment it stops being orderable. */}
      <div className="inspect-row">
        <span className="inspect-label">Frame</span>
        <span className="inspect-value">
          {selectedOutsideWindow ? (
            <span className="ship-panel-combat">Ship outside frame</span>
          ) : (
            'Centred'
          )}
          {onRecenter && (
            <button type="button" className="ship-panel-unfollow-btn" onClick={onRecenter}>
              Recenter
            </button>
          )}
        </span>
      </div>

      {commandable && selectedParticipant ? (
        <>
          <div className="inspect-divider" />
          <div className="combat-orders-title">Orders — {selectedShip?.name}</div>

          {/* Fleet-wide focus fire. Sits directly above the per-ship Target
              row because it's the same decision at a different scale, and
              because concentrating the whole fleet is the move that matters
              most when you're the smaller force. */}
          <div className="inspect-row">
            <span className="inspect-label">Focus Fleet</span>
            <span className="inspect-value combat-density-row">
              {sides[1].map((hostile) => {
                const hostileShip = shipsById.get(hostile.shipId)
                if (!hostileShip) return null
                const allOnIt =
                  commandableShipIds.length > 0 &&
                  commandableShipIds.every(
                    (id) => engagement.participants.find((p) => p.shipId === id)?.targetShipId === hostile.shipId,
                  )
                return (
                  <button
                    key={hostile.shipId}
                    type="button"
                    className={`combat-density-btn${allOnIt ? ' active' : ''}`}
                    onClick={() => setFleetTarget(engagement.id, commandableShipIds, allOnIt ? null : hostile.shipId)}
                    title={
                      allOnIt
                        ? 'Release your whole fleet back to auto-targeting'
                        : `Point every ship you command at ${hostileShip.name}`
                    }
                  >
                    {hostileShip.name}
                  </button>
                )
              })}
              {sides[1].length === 0 && <span className="combat-side-empty">No hostiles</span>}
            </span>
          </div>

          <div className="inspect-row">
            <span className="inspect-label">Target</span>
            <span className="inspect-value">
              {selectedParticipant.targetShipId
                ? shipsById.get(selectedParticipant.targetShipId)?.name ?? 'Unknown'
                : 'Auto (nearest)'}
              {selectedParticipant.targetShipId && (
                <button
                  type="button"
                  className="ship-panel-unfollow-btn"
                  onClick={() => setParticipantTarget(engagement.id, selectedParticipant.shipId, null)}
                >
                  Auto
                </button>
              )}
            </span>
          </div>

          <div className="inspect-row">
            <span className="inspect-label">Focus Fire</span>
            <span className="inspect-value combat-density-row">
              {TARGET_COMPONENTS.map((kind) => (
                <button
                  key={kind ?? 'spread'}
                  type="button"
                  className={`combat-density-btn${selectedParticipant.targetComponent === kind ? ' active' : ''}`}
                  onClick={() => setParticipantTargetComponent(engagement.id, selectedParticipant.shipId, kind)}
                  title={
                    kind === null
                      ? 'Spread damage across whatever is exposed'
                      : kind === 'weapons'
                        ? 'Disarm — scales their firepower down'
                        : kind === 'utility'
                          ? 'Cripple — slows them and blocks their FTL escape'
                          : 'Kill — the only component that actually destroys a ship'
                  }
                >
                  {kind === null ? 'Spread' : COMPONENT_LABELS[kind].split(' ')[0]}
                </button>
              ))}
            </span>
          </div>

          <div className="inspect-row">
            <span className="inspect-label">Movement</span>
            <span className="inspect-value">
              {selectedParticipant.holdPosition
                ? 'Manual'
                : selectedParticipant.chasing
                  ? 'Chasing'
                  : selectedParticipant.inheritVelocityFrom
                    ? `Locked to ${selectedParticipant.inheritVelocityFrom}`
                    : 'Auto-engage'}
              {selectedParticipant.holdPosition && (
                <button
                  type="button"
                  className="ship-panel-unfollow-btn"
                  onClick={() => setHoldPosition(engagement.id, selectedParticipant.shipId, false)}
                >
                  Resume Auto
                </button>
              )}
              {!selectedParticipant.holdPosition && sides[1].length > 0 && (
                <button
                  type="button"
                  className={`ship-panel-unfollow-btn${selectedParticipant.chasing ? ' active' : ''}`}
                  onClick={() => setChasing(engagement.id, selectedParticipant.shipId, !selectedParticipant.chasing)}
                  title={
                    selectedParticipant.chasing
                      ? 'Stop chasing and return to this stance’s normal range-holding'
                      : 'Close on the current target continuously instead of holding the stance’s usual range — for running down a fleeing ship'
                  }
                >
                  {selectedParticipant.chasing ? 'Stop Chase' : 'Chase'}
                </button>
              )}
            </span>
          </div>

          {/* Match a body's own velocity instead of flying under thrust — the
              building block for staying on the far side of something that
              moves (an orbiting moon today; a future weaponized one is the
              actual point). Only offered when NOT under manual control —
              same reasoning as Chase above, and setInheritVelocityFrom
              itself drops any manual hold the moment it's used anyway. */}
          {!selectedParticipant.holdPosition && engagement.obstacles.length > 0 && (
            <div className="inspect-row">
              <span className="inspect-label">Inherit Velocity</span>
              <span className="inspect-value combat-density-row">
                {engagement.obstacles.map((obstacle) => {
                  const active = selectedParticipant.inheritVelocityFrom === obstacle.name
                  return (
                    <button
                      key={obstacle.name}
                      type="button"
                      className={`combat-density-btn${active ? ' active' : ''}`}
                      onClick={() =>
                        setInheritVelocityFrom(engagement.id, selectedParticipant.shipId, active ? null : obstacle.name)
                      }
                      title={
                        obstacle.velocity
                          ? `Match ${obstacle.name}'s current velocity every step`
                          : `${obstacle.name} isn't moving in this frame — locking on holds station here`
                      }
                    >
                      {obstacle.name}
                    </button>
                  )
                })}
              </span>
            </div>
          )}

          {/* Chaff — a consumable, so the count is shown even at zero rather
              than the row disappearing: "none left" is decision-relevant
              information, and a row that vanishes reads as a bug. */}
          <div className="inspect-row">
            <span className="inspect-label">Chaff</span>
            <span className="inspect-value">
              {chaffActive ? (
                <span className="ship-panel-combat">Active {chaffSecondsLeft.toFixed(1)}s</span>
              ) : (
                `${selectedShip?.combat.chaffRemaining ?? 0} left`
              )}
              {!chaffActive && (selectedShip?.combat.chaffRemaining ?? 0) > 0 && (
                <button
                  type="button"
                  className="ship-panel-unfollow-btn"
                  onClick={() => deployChaff(selectedParticipant.shipId, simDays)}
                  title={`Cuts incoming accuracy to 25% for ${CHAFF_DURATION_SECONDS}s`}
                >
                  Deploy
                </button>
              )}
            </span>
          </div>

          {/* Default ON (see ShipInstance.chaffAutoDeploy) — this is here for
              the player who wants to hold a charge back for a specific
              moment instead of spending it the instant it's worth it. */}
          <label className="ship-panel-checkbox-row">
            <input
              type="checkbox"
              checked={selectedShip?.chaffAutoDeploy ?? true}
              onChange={(e) => setChaffAutoDeploy(selectedParticipant.shipId, e.target.checked)}
            />
            Auto-deploy chaff
          </label>

          {/* The doomed-ship trade. Deliberately the last row and behind a
              confirm — it destroys the ship outright, and an accidental click
              here is unrecoverable in a way nothing else in this panel is. */}
          <div className="inspect-row">
            <span className="inspect-label">Scuttle</span>
            <span className="inspect-value">
              {selectedParticipant.scuttleOrdered ? (
                <span className="ship-panel-combat">Detonating…</span>
              ) : (
                <>
                  {Math.round(scuttleYield * 100)}% yield
                  <button
                    type="button"
                    className="ship-panel-unfollow-btn scuttle-btn"
                    onClick={() => {
                      if (scuttleArmed) orderScuttle(engagement.id, selectedParticipant.shipId)
                      else setScuttleArmed(true)
                    }}
                    title={`Destroy this ship, damaging hostiles within ${SCUTTLE_BLAST_RADIUS_UNITS} units. Yield scales with remaining core.`}
                  >
                    {scuttleArmed ? 'Confirm' : 'Scuttle'}
                  </button>
                </>
              )}
            </span>
          </div>

          {selectedShip?.combat.ftlCharge && (
            <div className="inspect-row">
              <span className="inspect-label">Escaping</span>
              <span className="inspect-value ship-panel-combat">
                {Math.max(0, simDaysToSeconds(selectedShip.combat.ftlCharge.readySimDays - simDays)).toFixed(1)}s —
                weapons offline
              </span>
            </div>
          )}

          <div className="ship-panel-hint">
            Right-click the grid to move · right-click a hostile ship (in the arena or this roster) to target it,
            again to release it back to auto.
          </div>
        </>
      ) : (
        <div className="ship-panel-hint">
          {selectedShip && selectedShip.allegiance !== 'player'
            ? 'Not under your command.'
            : 'Select one of your ships to give it orders.'}
        </div>
      )}
    </DraggableWindow>
  )
}
