import type { TabViewSnapshot } from '../state/workspaceStore'
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

// The same destination as a new tab's view (Ctrl/Cmd-click on a battle).
export function battleTabPatch(battle: PlayerBattle): Partial<TabViewSnapshot> {
  const star = battle.starId ? { selectedStarId: battle.starId } : {}
  if (battle.kind === 'terrain' && battle.terrainBattleId && battle.bodyName) return { ...star, level: 'terrain', terrainBattleId: battle.terrainBattleId, selectedBodyName: battle.bodyName, inViewSelection: null }
  if (battle.kind === 'space' && battle.engagementId) return { ...star, level: 'combat', combatEngagementId: battle.engagementId }
  if (battle.bodyName) return { ...star, level: 'ground', selectedBodyName: battle.bodyName, inViewSelection: null, terrainBattleId: null }
  return star
}
