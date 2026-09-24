import { useEffect } from 'react'
import { playerGroundBattles, playerSpaceBattles, type PlayerBattle } from '../scene/battleList'
import { useArmyStore } from '../state/armyStore'
import { useBattleStore } from '../state/battleStore'
import { useCombatStore } from '../state/combatStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { usePlayerStore } from '../state/playerStore'
import { useShipStore } from '../state/shipStore'

const keyOf = (battles: PlayerBattle[]) => battles.map((b) => `${b.key}@${b.starId ?? ''}`).join('|')

// Keeps the battle list (state/battleStore.ts) in step with the game: rebuilt
// whenever combat, armies, ships, wars or the player change, but only written
// when the set of battles actually differs, so nothing downstream re-renders
// on every combat step.
export function refreshBattles(): void {
  const playerId = usePlayerStore.getState().selectedCountryId
  const next = [
    ...playerSpaceBattles(useCombatStore.getState().engagements, useShipStore.getState().ships, playerId),
    ...playerGroundBattles(useArmyStore.getState().armies, playerId),
  ]
  if (keyOf(next) !== keyOf(useBattleStore.getState().battles)) useBattleStore.getState().setBattles(next)
}

export function useBattleTracker() {
  useEffect(() => {
    refreshBattles()
    const unsubs = [
      useCombatStore.subscribe(refreshBattles),
      useArmyStore.subscribe(refreshBattles),
      useShipStore.subscribe(refreshBattles),
      usePlayerStore.subscribe(refreshBattles),
      useDiplomacyStore.subscribe(refreshBattles),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])
}
