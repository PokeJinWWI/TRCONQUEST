import type { BombardStance } from '../data/defenseData'
// Shared shapes for the strategic AI (see coordinator.ts for how the pieces
// fit together).
import type { PeaceTerms } from '../data/diplomacyData'
import type { ResourceId } from '../data/resourceData'
import type { SubjectType } from '../data/subjectData'

// What an agent wants done. Agents never touch stores: they return intents,
// and the executor (executor.ts) carries them out through the same store
// actions the player's UI uses, under the same rules.
export type Intent =
  | { kind: 'declare-war'; targetId: string }
  | { kind: 'propose-peace'; warId: string; terms: PeaceTerms }
  | { kind: 'adjust-opinion'; otherId: string; delta: number }
  // An unprovoked first strike: these warships attack a ship of a nation this
  // empire is not at war with (scene/aggression.ts). The news starts the war.
  | { kind: 'attack-ship'; shipIds: string[]; targetShipId: string }
  | { kind: 'build-ship'; classId: string }
  // A Construction Ship builds a Starbase at the star it rests at, paid from
  // its hold; `starId` is only what the planner meant (for traces).
  | { kind: 'build-starbase'; shipId: string; starId: string }
  | { kind: 'research-tech'; techId: string }
  | { kind: 'survey-system'; shipId: string }
  | { kind: 'load-cargo'; shipId: string; want: Partial<Record<ResourceId, number>> }
  | { kind: 'transfer-cargo'; fromShipId: string; toShipId: string; want: Partial<Record<ResourceId, number>> }
  | { kind: 'recruit-army'; bodyName: string }
  // `bodyName: null` means the system's star itself (systemId is the star id).
  | { kind: 'move-ship'; shipId: string; systemId: string; bodyName: string | null }
  | { kind: 'embark'; shipId: string; armyIds: string[] }
  | { kind: 'land'; shipId: string; dropNode?: number }
  | { kind: 'set-bombard'; shipId: string; stance: BombardStance }
  // A Colony Ship founds a colony on `bodyName` (flying there first if it must).
  | { kind: 'colonize-body'; shipId: string; systemId: string; bodyName: string }
  // Patrol duty on or off (a warship holding a micro-colony's orbit).
  | { kind: 'set-patrol'; shipId: string; on: boolean }
  // Fleet organisation: fleets travel as one (scene/fleetMove.ts), so the
  // AI keeps its transports in their own fleet and gathers its warships.
  | { kind: 'split-fleet'; shipIds: string[] }
  | { kind: 'merge-fleets'; intoFleetId: string; fromFleetId: string }
  // --- Diplomacy (executor.ts → scene funnels) ---
  // Found a new international organization of this preset, led by this empire.
  | { kind: 'found-org'; presetId: string; name: string }
  // Join an existing organization.
  | { kind: 'join-org'; orgId: string }
  // Answer a defense pact: join `allyId`'s war against `enemyId` as a co-attacker.
  | { kind: 'join-war-as-ally'; allyId: string; enemyId: string }
  // Offer subjection to a much weaker neighbour at peace (established directly
  // between AI empires, like an accepted peace offer).
  | { kind: 'offer-subjection'; targetId: string; subjectType: SubjectType }
  // Blanket-embargo a nation (trade policy); used against active enemies.
  | { kind: 'declare-embargo'; targetId: string }
  // Escalate this empire's own skirmish to a limited war.
  | { kind: 'escalate-conflict'; warId: string }

export type Posture = 'peace' | 'buildup' | 'defensive' | 'war'

// What an empire remembers between planning passes. Everything else is
// rebuilt from a fresh snapshot each pass.
export interface AiMemory {
  posture: Posture
  // The body the navy (Admiral) and armies (Marshal) are working on taking.
  targetBody: string | null
  // warId → last simDays this empire offered peace in it (rate-limits offers).
  lastPeaceOfferSimDays: Record<string, number>
  // The star the Expander is currently working to claim with a Starbase.
  expansionTarget?: string | null
}

export const INITIAL_AI_MEMORY: AiMemory = { posture: 'peace', targetBody: null, lastPeaceOfferSimDays: {} }

export interface AgentOutput {
  intents: Intent[]
  memory?: Partial<AiMemory>
}
