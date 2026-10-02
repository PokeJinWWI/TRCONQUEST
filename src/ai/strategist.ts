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
import { shipPower, type AiSnapshot, type Blackboard } from './blackboard'
import type { AgentOutput, Intent, Posture } from './types'
import { attackTargetOf } from '../scene/aggression'

// Power edge wanted over a target this empire holds `opinion` of.
export function requiredWarRatio(opinion: number): number {
  if (opinion >= AI_WAR_OPINION) return AI_WAR_RATIO
  if (opinion <= AI_HATRED_OPINION) return AI_WAR_RATIO_AT_HATRED
  const t = (AI_WAR_OPINION - opinion) / (AI_WAR_OPINION - AI_HATRED_OPINION)
  return AI_WAR_RATIO + (AI_WAR_RATIO_AT_HATRED - AI_WAR_RATIO) * t
}

// Opening a war it has already decided on with an unprovoked attack instead of
// a declaration (scene/aggression.ts): worth it only where its idle warships
// share an orbit with the target's armed ships and outgun them by the same edge
// it wants for the war. The rest of the target's navy stays at peace until the
// news reaches its territory. Picks the orbit with the most to destroy.
export function surpriseStrike(bb: Blackboard, snap: AiSnapshot, targetId: string): Extract<Intent, { kind: 'attack-ship' }> | null {
  const mineAt = new Map<string, string[]>()
  for (const s of bb.idleWarships) {
    if (s.location.kind !== 'orbiting') continue
    mineAt.set(s.location.bodyName, [...(mineAt.get(s.location.bodyName) ?? []), s.id])
  }
  let best: { body: string; power: number } | null = null
  for (const body of [...mineAt.keys()].sort()) {
    const theirs = bb.powerAt(targetId, body)
    if (theirs <= 0 || bb.powerAt(bb.countryId, body) < AI_WAR_RATIO * theirs) continue
    if (!best || theirs > best.power) best = { body, power: theirs }
  }
  if (!best) return null
  const body = best.body
  const target = snap.ships
    .filter((s) => s.ownerId === targetId && !s.order && s.location.kind === 'orbiting' && s.location.bodyName === body && shipPower(s) > 0)
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  if (!target) return null
  return { kind: 'attack-ship', shipIds: mineAt.get(body)!, targetShipId: target.id }
}

// Whether this empire already has a first strike on `targetId` going: an attack
// order on its way or standing, or a fight whose news hasn't arrived.
export function strikeUnderWay(bb: Blackboard, snap: AiSnapshot, targetId: string): boolean {
  if ((snap.incidents ?? []).some((i) => i.aggressorId === bb.countryId && i.victimId === targetId)) return true
  const ownerOf = (shipId: string) => snap.ships.find((s) => s.id === shipId)?.ownerId
  return bb.mine.some((s) => {
    const standing = attackTargetOf(s)
    if (standing && ownerOf(standing) === targetId) return true
    return (s.pendingCommands ?? []).some((p) => p.command.kind === 'attack' && ownerOf(p.command.targetShipId) === targetId)
  })
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
    // A first strike already ordered or fought: wait for its news to start the war.
    if (rivals.some((n) => strikeUnderWay(bb, snap, n))) return { intents: [], memory: { posture: 'buildup' } }
    if (viable.length > 0) {
      const strike = surpriseStrike(bb, snap, viable[0])
      if (strike) return { intents: [strike], memory: { posture: 'buildup' } }
      return { intents: [{ kind: 'declare-war', targetId: viable[0] }], memory: { posture: 'war', targetBody: null } }
    }
  }
  return { intents: [], memory: { posture } }
}
