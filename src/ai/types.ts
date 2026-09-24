// Shared shapes for the strategic AI (see coordinator.ts for how the pieces
// fit together).
import type { PeaceTerms } from '../data/diplomacyData'

// What an agent wants done. Agents never touch stores: they return intents,
// and the executor (executor.ts) carries them out through the same store
// actions the player's UI uses, under the same rules.
export type Intent =
  | { kind: 'declare-war'; targetId: string }
  | { kind: 'propose-peace'; warId: string; terms: PeaceTerms }
  | { kind: 'adjust-opinion'; otherId: string; delta: number }
  | { kind: 'build-ship'; classId: string }
  | { kind: 'recruit-army'; bodyName: string }
  | { kind: 'move-ship'; shipId: string; systemId: string; bodyName: string }
  | { kind: 'embark'; shipId: string; armyIds: string[] }
  | { kind: 'land'; shipId: string; dropNode?: number }
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
}

export const INITIAL_AI_MEMORY: AiMemory = { posture: 'peace', targetBody: null, lastPeaceOfferSimDays: {} }

export interface AgentOutput {
  intents: Intent[]
  memory?: Partial<AiMemory>
}
