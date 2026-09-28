// Bringing a ship into view from anywhere (the Outliner's fleet list, the ship
// panel's Go To when the ship isn't in the current view): open the map it is
// on — its star system, or interstellar space — and leave it to the scene's own
// selection tracking to frame it.
import { useViewStore } from '../state/viewStore'
import type { ShipInstance } from '../state/shipStore'
import { shipSystemId } from './shipPhysics'

export function viewShip(ship: Pick<ShipInstance, 'order' | 'location'>): void {
  const view = useViewStore.getState()
  const systemId = shipSystemId(ship)
  if (systemId) {
    const there = view.selectedStarId === systemId && (view.level === 'system' || view.level === 'satellite')
    if (!there) view.enterSystem(systemId)
  } else if (view.level !== 'interstellar') {
    view.enterInterstellar('solar-neighborhood')
  }
}
