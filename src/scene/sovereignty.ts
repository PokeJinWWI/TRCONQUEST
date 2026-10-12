// The I/O layer over the pure claim and jurisdiction rules (scene/claims.ts,
// scene/jurisdiction.ts): builds the live JurisdictionState from the stores and applies
// the lifecycle to them. Every caller that asks "may X build here?" or changes a claim
// goes through here, so nobody invents a private reading of sovereignty.
import { getCountry } from '../data/countryData'
import { atWar } from '../state/diplomacyStore'
import { useJurisdictionStore } from '../state/jurisdictionStore'
import { siteOwner } from '../state/locationStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useTreatyStore } from '../state/treatyStore'
import { permissionsFromTreaties, restrictionsFromTreaties } from './territorialAgreements'
import * as claimRules from './claims'
import { decideConstruction, jurisdictionOf, type AssetKind, type ConstructionDecision, type Jurisdiction, type JurisdictionState, type Permission, type PhysicalResult } from './jurisdiction'
import { locationById } from './locations'
import { orbitalAccessNow, orbitalControlNow } from './orbitalState'
import { bodyStarId } from './territory'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'
import type { Claim, ClaimBasis, ClaimResult, Scope } from './claims'

export const defaultGeo: claimRules.Geo = {
  siteOf: (id) => {
    const site = locationById(id)
    return site ? { bodyName: site.bodyName, node: site.node } : undefined
  },
  starOfBody: (body) => bodyStarId(body),
  cellsBetween: (a, b) => arc(nodePoint(a), nodePoint(b)) / surfaceMesh().fineSpacingRad,
}

export function jurisdictionState(): JurisdictionState {
  const territory = useTerritoryStore.getState()
  const store = useJurisdictionStore.getState()
  return {
    claims: store.claims,
    permissions: [...store.permissions, ...permissionsFromTreaties(useTreatyStore.getState().treaties)],
    restrictions: restrictionsFromTreaties(useTreatyStore.getState().treaties),
    bodyOwner: territory.bodyOwner,
    bodyController: territory.bodyController,
    atWar,
    orbitController: (body) => orbitalControlNow(body).controller,
    geo: defaultGeo,
    nameOf: (id) => getCountry(id)?.name ?? id,
  }
}

export function jurisdictionNow(at: Scope): Jurisdiction {
  return jurisdictionOf(at, jurisdictionState())
}

// Can this asset physically go on this scope? Only a site has a physical answer here
// (a body or system has no single place to build): the site must exist, be the right
// kind, and not be held by someone else.
export function physicalCheck(builderId: string, scope: Scope, asset: AssetKind): PhysicalResult {
  if (scope.kind !== 'location') return { ok: true }
  const site = locationById(scope.id)
  if (!site) return { ok: false, reason: 'there is no such development site' }
  const want = asset === 'colony' ? 'settlement' : asset
  if (want !== 'starbase' && site.kind !== want) return { ok: false, reason: `this site is for ${site.kind} use, not ${want}` }
  const holder = siteOwner(scope.id)
  if (holder && holder !== builderId) return { ok: false, reason: `${getCountry(holder)?.name ?? holder} already holds this site` }
  return { ok: true }
}

// The one construction check: legal (jurisdiction) and physical (the site), reported apart.
export function decideConstructionNow(builderId: string, scope: Scope, asset: AssetKind): ConstructionDecision {
  return decideConstruction({ builderId, scope, asset, physical: physicalCheck(builderId, scope, asset) }, jurisdictionState())
}

// ---- changing claims -------------------------------------------------------------

function apply(result: ClaimResult): ClaimResult {
  if (result.ok) useJurisdictionStore.getState().setClaims(result.claims)
  return result
}

const claims = (): Claim[] => useJurisdictionStore.getState().claims

export function fileClaimNow(scope: Scope, claimantId: string, basis: ClaimBasis, simDays: number): ClaimResult {
  return apply(claimRules.fileClaim(claims(), { scope, claimantId, basis, simDays }))
}

// A settlement at a site: strengthens the owner's claim there (files a region claim if it has none).
export function strengthenBySettlementNow(claimantId: string, anchorSiteId: string, simDays: number): ClaimResult {
  return apply(claimRules.strengthenBySettlement(claims(), { claimantId, anchorSiteId, geo: defaultGeo, simDays }))
}

// Recognition. A body-wide recognition also becomes the body's sovereign
// (territoryStore.bodyOwner, which every border consumer reads).
export function recognizeClaim(claimId: string, args: { basis: 'treaty' | 'recognition' | 'transfer'; byId?: string; simDays: number; resolveRivals?: boolean }): ClaimResult {
  const result = apply(claimRules.recognize(claims(), { claimId, ...args }))
  if (result.ok && result.claim.scope.kind === 'body') setBodySovereign(result.claim.scope.id, result.claim.claimantId)
  return result
}

export function withdrawClaim(claimId: string): void {
  useJurisdictionStore.getState().setClaims(claimRules.withdraw(claims(), claimId))
}

// Sovereignty over a scope passes to `toId` (a treaty, a war settlement). What stands there is NOT
// removed: buildings, settlements and people stay with their owners (M5 settles the rules for the
// economy side; for a world that already has an economy the legacy cession still moves it).
export function transferSovereignty(scope: Scope, toId: string, simDays: number): ClaimResult {
  const result = apply(claimRules.transfer(claims(), { scope, toId, simDays }))
  if (result.ok && scope.kind === 'body') setBodySovereign(scope.id, toId)
  return result
}

function setBodySovereign(bodyName: string, toId: string): void {
  const territory = useTerritoryStore.getState()
  if (territory.bodyOwner[bodyName]) territory.cedeBody(bodyName, toId)
  else territory.claimBody(bodyName, toId)
}

export function grantPermission(permission: Permission): void {
  useJurisdictionStore.getState().addPermission(permission)
}

// A Starbase is a foothold, not a title: its builder files a PROVISIONAL claim on the system (with the
// administration as evidence) unless it is already the system's recognized sovereign or already
// claims it. Rivals who build there file theirs, and the system is then contested, not anyone's.
export function claimSystemForStarbase(builderId: string, starId: string, simDays: number): void {
  const scope: Scope = { kind: 'system', id: starId }
  if (jurisdictionNow(scope).sovereign === builderId) return
  const filed = fileClaimNow(scope, builderId, 'founding', simDays)
  if (filed.ok) {
    const claim = filed.claim
    useJurisdictionStore.getState().setClaims(claimRules.addEvidence(useJurisdictionStore.getState().claims, claim.id, { kind: 'administration', byId: builderId, simDays, note: 'starbase' }))
  }
}

// A sovereign closes its ground to every other country's construction (a general ban: `holderId '*'`).
// The ban is LAW. Whether it can be ENFORCED is a matter of force: see `canEnforce`.
export function banForeignConstruction(sovereignId: string, scope: Scope, simDays: number): void {
  grantPermission({ id: `ban:${sovereignId}:${scope.kind}:${scope.id}`, grantorId: sovereignId, holderId: '*', scope, effect: 'deny', basis: 'decree', since: simDays })
}

// Can the sovereign actually keep others out of a place? Not when an enemy holds the orbit over it.
export function canEnforce(sovereignId: string, bodyName: string): boolean {
  return orbitalAccessNow(sovereignId, bodyName).ok
}
