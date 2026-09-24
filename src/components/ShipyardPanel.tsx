import { useMemo, useState } from 'react'
import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import { SHIP_CLASSES, SHIP_ROLE_LABELS, describeFtlDrive, type ShipClass } from '../data/shipData'
import { MAX_QUEUED_BUILDS, RESOURCE_INCOME_PER_MONTH, shipBuildCost, shipBuildDays, type ResourceCost } from '../data/shipyardData'
import { resolveShipClass } from '../state/shipClassResolver'
import { useShipDesignStore } from '../state/shipDesignStore'
import { usePlayerResources } from '../hooks/usePlayerResources'
import { usePlayerStore } from '../state/playerStore'
import { useShipyardStore } from '../state/shipyardStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { shipyardSlotsForWorld } from '../scene/shipyardLogic'

// The resources a hull can actually cost — the ones worth a row in the
// stockpile readout (minerals only feed a future alloy chain).
const COST_RESOURCE_IDS: ResourceId[] = ['alloys', 'energy', 'exoticMatter', 'hyperium', 'special']
const RESOURCE_SHORT = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>

function CostChips({ cost, amounts }: { cost: ResourceCost; amounts: Record<ResourceId, number> }) {
  return (
    <span className="shipyard-costs">
      {COST_RESOURCE_IDS.filter((id) => (cost[id] ?? 0) > 0).map((id) => {
        const short = (cost[id] ?? 0) > (amounts[id] ?? 0)
        return (
          <span key={id} className={`shipyard-cost${short ? ' short' : ''}`} title={`${RESOURCE_SHORT[id]}: need ${cost[id]}, have ${amounts[id] ?? 0}`}>
            {cost[id]} {RESOURCE_SHORT[id]}
          </span>
        )
      })}
    </span>
  )
}

// Military > Navy > Shipyard: how a player without the debug console gets
// ships. Pick a hull, pay its resources up front, wait its build time at the
// capital, and the finished ship appears in orbit there. See
// data/shipyardData.ts for costs/timing/supply (all placeholder tuning) and
// hooks/useShipyardResolver for what actually advances the queue.
export function ShipyardPanel() {
  const { world } = usePlayerEconomy()
  const { amounts } = usePlayerResources()
  const countryId = usePlayerStore((s) => s.selectedCountryId) ?? ''
  const orders = useShipyardStore((s) => s.ordersFor(countryId))
  const queueBuild = useShipyardStore((s) => s.queueBuild)
  const cancelBuild = useShipyardStore((s) => s.cancelBuild)
  const designs = useShipDesignStore((s) => s.designs)
  const simDays = useGameTimeStore((s) => s.simDays)
  const [message, setMessage] = useState<string | null>(null)

  const slots = shipyardSlotsForWorld(world)
  const buildable = useMemo(
    () => [
      ...SHIP_CLASSES,
      ...designs.map((d) => resolveShipClass(`design:${d.id}`)).filter((c): c is ShipClass => !!c),
    ],
    [designs],
  )
  const building = orders.filter((o) => o.startedSimDays !== null).length

  const handleBuild = (classId: string) => {
    const result = queueBuild(countryId, classId, simDays)
    setMessage(result.ok ? null : result.reason)
  }

  return (
    <div className="fleet-list">
      <div className="ship-panel-hint strategizer-intro">
        Ships are built at your capital and appear in orbit around it. Cost is paid up front and refunded in full if you
        cancel. Capacity: <b>{slots}</b> at once ({building} building, {orders.length - building} waiting) — build Spaceyards in
        Economy &gt; Construction for more.
      </div>

      <div className="fleet-group-header">Stockpile</div>
      <div className="shipyard-stockpile">
        {COST_RESOURCE_IDS.map((id) => (
          <span key={id} className="shipyard-stock" title={RESOURCE_TYPES.find((r) => r.id === id)?.description}>
            {RESOURCE_SHORT[id]} <b>{(amounts[id] ?? 0).toLocaleString()}</b>
            {(RESOURCE_INCOME_PER_MONTH[id] ?? 0) > 0 && <span className="shipyard-income"> +{RESOURCE_INCOME_PER_MONTH[id]}/mo</span>}
          </span>
        ))}
      </div>

      {orders.length > 0 && (
        <>
          <div className="fleet-group-header">Under construction</div>
          {orders.map((o) => {
            const started = o.startedSimDays !== null && o.finishSimDays !== null
            const fraction = started ? Math.min(1, Math.max(0, (simDays - o.startedSimDays!) / o.durationDays)) : 0
            const daysLeft = started ? Math.max(0, o.finishSimDays! - simDays) : o.durationDays
            return (
              <div key={o.id} className="fleet-row">
                <div className="fleet-row-head">
                  <span className="fleet-row-name">{o.className}</span>
                  <span className="fleet-row-class">{started ? `${daysLeft.toFixed(1)}d left` : 'Waiting for a slot'}</span>
                  <button type="button" className="ship-panel-unfollow-btn" onClick={() => cancelBuild(countryId, o.id)} title="Cancel and refund the full cost">
                    Cancel
                  </button>
                </div>
                <div className="fleet-row-bar">
                  <span className="health-bar-track tone-overall combat-roster-bar">
                    <span className="health-bar-fill" style={{ width: `${fraction * 100}%` }} />
                  </span>
                  <span className="combat-roster-pct">{Math.round(fraction * 100)}%</span>
                </div>
              </div>
            )
          })}
        </>
      )}

      <div className="fleet-group-header">Build a ship</div>
      {message && <div className="ship-panel-hint shipyard-message">{message}</div>}
      {buildable.map((shipClass) => {
        const cost = shipBuildCost(shipClass)
        const affordable = COST_RESOURCE_IDS.every((id) => (cost[id] ?? 0) <= (amounts[id] ?? 0))
        const queueFull = orders.length >= MAX_QUEUED_BUILDS
        return (
          <div key={shipClass.id} className="fleet-row">
            <div className="fleet-row-head">
              <span className="fleet-row-name">{shipClass.name}</span>
              <span className="fleet-row-class">{SHIP_ROLE_LABELS[shipClass.role]}</span>
              <button
                type="button"
                className="ship-panel-unfollow-btn"
                disabled={!affordable || queueFull}
                onClick={() => handleBuild(shipClass.id)}
                title={queueFull ? 'The build queue is full' : affordable ? `Build for ${shipBuildDays(shipClass)} days` : 'Not enough resources'}
              >
                Build
              </button>
            </div>
            <div className="fleet-row-status">
              {shipClass.ftlDrives.map(describeFtlDrive).join(', ')} · {shipBuildDays(shipClass)} days
            </div>
            <CostChips cost={cost} amounts={amounts} />
          </div>
        )
      })}
    </div>
  )
}
