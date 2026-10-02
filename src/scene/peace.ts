// War and peace as gameplay actions — the store I/O around the pure rules in
// scene/warScore.ts. Everything that starts or ends a war goes through here
// (the Diplomacy panel and the AI's executor alike), so the event log, the
// territory changes and the armies' homecoming all happen in one place.
import { useSubjectStore, subjectionOf } from '../state/subjectStore'
import { COUNTRIES } from '../data/countryData'
import { ownerDisplay } from '../data/countryRoster'
import {
  BODY_VALUE_CAPITAL,
  BODY_VALUE_OUTPOST,
  BODY_VALUE_WORLD,
  ESCALATION_MIN_SCORE,
  OPINION_ON_PEACE,
  type ConflictTier,
  type PeaceTerms,
} from '../data/diplomacyData'
import { useDiplomacyStore, warBetweenIn, type DeclareWarResult } from '../state/diplomacyStore'
import { isGuarantorOf, isNonAggression } from '../state/treatyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useArmyStore } from '../state/armyStore'
import { useResourceStore } from '../state/resourceStore'
import type { ResourceId } from '../data/resourceData'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { controllerOf } from './territory'
import { bodiesHeldFrom, evaluatePeace, scoreFor, type PeaceEvaluation } from './warScore'
import { groundSurface, musterNode, placeUnits } from './groundLogic'

function nameOf(countryId: string): string {
  return ownerDisplay(countryId).name
}

// What a body is worth in war score, from live data: capitals most, then
// inhabited worlds, then everything else.
export function liveBodyValue(bodyName: string): number {
  if (COUNTRIES.some((c) => c.capitalBodyName === bodyName)) return BODY_VALUE_CAPITAL
  if (worldByName(useEconomyStore.getState().worlds, bodyName)) return BODY_VALUE_WORLD
  return BODY_VALUE_OUTPOST
}

export function declareWarOn(attackerId: string, defenderId: string, simDays: number, tier: ConflictTier = 'limited', opts: { ignoreTruce?: boolean } = {}): DeclareWarResult {
  if (isNonAggression(attackerId, defenderId)) return { ok: false, reason: 'A non-aggression pact is in effect' }
  if (isGuarantorOf(attackerId, defenderId)) return { ok: false, reason: 'You guarantee their independence' }
  const result = useDiplomacyStore.getState().declareWar(attackerId, defenderId, simDays, tier, opts)
  if (result.ok) {
    const verb = tier === 'skirmish' ? 'started a skirmish with' : 'declared war on'
    useDiplomacyStore.getState().pushEvent('war-declared', [attackerId, defenderId], `${nameOf(attackerId)} ${verb} ${nameOf(defenderId)}`, simDays)
  }
  return result
}

// The receiving side judges the offer by the shared rule; an accepted offer is
// signed on the spot, a refused one is logged.
export function proposePeace(warId: string, proposerId: string, terms: PeaceTerms, simDays: number): PeaceEvaluation {
  const war = useDiplomacyStore.getState().wars.find((w) => w.id === warId)
  if (!war) return { accept: false, reason: 'No such war' }
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  const receiverId = proposerId === war.attackerId ? war.defenderId : war.attackerId
  // Vassalization needs both to be free nations (no subject, not each other's).
  const subjections = useSubjectStore.getState().subjections
  const verdict =
    terms.kind === 'vassalize' && (subjectionOf(subjections, receiverId) || subjectionOf(subjections, proposerId))
      ? { accept: false, reason: subjectionOf(subjections, receiverId) ? 'They are already a subject' : 'A subject cannot take a vassal' }
      : evaluatePeace(war, proposerId, terms, bodyOwner, bodyController, liveBodyValue, simDays)
  if (verdict.accept) makePeace(warId, terms, proposerId, simDays)
  else {
    useDiplomacyStore
      .getState()
      .pushEvent('peace-rejected', [receiverId, proposerId], `${nameOf(receiverId)} refused peace with ${nameOf(proposerId)}: ${verdict.reason}`, simDays)
  }
  return verdict
}

