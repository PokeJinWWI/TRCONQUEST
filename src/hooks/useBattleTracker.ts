import { useEffect } from 'react'
import { playerContests, playerGroundBattles, playerSpaceBattles, playerTerrainBattles, type PlayerBattle } from '../scene/battleList'
import { useArmyStore } from '../state/armyStore'
import { useBattleStore } from '../state/battleStore'
import { useCombatStore } from '../state/combatStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { usePlayerStore } from '../state/playerStore'
import { useShipStore } from '../state/shipStore'
import { useTerrainStore } from '../state/terrainStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { engagementKnownToPlayer } from '../scene/commsVisual'
import { engagedUnitIds } from '../scene/terrainWar'

const keyOf = (battles: PlayerBattle[]) => battles.map((b) => `${b.key}@${b.starId ?? ''}`).join('|')

// Keeps the battle list (state/battleStore.ts) in step with the game: rebuilt
// whenever combat, armies, ships, wars or the player change, but only written
// when the set of battles actually differs, so nothing downstream re-renders
// on every combat step.
export function refreshBattles(): void {
  const playerId = usePlayerStore.getState().selectedCountryId
  const terrain = useTerrainStore.getState().battles
  const engaged = engagedUnitIds(terrain)
  const armies = useArmyStore.getState().armies
  const next = [
    ...playerSpaceBattles(useCombatStore.getState().engagements, useShipStore.getState().ships, playerId, (e) =>
      engagementKnownToPlayer(e, useShipStore.getState().ships, useGameTimeStore.getState().simDays),
    ),
    ...playerTerrainBattles(terrain, playerId),
    ...playerGroundBattles(armies, playerId, engaged),
    ...playerContests(armies, playerId, undefined, engaged),
  ]
  if (keyOf(next) !== keyOf(useBattleStore.getState().battles)) useBattleStore.getState().setBattles(next)
}

export function useBattleTracker() {
  useEffect(() => {
    refreshBattles()
    const unsubs = [
      useCombatStore.subscribe(refreshBattles),
      useArmyStore.subscribe(refreshBattles),
      useTerrainStore.subscribe(refreshBattles),
      useShipStore.subscribe(refreshBattles),
      usePlayerStore.subscribe(refreshBattles),
      useDiplomacyStore.subscribe(refreshBattles),
      // News of a fight arrives with time, not with a store change.
      useGameTimeStore.subscribe((state, prev) => {
        if (Math.floor(state.simDays) !== Math.floor(prev.simDays)) refreshBattles()
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])
}
