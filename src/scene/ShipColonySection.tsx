import { COLONY_PATROL_DAYS } from '../data/colonyData'
import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { useColonyStore } from '../state/colonyStore'
import { useResourceStore } from '../state/resourceStore'
import { resolveShipClass } from '../state/shipClassResolver'
import type { ShipInstance } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { isArmed, orbitedBody } from './armyLogic'
import { canColonize } from './colonies'
import { queuePatrol } from './commsVisual'
import { getMoonsForPlanet } from './moonData'
import { groundSurface } from './groundLogic'
import { queueShipCommand } from './shipCommands'
import { orbitBodyOf } from './territory'

// A Colony Ship's part of ShipPanel: the settlers aboard, and a Colonize
// button for each world it could settle from where it orbits (the body and its
// moons). Its own component so its hooks stay clear of ShipPanel's early return.
export function ShipColonySection({ ship }: { ship: ShipInstance }) {
  // Re-render when what the checks read changes.
  useResourceStore((s) => s.stateFor(ship.ownerId).amounts.influence)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  if (resolveShipClass(ship.classId)?.role !== 'colony') return null
  const orbit = orbitedBody(ship)
  // Only worlds that could ever be settled: nobody's, with land.
  const settleable = (body: string) => !owners[body] && (groundSurface(body, owners)?.mainland ?? -1) >= 0
  const bodies = orbit ? [orbit, ...getMoonsForPlanet(orbit).moons.map((m) => m.name)].filter(settleable) : []
  const options = bodies.map((body) => ({ body, check: canColonize(ship, body) }))
  const pending = ship.arrivalCommand?.command.kind === 'colonize' ? ship.arrivalCommand.command.bodyName : null
  return (
    <>
      <div className="inspect-row">
        <span className="inspect-label">Settlers</span>
        <span className="inspect-value">{ship.settlers ? `${Math.round(ship.settlers)} million aboard` : 'None aboard'}</span>
      </div>
      {pending && (
        <div className="inspect-row">
          <span className="inspect-label">On arrival</span>
          <span className="inspect-value">Found a colony on {pending}</span>
        </div>
      )}
      {options.length > 0 ? (
        <div className="ship-panel-btn-row">
          {options.map(({ body, check }) => (
            <button
              key={body}
              type="button"
              className="detail-view-btn"
              disabled={!check.ok}
              title={check.ok ? `Found a micro-colony on ${body} for ${check.cost} influence. The ship is used up.` : check.reason}
              onClick={() => queueShipCommand(ship.id, { kind: 'colonize', bodyName: body })}
            >
              Colonize {body}
              {check.ok ? ` (${check.cost})` : ''}
            </button>
          ))}
        </div>
      ) : (
        <div className="inspect-status">{orbit ? 'Nothing here to settle.' : 'Right-click a surveyed, unowned world to colonize it.'}</div>
      )}
    </>
  )
}

// Patrol duty for an armed ship: while it orbits one of its nation's
// micro-colonies (a moon's orbit is its planet's), it holds that orbit.
export function ShipPatrolToggle({ ship }: { ship: ShipInstance }) {
  const simDays = useThrottledSimDays()
  const colonies = useColonyStore((s) => s.colonies)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  if (!isArmed(ship)) return null
  const on = ship.pendingPatrol ? ship.pendingPatrol.on : !!ship.patrol
  const orbit = orbitedBody(ship)
  const guarding = orbit ? Object.values(colonies).filter((c) => c.stage === 'micro' && owners[c.bodyName] === ship.ownerId && orbitBodyOf(c.bodyName) === orbit) : []
  const status = ship.pendingPatrol
    ? `order in transit (${Math.max(0, Math.ceil(ship.pendingPatrol.arrivesSimDays - simDays))}d)`
    : ship.patrol && guarding.length > 0
      ? `holding the orbit of ${guarding.map((c) => `${c.bodyName} (${c.orbitSecureSinceSimDays === null ? 'contested' : `${Math.min(COLONY_PATROL_DAYS, Math.floor(simDays - c.orbitSecureSinceSimDays))} / ${COLONY_PATROL_DAYS} days`})`).join(', ')}`
      : null
  return (
    <>
      <label
        className="ship-panel-checkbox-row"
        title={`Orbiting one of your micro-colonies, a patrol ship holds its orbit: after ${COLONY_PATROL_DAYS} days uncontested the colony becomes a planetary colony.`}
      >
        <input type="checkbox" checked={on} onChange={(e) => queuePatrol(ship, e.target.checked)} />
        Patrol duty
      </label>
      {status && <div className="inspect-status">{status}</div>}
    </>
  )
}
