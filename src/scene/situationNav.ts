// What clicking a Situations line does (store I/O): go to the place, select and show the ship,
// or open the battle.
import type { SituationAction } from './situations'
import { goToEvent } from './eventNavigation'
import { viewShip } from './shipNav'
import { openBattle } from './battleNav'
import { useShipStore } from '../state/shipStore'
import { useBattleStore } from '../state/battleStore'
import { useViewStore } from '../state/viewStore'

export function runSituationAction(action: SituationAction): void {
  if (action.kind === 'place') {
    // A map place closes the panel so the map shows; a panel place opens that panel.
    if (!action.place.nav) useViewStore.getState().setNavCategory(null, null)
    goToEvent({ kind: 'holding', place: action.place })
    return
  }
  if (action.kind === 'ship') {
    const ship = useShipStore.getState().ships.find((s) => s.id === action.shipId)
    if (!ship) return
    useViewStore.getState().setNavCategory(null, null)
    useShipStore.getState().selectShip(ship.id)
    viewShip(ship)
    return
  }
  const battle = useBattleStore.getState().battles.find((b) => b.key === action.key)
  if (battle) {
    useViewStore.getState().setNavCategory(null, null)
    openBattle(battle)
  }
}
