// "Refill at nearest station": a hauler that isn't orbiting one of its nation's
// worlds flies to the nearest one and loads there on arrival, instead of being
// told it can't load. A "station" is any world the nation owns.
import { confirmRiskyJump } from './jumpConfirm'
import { STARBASE_COST } from '../data/starbaseData'
import { STARS } from '../data/starData'
import type { ResourceCost } from '../data/shipyardData'
import type { ResourceId } from '../data/resourceData'
import { resolveShipClass } from '../state/shipClassResolver'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useTerritoryStore } from '../state/territoryStore'
import { queueMoveOrder } from './commsVisual'
import { loadingBody, type Cargo } from './cargoLogic'
import { queueShipCommand } from './shipCommands'
import { bodyLivePosition, getShipRenderPosition, KM_PER_SYSTEM_UNIT, LY_IN_KM } from './shipPhysics'
import { bodyIndex, type OwnerMap } from './territory'

// How much a refill asks for: as many Starbase kits as the hold fits (a hold too
// small for one kit just takes alloys), less what it already carries.
export function refillWant(hold: Cargo | undefined, capacity: number): ResourceCost {
  const kitUnits = Object.values(STARBASE_COST).reduce((a, b) => a + (b ?? 0), 0)
  const kits = Math.floor(capacity / kitUnits)
  const target: ResourceCost = kits > 0 ? Object.fromEntries(Object.entries(STARBASE_COST).map(([id, n]) => [id, (n ?? 0) * kits])) : { alloys: capacity }
  const want: ResourceCost = {}
  for (const [id, n] of Object.entries(target) as [ResourceId, number][]) {
    const need = n - (hold?.[id] ?? 0)
    if (need > 0) want[id] = need
  }
  return want
}

function starPositionLy(starId: string): [number, number, number] {
  return STARS.find((s) => s.id === starId)?.position ?? [0, 0, 0]
}

// Rough distance in km from where the ship is now to a body: in-system when they
// share a system, otherwise dominated by the star-to-star distance.
function distanceKm(ship: ShipInstance, body: { name: string; starId: string }, simDays: number): number {
  const here = getShipRenderPosition(ship, simDays)
  if (here.space === 'system' && here.systemId === body.starId) return here.position.distanceTo(bodyLivePosition(body.name, simDays)) * KM_PER_SYSTEM_UNIT
  const hereStar = here.space === 'system' && here.systemId ? starPositionLy(here.systemId) : here.position.toArray().map((v) => v / 8)
  const there = starPositionLy(body.starId)
  return Math.hypot(hereStar[0] - there[0], hereStar[1] - there[1], hereStar[2] - there[2]) * LY_IN_KM
}

// The nearest world of the ship's own nation, or null if it owns none.
export function nearestStation(ship: ShipInstance, owners: OwnerMap, simDays: number): { systemId: string; bodyName: string } | null {
  let best: { systemId: string; bodyName: string; km: number } | null = null
  for (const body of bodyIndex().values()) {
    if (owners[body.name] !== ship.ownerId) continue
    const km = distanceKm(ship, body, simDays)
    if (!best || km < best.km) best = { systemId: body.starId, bodyName: body.name, km }
  }
  return best ? { systemId: best.systemId, bodyName: best.bodyName } : null
}

// The button's action. At one of its nation's worlds it loads at once; anywhere
// else it flies to the nearest and loads on arrival.
export function orderRefill(shipId: string): void {
  const store = useShipStore.getState()
  const ship = store.ships.find((s) => s.id === shipId)
  const capacity = ship ? resolveShipClass(ship.classId)?.cargoCapacity ?? 0 : 0
  if (!ship || capacity <= 0) return
  const want = refillWant(ship.cargo, capacity)
  if (Object.keys(want).length === 0) return
  const owners = useTerritoryStore.getState().bodyOwner
  if (loadingBody(ship, owners).ok) {
    queueShipCommand(shipId, { kind: 'load', want })
    return
  }
  const station = nearestStation(ship, owners, useGameTimeStore.getState().simDays)
  if (!station) return
  const destination = { kind: 'body' as const, systemId: station.systemId, bodyName: station.bodyName }
  // The arrival command is set only once the order is given (a risky jump asks first).
  confirmRiskyJump([ship], destination, () => {
    store.setArrivalCommand(shipId, { starId: station.systemId, bodyName: station.bodyName, command: { kind: 'load', want } })
    queueMoveOrder(ship, destination)
  })
}
