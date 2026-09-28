import { useShipStore } from '../state/shipStore'
import { isAdditiveClick } from './selectionInput'

// A right-click is an order (move here), never a deselect — r3f also reports a
// right-click on empty space as a "pointer missed", so every miss handler asks.
export function isSecondaryClick(event: { type?: string; button?: number }): boolean {
  return event.type === 'contextmenu' || (event.button ?? 0) !== 0
}

// A plain click on empty space drops the ship selection, like it drops the
// body selection (each scene's own handler does that). Shift/Ctrl/Cmd-click
// leaves it alone — that's the "add to the selection" gesture, so a slipped
// modifier click doesn't wipe a selection built up on purpose.
export function deselectShipsOnEmptyClick(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; type?: string; button?: number }): void {
  if (isAdditiveClick(event) || isSecondaryClick(event)) return
  const store = useShipStore.getState()
  if (store.selectedShipIds.length > 0) store.selectShip(null)
}
