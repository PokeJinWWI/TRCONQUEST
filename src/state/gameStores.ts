// The registry of every store that holds game or session state. One list for
// both jobs: `scene/gameReset.resetGame` puts them all back to their initial
// state, and `state/saveGame` saves the 'game' ones (the 'ui' ones are window
// layout, selections, popups: a loaded game starts with a fresh screen).
//
// A store that is not here is neither reset nor saved, so tests/saveLoad.test.ts
// scans src for `create<` stores and fails on any that is neither registered nor
// listed in UNREGISTERED_STORES with a reason.
import { useAiStore } from '../ai/aiStore'
import { useAbstractEconomyStore } from './abstractEconomyStore'
import { useArmyStore } from './armyStore'
import { useBattleStore } from './battleStore'
import { useSituationStore } from './situationStore'
import { useSituationSnoozeStore } from './situationSnoozeStore'
import { useBombardmentStore } from './bombardmentStore'
import { useCivicStore, useCivicDetailStore } from './civicStore'
import { useUnrestStore } from './unrestStore'
import { useZoneStore } from './zoneStore'
import { useStructureStore } from './structureStore'
import { useLensStore } from './lensStore'
import { useClusterVisitStore } from './clusterVisitStore'
import { useContactStore } from './contactStore'
import { useColonyStore } from './colonyStore'
import { useCombatStore } from './combatStore'
import { useConfirmStore } from './confirmStore'
import { useDebugConsoleStore } from './debugConsoleStore'
import { useDefenseStore } from './defenseStore'
import { useDepositStore } from './depositStore'
import { useDiplomacyStore } from './diplomacyStore'
import { useEconomyStore } from './economyStore'
import { useFleetStore } from './fleetStore'
import { useGameTimeStore } from './gameTimeStore'
import { useGroundViewStore } from './groundViewStore'
import { useHoldingsStore } from './holdingsStore'
import { useHyperlaneStore } from './hyperlaneStore'
import { useJurisdictionStore } from './jurisdictionStore'
import { useLocationStore } from './locationStore'
import { migratePlaceNames, usePlaceNameStore } from './placeNameStore'
import { useInfrastructureStore } from './infrastructureStore'
import { useInternationalOrgStore } from './internationalOrgStore'
import { useMapModeStore } from './mapModeStore'
import { useMaterialStore } from './materialStore'
import { useOrbitalStore } from './orbitalStore'
import { useObserverStore } from './observerStore'
import { usePlanetViewStore } from './planetViewStore'
import { usePlacementStore } from './placementStore'
import { usePlayerStore } from './playerStore'
import { useResourceStore } from './resourceStore'
import { useShipDeconstructionStore } from './shipDeconstructionStore'
import { useShipDesignStore } from './shipDesignStore'
import { useShipStore } from './shipStore'
import { useShipyardStore } from './shipyardStore'
import { useStarbasePanelStore } from './starbasePanelStore'
import { useStarbaseStore } from './starbaseStore'
import { useMigrationStore } from './migrationStore'
import { RING_OF_HEAVEN_MODULES } from '../data/starbaseData'
import { useSubjectStore } from './subjectStore'
import { useSurveyStore } from './surveyStore'
import { useTechStore } from './techStore'
import { useTerrainStore } from './terrainStore'
import { useTerritoryStore } from './territoryStore'
import { useTradePolicyStore } from './tradePolicyStore'
import { useTreatyStore } from './treatyStore'
import { useViewStore } from './viewStore'
import { useWindowLayoutStore } from './windowLayoutStore'
import { useWorkspaceStore } from './workspaceStore'

// The slice of a zustand store this file needs.
export interface RegisteredStore {
  getState: () => unknown
  setState: (state: never, replace?: boolean) => void
  getInitialState: () => unknown
}

export interface StoreEntry {
  // Stable key in a save file: never rename one (rename = a migration).
  key: string
  store: RegisteredStore
  // 'game' is saved; 'ui' is reset but never saved.
  kind: 'game' | 'ui'
  // Bump when the store's saved shape changes, and add the step to `migrate`.
  version: number
  // Upgrades a saved value from `fromVersion` to `version`.
  migrate?: (saved: unknown, fromVersion: number) => unknown
  // Top-level fields left out of a save (derived or session-only).
  exclude?: string[]
}

import { migrateWorldDistricts } from '../economy/districtMigration'
import type { World } from '../economy/economyTypes'

function migrateEconomyState(saved: unknown): unknown {
  const state = saved as { worlds?: World[] }
  return state.worlds ? { ...state, worlds: state.worlds.map(migrateWorldDistricts) } : saved
}

// Earth's development sites were redrawn (data/earthEconomicGeography.ts), so ids saved before that point at other places. Anything keyed by an
// 'Earth#...' id is dropped, and Earth is marked unseeded so its starting buildings are assigned to the new sites the next time it is looked at.
function dropEarthSites<T extends object>(saved: T): T {
  const strip = (rec: unknown): unknown => (rec && typeof rec === 'object' && !Array.isArray(rec) ? Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith('Earth#'))) : rec)
  const out: Record<string, unknown> = { ...(saved as Record<string, unknown>) }
  for (const key of ['established', 'placed', 'levels', 'names']) if (key in out) out[key] = strip(out[key])
  if (out.custom && typeof out.custom === 'object') out.custom = Object.fromEntries(Object.entries(out.custom as object).filter(([k]) => k !== 'Earth'))
  if (out.seeded && typeof out.seeded === 'object') out.seeded = Object.fromEntries(Object.entries(out.seeded as object).filter(([k]) => k !== 'Earth'))
  return out as T
}

