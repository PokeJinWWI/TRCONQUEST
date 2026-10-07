import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import { MAX_QUEUED_BUILDS } from '../data/shipyardData'
import { getCountry } from '../data/countryData'
import { resolveShipClass } from '../state/shipClassResolver'
import { useResourceStore } from '../state/resourceStore'
import { useShipyardStore } from '../state/shipyardStore'
import type { ShipInstance } from '../state/shipStore'
import { orderFleetRepair, orderFleetUpgrade, orderRepair, repairable, upgradable } from './upgradeOrders'
import { REPAIR_MIN_DAMAGE, damageFraction, repairBlock, repairCost, repairDays } from './shipRepair'
import { atShipyard, isEngaged, nearestYard } from './shipUpgrade'

const NAMES = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>

// The repair row of ShipPanel: a damaged ship goes to the nearest shipyard by itself, takes
// a slip and comes out pristine. Its own component so its hooks stay clear of ShipPanel's
// early return.
export function ShipRepairSection({ ship }: { ship: ShipInstance }) {
  const amounts = useResourceStore((s) => s.stateFor(ship.ownerId).amounts)
  const orders = useShipyardStore((s) => s.ordersFor(ship.ownerId))
  const mine = orders.find((o) => o.repairShipId === ship.id)
  const damage = damageFraction(ship)
  if (!mine && damage < REPAIR_MIN_DAMAGE) return null
  if (mine) {
    return (
      <div className="inspect-row">
        <span className="inspect-label">Repair</span>
        <span className="inspect-value">
          {mine.startedSimDays === null ? 'Queued at the shipyard' : 'Being repaired'}
          <button type="button" className="ship-panel-unfollow-btn" onClick={() => useShipyardStore.getState().cancelBuild(ship.ownerId, mine.id)} title="Cancel: the cost is refunded and the ship is free again">
            Cancel
          </button>
        </span>
      </div>
    )
  }
  const shipClass = resolveShipClass(ship.classId)
  if (!shipClass) return null
  const cost = repairCost(shipClass, damage)
  const costText = Object.entries(cost).map(([id, n]) => `${n} ${NAMES[id as ResourceId]}`).join(', ')
  const days = repairDays(shipClass, damage)
  const block = repairBlock({
    damage,
    amounts,
    shipClass,
    engaged: isEngaged(ship.id),
    alreadyQueued: orders.some((o) => o.upgradeShipId === ship.id),
    queueFull: orders.length >= MAX_QUEUED_BUILDS,
    // Away from a yard the ship flies to the nearest one by itself, so only the other reasons block.
    atYard: true,
  })
  const away = !atShipyard(ship)
  const yard = nearestYard(ship)
  const yardName = yard?.bodyName ?? (yard ? `the Starbase at ${yard.starId}` : null)
  const headed = ship.arrivalCommand?.command.kind === 'repair'
  return (
    <div className="inspect-row">
      <span className="inspect-label">Repair</span>
      <span className="inspect-value">
        <button
          type="button"
          className="ship-panel-unfollow-btn"
          disabled={!!block || headed || !yard}
          onClick={() => orderRepair(ship.id)}
          title={block ?? `${away && yardName ? `Flies to ${yardName} (the nearest shipyard) by itself, then` : 'Takes'} a slip for ${days} days: ${costText}. Cancel for a refund.`}
        >
          {headed ? `Flying to ${yardName ?? 'the yard'} to repair` : `${away ? 'Fly to yard and repair' : 'Repair'} · ${costText} · ${days} days`}
        </button>
        {block && <span className="abs-dim"> {block}</span>}
      </span>
    </div>
  )
}

// Repair / Upgrade for several ships at once (a fleet): each ship that needs it goes to its
// nearest yard and takes a slip. Shown only for what applies.
export function FleetYardButtons({ ships }: { ships: ShipInstance[] }) {
  const own = ships.filter((s) => !!getCountry(s.ownerId))
  const toRepair = repairable(own).filter((s) => !isEngaged(s.id))
  const toUpgrade = upgradable(own).filter((s) => !isEngaged(s.id))
  if (toRepair.length === 0 && toUpgrade.length === 0) return null
  return (
    <>
      {toRepair.length > 0 && (
        <button type="button" className="detail-view-btn" onClick={() => orderFleetRepair(toRepair)} title="Each damaged ship flies to its nearest shipyard and takes a slip to be repaired (cost scales with the damage)">
          Repair {toRepair.length} damaged
        </button>
      )}
      {toUpgrade.length > 0 && (
        <button type="button" className="detail-view-btn" onClick={() => orderFleetUpgrade(toUpgrade)} title="Each ship with a better level available flies to its nearest shipyard and takes a slip to be upgraded">
          Upgrade {toUpgrade.length}
        </button>
      )}
    </>
  )
}
