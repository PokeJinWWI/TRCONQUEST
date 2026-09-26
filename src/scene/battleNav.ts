// Opening a battle from anywhere (the Outliner's Battles list, a combat
// indicator on a map): bring its system into view, then the combat arena
// (space) or the planetary map (ground).
import type { PlayerBattle } from './battleList'
import { useViewStore } from '../state/viewStore'

export function openBattle(battle: PlayerBattle): void {
  const view = useViewStore.getState()
  if (battle.starId && view.selectedStarId !== battle.starId) useViewStore.setState({ selectedStarId: battle.starId })
  if (battle.kind === 'terrain' && battle.terrainBattleId && battle.bodyName) view.enterTerrain(battle.terrainBattleId, battle.bodyName)
  else if (battle.kind === 'space' && battle.engagementId) view.enterCombat(battle.engagementId)
  else if (battle.bodyName) view.enterGround(battle.bodyName)
}
