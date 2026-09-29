import { resolveShipClass } from '../state/shipClassResolver'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { AUTOMATION_LABELS, automationsFor, type Automation } from './automation'

const TIPS: Record<Automation, string> = {
  survey: 'Survey the nearest system nobody of yours is surveying yet, then the next, on its own',
  build: 'Keep a Starbase kit in the hold and build Starbases at the nearest systems it may, on its own',
  refill: 'Keep the hold topped up: from a Cargo Ship in the same place, or the nearest world you own',
}

// Automation for a Science or Construction Ship (scene/automation.ts): Off, or
// one of its role's modes. A manual order turns it off.
export function ShipAutomationToggle({ ship }: { ship: ShipInstance }) {
  const setAutomation = useShipStore((s) => s.setAutomation)
  const modes = automationsFor(resolveShipClass(ship.classId)?.role)
  if (modes.length === 0) return null
  const current = ship.automation ?? null
  return (
    <div className="inspect-row">
      <span className="inspect-label">Automation</span>
      <span className="inspect-value ship-automation">
        <button type="button" className={`nav-subtab${current === null ? ' active' : ''}`} onClick={() => setAutomation(ship.id, null)} title="The ship waits for your orders">
          Off
        </button>
        {modes.map((m) => (
          <button key={m} type="button" className={`nav-subtab${current === m ? ' active' : ''}`} onClick={() => setAutomation(ship.id, m)} title={`${TIPS[m]}. Any order you give it turns this off.`}>
            {AUTOMATION_LABELS[m]}
          </button>
        ))}
      </span>
    </div>
  )
}