// Signs a peace: cessions go to `beneficiaryId`, every other occupation
// between the two sides ends, armies left standing on ground their nation
// doesn't hold go home, and a truce starts.
export function makePeace(warId: string, terms: PeaceTerms, beneficiaryId: string, simDays: number): void {
  const diplomacy = useDiplomacyStore.getState()
  const war = diplomacy.wars.find((w) => w.id === warId)
  if (!war) return
  const loserId = beneficiaryId === war.attackerId ? war.defenderId : war.attackerId
  const territory = useTerritoryStore.getState()

  if (terms.kind === 'cede') {
    for (const body of terms.bodies) {
      if (territory.bodyOwner[body] !== loserId) continue
      territory.cedeBody(body, beneficiaryId)
      diplomacy.pushEvent('body-ceded', [loserId, beneficiaryId], `${nameOf(loserId)} ceded ${body} to ${nameOf(beneficiaryId)}`, simDays, { bodyName: body })
    }
  }

  // The loser becomes the winner's subject; the war ends with it.
  if (terms.kind === 'vassalize') {
    useSubjectStore.getState().establishSubject(beneficiaryId, loserId, terms.subjectType, simDays)
  }

  // Occupations between these two that weren't settled by cession end.
  if (terms.kind === 'reparations') payReparations(loserId, beneficiaryId, terms.share)

  {
    const { bodyOwner, bodyController } = useTerritoryStore.getState()
    for (const body of [
      ...bodiesHeldFrom(war.attackerId, war.defenderId, bodyOwner, bodyController),
      ...bodiesHeldFrom(war.defenderId, war.attackerId, bodyOwner, bodyController),
    ]) {
      useTerritoryStore.getState().liberateBody(body)
    }
  }

  // The front lines between them on every world go back to their owners.
  useTerritoryStore.getState().clearPaintBetween(war.attackerId, war.defenderId)
  sendStrandedArmiesHome([war.attackerId, war.defenderId])

  diplomacy.endWar(warId, simDays)
  diplomacy.adjustOpinion(war.attackerId, war.defenderId, OPINION_ON_PEACE)
  const text =
    terms.kind === 'white'
      ? `${nameOf(war.attackerId)} and ${nameOf(war.defenderId)} signed a white peace`
      : terms.kind === 'cede'
        ? `${nameOf(loserId)} made peace with ${nameOf(beneficiaryId)}, ceding ${terms.bodies.join(', ')}`
        : terms.kind === 'reparations'
          ? `${nameOf(loserId)} made peace with ${nameOf(beneficiaryId)}, paying ${Math.round(terms.share * 100)}% of its stockpile in reparations`
          : terms.kind === 'vassalize'
            ? `${nameOf(loserId)} submitted to ${nameOf(beneficiaryId)} as its ${terms.subjectType}, ending the war`
            : `${nameOf(war.attackerId)} and ${nameOf(war.defenderId)} made peace`
  useDiplomacyStore.getState().pushEvent('peace-signed', [war.attackerId, war.defenderId], text, simDays)
}

// Armies of these nations standing on a body their nation no longer controls
// return to their capital's muster point (or disband if the capital itself
// isn't theirs).
// Hands `share` of every good in the loser's stockpile to the winner.
export function payReparations(loserId: string, winnerId: string, share: number): void {
  const resources = useResourceStore.getState()
  const amounts = resources.stateFor(loserId).amounts
  for (const id of Object.keys(amounts) as ResourceId[]) {
    // Influence is political reach, not goods: it can't be handed over.
    if (id === 'influence') continue
    const paid = Math.floor(Math.max(0, amounts[id]) * share)
    if (paid <= 0) continue
    resources.addAmount(loserId, id, -paid)
    resources.addAmount(winnerId, id, paid)
  }
}

function sendStrandedArmiesHome(countryIds: string[]): void {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  const involved = new Set(countryIds)
  const armies = useArmyStore.getState().armies
  let changed = false
  const next = armies.flatMap((a) => {
    if (!involved.has(a.ownerId) || a.location.kind !== 'body') return [a]
    if (controllerOf(a.location.bodyName, bodyOwner, bodyController) === a.ownerId) return [a]
    changed = true
    const capital = COUNTRIES.find((c) => c.id === a.ownerId)?.capitalBodyName
    if (!capital || controllerOf(capital, bodyOwner, bodyController) !== a.ownerId) return []
    const surface = groundSurface(capital, bodyOwner)
    const units = surface ? placeUnits(surface, a.units, musterNode(surface)) : a.units
    return [{ ...a, location: { kind: 'body' as const, bodyName: capital }, units }]
  })
  if (changed) useArmyStore.getState().setArmies(next)
}

// Escalates a war one tier (skirmish -> limited -> total). `proposerId`'s war
// score has to justify it: a skirmish always escalates freely (it's already
// a live conflict, just widening its scope), but limited -> total needs the
// proposer clearly winning, mirroring how a total war's stakes are higher.
export function escalateConflict(warId: string, proposerId: string, simDays: number): { ok: boolean; reason: string } {
  const diplomacy = useDiplomacyStore.getState()
  const war = diplomacy.wars.find((w) => w.id === warId)
  if (!war) return { ok: false, reason: 'No such war' }
  if (war.tier === 'total') return { ok: false, reason: 'Already total war' }
  if (war.tier === 'limited') {
    const { bodyOwner, bodyController } = useTerritoryStore.getState()
    const score = scoreFor(war, proposerId, bodyOwner, bodyController, liveBodyValue)
    if (score < ESCALATION_MIN_SCORE) return { ok: false, reason: `Needs war score ${ESCALATION_MIN_SCORE} (have ${Math.floor(score)})` }
  }
  const nextTier: ConflictTier = war.tier === 'skirmish' ? 'limited' : 'total'
  diplomacy.setConflictTier(warId, nextTier)
  diplomacy.pushEvent('war-declared', [proposerId], `${nameOf(proposerId)} escalated the conflict to ${nextTier} war`, simDays)
  return { ok: true, reason: 'Escalated' }
}

// Ends any skirmish that's had no hostile engagement for SKIRMISH_LAPSE_DAYS —
// call this from wherever else the game already runs a periodic sweep (it's
// cheap and idempotent, safe to call every tick).
export function lapseStaleSkirmishes(simDays: number): void {
  useDiplomacyStore.getState().lapseStaleSkirmishes(simDays)
}

// Charges a loss to every war between the loser's nation and any of
// `enemyIds` (the nations it was fighting when it happened).
export function recordLoss(loserId: string, enemyIds: string[], value: number): void {
  if (value <= 0) return
  const diplomacy = useDiplomacyStore.getState()
  for (const enemyId of new Set(enemyIds)) {
    const war = warBetweenIn(diplomacy.wars, loserId, enemyId)
    if (!war) continue
    if (war.attackerId === loserId) diplomacy.recordWarLosses(war.id, value, 0)
    else diplomacy.recordWarLosses(war.id, 0, value)
  }
}
