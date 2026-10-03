// Captures an AiSnapshot from the live stores — the one read the strategic
// AI makes per planning pass.
import { COUNTRIES } from '../data/countryData'
import { useShipStore } from '../state/shipStore'
import { useArmyStore } from '../state/armyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { useResourceStore } from '../state/resourceStore'
import { useShipyardStore } from '../state/shipyardStore'
import { useTechStore } from '../state/techStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useSurveyStore } from '../state/surveyStore'
import { useCombatStore } from '../state/combatStore'
import { usePlayerStore } from '../state/playerStore'
import { liveBodyValue } from '../scene/peace'
import { batteryDenial, groundKeySurface, hostileDefenseCount, shieldedFor } from '../state/defenseStore'
import type { AiSnapshot } from './blackboard'
import { useColonyStore } from '../state/colonyStore'
import { useInternationalOrgStore } from '../state/internationalOrgStore'
import { useSubjectStore } from '../state/subjectStore'
import { useTradePolicyStore } from '../state/tradePolicyStore'

export function captureSnapshot(simDays: number): AiSnapshot {
  const territory = useTerritoryStore.getState()
  const diplomacy = useDiplomacyStore.getState()
  const engagedShipIds = new Set<string>()
  for (const e of useCombatStore.getState().engagements) for (const p of e.participants) engagedShipIds.add(p.shipId)
  return {
    simDays,
    playerCountryId: usePlayerStore.getState().selectedCountryId,
    countries: COUNTRIES.map((c) => ({ id: c.id, capitalStarId: c.capitalStarId, capitalBodyName: c.capitalBodyName })),
    ships: useShipStore.getState().ships,
    engagedShipIds,
    armies: useArmyStore.getState().armies,
    owners: territory.bodyOwner,
    controllers: territory.bodyController,
    nodeHolders: territory.nodeHolders,
    relations: diplomacy.relations,
    incidents: diplomacy.incidents,
    wars: diplomacy.wars,
    starbases: useStarbaseStore.getState().starbases,
    colonies: useColonyStore.getState().colonies,
    simpleEconomy: usePlayerStore.getState().economyModel === 'abstract',
    resourcesOf: (id) => useResourceStore.getState().stateFor(id).amounts,
    researchedOf: (id) => useTechStore.getState().stateFor(id).researched,
    buildQueueLengthOf: (id) => useShipyardStore.getState().ordersFor(id).length,
    queuedClassesOf: (id) => useShipyardStore.getState().ordersFor(id).map((o) => o.classId),
    // What has reached the empire's capital, not what its ships have found:
    // it acts on reports, which take signal time (a nation's `known` layer).
    discoveredOf: (id) => useSurveyStore.getState().known[id],
    researchPointsOf: (id) => useTechStore.getState().stateFor(id).researchPoints,
    valueOf: liveBodyValue,
    orbitDenied: batteryDenial,
    hostileDefensesAt: hostileDefenseCount,
    shieldedFor,
    surfaceOf: (bodyName) => groundKeySurface(bodyName, territory.bodyOwner),
    orgs: useInternationalOrgStore.getState().orgs,
    subjections: useSubjectStore.getState().subjections,
    embargoedPairs: new Set(Object.entries(useTradePolicyStore.getState().embargoes).filter(([, on]) => on).map(([k]) => k)),
  }
}
