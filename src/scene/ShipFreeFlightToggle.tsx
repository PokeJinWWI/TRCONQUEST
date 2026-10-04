import { usePlayerTech } from '../hooks/usePlayerTech'
import { type ShipInstance } from '../state/shipStore'
import { queueFreeFlight } from './commsVisual'
import { fleetFreeFlight, hasFreeFlightTech } from './freeFlight'

const ON_TIP = 'Free Flight on: in a fight the ship holds any position it likes, thrusting against gravity'
const OFF_TIP = 'Free Flight off: in a fight the ship is in the gravity of the bodies around it. It circles the body it is at when idle, and its path bends toward a body while it moves'
const NEEDS_TIP = 'Without Free-Flight Maneuvering (Engineering) every ship fights in orbit: it circles the body it is at when idle, and gravity bends its path while it moves'

// Free Flight for one own ship (scene/freeFlight.ts): on by default once
// Free-Flight Maneuvering is researched; the change is a signal like a stance.
export function ShipFreeFlightToggle({ ship }: { ship: ShipInstance }) {
  const researched = usePlayerTech().researched
  if (!hasFreeFlightTech(researched)) {
    return (
      <div className="inspect-row" title={NEEDS_TIP}>
        <span className="inspect-label">Flight</span>
        <span className="inspect-value">Orbital (needs Free-Flight Maneuvering)</span>
      </div>
    )
  }
  const on = ship.freeFlight ?? true
  const pending = ship.pendingFreeFlight
  return (
    <div className="inspect-row">
      <span className="inspect-label">Free Flight</span>
      <span className="inspect-value ship-automation">
        <button type="button" className={`nav-subtab${on ? ' active' : ''}`} onClick={() => queueFreeFlight(ship, true)} title={ON_TIP}>
          On
        </button>
        <button type="button" className={`nav-subtab${!on ? ' active' : ''}`} onClick={() => queueFreeFlight(ship, false)} title={`${OFF_TIP}. Switching it off in a fight puts the ship into a circular orbit where it is.`}>
          Off
        </button>
        {pending && <span className="ship-panel-comms-delay">{pending.on ? 'On' : 'Off'} signal on its way</span>}
      </span>
    </div>
  )
}

// The same for a whole fleet, in the fleet menu: one click sets every ship of it.
// Each ship still obeys its own setting, so a fleet can be mixed.
export function FleetFreeFlightToggle({ ships }: { ships: ShipInstance[] }) {
  const researched = usePlayerTech().researched
  if (!hasFreeFlightTech(researched) || ships.length === 0) return null
  const state = fleetFreeFlight(ships)
  const label = state === 'on' ? 'On' : state === 'off' ? 'Off' : 'Mixed'
  // Mixed or off: one click turns every ship on; all on: off.
  const next = state !== 'on'
  return (
    <button
      type="button"
      className={`nav-subtab fleet-free-flight${state === 'on' ? ' active' : ''}`}
      onClick={() => ships.forEach((s) => queueFreeFlight(s, next))}
      title={`${state === 'mixed' ? 'Some ships of this fleet have Free Flight on and some off; each obeys its own setting. ' : ''}Click to turn Free Flight ${next ? 'on' : 'off'} for every ship of the fleet. ${next ? ON_TIP : OFF_TIP}.`}
    >
      Free Flight: {label}
    </button>
  )
}
