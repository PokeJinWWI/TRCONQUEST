// The Diplomat: how this empire feels about its neighbours, and when to seek
// peace. Opinion mellows back toward neutral over time from a real grievance;
// in a war it takes what its war score can buy, or cuts its losses.
import {
  AI_ESCALATE_SCORE,
  AI_OPINION_RECOVERY,
  AI_ORG_FRIENDLY_OPINION,
  AI_ORG_OPINION_FLOOR,
  AI_ORG_OPINION_STEP,
  AI_PEACE_OFFER_COOLDOWN_DAYS,
  AI_PRESS_ON_DAYS,
  AI_PRESS_ON_EXHAUSTION,
  AI_REPARATIONS_MIN_SCORE,
  AI_STALEMATE_DAYS,
  AI_STALEMATE_SCORE,
  AI_SUBJUGATE_OPINION,
  AI_WHITE_PEACE_WHEN_EXHAUSTION,
  AI_WHITE_PEACE_WHEN_SCORE_BELOW,
} from '../data/aiData'
import type { PeaceTerms } from '../data/diplomacyData'
import { SUBJECT_OFFER_MIN_OPINION, SUBJECT_OFFER_MIN_POWER_RATIO } from '../data/subjectData'
import { affordableReparations, bodiesHeldFrom, evaluatePeace, scoreFor, warExhaustion } from '../scene/warScore'
import { bodyStarId, controllerOf } from '../scene/territory'
import type { AiSnapshot, Blackboard } from './blackboard'
import type { AgentOutput, AiMemory, Intent } from './types'

export function diplomat(bb: Blackboard, snap: AiSnapshot, memory: AiMemory): AgentOutput {
  const intents: Intent[] = []

  // Opinion drift: a nation with a grudge (opinion already negative, from a
  // past war or other real event) mellows back toward neutral over time.
  // Neighbours used to also grind each other's opinion down every cycle just
  // for sharing a border, with nothing pulling it back the other way — that
  // made war with any neighbour a inevitability on a long enough clock,
  // unprovoked, which read as the AI turning hostile out of nowhere. Removed;
  // an empire's Strategist still goes to war for a real reason (an opinion
  // already driven down by an actual grievance, or its own opportunism), it
  // just doesn't happen on proximity alone anymore.
  for (const other of snap.countries) {
    if (other.id === bb.countryId || bb.enemies.includes(other.id)) continue
    const opinion = bb.opinionOf(other.id)
    if (opinion < 0) intents.push({ kind: 'adjust-opinion', otherId: other.id, delta: Math.min(AI_OPINION_RECOVERY, -opinion) })
  }

  // Organizations, subjects and trade policy — the non-war diplomacy layer.
  intents.push(...orgAndSubjectIntents(bb, snap))

  const lastOffers = { ...memory.lastPeaceOfferSimDays }
  for (const war of bb.wars) {
    const enemy = war.attackerId === bb.countryId ? war.defenderId : war.attackerId
    // Embargo an active enemy if it isn't already — trade is a weapon of war.
    if (!bb.embargoes(enemy)) intents.push({ kind: 'declare-embargo', targetId: enemy })
    // A skirmish this empire is winning clearly is escalated into a real war so
    // it can actually take ground (skirmishes carry no cession terms).
    if (war.tier === 'skirmish' && war.attackerId === bb.countryId) {
      const score = scoreFor(war, bb.countryId, snap.owners, snap.controllers, snap.valueOf)
      if (score >= AI_ESCALATE_SCORE) intents.push({ kind: 'escalate-conflict', warId: war.id })
    }
    const last = lastOffers[war.id]
    if (last !== undefined && snap.simDays - last < AI_PEACE_OFFER_COOLDOWN_DAYS) continue
    const terms = chooseTerms(bb, enemy, war, snap)
    if (!terms) continue
    intents.push({ kind: 'propose-peace', warId: war.id, terms })
    lastOffers[war.id] = snap.simDays
  }

  return { intents, memory: { lastPeaceOfferSimDays: lastOffers } }
}