const game = (key: string, store: unknown, extra: Partial<StoreEntry> = {}): StoreEntry => ({ key, store: store as RegisteredStore, kind: 'game', version: 1, ...extra })
const ui = (key: string, store: unknown): StoreEntry => ({ key, store: store as RegisteredStore, kind: 'ui', version: 1 })

export const STORE_REGISTRY: StoreEntry[] = [
  game('player', usePlayerStore),
  game('gameTime', useGameTimeStore),
  game('territory', useTerritoryStore),
  // v2: the resource district became mining + agricultural (economy/districtMigration).
  game('economy', useEconomyStore, { version: 2, migrate: (saved) => migrateEconomyState(saved) }),
  game('abstractEconomy', useAbstractEconomyStore),
  game('resources', useResourceStore),
  game('colonies', useColonyStore),
  game('deposits', useDepositStore),
  // v2: player-given site names (v1 saves have none).
  // v3: subscripts per script (Japanese / Traditional / Simplified).
  game('placeNames', usePlaceNameStore, { version: 3, migrate: (saved) => migratePlaceNames(saved) }),
  game('locations', useLocationStore, { version: 2, migrate: (saved) => dropEarthSites({ names: {}, ...(saved as object) }) }),
  game('jurisdiction', useJurisdictionStore),
  // v2: district levels per site, seeded bodies, auto-seed flag (v1 saves keep their `placed`). v3: Earth's sites moved (hand-placed).
  game('civic', useCivicStore),
  game('unrest', useUnrestStore),
  game('zones', useZoneStore),
  // v2: rural structures (space-elevator anchors).
  game('structures', useStructureStore, { version: 2, migrate: (saved) => ({ rural: {}, ...(saved as object) }) }),
  game('placement', usePlacementStore, { version: 3, migrate: (saved) => dropEarthSites({ levels: {}, seeded: {}, autoSeed: false, ...(saved as object) }) }),
  game('infrastructure', useInfrastructureStore),
  game('orbital', useOrbitalStore),
  game('materials', useMaterialStore),
  game('defense', useDefenseStore),
  game('bombardment', useBombardmentStore),
  game('holdings', useHoldingsStore),
  game('ai', useAiStore),
  game('survey', useSurveyStore),
  game('clusterVisit', useClusterVisitStore),
  game('contact', useContactStore),
  // v2: orbital stations. Earth's ring used to hang at the star Sol: it now circles Earth (zone Earth~low) with the modules it opens with.
  game('migration', useMigrationStore),
  game('starbases', useStarbaseStore, {
    version: 2,
    migrate: (saved) => {
      const state = saved as { starbases?: { ownerId: string; tier?: string; zone?: string; starId: string; name?: string; modules?: string[] }[] }
      return { ...state, starbases: (state.starbases ?? []).map((sb) => (sb.ownerId === 'earth' && sb.tier === 'orbital-ring' && !sb.zone && sb.starId === 'sol' ? { ...sb, zone: 'Earth~low', name: sb.name ?? 'Ring of Heaven', modules: RING_OF_HEAVEN_MODULES } : sb)) }
    },
  }),
  game('armies', useArmyStore),
  game('battles', useBattleStore),
  game('situationSnooze', useSituationSnoozeStore),
  game('combat', useCombatStore),
  game('diplomacy', useDiplomacyStore),
  game('subjects', useSubjectStore),
  game('internationalOrgs', useInternationalOrgStore),
  game('tradePolicy', useTradePolicyStore),
  game('treaties', useTreatyStore),
  game('fleets', useFleetStore),
  game('hyperlanes', useHyperlaneStore),
  game('shipDesigns', useShipDesignStore),
  game('ships', useShipStore),
  game('shipyard', useShipyardStore),
  game('shipDeconstruction', useShipDeconstructionStore),
  game('tech', useTechStore),
  game('terrain', useTerrainStore),
  ui('observer', useObserverStore),
  ui('situations', useSituationStore),
  ui('civicDetail', useCivicDetailStore),
  ui('lens', useLensStore),
  ui('windowLayout', useWindowLayoutStore),
  ui('planetView', usePlanetViewStore),
  ui('starbasePanel', useStarbasePanelStore),
  ui('confirm', useConfirmStore),
  ui('debugConsole', useDebugConsoleStore),
  ui('groundView', useGroundViewStore),
  ui('mapMode', useMapModeStore),
  ui('view', useViewStore),
  ui('workspace', useWorkspaceStore),
]

// Stores that are deliberately in neither list, and why.
export const UNREGISTERED_STORES: Record<string, string> = {
  settingsStore: 'player preferences, kept across games',
  customButtonStore: 'quick buttons, saved in localStorage',
  situationPrefsStore: 'Situations preferences, saved in localStorage',
  sidePanelStore: 'side panel widths, saved in localStorage',
  themeStore: 'UI theme, saved in localStorage',
  menuStore: 'escape-menu open state',
  hoverTipStore: 'hover tooltip',
  buildingDetailStore: 'open detail panel',
  standaloneDetailStore: 'open detail panel',
  goodDetailStore: 'open detail panel',
  fleetTabStore: 'which Navy tab is open',
}

export function gameEntries(): StoreEntry[] {
  return STORE_REGISTRY.filter((e) => e.kind === 'game')
}
