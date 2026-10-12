// Territorial claims: the data and the lifecycle, pure (state/jurisdictionStore.ts
// holds the live list; scene/jurisdiction.ts answers "who governs here?").
//
// A claim says WHO asserts a right over WHAT, and why. It is not ownership:
//   claim      a country asserts a right to a scope (provisional until something makes it more)
//   recognized the claim has been accepted by an explicit act: a treaty, a transfer, a recognition
//   superseded another recognized claim or an agreement replaced it
//   withdrawn  the claimant gave it up
// "Contested" is not a status: it is derived (two live claimants over one place), so it
// clears itself when one of them withdraws. Nothing here turns a claim into
// sovereignty through a number: recognition is always a call to `recognize`.
//
// Scopes, from widest to narrowest: system, body, region (an anchor site and the sites
// near it), location (one site). Sovereignty over a whole body is the legacy
// territoryStore.bodyOwner (see docs/territorial-design.md 2.6); this module covers
// everything else, and a body-wide recognition writes bodyOwner (scene/sovereignty.ts).
import { SETTLEMENT_CLAIM_RADIUS_CELLS } from '../data/territoryData'

export type ScopeKind = 'system' | 'body' | 'region' | 'location' | 'orbit'
export interface Scope {
  kind: ScopeKind
  // star id / body name / anchor site id / site id / orbital zone id (`<body>~low`, scene/orbits.ts)
  id: string
}

export type ClaimStatus = 'provisional' | 'recognized' | 'superseded' | 'withdrawn'
export type ClaimBasis = 'founding' | 'settlement' | 'treaty' | 'transfer' | 'recognition' | 'seed'

export interface ClaimEvidence {
  kind: 'settlement' | 'administration' | 'treaty' | 'recognition' | 'survey'
  byId?: string
  simDays: number
  note?: string
}

export interface Claim {
  id: string
  scope: Scope
  claimantId: string
  status: ClaimStatus
  basis: ClaimBasis
  since: number
  evidence: ClaimEvidence[]
  supersededBy?: string
}

export const scopeKey = (s: Scope): string => `${s.kind}:${s.id}`
export const sameScope = (a: Scope, b: Scope): boolean => a.kind === b.kind && a.id === b.id
export const isLive = (c: Claim): boolean => c.status === 'provisional' || c.status === 'recognized'

// Where a site is, as far as scope coverage needs to know.
export interface Geo {
  siteOf: (siteId: string) => { bodyName: string; node: number | null } | undefined
  starOfBody: (bodyName: string) => string | undefined
  // Angular distance between two nodes of any body, in fine cells.
  cellsBetween: (a: number, b: number) => number
}

// Does `scope` cover the site? A system covers every site of every body in it, a body
// all of its sites, a region the sites within the settlement radius of its anchor, a
// location only itself.
export function scopeCovers(scope: Scope, siteId: string, geo: Geo, radius = SETTLEMENT_CLAIM_RADIUS_CELLS): boolean {
  const site = geo.siteOf(siteId)
  if (!site) return false
  switch (scope.kind) {
    case 'location':
      return scope.id === siteId
    case 'body':
      return scope.id === site.bodyName
    case 'system':
      return geo.starOfBody(site.bodyName) === scope.id
    case 'orbit':
      return false // an orbital zone covers no surface site
    case 'region': {
      const anchor = geo.siteOf(scope.id)
      if (!anchor || anchor.bodyName !== site.bodyName) return false
      if (scope.id === siteId) return true
      if (anchor.node === null || site.node === null) return false
      return geo.cellsBetween(anchor.node, site.node) <= radius
    }
  }
}

export type ClaimResult = { ok: true; claims: Claim[]; claim: Claim } | { ok: false; reason: string }

// Ids are derived, never counted: `<scope>|<claimant>|<n>`, n = claims that pair has had.
function idFor(claims: Claim[], scope: Scope, claimantId: string): string {
  const n = claims.filter((c) => sameScope(c.scope, scope) && c.claimantId === claimantId).length
  return `${scopeKey(scope)}|${claimantId}|${n}`
}

const replace = (claims: Claim[], next: Claim): Claim[] => claims.map((c) => (c.id === next.id ? next : c))

// A country files a claim: provisional, until something recognizes it.
export function fileClaim(claims: Claim[], args: { scope: Scope; claimantId: string; basis: ClaimBasis; simDays: number; evidence?: ClaimEvidence[] }): ClaimResult {
  const { scope, claimantId, basis, simDays } = args
  if (claims.some((c) => isLive(c) && sameScope(c.scope, scope) && c.claimantId === claimantId)) return { ok: false, reason: 'That country already holds a claim on this scope' }
  const claim: Claim = { id: idFor(claims, scope, claimantId), scope, claimantId, status: 'provisional', basis, since: simDays, evidence: args.evidence ?? [] }
  return { ok: true, claims: [...claims, claim], claim }
}

