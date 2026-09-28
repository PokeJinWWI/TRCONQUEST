// Treaties as a gameplay action — the store I/O around the acceptance rule
// below, same split as scene/peace.ts. Proposing a treaty means proposing a
// whole BUNDLE of articles at once (Victoria 3's model): the receiving side
// weighs every article together, so a burden in one can be offset by a
// sweetener in another, even when they point in opposite directions. A
// treaty is named, runs for a chosen binding period, and two nations can
// hold any number of separate treaties simultaneously.
import { getCountry } from '../data/countryData'
import {
  articleCostFor,
  defaultTreatyName,
  describeArticle,
  isBinding,
  isInstantArticle,
  OPINION_ON_EMBASSY,
  OPINION_ON_TREATY_BROKEN,
  type Treaty,
  type TreatyArticle,
  type TreatyDurationYears,
} from '../data/treatyData'
import { relationIn, useDiplomacyStore } from '../state/diplomacyStore'
import { useTreatyStore, treatyPortOperatorOf } from '../state/treatyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useSubjectStore, subjectionOf } from '../state/subjectStore'
import { useShipStore } from '../state/shipStore'
import { useInternationalOrgStore } from '../state/internationalOrgStore'
import { spaceportSitesOf } from '../state/nationEconomy'

export type TreatyOfferResult = { ok: true; treatyId: string } | { ok: false; reason: string }

function nameOf(id: string): string {
  return getCountry(id)?.name ?? id
}

// The opinion `receiverId` needs of the proposer to accept this whole
// bundle — the sum of every article's cost for them. Pure, so the AI and the
// player's UI share one rule; exported for tests.
export function bundleCostForReceiver(articles: TreatyArticle[], receiverId: string): number {
  return articles.reduce((sum, a) => sum + articleCostFor(a, receiverId), 0)
}

function validateArticle(article: TreatyArticle, a: string, b: string): string | null {
  const pair = new Set([a, b])
  switch (article.kind) {
    case 'guarantee-independence':
      if (article.guarantorId === article.guaranteedId) return 'A nation cannot guarantee itself'
      if (!pair.has(article.guarantorId) || !pair.has(article.guaranteedId)) return 'Guarantee must be between these two nations'
      return null
    case 'treaty-port': {
      if (article.sourceId === article.targetId) return 'A nation cannot cede a port to itself'
      if (!pair.has(article.sourceId) || !pair.has(article.targetId)) return 'Treaty port must be between these two nations'
      const territory = useTerritoryStore.getState()
      if (territory.bodyOwner[article.bodyName] !== article.sourceId) return 'You do not own that world'
      if (territory.bodyController[article.bodyName] && territory.bodyController[article.bodyName] !== article.sourceId) return 'That world is under enemy occupation'
      if (spaceportSitesOf(article.bodyName).length === 0) return 'That world has no spaceport'
      if (treatyPortOperatorOf(article.bodyName)) return 'Already ceded to someone'
      return null
    }
    case 'investment-rights':
    case 'military-access':
      if (article.sourceId === article.targetId) return 'A nation cannot grant this to itself'
      if (!pair.has(article.sourceId) || !pair.has(article.targetId)) return 'Must be between these two nations'
      return null
    case 'transfer-subject': {
      if (article.fromSuzerainId === article.toSuzerainId) return 'Source and destination must differ'
      if (!pair.has(article.fromSuzerainId) || !pair.has(article.toSuzerainId)) return 'Transfer must be between these two nations'
      const subjection = subjectionOf(useSubjectStore.getState().subjections, article.subjectId)
      if (!subjection || subjection.suzerainId !== article.fromSuzerainId) return `${nameOf(article.fromSuzerainId)} does not hold that subject`
      return null
    }
    case 'ship-transfer': {
      if (article.fromId === article.toId) return 'Source and destination must differ'
      if (!pair.has(article.fromId) || !pair.has(article.toId)) return 'Transfer must be between these two nations'
      const ship = useShipStore.getState().ships.find((s) => s.id === article.shipId)
      if (!ship || ship.ownerId !== article.fromId) return `${nameOf(article.fromId)} does not own that ship`
      return null
    }
    case 'join-power-bloc': {
      if (article.leaderId === article.joiningId) return 'A nation cannot invite itself'
      if (!pair.has(article.leaderId) || !pair.has(article.joiningId)) return 'Must be between these two nations'
      const org = useInternationalOrgStore.getState().orgs.find((o) => o.id === article.orgId)
      if (!org || org.leaderId !== article.leaderId) return `${nameOf(article.leaderId)} does not lead that organization`
      if (org.memberIds.includes(article.joiningId)) return 'Already a member'
      return null
    }
    default:
      return null
  }
}

// Applies a ONE-TIME article's effect immediately — the rest are ongoing and
// need no further action beyond being recorded on the signed treaty.
function applyInstantArticle(article: TreatyArticle, simDays: number): void {
  if (article.kind === 'transfer-subject') {
    useSubjectStore.getState().establishSubject(article.toSuzerainId, article.subjectId, subjectionOf(useSubjectStore.getState().subjections, article.subjectId)!.type, simDays)
  } else if (article.kind === 'ship-transfer') {
    useShipStore.setState((s) => ({ ships: s.ships.map((ship) => (ship.id === article.shipId ? { ...ship, ownerId: article.toId } : ship)) }))
  } else if (article.kind === 'join-power-bloc') {
    useInternationalOrgStore.getState().join(article.orgId, article.joiningId)
  }
}

