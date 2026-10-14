import { notifyOwner } from '../scene/notify'
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

const battleLabel = (b: PlayerBattle) => `${b.kind === 'space' ? 'Space battle' : 'Ground battle'} at ${b.place}`
const battlePlace = (b: PlayerBattle) => (b.bodyName ? { bodyName: b.bodyName } : b.starId ? { starId: b.starId } : undefined)

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
  const prev = useBattleStore.getState().battles
  if (keyOf(next) === keyOf(prev)) return
  useBattleStore.getState().setBattles(next)
  if (!playerId) return
  // A fight the player learns of, or that ends, is news. By place, not key: a ground fight turns into
  // a terrain battle and back under a new key, and that is still the same fight.
  const placeKey = (b: PlayerBattle) => `${b.kind === 'space' ? 'space' : 'ground'}@${b.bodyName ?? b.place}`
  const before = new Set(prev.map(placeKey))
  const after = new Set(next.map(placeKey))
  for (const b of next) if (!before.has(placeKey(b))) notifyOwner(playerId, 'battle-started', `${battleLabel(b)} has begun`, battlePlace(b))
  for (const b of prev) if (!after.has(placeKey(b))) notifyOwner(playerId, 'battle-ended', `${battleLabel(b)} is over`, battlePlace(b))
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
