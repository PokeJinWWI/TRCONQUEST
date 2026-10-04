// Which order arrows the galactic view draws, and where they point. The same three line
// kinds as the interstellar view (a committed order, a command still behind comms delay,
// the legs queued behind the current order), one scale up: destinations are clusters and
// bare points of galactic space, in galactic scene units. Pure, so it is tested.
import { Vector3 } from 'three'
import type { MoveDestination, ShipInstance } from '../state/shipStore'
import { clusterScenePosition, isGalacticDestination, isShipInGalacticSpace } from './shipPhysics'

// A destination in the galactic frame, or null when it is not one (a star or a world is
// a place inside a neighbourhood: this view has no coordinate for it).
export function galacticDestinationPosition(destination: MoveDestination): Vector3 | null {
  if (destination.kind === 'cluster') return clusterScenePosition(destination.clusterId)
  if (destination.kind === 'galactic-point') return new Vector3(...destination.position)
  return null
}

export interface GalacticOrderLines {
  // Flying a galactic order now: the solid arrow.
  committed: ShipInstance[]
  // Told to go to a cluster or galactic point, the signal not there yet: the dashed arrow.
  pending: ShipInstance[]
  // Flying a galactic order with more legs queued behind it: the dashed route.
  queued: ShipInstance[]
}

// The player's own ships' lines for the galactic view (other nations' orders are never
// shown, as in every other view).
export function galacticOrderLines(ships: readonly ShipInstance[], playerId: string | null): GalacticOrderLines {
  const own = ships.filter((s) => s.ownerId === playerId)
  return {
    committed: own.filter((s) => s.order && isShipInGalacticSpace(s)),
    pending: own.filter((s) => s.pendingMoveOrder && isGalacticDestination(s.pendingMoveOrder.destination)),
    queued: own.filter((s) => (s.orderQueue?.length ?? 0) > 0 && s.order && isGalacticDestination(s.order.destination)),
  }
}
