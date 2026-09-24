// War and peace as gameplay actions — the store I/O around the pure rules in
// scene/warScore.ts. Everything that starts or ends a war goes through here
// (the Diplomacy panel and the AI's executor alike), so the event log, the
// territory changes and the armies' homecoming all happen in one place.
import { COUNTRIES } from '../data/countryData'
import { ownerDisplay } from '../data/countryRoster'
import {
  BODY_VALUE_CAPITAL,
  BODY_VALUE_OUTPOST,
  BODY_VALUE_WORLD,
  OPINION_ON_PEACE,
  type PeaceTerms,
} from '../data/diplomacyData'
import { useDiplomacyStore, warBetweenIn, type DeclareWarResult } from '../state/diplomacyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useArmyStore } from '../state/armyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { controllerOf } from './territory'
import { bodiesHeldFrom, evaluatePeace, type PeaceEvaluation } from './warScore'
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

export function declareWarOn(attackerId: string, defenderId: string, simDays: number): DeclareWarResult {
  const result = useDiplomacyStore.getState().declareWar(attackerId, defenderId, simDays)
  if (result.ok) {
    useDiplomacyStore
      .getState()
      .pushEvent('war-declared', [attackerId, defenderId], `${nameOf(attackerId)} declared war on ${nameOf(defenderId)}`, simDays)
  }
  return result
}

// The receiving side judges the offer by the shared rule; an accepted offer is
// signed on the spot, a refused one is logged.
export function proposePeace(warId: string, proposerId: string, terms: PeaceTerms, simDays: number): PeaceEvaluation {
  const war = useDiplomacyStore.getState().wars.find((w) => w.id === warId)
  if (!war) return { accept: false, reason: 'No such war' }
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  const verdict = evaluatePeace(war, proposerId, terms, bodyOwner, bodyController, liveBodyValue, simDays)
  const receiverId = proposerId === war.attackerId ? war.defenderId : war.attackerId
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
      diplomacy.pushEvent('body-ceded', [loserId, beneficiaryId], `${nameOf(loserId)} ceded ${body} to ${nameOf(beneficiaryId)}`, simDays)
    }
  }

  // Occupations between these two that weren't settled by cession end.
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
      : `${nameOf(loserId)} made peace with ${nameOf(beneficiaryId)}, ceding ${terms.bodies.join(', ')}`
  useDiplomacyStore.getState().pushEvent('peace-signed', [war.attackerId, war.defenderId], text, simDays)
}

// Armies of these nations standing on a body their nation no longer controls
// return to their capital's muster point (or disband if the capital itself
// isn't theirs).
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