// Proposes a whole bundle of articles from `proposerId` to `receiverId` at
// once, as one named treaty running for `durationYears`. Every article is
// pre-consented by the proposer (they're the one asking); only the
// receiver's acceptance is evaluated, against the SUM of what every article
// in the bundle costs them — so a burden ("you guarantee me") can be offset
// by a sweetener in the same treaty ("...and I'll cede you a treaty port"),
// in either direction. Two nations can hold any number of separate treaties
// at once; proposing another doesn't touch existing ones.
export function proposeTreaty(
  proposerId: string,
  receiverId: string,
  articles: TreatyArticle[],
  durationYears: TreatyDurationYears,
  simDays: number,
  name?: string,
): TreatyOfferResult {
  if (proposerId === receiverId) return { ok: false, reason: 'A nation cannot treaty with itself' }
  if (articles.length === 0) return { ok: false, reason: 'No articles proposed' }
  for (const article of articles) {
    const err = validateArticle(article, proposerId, receiverId)
    if (err) return { ok: false, reason: err }
  }
  const cost = bundleCostForReceiver(articles, receiverId)
  const opinion = relationIn(useDiplomacyStore.getState().relations, proposerId, receiverId).opinion
  if (opinion < cost) return { ok: false, reason: `${nameOf(receiverId)} does not trust you enough` }

  const treatyId = useTreatyStore.getState().sign(proposerId, receiverId, name?.trim() || defaultTreatyName(articles), articles, durationYears, simDays)
  if (articles.some((a) => a.kind === 'embassy')) useDiplomacyStore.getState().adjustOpinion(proposerId, receiverId, OPINION_ON_EMBASSY)
  for (const article of articles) if (isInstantArticle(article.kind)) applyInstantArticle(article, simDays)
  const summary = articles.map((a) => describeArticle(a, proposerId, nameOf)).join('; ')
  useDiplomacyStore.getState().pushEvent('treaty-signed', [proposerId, receiverId], `${nameOf(proposerId)} and ${nameOf(receiverId)} signed a treaty: ${summary}`, simDays)
  return { ok: true, treatyId }
}

// --- Convenience wrappers: a single-article, 10-year treaty, same call shape
// the UI and tests used before bundling existed. ---

const DEFAULT_DURATION: TreatyDurationYears = 10

export function proposeEmbassy(a: string, b: string, simDays: number): TreatyOfferResult {
  return proposeTreaty(a, b, [{ kind: 'embassy' }], DEFAULT_DURATION, simDays)
}

export function proposeNonAggressionPact(a: string, b: string, simDays: number): TreatyOfferResult {
  if (useDiplomacyStore.getState().wars.some((w) => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a))) {
    return { ok: false, reason: 'You are at war' }
  }
  return proposeTreaty(a, b, [{ kind: 'non-aggression-pact' }], DEFAULT_DURATION, simDays)
}

export function proposeTradeAgreement(a: string, b: string, simDays: number): TreatyOfferResult {
  return proposeTreaty(a, b, [{ kind: 'trade-agreement' }], DEFAULT_DURATION, simDays)
}

export function proposeAlliance(a: string, b: string, simDays: number): TreatyOfferResult {
  return proposeTreaty(a, b, [{ kind: 'alliance' }], DEFAULT_DURATION, simDays)
}

export function proposeGuaranteeIndependence(guarantorId: string, guaranteedId: string, simDays: number): TreatyOfferResult {
  return proposeTreaty(guarantorId, guaranteedId, [{ kind: 'guarantee-independence', guarantorId, guaranteedId }], DEFAULT_DURATION, simDays)
}

export function proposeTreatyPort(sourceId: string, bodyName: string, targetId: string, simDays: number): TreatyOfferResult {
  return proposeTreaty(sourceId, targetId, [{ kind: 'treaty-port', sourceId, targetId, bodyName }], DEFAULT_DURATION, simDays)
}

// Cancelling a still-binding treaty costs opinion with whoever's left
// holding the broken promise; once its binding period has run out it's a
// free withdrawal (see data/treatyData.isBinding). Drops the WHOLE treaty —
// see useTreatyStore's removeArticle to drop just one article instead.
export function cancelTreaty(treatyId: string, byId: string, simDays: number): void {
  const treaty = useTreatyStore.getState().treaties.find((t) => t.id === treatyId)
  if (!treaty) return
  const otherId = treaty.a === byId ? treaty.b : treaty.a
  const stillBinding = isBinding(treaty, simDays)
  useTreatyStore.getState().cancel(treatyId)
  if (stillBinding) useDiplomacyStore.getState().adjustOpinion(byId, otherId, OPINION_ON_TREATY_BROKEN)
  const summary = treaty.articles.map((a) => describeArticle(a, byId, nameOf)).join('; ')
  const verb = stillBinding ? 'broke' : 'withdrew from'
  useDiplomacyStore.getState().pushEvent('treaty-broken', [byId, otherId], `${nameOf(byId)} ${verb} its treaty with ${nameOf(otherId)} (${summary})`, simDays)
}

export function treatyStillBinding(treaty: Treaty, simDays: number): boolean {
  return isBinding(treaty, simDays)
}

export { treatiesBetween } from '../state/treatyStore'
