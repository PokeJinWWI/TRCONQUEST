import { useState } from 'react'
import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import { STARBASE_COST } from '../data/starbaseData'
import { STARS } from '../data/starData'
import type { ResourceCost } from '../data/shipyardData'
import { resolveShipClass } from '../state/shipClassResolver'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { useResourceStore } from '../state/resourceStore'
import { useStarbaseStore, canBuildStarbase } from '../state/starbaseStore'
import { useTerritoryStore } from '../state/territoryStore'
import { queueShipCommand } from './shipCommands'
import { cargoSpace, cargoTotal, loadingBody, transferCheck } from './cargoLogic'
import { restingStarId } from './surveyLogic'
import { nearestStation, orderRefill, refillWant } from './refill'
import { useGameTimeStore } from '../state/gameTimeStore'

const NAMES = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>
// What Load offers: the goods a Starbase (or a ship) is built from.
const LOADABLE: ResourceId[] = ['alloys', 'energy', 'exoticMatter']

function describe(cost: ResourceCost): string {
  return (Object.entries(cost) as [ResourceId, number][]).filter(([, n]) => n > 0).map(([id, n]) => `${n} ${NAMES[id]}`).join(', ')
}

// The hold of a Construction or Cargo Ship, and what can be done with it: load
// at an owned world, hand it to another ship in the same place, and (for a
// Construction Ship) build a Starbase out of it. A separate component so its
// hooks stay clear of ShipPanel's early return. Every action is a ship command,
// so out of comms contact it travels as a signal (scene/shipCommands.ts).
export function ShipCargoSection({ ship }: { ship: ShipInstance }) {
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const ships = useShipStore((s) => s.ships)
  const starbases = useStarbaseStore((s) => s.starbases)
  const stock = useResourceStore((s) => s.stateFor(ship.ownerId).amounts)
  const [targetId, setTargetId] = useState('')
  const simDays = useGameTimeStore((s) => Math.floor(s.simDays))

  const shipClass = resolveShipClass(ship.classId)
  const capacity = shipClass?.cargoCapacity ?? 0
  if (capacity <= 0) return null

  const hold = ship.cargo ?? {}
  const loading = loadingBody(ship, owners)
  const space = cargoSpace(capacity, hold)
  const kit = (Object.entries(STARBASE_COST) as [ResourceId, number][]).reduce<ResourceCost>((acc, [id, n]) => ({ ...acc, [id]: Math.max(0, n - (hold[id] ?? 0)) }), {})
  const others = ships.filter((s) => s.id !== ship.id && (resolveShipClass(s.classId)?.cargoCapacity ?? 0) > 0 && transferCheck(ship, s).ok)
  const target = others.find((s) => s.id === targetId) ?? others[0]
  const star = restingStarId(ship)
  const build = shipClass?.role === 'construction' ? canBuildStarbase(ship.ownerId, star ?? '', starbases, ship.id) : null
  const pending = (ship.pendingCommands ?? []).length
  const refillEmpty = Object.keys(refillWant(ship.cargo, capacity)).length === 0
  const station = loading.ok ? null : nearestStation(ship, owners, simDays)

  return (
    <>
      <div className="inspect-row">
        <span className="inspect-label">Hold</span>
        <span className="inspect-value">
          {cargoTotal(hold)} / {capacity}
          {cargoTotal(hold) > 0 && <> — {describe(hold)}</>}
        </span>
      </div>
      {pending > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Orders</span>
          <span className="inspect-value">{pending} in transit…</span>
        </div>
      )}

      {ship.arrivalCommand?.command.kind === 'load' && ship.arrivalCommand.bodyName && (
        <div className="inspect-row">
          <span className="inspect-label">On arrival</span>
          <span className="inspect-value">Load at {ship.arrivalCommand.bodyName}</span>
        </div>
      )}
      <div className="ship-panel-btn-row">
        <button
          type="button"
          className="detail-view-btn"
          disabled={refillEmpty || (!loading.ok && !station)}
          title={
            refillEmpty
              ? 'The hold is already full'
              : loading.ok
                ? `Fill the hold with Starbase kits from your stockpile at ${loading.bodyName}`
                : station
                  ? `Fly to ${station.bodyName}, your nearest world, and fill the hold with Starbase kits there`
                  : 'You own no world to refill at'
          }
          onClick={() => orderRefill(ship.id)}
        >
          {loading.ok ? 'Refill' : 'Refill at nearest station'}
        </button>
      </div>
      <div className="ship-panel-hint">{loading.ok ? `Load at ${loading.bodyName}:` : 'Or, at one of your worlds:'}</div>
      <div className="ship-panel-btn-row">
        <button
          type="button"
          className="detail-view-btn"
          disabled={!loading.ok || space <= 0 || Object.values(kit).every((n) => !n)}
          title={loading.ok ? `Load what a Starbase needs (${describe(STARBASE_COST)}) from your stockpile` : loading.reason}
          onClick={() => queueShipCommand(ship.id, { kind: 'load', want: kit })}
        >
          Load Starbase kit
        </button>
        {LOADABLE.map((id) => (
          <button
            key={id}
            type="button"
            className="detail-view-btn"
            disabled={!loading.ok || space <= 0 || (stock[id] ?? 0) < 1}
            title={loading.ok ? `Fill the hold with ${NAMES[id]} (you have ${Math.floor(stock[id] ?? 0)})` : loading.reason}
            onClick={() => queueShipCommand(ship.id, { kind: 'load', want: { [id]: space } })}
          >
            Fill {NAMES[id]}
          </button>
        ))}
      </div>

      <div className="ship-panel-hint">{others.length > 0 ? 'Hand goods to a ship here:' : 'No other cargo-carrying ship of yours is resting here to hand goods to.'}</div>
      {others.length > 0 && (
        <div className="ship-panel-btn-row">
          <select value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)}>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="detail-view-btn"
            disabled={!target || cargoTotal(hold) <= 0}
            onClick={() => target && queueShipCommand(ship.id, { kind: 'transfer', toShipId: target.id, want: hold })}
          >
            Transfer all
          </button>
        </div>
      )}

      {build && (
        <button
          type="button"
          className="detail-view-btn"
          disabled={!build.ok}
          title={build.ok ? `Build a Starbase at ${STARS.find((s) => s.id === star)?.name ?? star}, paid from the hold` : build.reason}
          onClick={() => queueShipCommand(ship.id, { kind: 'build-starbase' })}
        >
          Build Starbase
        </button>
      )}
      {build && !build.ok && <div className="ship-panel-hint">{build.reason}</div>}
    </>
  )
}
