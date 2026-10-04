import { getCountry } from '../data/countryData'
import { MAX_QUEUED_BUILDS } from '../data/shipyardData'
import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import { resolveShipClass } from '../state/shipClassResolver'
import { useResourceStore } from '../state/resourceStore'
import { useShipyardStore } from '../state/shipyardStore'
import { useTechStore } from '../state/techStore'
import type { ShipInstance } from '../state/shipStore'
import { orderUpgrade } from './upgradeOrders'
import { atShipyard, isEngaged, nextLevel, upgradeBlock, upgradeCost, upgradeDays, upgradeTarget } from './shipUpgrade'

const NAMES = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>

// The upgrade row of ShipPanel: queue this ship for the next level of its class at the
// shipyard (a slip, the cost difference, half the new build time), or watch/cancel it.
// Its own component so its hooks stay clear of ShipPanel's early return.
export function ShipUpgradeSection({ ship }: { ship: ShipInstance }) {
  const researched = useTechStore((s) => s.stateFor(ship.ownerId).researched)
  const amounts = useResourceStore((s) => s.stateFor(ship.ownerId).amounts)
  const orders = useShipyardStore((s) => s.ordersFor(ship.ownerId))
  const next = nextLevel(ship.classId, resolveShipClass)
  const mine = orders.find((o) => o.upgradeShipId === ship.id)
  if (!next && !mine) return null
  if (mine) {
    return (
      <div className="inspect-row">
        <span className="inspect-label">Upgrade</span>
        <span className="inspect-value">
          {mine.startedSimDays === null ? `Queued for ${mine.className}` : `Upgrading to ${mine.className}`}
          <button type="button" className="ship-panel-unfollow-btn" onClick={() => useShipyardStore.getState().cancelBuild(ship.ownerId, mine.id)} title="Cancel: the full cost is refunded and the ship is free again">
            Cancel
          </button>
        </span>
      </div>
    )
  }
  const from = resolveShipClass(ship.classId)
  const to = upgradeTarget(ship.classId, researched, resolveShipClass)
  const shown = to ?? next!
  const cost = from ? upgradeCost(from, shown) : {}
  const costText = Object.entries(cost).map(([id, n]) => `${n} ${NAMES[id as ResourceId]}`).join(', ') || 'free'
  const days = upgradeDays(shown)
  const capital = getCountry(ship.ownerId)?.capitalBodyName
  const block = upgradeBlock({
    classId: ship.classId,
    researched,
    amounts,
    classOf: resolveShipClass,
    // Away from the yard the ship flies there by itself (scene/upgradeOrders.ts), so only the other reasons block.
    atYard: true,
    engaged: isEngaged(ship.id),
    alreadyQueued: false,
    queueFull: orders.length >= MAX_QUEUED_BUILDS,
  })
  const away = !atShipyard(ship)
  const reason = block
  const headed = ship.arrivalCommand?.command.kind === 'upgrade'
  return (
    <div className="inspect-row">
      <span className="inspect-label">Upgrade</span>
      <span className="inspect-value">
        <button
          type="button"
          className="ship-panel-unfollow-btn"
          disabled={!!block || headed}
          onClick={() => orderUpgrade(ship.id)}
          title={reason ?? `${away && capital ? `Flies to ${capital} (the shipyard) by itself, then upgrades` : 'Upgrade'} this ship to a ${shown.name}: ${costText}, ${days} days in a slip. Cancel for a full refund.`}
        >
          {headed ? `Flying to ${capital} to upgrade` : `${away ? 'Fly to yard and upgrade' : 'Upgrade'} to ${shown.name} · ${costText} · ${days} days`}
        </button>
        {reason && <span className="abs-dim"> {reason}</span>}
      </span>
    </div>
  )
}
