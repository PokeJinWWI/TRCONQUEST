// A ship lost to a hyperspace jump: it is removed, and for the player's own ship a
// notification (a diplomacy event of kind 'ship-lost') says where it was headed
// and the risk it ran; a click goes there. One place for every route a jump can
// kill a ship by (an order, a queued jump, an automated ship, an escape).
import type { EventPlace } from '../data/diplomacyData'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { isPlayerOwned } from '../state/shipRelations'
import { useShipStore, type MoveDestination, type ShipInstance } from '../state/shipStore'
import { destinationLabel } from './shipPhysics'

// The place a click on the notification goes to: the system or world the jump was
// headed to, or the cluster. A bare point of space has none.
export function jumpPlaceOf(destination: MoveDestination | undefined): EventPlace | undefined {
  if (!destination) return undefined
  switch (destination.kind) {
    case 'body':
      return { bodyName: destination.bodyName }
    case 'point':
      return { starId: destination.systemId }
    case 'star':
      return { starId: destination.starId }
    case 'cluster':
      return { neighborhoodId: destination.clusterId }
    default:
      return undefined
  }
}

// The notification's text: "<ship> was lost in a hyperspace jump to <place> (a 43% risk)".
export function jumpLossText(shipName: string, destination: MoveDestination | undefined, chance?: number): string {
  const where = destination ? ` to ${destinationLabel(destination)}` : ''
  const risk = chance !== undefined ? ` (a ${Math.round(chance * 100)}% risk)` : ''
  return `${shipName} was lost in a hyperspace jump${where}${risk}`
}

export function loseShipToJump(ship: ShipInstance, destination?: MoveDestination, chance?: number): void {
  useShipStore.getState().removeShip(ship.id)
  if (!isPlayerOwned(ship)) return
  useDiplomacyStore.getState().pushEvent('ship-lost', [ship.ownerId], jumpLossText(ship.name, destination, chance), useGameTimeStore.getState().simDays, jumpPlaceOf(destination))
}
