// "Upgrade" from the ship panel: at the shipyard world it queues the upgrade at once; anywhere
// else the ship flies to the shipyard (its nation's capital world) by itself and queues it on
// arrival (the ship command `upgrade`, fired through ShipInstance.arrivalCommand like a refill).
import { getCountry } from '../data/countryData'
import { useShipStore } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipyardStore } from '../state/shipyardStore'
import { confirmRiskyJump } from './jumpConfirm'
import { queueMoveOrder } from './commsVisual'
import { atShipyard } from './shipUpgrade'

export function orderUpgrade(shipId: string): void {
  const store = useShipStore.getState()
  const ship = store.ships.find((s) => s.id === shipId)
  const capital = ship ? getCountry(ship.ownerId) : undefined
  if (!ship || !capital) return
  if (atShipyard(ship)) {
    useShipyardStore.getState().queueUpgrade(ship.ownerId, shipId, useGameTimeStore.getState().simDays)
    return
  }
  const destination = { kind: 'body' as const, systemId: capital.capitalStarId, bodyName: capital.capitalBodyName }
  // The arrival command is set only once the order is given (a risky jump asks first).
  confirmRiskyJump([ship], destination, () => {
    store.setArrivalCommand(shipId, { starId: capital.capitalStarId, bodyName: capital.capitalBodyName, command: { kind: 'upgrade' } })
    queueMoveOrder(ship, destination)
  })
}
