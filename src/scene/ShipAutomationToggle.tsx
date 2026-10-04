import { resolveShipClass } from '../state/shipClassResolver'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { AUTOMATION_LABELS, automationsFor, type Automation } from './automation'
import { AUTO_MAX_RISK_DEFAULT, AUTO_MAX_RISK_MIN, AUTO_MAX_RISK_STEP, AUTO_ROUTE_MAX_JUMPS } from '../data/shipData'
import { JUMP_WARN_LOSS } from './jumpWarning'
import { DEFAULT_EXPLORE_SCOPE, EXPLORE_SCOPES, EXPLORE_SCOPE_LABELS, EXPLORE_SCOPE_TIPS } from './autoExplore'

const TIPS: Record<Automation, string> = {
  survey: 'Survey the nearest system nobody of yours is surveying yet, then the next, on its own',
  build: 'Keep a Starbase kit in the hold and build Starbases at the nearest systems it may, on its own',
  refill: 'Keep the hold topped up: from a Cargo Ship in the same place, or the nearest world you own',
  receive: 'Stay where it is: Cargo Ships in distribution mode bring it goods',
  distribute: 'Bring goods to Construction Ships in receiving mode that need them, loading at your nearest world when empty',
  settle: 'Found colonies on its own, on the nearest world it may settle',
  explore: 'Jump to the nearest place not yet explored, on its own. It only explores: it never surveys',
}

// Automation for a Science or Construction Ship (scene/automation.ts): Off, or
// one of its role's modes. A manual order turns it off.
export function ShipAutomationToggle({ ship }: { ship: ShipInstance }) {
  const setAutomation = useShipStore((s) => s.setAutomation)
  const toggle = useShipStore((s) => s.toggleAutomation)
  const setReturn = useShipStore((s) => s.setAutomationReturn)
  const setUnsafe = useShipStore((s) => s.setAutomationUnsafe)
  const setMaxRisk = useShipStore((s) => s.setAutomationMaxRisk)
  const setScope = useShipStore((s) => s.setExploreScope)
  const maxRisk = ship.automationMaxRisk ?? AUTO_MAX_RISK_DEFAULT
  const warnPct = Math.round(JUMP_WARN_LOSS * 100)
  const modes = automationsFor(resolveShipClass(ship.classId)?.role, ship.classId)
  if (modes.length === 0) return null
  const active = ship.automations ?? []
  return (
    <>
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
      </div>
      {modes.includes('explore') && (
        <div className="inspect-row">
          <span className="inspect-label" title="How far Auto-explore goes. Interstellar is the default">Explore scope</span>
          <span className="inspect-value ship-automation">
            {EXPLORE_SCOPES.map((sc) => (
              <button key={sc} type="button" className={`nav-subtab${(ship.exploreScope ?? DEFAULT_EXPLORE_SCOPE) === sc ? ' active' : ''}`} onClick={() => setScope(ship.id, sc)} title={EXPLORE_SCOPE_TIPS[sc]}>
                {EXPLORE_SCOPE_LABELS[sc]}
              </button>
            ))}
          </span>
        </div>
      )}
      <div className="ship-automation-options">
        {active.includes('refill') && (
          <label className="ship-automation-return" title="After refilling at a world of yours, fly back to where it was">
            <input type="checkbox" checked={!!ship.automationReturn} onChange={(e) => setReturn(ship.id, e.target.checked)} /> Return afterwards
          </label>
        )}
        {!(modes.length === 1 && modes[0] === 'explore') && (
        <label
          className="ship-automation-return"
          title={`Off: on its own the ship never makes a hyperdrive jump with more than a ${warnPct}% chance of losing it, and waits if there is no such route. On: it may, without asking you. Either way it takes the route of up to ${AUTO_ROUTE_MAX_JUMPS} jumps that loses the fewest ships, and a route of safe jumps whenever there is one.`}
        >
          <input type="checkbox" checked={!!ship.automationUnsafe} onChange={(e) => setUnsafe(ship.id, e.target.checked)} /> Make unsafe jumps
        </label>
        )}
        {ship.automationUnsafe && !(modes.length === 1 && modes[0] === 'explore') && (
          <label className="ship-automation-return ship-automation-risk" title="The riskiest single jump the ship makes on its own: the chance that jump loses it">
            Max risk per jump
            <input
              type="range"
              min={Math.round(AUTO_MAX_RISK_MIN * 100)}
              max={100}
              step={Math.round(AUTO_MAX_RISK_STEP * 100)}
              value={Math.round(maxRisk * 100)}
              onChange={(e) => setMaxRisk(ship.id, Number(e.target.value) / 100)}
            />
            {Math.round(maxRisk * 100)}%
          </label>
        )}
        {ship.automationNote && active.length > 0 && <div className="shipyard-reason ship-automation-note">{ship.automationNote}</div>}
      </div>
    </>
  )
}

// Auto-explore for a whole fleet, in the fleet menu: one click turns it on or off for every
// Turing Scout of the fleet, and the scope buttons set theirs. Nothing shows for a fleet with none.
export function FleetExploreToggle({ ships }: { ships: ShipInstance[] }) {
  const toggle = useShipStore((s) => s.toggleAutomation)
  const setScope = useShipStore((s) => s.setExploreScope)
  const scouts = ships.filter((s) => automationsFor(resolveShipClass(s.classId)?.role, s.classId).includes('explore'))
  if (scouts.length === 0) return null
  const on = scouts.filter((s) => s.automations?.includes('explore')).length
  const label = on === scouts.length ? 'On' : on === 0 ? 'Off' : 'Mixed'
  const scopes = new Set(scouts.map((s) => s.exploreScope ?? DEFAULT_EXPLORE_SCOPE))
  const scope = scopes.size === 1 ? [...scopes][0] : null
  return (
    <span className="fleet-explore">
      <button
        type="button"
        className={`nav-subtab${on === scouts.length ? ' active' : ''}`}
        onClick={() => scouts.forEach((s) => (on === scouts.length) === !!s.automations?.includes('explore') && toggle(s.id, 'explore'))}
        title="Turn Auto-explore on or off for every Turing Scout of this fleet. They split the places to explore between them"
      >
        Auto-explore: {label}
      </button>
      {EXPLORE_SCOPES.map((sc) => (
        <button key={sc} type="button" className={`nav-subtab${scope === sc ? ' active' : ''}`} onClick={() => scouts.forEach((s) => setScope(s.id, sc))} title={EXPLORE_SCOPE_TIPS[sc]}>
          {EXPLORE_SCOPE_LABELS[sc]}
        </button>
      ))}
    </span>
  )
}
