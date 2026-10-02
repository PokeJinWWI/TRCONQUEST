import { resolveShipClass } from '../state/shipClassResolver'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { AUTOMATION_LABELS, automationsFor, type Automation } from './automation'

const TIPS: Record<Automation, string> = {
  survey: 'Survey the nearest system nobody of yours is surveying yet, then the next, on its own',
  build: 'Keep a Starbase kit in the hold and build Starbases at the nearest systems it may, on its own',
  refill: 'Keep the hold topped up: from a Cargo Ship in the same place, or the nearest world you own',
  receive: 'Stay where it is: Cargo Ships in distribution mode bring it goods',
  distribute: 'Bring goods to Construction Ships in receiving mode that need them, loading at your nearest world when empty',
  settle: 'Found colonies on its own, on the cheapest world it may settle',
}

// Automation for a Science or Construction Ship (scene/automation.ts): Off, or
// one of its role's modes. A manual order turns it off.
export function ShipAutomationToggle({ ship }: { ship: ShipInstance }) {
  const setAutomation = useShipStore((s) => s.setAutomation)
  const toggle = useShipStore((s) => s.toggleAutomation)
  const setReturn = useShipStore((s) => s.setAutomationReturn)
  const modes = automationsFor(resolveShipClass(ship.classId)?.role)
  if (modes.length === 0) return null
  const active = ship.automations ?? []
  return (
    <div className="inspect-row">
      <span className="inspect-label">Automation</span>
      <span className="inspect-value ship-automation">
        <button type="button" className={`nav-subtab${active.length === 0 ? ' active' : ''}`} onClick={() => setAutomation(ship.id, null)} title="Turn every automation off: the ship waits for your orders">
          Off
        </button>
        {modes.map((m) => (
          <button key={m} type="button" className={`nav-subtab${active.includes(m) ? ' active' : ''}`} onClick={() => toggle(ship.id, m)} title={`${TIPS[m]}. Modes combine; any order you give the ship turns them all off.`}>
            {AUTOMATION_LABELS[m]}
          </button>
        ))}
      </span>
      {active.includes('refill') && (
        <label className="ship-automation-return" title="After refilling at a world of yours, fly back to where it was">
          <input type="checkbox" checked={!!ship.automationReturn} onChange={(e) => setReturn(ship.id, e.target.checked)} /> Return afterwards
        </label>
      )}
    </div>
  )
}
