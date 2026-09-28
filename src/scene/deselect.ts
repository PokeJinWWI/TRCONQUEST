import { useShipStore } from '../state/shipStore'
import { isAdditiveClick } from './selectionInput'

// A plain click on empty space drops the ship selection, like it drops the
// body selection (each scene's own handler does that). Shift/Ctrl/Cmd-click
// leaves it alone — that's the "add to the selection" gesture, so a slipped
// modifier click doesn't wipe a selection built up on purpose.
export function deselectShipsOnEmptyClick(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
  if (isAdditiveClick(event)) return
  const store = useShipStore.getState()
  if (store.selectedShipIds.length > 0) store.selectShip(null)
}