// The non-war diplomacy an empire conducts in peacetime: keeping up relations
// inside its organizations, answering defense pacts, forming and joining orgs
// with friends, and subjugating much weaker neighbours.
function orgAndSubjectIntents(bb: Blackboard, snap: AiSnapshot): Intent[] {
  const intents: Intent[] = []
  const me = bb.countryId

  // Keep opinion of fellow org members topped up (the political-forum/cultural
  // bonus), as long as there is still goodwill to add.
  for (const other of snap.countries) {
    if (other.id === me || bb.enemies.includes(other.id)) continue
    const shares = bb.sharesOrgPillar(other.id, 'political-forum') || bb.sharesOrgPillar(other.id, 'cultural')
    if (!shares) continue
    const gap = AI_ORG_OPINION_FLOOR - bb.opinionOf(other.id)
    if (gap > 0) intents.push({ kind: 'adjust-opinion', otherId: other.id, delta: Math.min(AI_ORG_OPINION_STEP, gap) })
  }

  // Defense pacts: a fellow defense-pact member attacked by an outsider is a
  // call to arms. Join against the attacker if at peace with them and no truce.
  for (const war of snap.wars) {
    if (war.attackerId === me || war.defenderId === me) continue
    const ally = war.defenderId
    const attacker = war.attackerId
    if (!bb.sharesOrgPillar(ally, 'defense-pact')) continue
    if (bb.atWar(me, attacker) || bb.truceWith(attacker)) continue
    intents.push({ kind: 'join-war-as-ally', allyId: ally, enemyId: attacker })
  }

  // A subject has no independent foreign policy of this kind.
  if (bb.mySuzerain) return intents

  // Found or join an organization with a friendly neighbour at peace. Only a
  // nation not already leading one founds; otherwise it joins a neighbour's.
  const friendlyNeighbour = bb.neighbours.find(
    (n) => n !== snap.playerCountryId && !bb.atWar(me, n) && !bb.truceWith(n) && bb.opinionOf(n) >= AI_ORG_FRIENDLY_OPINION,
  )
  if (friendlyNeighbour) {
    const neighbourOrg = (snap.orgs ?? []).find((o) => o.memberIds.includes(friendlyNeighbour) && !o.memberIds.includes(me))
    const leadsOne = bb.myOrgs.some((o) => o.leaderId === me)
    if (neighbourOrg) intents.push({ kind: 'join-org', orgId: neighbourOrg.id })
    else if (!leadsOne && bb.myOrgs.length === 0) intents.push({ kind: 'found-org', presetId: 'common-market', name: 'Common Market' })
  }

  // Subjugate a much weaker neighbour it is at peace with (the same rule the
  // player's offer uses: a decisive power edge and no standing hatred).
  for (const n of bb.neighbours) {
    if (n === snap.playerCountryId || bb.atWar(me, n) || bb.truceWith(n)) continue
    if (bb.mySubjects.includes(n) || (snap.subjections ?? []).some((s) => s.subjectId === n)) continue
    const mine = bb.powerOf(me)
    const theirs = bb.powerOf(n)
    const strongEnough = theirs > 0 ? mine / theirs >= SUBJECT_OFFER_MIN_POWER_RATIO : mine > 0
    if (!strongEnough) continue
    if (bb.opinionOf(n) < Math.max(SUBJECT_OFFER_MIN_OPINION, AI_SUBJUGATE_OPINION)) continue
    intents.push({ kind: 'offer-subjection', targetId: n, subjectType: 'vassal' })
    break // one offer at a time
  }

  return intents
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
    // Holding ground it can't yet claim: fall through to reparations, or to
    // fighting on for more score.
  }

  // Winning with no whole world to take (a neighbour's only world is usually
  // its capital): it takes what its score buys of the loser's stockpile.
  if (!pressing && score >= AI_REPARATIONS_MIN_SCORE) {
    const terms: PeaceTerms = { kind: 'reparations', share: affordableReparations(war, me, snap.owners, snap.controllers, snap.valueOf, snap.simDays) }
    if (terms.share > 0 && wouldAccept(terms)) return terms
  }

  const stalemate = snap.simDays - war.startedSimDays >= AI_STALEMATE_DAYS && Math.abs(score) < AI_STALEMATE_SCORE
  if (score <= AI_WHITE_PEACE_WHEN_SCORE_BELOW || exhaustion >= AI_WHITE_PEACE_WHEN_EXHAUSTION || stalemate) {
    const white: PeaceTerms = { kind: 'white' }
    return wouldAccept(white) ? white : null
  }
  return null
}
