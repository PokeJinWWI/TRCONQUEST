// The Diplomat: how this empire feels about its neighbours, and when to seek
// peace. Friction with nations sharing its systems builds hostility over time
// (that's what eventually gives the Strategist a reason for war); in a war it
// takes what its war score can buy, or cuts its losses.
import {
  AI_NEIGHBOUR_FRICTION,
  AI_OPINION_RECOVERY,
  AI_PEACE_OFFER_COOLDOWN_DAYS,
  AI_PRESS_ON_DAYS,
  AI_PRESS_ON_EXHAUSTION,
  AI_STALEMATE_DAYS,
  AI_STALEMATE_SCORE,
  AI_WHITE_PEACE_WHEN_EXHAUSTION,
  AI_WHITE_PEACE_WHEN_SCORE_BELOW,
} from '../data/aiData'
import type { PeaceTerms } from '../data/diplomacyData'
import { bodiesHeldFrom, evaluatePeace, scoreFor, warExhaustion } from '../scene/warScore'
import { bodyStarId, controllerOf } from '../scene/territory'
import type { AiSnapshot, Blackboard } from './blackboard'
import type { AgentOutput, AiMemory, Intent } from './types'

export function diplomat(bb: Blackboard, snap: AiSnapshot, memory: AiMemory): AgentOutput {
  const intents: Intent[] = []

  // Opinion drift. Only this empire's half of the friction — the neighbour's
  // own Diplomat (or nobody, for the player) supplies the other half.
  const neighbours = new Set(bb.neighbours)
  for (const other of snap.countries) {
    if (other.id === bb.countryId || bb.enemies.includes(other.id)) continue
    const opinion = bb.opinionOf(other.id)
    if (neighbours.has(other.id)) intents.push({ kind: 'adjust-opinion', otherId: other.id, delta: AI_NEIGHBOUR_FRICTION })
    else if (opinion < 0) intents.push({ kind: 'adjust-opinion', otherId: other.id, delta: Math.min(AI_OPINION_RECOVERY, -opinion) })
  }

  const lastOffers = { ...memory.lastPeaceOfferSimDays }
  for (const war of bb.wars) {
    const last = lastOffers[war.id]
    if (last !== undefined && snap.simDays - last < AI_PEACE_OFFER_COOLDOWN_DAYS) continue
    const enemy = war.attackerId === bb.countryId ? war.defenderId : war.attackerId
    const terms = chooseTerms(bb, enemy, war, snap)
    if (!terms) continue
    intents.push({ kind: 'propose-peace', warId: war.id, terms })
    lastOffers[war.id] = snap.simDays
  }

  return { intents, memory: { lastPeaceOfferSimDays: lastOffers } }
}

// The best peace this empire would propose right now, or null to keep
// fighting. Proposals to another AI are pre-checked against the shared
// acceptance rule (no point sending one that will be refused); the player
// gets the same offer and decides for themselves.
function chooseTerms(bb: Blackboard, enemy: string, war: AiSnapshot['wars'][number], snap: AiSnapshot): PeaceTerms | null {
  const me = bb.countryId
  const enemyIsPlayer = enemy === snap.playerCountryId
  const score = scoreFor(war, me, snap.owners, snap.controllers, snap.valueOf)
  const exhaustion = warExhaustion(war, me, snap.simDays)

  // While fresh, with enemy ground still within reach, it presses on rather
  // than settling for its first gains.
  const moreToTake = Object.keys(snap.owners).some(
    (b) => snap.owners[b] === enemy && controllerOf(b, snap.owners, snap.controllers) === enemy && bb.theatreStars.has(bodyStarId(b) ?? ''),
  )
  const pressing = moreToTake && exhaustion < AI_PRESS_ON_EXHAUSTION && snap.simDays - war.startedSimDays < AI_PRESS_ON_DAYS
  const wouldAccept = (terms: PeaceTerms) =>
    enemyIsPlayer || evaluatePeace(war, me, terms, snap.owners, snap.controllers, snap.valueOf, snap.simDays).accept

  // Take the most valuable occupied bodies the score covers.
  const held = bodiesHeldFrom(enemy, me, snap.owners, snap.controllers).sort((a, b) => snap.valueOf(b) - snap.valueOf(a))
  if (held.length > 0 && !pressing) {
    for (let n = held.length; n >= 1; n--) {
      const terms: PeaceTerms = { kind: 'cede', bodies: held.slice(0, n) }
      if (evaluatePeace(war, me, terms, snap.owners, snap.controllers, snap.valueOf, snap.simDays).accept) return terms
    }
    // Holding ground it can't yet claim: fall through — it keeps fighting for
    // more score unless it's losing or worn out anyway.
  }

  const stalemate = snap.simDays - war.startedSimDays >= AI_STALEMATE_DAYS && Math.abs(score) < AI_STALEMATE_SCORE
  if (score <= AI_WHITE_PEACE_WHEN_SCORE_BELOW || exhaustion >= AI_WHITE_PEACE_WHEN_EXHAUSTION || stalemate) {
    const white: PeaceTerms = { kind: 'white' }
    return wouldAccept(white) ? white : null
  }
  return null
}
