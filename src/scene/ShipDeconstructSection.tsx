import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { resolveShipClass } from '../state/shipClassResolver'
import { useArmyStore } from '../state/armyStore'
import { useShipDeconstructionStore } from '../state/shipDeconstructionStore'
import type { ShipInstance } from '../state/shipStore'
import { armiesAboard } from './armyLogic'
import { deconstructBlock, deconstructionDays, deconstructionRemaining } from './shipDeconstruction'
import { isEngaged } from './shipUpgrade'
import { useGameTimeStore } from '../state/gameTimeStore'

// The deconstruct row of ShipPanel: scrap the ship over the days it took to build, as a
// bar running from full to empty. Holds no shipyard slip; no refund. Its own component
// so its hooks stay clear of ShipPanel's early return.
export function ShipDeconstructSection({ ship }: { ship: ShipInstance }) {
  const job = useShipDeconstructionStore((s) => s.jobs.find((j) => j.shipId === ship.id))
  const aboard = useArmyStore((s) => armiesAboard(s.armies, ship.id).length)
  const simDays = useThrottledSimDays()
  const shipClass = resolveShipClass(ship.classId)
  if (!shipClass) return null
  if (job) {
    const left = deconstructionRemaining(job, simDays)
    return (
      <div className="inspect-row">
        <span className="inspect-label">Deconstructing</span>
        <span className="inspect-value">
          <span className="fleet-row-bar">
            <span className="health-bar-track tone-overall combat-roster-bar" title={`${Math.max(0, job.finishSimDays - simDays).toFixed(1)} days left`}>
              <span className="health-bar-fill" style={{ width: `${left * 100}%` }} />
            </span>
            <span className="combat-roster-pct">{Math.round(left * 100)}%</span>
          </span>
          <button type="button" className="ship-panel-unfollow-btn" onClick={() => useShipDeconstructionStore.getState().cancel(ship.id)} title="Stop: the ship stays as it is now">
            Cancel
          </button>
        </span>
      </div>
    )
  }
  const block = deconstructBlock({ alreadyRunning: false, engaged: isEngaged(ship.id), armiesAboard: aboard })
  const days = deconstructionDays(shipClass)
  return (
    <div className="inspect-row">
      <span className="inspect-label">Deconstruct</span>
      <span className="inspect-value">
        <button
          type="button"
          className="ship-panel-unfollow-btn"
          disabled={!!block}
          onClick={() => useShipDeconstructionStore.getState().begin(ship, shipClass, useGameTimeStore.getState().simDays)}
          title={block ?? `Scrap this ship over ${days} days (the time it took to build). No refund. It holds no shipyard slip.`}
        >
          Deconstruct · {days} days
        </button>
        {block && <span className="abs-dim"> {block}</span>}
      </span>
    </div>
  )
}
