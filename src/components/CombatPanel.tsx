import { COMPONENT_LABELS, type ComponentKind } from '../data/combatData'
import { GRID_DENSITIES, GRID_DENSITY_LABELS, GRID_DIVISIONS, isInsideWindow } from '../scene/combatArena'
import { overallHealthFraction, shipCombatProfile } from '../scene/combatResolution'
import { useCombatStore, type Engagement } from '../state/combatStore'
import { useShipStore } from '../state/shipStore'
import { simDaysToSeconds, useGameTimeStore } from '../state/gameTimeStore'
import { DraggableWindow } from './DraggableWindow'

const TARGET_COMPONENTS: (ComponentKind | null)[] = [null, 'weapons', 'utility', 'core']

// Half the horizontal gap between the combat view's two windows (this panel
// and the selected ship's inspector), which otherwise open in exactly the
// same spot and hide each other.
//
// Computed from the viewport rather than hardcoded: a fixed 300px shove put
// the panel completely off-screen at ~520px wide, which is a worse bug than
// the overlap it was fixing. Collapses to zero on a narrow viewport, where
// the vertical offsets below keep both title bars grabbable instead.
export function combatPanelGap(): number {
  if (typeof window === 'undefined') return 0
  return Math.max(0, Math.min(280, window.innerWidth / 2 - 260))
}

function combatPanelOffset() {
  return { x: -combatPanelGap(), y: -60 }
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
  const setDensity = useCombatStore((s) => s.setDensity)

  const shipsById = new Map(ships.map((s) => [s.id, s]))
  const selectedParticipant = engagement.participants.find((p) => p.shipId === selectedShipId)
  const selectedShip = selectedShipId ? shipsById.get(selectedShipId) : undefined
  const commandable = selectedShip?.allegiance === 'player' && selectedParticipant
  const selectedOutsideWindow = !!selectedParticipant && !isInsideWindow(selectedParticipant.position, engagement.center)

  const sides: [typeof engagement.participants, typeof engagement.participants] = [
    engagement.participants.filter((p) => p.side === 0),
    engagement.participants.filter((p) => p.side === 1),
  ]

  const renderSide = (label: string, group: typeof engagement.participants) => (
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
          >
            <span className="combat-roster-name">
              {ship.name}
              {ship.combat.ftlCharge && <span className="combat-roster-tag">FTL</span>}
              {isTargetOfSelected && <span className="combat-roster-tag target">TGT</span>}
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
    >
      {renderSide('Your Forces', sides[0])}
      {renderSide('Hostiles', sides[1])}

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
              {selectedParticipant.holdPosition ? 'Manual' : 'Auto-engage'}
              {selectedParticipant.holdPosition && (
                <button
                  type="button"
                  className="ship-panel-unfollow-btn"
                  onClick={() => setHoldPosition(engagement.id, selectedParticipant.shipId, false)}
                >
                  Resume Auto
                </button>
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
            Right-click the grid to move · right-click a hostile ship to target it.
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
