// Bringing a ship into view from anywhere (the Outliner's fleet list, the ship
// panel's Go To when the ship isn't in the current view): open the map it is
// on — its star system, or interstellar space — and leave it to the scene's own
// selection tracking to frame it. In the galactic view that map is its cluster's.
import { useViewStore } from '../state/viewStore'
import type { ShipInstance } from '../state/shipStore'
import { isShipInGalacticSpace, shipSystemId } from './shipPhysics'
import { shipClusterId } from './clusters'
import { SOLAR_NEIGHBORHOOD_ID } from '../data/galaxyGen'

export function viewShip(ship: Pick<ShipInstance, 'order' | 'location'>): void {
  const view = useViewStore.getState()
  // From the galaxy, a ship inside a cluster is brought up on that cluster's map, one
  // zoom level down (the selection tracker then frames the ship), not on its star's
  // system view: the galaxy shows clusters, so the cluster is where "go to" lands.
  const inside = view.level === 'galactic' && !isShipInGalacticSpace(ship) ? shipClusterId(ship) : null
  if (inside) {
    view.enterInterstellar(inside, true)
    return
  }
  const systemId = shipSystemId(ship)
  if (systemId) {
    const there = view.selectedStarId === systemId && (view.level === 'system' || view.level === 'satellite')
    if (!there) view.enterSystem(systemId)
  } else if (isShipInGalacticSpace(ship)) {
    // Out between clusters: its place is the galactic view.
    if (view.level !== 'galactic') view.enterGalactic()
  } else {
    // In interstellar space: the map of the cluster it is in (ours, or another).
    const cluster = shipClusterId(ship) ?? SOLAR_NEIGHBORHOOD_ID
    if (view.level !== 'interstellar' || view.selectedNeighborhoodId !== cluster) view.enterInterstellar(cluster)
  }
}
