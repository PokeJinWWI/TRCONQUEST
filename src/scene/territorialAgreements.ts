// Territorial agreements (docs/territorial-design.md M9): what the treaty articles about places mean.
// Rights and bans are DERIVED from the treaties in force, so ending a treaty withdraws the right with
// no extra bookkeeping, and what was built under it stays with its owner. Recognitions and transfers
// are one-time acts that go through the claim lifecycle (scene/sovereignty), never around it.
import { getCountry } from '../data/countryData'
import type { Treaty, TreatyArticle } from '../data/treatyData'
import { useJurisdictionStore } from '../state/jurisdictionStore'
import { isLive, sameScope, type Claim } from './claims'
import type { Permission, Restriction } from './jurisdiction'
import { jurisdictionNow, recognizeClaim, transferSovereignty, withdrawClaim } from './sovereignty'
import * as claimRules from './claims'

const nameOf = (id: string) => getCountry(id)?.name ?? id

// The permissions the treaties in force give (ids carry the treaty and article, so they are stable).
export function permissionsFromTreaties(treaties: readonly Treaty[]): Permission[] {
  const out: Permission[] = []
  for (const t of treaties) {
    t.articles.forEach((a, i) => {
      if (a.kind === 'construction-right') out.push({ id: `treaty:${t.id}:${i}`, grantorId: a.sourceId, holderId: a.targetId, scope: a.scope, effect: 'allow', basis: 'treaty', since: t.signedSimDays })
      else if (a.kind === 'access-right') out.push({ id: `treaty:${t.id}:${i}`, grantorId: a.sourceId, holderId: a.targetId, scope: a.scope, action: a.access, effect: 'allow', basis: 'treaty', since: t.signedSimDays })
    })
  }
  return out
}

export function restrictionsFromTreaties(treaties: readonly Treaty[]): Restriction[] {
  const out: Restriction[] = []
  for (const t of treaties) t.articles.forEach((a, i) => a.kind === 'demilitarized-zone' && out.push({ id: `treaty:${t.id}:${i}`, scope: a.scope, parties: [t.a, t.b] }))
  return out
}

// Why an article cannot be signed, or null. Reads the live claims and sovereigns.
export function validateTerritorialArticle(article: TreatyArticle, a: string, b: string): string | null {
  const pair = new Set([a, b])
  switch (article.kind) {
    case 'construction-right':
    case 'access-right': {
      if (article.sourceId === article.targetId) return 'A nation cannot grant this to itself'
      if (!pair.has(article.sourceId) || !pair.has(article.targetId)) return 'Must be between these two nations'
      return jurisdictionNow(article.scope).sovereign === article.sourceId ? null : `${nameOf(article.sourceId)} does not govern ${article.scope.id}`
    }
    case 'territorial-recognition': {
      if (article.sourceId === article.targetId) return 'A nation cannot recognize itself'
      if (!pair.has(article.sourceId) || !pair.has(article.targetId)) return 'Must be between these two nations'
      if (jurisdictionNow(article.scope).sovereign === article.sourceId) return `${nameOf(article.sourceId)} governs ${article.scope.id}: that is a transfer`
      return ownClaim(article) ? null : `${nameOf(article.targetId)} has no claim on ${article.scope.id}`
    }
    case 'territorial-transfer': {
      if (article.fromId === article.toId) return 'Source and destination must differ'
      if (!pair.has(article.fromId) || !pair.has(article.toId)) return 'Transfer must be between these two nations'
      return jurisdictionNow(article.scope).sovereign === article.fromId ? null : `${nameOf(article.fromId)} does not govern ${article.scope.id}`
    }
    default:
      return null
  }
}

const ownClaim = (article: Extract<TreatyArticle, { kind: 'territorial-recognition' }>): Claim | undefined =>
  useJurisdictionStore.getState().claims.find((c) => isLive(c) && c.status === 'provisional' && sameScope(c.scope, article.scope) && c.claimantId === article.targetId)

// Applies a one-time territorial article.
export function applyTerritorialArticle(article: TreatyArticle, simDays: number): void {
  if (article.kind === 'territorial-transfer') {
    transferSovereignty(article.scope, article.toId, simDays)
  } else if (article.kind === 'territorial-recognition') {
    const claim = ownClaim(article)
    if (!claim) return
    // A rival claim of the recognizer's own is given up: the dispute between the two is settled.
    const theirs = useJurisdictionStore.getState().claims.find((c) => isLive(c) && sameScope(c.scope, article.scope) && c.claimantId === article.sourceId)
    if (theirs) withdrawClaim(theirs.id)
    const done = recognizeClaim(claim.id, { basis: 'recognition', byId: article.sourceId, simDays })
    // Third parties still claim it: the recognition counts as evidence, and the dispute stands.
    if (!done.ok) useJurisdictionStore.getState().setClaims(claimRules.addEvidence(useJurisdictionStore.getState().claims, claim.id, { kind: 'recognition', byId: article.sourceId, simDays }))
  }
}