export function addEvidence(claims: Claim[], claimId: string, evidence: ClaimEvidence): Claim[] {
  return claims.map((c) => (c.id === claimId ? { ...c, evidence: [...c.evidence, evidence] } : c))
}

// A settlement at `anchorSiteId` strengthens its owner's position: with a live claim of the
// owner already covering it, that claim gains the evidence; otherwise a provisional REGION
// claim (the anchor and the sites near it) is filed. Never anything wider than the body.
export function strengthenBySettlement(claims: Claim[], args: { claimantId: string; anchorSiteId: string; geo: Geo; simDays: number }): ClaimResult {
  const { claimantId, anchorSiteId, geo, simDays } = args
  const covering = claims.filter((c) => isLive(c) && c.claimantId === claimantId && scopeCovers(c.scope, anchorSiteId, geo))
  const evidence: ClaimEvidence = { kind: 'settlement', byId: claimantId, simDays, note: anchorSiteId }
  if (covering.length > 0) {
    // The narrowest claim already there carries the evidence.
    const rank: Record<ScopeKind, number> = { location: 0, orbit: 0, region: 1, body: 2, system: 3 }
    const best = [...covering].sort((a, b) => rank[a.scope.kind] - rank[b.scope.kind])[0]
    const next = { ...best, evidence: [...best.evidence, evidence] }
    return { ok: true, claims: replace(claims, next), claim: next }
  }
  return fileClaim(claims, { scope: { kind: 'region', id: anchorSiteId }, claimantId, basis: 'settlement', simDays, evidence: [evidence] })
}

// An explicit act makes a claim recognized. Refused while another live claim over the same
// scope stands, unless `resolveRivals` (a treaty that settles it): those become superseded.
// Never turns a scope with a recognized claimant into a second one: that is a `transfer`.
export function recognize(claims: Claim[], args: { claimId: string; basis: 'treaty' | 'recognition' | 'transfer'; byId?: string; simDays: number; resolveRivals?: boolean }): ClaimResult {
  const claim = claims.find((c) => c.id === args.claimId)
  if (!claim) return { ok: false, reason: 'No such claim' }
  if (claim.status !== 'provisional') return { ok: false, reason: `A ${claim.status} claim cannot be recognized` }
  const others = claims.filter((c) => c.id !== claim.id && isLive(c) && sameScope(c.scope, claim.scope) && c.claimantId !== claim.claimantId)
  if (others.some((c) => c.status === 'recognized')) return { ok: false, reason: 'Another country is already recognized here: use a transfer' }
  if (others.length > 0 && !args.resolveRivals) return { ok: false, reason: 'Rival claims stand on this scope; recognition has to settle them' }
  const next: Claim = { ...claim, status: 'recognized', basis: args.basis, evidence: [...claim.evidence, { kind: args.basis === 'treaty' ? 'treaty' : 'recognition', byId: args.byId, simDays: args.simDays }] }
  const rivalIds = new Set(others.map((c) => c.id))
  const out = claims.map((c) => (c.id === next.id ? next : rivalIds.has(c.id) ? { ...c, status: 'superseded' as const, supersededBy: next.id } : c))
  return { ok: true, claims: out, claim: next }
}

export function withdraw(claims: Claim[], claimId: string): Claim[] {
  return claims.map((c) => (c.id === claimId && isLive(c) ? { ...c, status: 'withdrawn' as const } : c))
}

// Sovereignty over `scope` passes to `toId`: the recognized claim there (whoever's) is superseded and
// `toId` holds a recognized one on basis 'transfer'. Rival provisional claims are untouched: a
// transfer is an agreement between two parties, it does not settle a third's dispute.
export function transfer(claims: Claim[], args: { scope: Scope; toId: string; simDays: number }): ClaimResult {
  const { scope, toId, simDays } = args
  const current = claims.find((c) => c.status === 'recognized' && sameScope(c.scope, scope))
  if (current?.claimantId === toId) return { ok: false, reason: 'That country is already recognized here' }
  // `toId` may already hold a provisional claim there: it becomes the recognized one.
  const own = claims.find((c) => isLive(c) && sameScope(c.scope, scope) && c.claimantId === toId)
  let next = claims
  if (current) next = replace(next, { ...current, status: 'superseded', supersededBy: own?.id ?? idFor(claims, scope, toId) })
  if (own) {
    const upgraded: Claim = { ...own, status: 'recognized', basis: 'transfer', evidence: [...own.evidence, { kind: 'treaty', byId: current?.claimantId, simDays, note: 'transfer' }] }
    return { ok: true, claims: replace(next, upgraded), claim: upgraded }
  }
  const claim: Claim = { id: idFor(claims, scope, toId), scope, claimantId: toId, status: 'recognized', basis: 'transfer', since: simDays, evidence: [{ kind: 'treaty', byId: current?.claimantId, simDays, note: 'transfer' }] }
  return { ok: true, claims: [...next, claim], claim }
}
