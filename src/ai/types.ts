import type { BombardStance } from '../data/defenseData'
// Shared shapes for the strategic AI (see coordinator.ts for how the pieces
// fit together).
import type { PeaceTerms } from '../data/diplomacyData'
import type { ResourceId } from '../data/resourceData'

// What an agent wants done. Agents never touch stores: they return intents,
// and the executor (executor.ts) carries them out through the same store
// actions the player's UI uses, under the same rules.
export type Intent =
  | { kind: 'declare-war'; targetId: string }
  | { kind: 'propose-peace'; warId: string; terms: PeaceTerms }
  | { kind: 'adjust-opinion'; otherId: string; delta: number }
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
