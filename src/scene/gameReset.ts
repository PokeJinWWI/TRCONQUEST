// Quitting to the empire-select screen: put every piece of game state back the
// way it was when the page loaded, so the next nation picked starts a fresh
// game. Each store hands back its own initial state (zustand's
// getInitialState), so nothing here needs to know what's inside them. The
// player's display settings are the one thing kept — they're preferences, not
// game state.
import { resetFightPace } from '../hooks/fightPace'
import { useAiStore } from '../ai/aiStore'
import { useArmyStore } from '../state/armyStore'
import { useBattleStore } from '../state/battleStore'
import { useCombatStore } from '../state/combatStore'
import { useConfirmStore } from '../state/confirmStore'
import { useDebugConsoleStore } from '../state/debugConsoleStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { useEconomyStore } from '../state/economyStore'
import { useFleetStore } from '../state/fleetStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { useMapModeStore } from '../state/mapModeStore'
import { usePlayerStore } from '../state/playerStore'
import { useResourceStore } from '../state/resourceStore'
import { useShipDesignStore } from '../state/shipDesignStore'
import { useShipStore } from '../state/shipStore'
import { useShipyardStore } from '../state/shipyardStore'
import { useTechStore } from '../state/techStore'
import { useTerrainStore } from '../state/terrainStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useViewStore } from '../state/viewStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useDefenseStore } from '../state/defenseStore'
import { useBombardmentStore } from '../state/bombardmentStore'
import { useHoldingsStore } from '../state/holdingsStore'

// Every store that holds game (or session) state. Not settingsStore.
interface Resettable {
  setState: (state: never, replace: true) => void
  getInitialState: () => unknown
}
const GAME_STORES: Resettable[] = [
  useAbstractEconomyStore,
  useDefenseStore,
  useBombardmentStore,
  useHoldingsStore,
  useAiStore,
  useArmyStore,
  useBattleStore,
  useCombatStore,
  useConfirmStore,
  useDebugConsoleStore,
  useDiplomacyStore,
  useEconomyStore,
  useFleetStore,
  useGameTimeStore,
  useGroundViewStore,
  useHyperlaneStore,
  useMapModeStore,
  useResourceStore,
  useShipDesignStore,
  useShipStore,
  useShipyardStore,
  useTechStore,
  useTerrainStore,
  useTerritoryStore,
  useViewStore,
  useWorkspaceStore,
  usePlayerStore,
] as unknown as Resettable[]

export function resetGame(): void {
  for (const store of GAME_STORES) store.setState(store.getInitialState() as never, true)
  resetFightPace()
}
