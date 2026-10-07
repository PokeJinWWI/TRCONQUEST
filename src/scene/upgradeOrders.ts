// "Upgrade" and "Repair" from the ship panel and the Fleet Manager: at a shipyard (the
// capital world, or a Starbase with a shipyard module) the order is queued at once;
// anywhere else the ship flies to the NEAREST yard by itself and queues it on arrival
// (the ship commands `upgrade` / `repair`, fired through ShipInstance.arrivalCommand like
// a refill). Either takes a slip, FIFO like any build. A fleet is just each of its ships.
import { useShipStore, type MoveDestination, type ShipCommand, type ShipInstance } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipyardStore } from '../state/shipyardStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { useTechStore } from '../state/techStore'
import { confirmRiskyJump } from './jumpConfirm'
import { queueMoveOrder } from './commsVisual'
import { atShipyard, nearestYard, upgradeTarget, type YardSite } from './shipUpgrade'
import { REPAIR_MIN_DAMAGE, damageFraction } from './shipRepair'

function yardDestination(site: YardSite): MoveDestination {
  return site.bodyName ? { kind: 'body', systemId: site.starId, bodyName: site.bodyName } : { kind: 'star', starId: site.starId }
}

function sendToYard(ship: ShipInstance, command: ShipCommand): void {
  const site = nearestYard(ship)
  if (!site) return
  const destination = yardDestination(site)
  const store = useShipStore.getState()
  // The arrival command is set only once the order is given (a risky jump asks first).
  confirmRiskyJump([ship], destination, () => {
    store.setArrivalCommand(ship.id, { starId: site.starId, bodyName: site.bodyName, command })
    queueMoveOrder(ship, destination)
  })
}

function orderAtYard(shipId: string, kind: 'upgrade' | 'repair'): void {
  const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
  if (!ship) return
  if (atShipyard(ship)) {
    const yard = useShipyardStore.getState()
    const now = useGameTimeStore.getState().simDays
    if (kind === 'upgrade') yard.queueUpgrade(ship.ownerId, shipId, now)
    else yard.queueRepair(ship.ownerId, shipId, now)
    return
  }
  sendToYard(ship, { kind })
}

export function orderUpgrade(shipId: string): void {
  orderAtYard(shipId, 'upgrade')
}

export function orderRepair(shipId: string): void {
  orderAtYard(shipId, 'repair')
}

function inYardWork(ship: ShipInstance): boolean {
  if (ship.upgrading) return true
  const kind = ship.arrivalCommand?.command.kind
  return kind === 'upgrade' || kind === 'repair'
}

// Which of these ships have something to repair / a level to upgrade to (and are not already on it).
export function repairable(ships: ShipInstance[]): ShipInstance[] {
  return ships.filter((s) => !inYardWork(s) && damageFraction(s) >= REPAIR_MIN_DAMAGE)
}
export function upgradable(ships: ShipInstance[]): ShipInstance[] {
  return ships.filter((s) => !inYardWork(s) && !!upgradeTarget(s.classId, useTechStore.getState().stateFor(s.ownerId).researched, resolveShipClass))
}

// "Repair fleet" / "Upgrade fleet": every ship that needs it goes to its nearest yard and queues.
export function orderFleetRepair(ships: ShipInstance[]): void {
  for (const s of repairable(ships)) orderRepair(s.id)
}
export function orderFleetUpgrade(ships: ShipInstance[]): void {
  for (const s of upgradable(ships)) orderUpgrade(s.id)
}
