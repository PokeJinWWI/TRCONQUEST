// Opening inspector panels from the map. A left click selects (the panel opens
// docked on the right, see windowLayoutStore.DOCKED_WINDOW_KEYS); a right
// click is a move order while you have ships selected, and otherwise opens
// that thing's panel full screen.
import { useShipStore } from '../state/shipStore'
import { isPlayerOwned } from '../state/shipRelations'
import { useViewStore } from '../state/viewStore'
import { useWindowLayoutStore } from '../state/windowLayoutStore'

export function hasOwnShipSelected(): boolean {
  const { ships, selectedShipIds } = useShipStore.getState()
  return ships.some((s) => selectedShipIds.includes(s.id) && isPlayerOwned(s))
}

// A body's (or star's) panel, full screen. `key` is the window's memory key.
export function openInViewFull(id: string, key: 'planet' | 'star' = 'planet'): void {
  useShipStore.getState().selectShip(null)
  useViewStore.getState().selectInView(id)
  useWindowLayoutStore.getState().requestOpenMode(key, 'maximized')
}

// A ship's panel, full screen.
export function openShipFull(shipId: string): void {
  useShipStore.getState().selectShip(shipId)
  useWindowLayoutStore.getState().requestOpenMode('ship', 'maximized')
}
