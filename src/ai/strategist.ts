// The Strategist: this empire's overall posture, and whether to start a war.
// It only ever picks a fight with a neighbour (a nation sharing one of its
// systems — its navy can actually reach and hold that ground), never during a
// truce, never against a dormant nation, and only when clearly stronger. The
// more it hates the target, the smaller the edge it needs.
import {
  AI_HATRED_OPINION,
  AI_MIN_ARMIES_FOR_WAR,
  AI_WAR_GRACE_DAYS,
  AI_WAR_OPINION,
  AI_WAR_RATIO,
  AI_WAR_RATIO_AT_HATRED,
} from '../data/aiData'
import { isValidAiWarTarget } from '../data/countryRoster'
import type { AiSnapshot, Blackboard } from './blackboard'
import type { AgentOutput, Posture } from './types'

// Power edge wanted over a target this empire holds `opinion` of.
export function requiredWarRatio(opinion: number): number {
  if (opinion >= AI_WAR_OPINION) return AI_WAR_RATIO
  if (opinion <= AI_HATRED_OPINION) return AI_WAR_RATIO_AT_HATRED
  const t = (AI_WAR_OPINION - opinion) / (AI_WAR_OPINION - AI_HATRED_OPINION)
  return AI_WAR_RATIO + (AI_WAR_RATIO_AT_HATRED - AI_WAR_RATIO) * t
}

export function strategist(bb: Blackboard, snap: AiSnapshot): AgentOutput {
  if (bb.enemies.length > 0) return { intents: [], memory: { posture: 'war' } }
  if (bb.threats.length > 0) return { intents: [], memory: { posture: 'defensive' } }

  const rivals = bb.neighbours.filter(
    (n) => isValidAiWarTarget(n, snap.playerCountryId) && !bb.truceWith(n) && bb.opinionOf(n) <= AI_WAR_OPINION,
  )
  const posture: Posture = rivals.length > 0 ? 'buildup' : 'peace'

  if (snap.simDays >= AI_WAR_GRACE_DAYS && bb.assaultArmyCount >= AI_MIN_ARMIES_FOR_WAR) {
    // Of the rivals it's strong enough to take on, the weakest.
    const viable = rivals
      .filter((n) => bb.power >= requiredWarRatio(bb.opinionOf(n)) * bb.powerOf(n))
      .sort((a, b) => bb.powerOf(a) - bb.powerOf(b) || a.localeCompare(b))
    if (viable.length > 0) {
      return { intents: [{ kind: 'declare-war', targetId: viable[0] }], memory: { posture: 'war', targetBody: null } }
    }
  }
  return { intents: [], memory: { posture } }
}
