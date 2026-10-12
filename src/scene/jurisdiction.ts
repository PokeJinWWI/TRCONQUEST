// Who governs a place, and whether someone may build there. Pure: every input is in
// `JurisdictionState`, so the UI, the AI, the resolvers and the tests all ask the same
// function (scene/sovereignty.ts builds the live state). Nothing else may decide this.
//
// Sovereignty over a place, most specific first:
//   a recognized LOCATION claim, a recognized REGION claim covering it, the body's
//   sovereign (territoryStore.bodyOwner, or a recognized body claim), a recognized
//   SYSTEM claim. None of those = no sovereign: the frontier.
// Owning a facility, holding a Starbase, or surveying confer none of it.
//
// Legal permission and physical possibility are separate answers, never merged: a site can
// be legal to build on and impossible (taken, wrong kind), or possible and forbidden.
import { isLive, scopeCovers, sameScope, type Claim, type Geo, type Scope, type ScopeKind } from './claims'

export type OwnerMap = Record<string, string>

// A standing right (or ban) a sovereign gives to another country over a scope: a treaty
// provision, a lease, a concession. M9 grows these into full agreements.
export type PermissionAction = 'construct' | 'transit' | 'dock' | 'basing'

export interface Permission {
  id: string
  grantorId: string
  // The country it applies to, or '*' for every country but the grantor (a general ban on foreigners).
  holderId: string
  // What it is about; absent = construction.
  action?: PermissionAction
  scope: Scope
  effect: 'allow' | 'deny'
  basis: 'treaty' | 'lease' | 'concession' | 'decree'
  since: number
}

// A treaty ban on military assets in a scope, binding the listed countries.
export interface Restriction {
  id: string
  scope: Scope
  parties: string[]
}

export interface JurisdictionState {
  claims: Claim[]
  permissions: Permission[]
  restrictions?: Restriction[]
  bodyOwner: OwnerMap
  bodyController: OwnerMap
  atWar: (a: string, b: string) => boolean
  // Who holds a body's orbit by force right now (scene/orbits.orbitalControl), if anyone. Absent = nobody is asked.
  orbitController?: (bodyName: string) => string | undefined
  geo: Geo
  nameOf: (id: string) => string
}

export interface Jurisdiction {
  scope: Scope
  sovereign?: string
  // Which scope the sovereignty comes from.
  sovereignFrom?: ScopeKind
  // Everyone asserting something here: the sovereign plus live provisional claimants.
  disputants: string[]
  contested: boolean
  frontier: boolean
  // Who holds it militarily right now (occupier, else the sovereign).
  controller?: string
  claims: Claim[]
}

const SPECIFICITY: ScopeKind[] = ['location', 'orbit', 'region', 'body', 'system']

function bodyOf(scope: Scope, state: JurisdictionState): string | undefined {
  if (scope.kind === 'body') return scope.id
  if (scope.kind === 'system') return undefined
  if (scope.kind === 'orbit') return scope.id.slice(0, scope.id.lastIndexOf('~'))
  return state.geo.siteOf(scope.id)?.bodyName
}

// Does a claim/permission scope reach the place `at`? For a site, via scopeCovers; for a body or a
// system, a claim covers it when it is that scope or wider.
function reaches(scope: Scope, at: Scope, state: JurisdictionState): boolean {
  if (sameScope(scope, at)) return true
  if (at.kind === 'location') return scopeCovers(scope, at.id, state.geo)
  if (at.kind === 'body') return scope.kind === 'system' && state.geo.starOfBody(at.id) === scope.id
  // An orbital zone answers to claims on itself, on its body and on its system.
  if (at.kind === 'orbit') {
    const body = bodyOf(at, state)
    return (scope.kind === 'body' && scope.id === body) || (scope.kind === 'system' && !!body && state.geo.starOfBody(body) === scope.id)
  }
  return false
}

export function jurisdictionOf(at: Scope, state: JurisdictionState): Jurisdiction {
  const covering = state.claims.filter((c) => isLive(c) && reaches(c.scope, at, state))
  const body = bodyOf(at, state)
  let sovereign: string | undefined
  let sovereignFrom: ScopeKind | undefined
  for (const kind of SPECIFICITY) {
    const recognized = covering.find((c) => c.status === 'recognized' && c.scope.kind === kind)
    // At body level territoryStore.bodyOwner is the authority (a recognized body claim only
    // records how it came about), so a stale claim can never outvote it.
    const legacy = kind === 'body' && body ? state.bodyOwner[body] : undefined
    const holder = kind === 'body' ? (legacy ?? recognized?.claimantId) : recognized?.claimantId
    if (holder) {
      sovereign = holder
      sovereignFrom = kind
      break
    }
  }
  const provisional = covering.filter((c) => c.status === 'provisional').map((c) => c.claimantId)
  const disputants = [...new Set([...(sovereign ? [sovereign] : []), ...provisional])].sort()
  return {
    scope: at,
    sovereign,
    sovereignFrom,
    disputants,
    contested: disputants.length >= 2,
    frontier: !sovereign,
    // An orbit is held by whoever dominates it with armed force, not by whoever occupies the ground.
    controller: at.kind === 'orbit' ? (body && state.orbitController?.(body)) || undefined : (body && state.bodyController[body]) || sovereign,
    claims: covering,
  }
}

// ---- construction rights --------------------------------------------------------

export type LegalOutcome = 'authorized' | 'treaty' | 'limited-right' | 'contested' | 'needs-permission' | 'prohibited' | 'military-restricted'
export type AssetKind = 'settlement' | 'industrial' | 'infrastructure' | 'resource' | 'agricultural' | 'strategic' | 'colony' | 'starbase' | 'orbital' | 'military'

export type PhysicalResult = { ok: true } | { ok: false; reason: string }

export interface ConstructionRequest {
  builderId: string
  scope: Scope
  asset: AssetKind
  physical?: PhysicalResult
}

export interface ConstructionDecision {
  legal: LegalOutcome
  physical: PhysicalResult
  // Both legal enough and physically possible.
  allowed: boolean
  // Going ahead would be a diplomatic incident (building in disputed ground).
  incident: boolean
  jurisdiction: Jurisdiction
  reason: string
}

// What an occupying power may build on the ground it holds.
const OCCUPIER_ASSETS: AssetKind[] = ['military', 'infrastructure', 'orbital']

const LEGAL_OK: LegalOutcome[] = ['authorized', 'treaty', 'limited-right', 'contested']

export function decideConstruction(req: ConstructionRequest, state: JurisdictionState): ConstructionDecision {
  const { builderId, scope } = req
  const j = jurisdictionOf(scope, state)
  const physical: PhysicalResult = req.physical ?? { ok: true }
  const name = state.nameOf
  const decide = (legal: LegalOutcome, reason: string): ConstructionDecision => ({
    legal,
    physical,
    allowed: physical.ok && LEGAL_OK.includes(legal),
    incident: legal === 'contested',
    jurisdiction: j,
    reason: physical.ok ? reason : `${reason} (and physically impossible: ${physical.reason})`,
  })

  // Armed control by someone at war with the builder stops building for now, whoever the sovereign is.
  if (j.controller && j.controller !== builderId && state.atWar(j.controller, builderId)) {
    return decide('military-restricted', `${name(j.controller)} holds this ground by force and is at war with you`)
  }

  // A demilitarized zone binds its parties: no military assets there, whoever governs.
  if (req.asset === 'military' && (state.restrictions ?? []).some((r) => r.parties.includes(builderId) && reaches(r.scope, scope, state))) return decide('prohibited', 'A treaty demilitarizes this place')

  const permissions = state.permissions.filter((p) => (p.action ?? 'construct') === 'construct' && (p.holderId === builderId || (p.holderId === '*' && p.grantorId !== builderId)) && reaches(p.scope, scope, state) && (!j.sovereign || p.grantorId === j.sovereign))
  if (permissions.some((p) => p.effect === 'deny')) return decide('prohibited', `${j.sovereign ? name(j.sovereign) : 'The authority here'} has forbidden you to build here`)

  // (Ground only: holding an ORBIT by force gives no such right.) An occupier holds the ground by force without the title: it may build what the occupation needs, and nothing that
  // would make the place its own (settling, farming, mining). That is the law of occupation, not annexation.
  if (scope.kind !== 'orbit' && j.sovereign && j.sovereign !== builderId && j.controller === builderId && state.atWar(j.sovereign, builderId)) {
    return OCCUPIER_ASSETS.includes(req.asset)
      ? decide('limited-right', `You hold this ground by force: an occupying power may build what the occupation needs, but ${name(j.sovereign)} stays its sovereign`)
      : decide('prohibited', `An occupier does not settle or exploit ground it holds only by force; ${name(j.sovereign)} is its sovereign`)
  }

  if (j.sovereign) {
    if (j.sovereign === builderId) return decide(j.contested ? 'contested' : 'authorized', j.contested ? 'Your own territory, but others dispute it' : 'Your own territory')
    const grant = permissions.find((p) => p.effect === 'allow')
    if (grant) return decide('treaty', `${name(j.sovereign)} allows it under a ${grant.basis}`)
    if (state.atWar(j.sovereign, builderId)) return decide('prohibited', `${name(j.sovereign)} governs here and is at war with you`)
    return decide('needs-permission', `${name(j.sovereign)} governs here: building needs its permission`)
  }

  // The frontier: nobody is sovereign.
  const rivals = j.disputants.filter((id) => id !== builderId)
  if (j.disputants.includes(builderId)) {
    return rivals.length > 0
      ? decide('contested', `You claim this, but ${rivals.map(name).join(' and ')} claim it too`)
      : decide('limited-right', 'Your provisional claim gives you priority on the frontier here')
  }
  if (rivals.length > 0) return decide('contested', `${rivals.map(name).join(' and ')} claim${rivals.length === 1 ? 's' : ''} this: building here is a dispute`)
  return decide('authorized', 'Open frontier: nobody governs here yet')
}

// ---- access: transit, docking, basing -------------------------------------------------

export interface AccessDecision {
  legal: 'authorized' | 'treaty' | 'needs-permission' | 'prohibited'
  allowed: boolean
  reason: string
  jurisdiction: Jurisdiction
}

// May `nationId` transit, dock at or base forces in a place? The sovereign (or a place with none) lets
// anyone transit and dock; basing is the sovereign's own, or by agreement. A treaty right opens it; war or a ban shuts it.
// This is the LAW: whether an enemy fleet can be kept out is a matter of force (scene/orbits.orbitalAccess).
export function decideAccess(req: { nationId: string; scope: Scope; access: Exclude<PermissionAction, 'construct'> }, state: JurisdictionState): AccessDecision {
  const { nationId, scope, access } = req
  const j = jurisdictionOf(scope, state)
  const rights = state.permissions.filter((p) => p.action === access && (p.holderId === nationId || (p.holderId === '*' && p.grantorId !== nationId)) && reaches(p.scope, scope, state) && (!j.sovereign || p.grantorId === j.sovereign))
  const out = (legal: AccessDecision['legal'], reason: string): AccessDecision => ({ legal, allowed: legal === 'authorized' || legal === 'treaty', reason, jurisdiction: j })
  if (rights.some((p) => p.effect === 'deny')) return out('prohibited', `${j.sovereign ? state.nameOf(j.sovereign) : 'The authority here'} has closed ${access} here to you`)
  if (!j.sovereign || j.sovereign === nationId) return out('authorized', j.sovereign ? 'Your own territory' : 'Open frontier')
  if (rights.some((p) => p.effect === 'allow')) return out('treaty', `${state.nameOf(j.sovereign)} grants ${access} rights by agreement`)
  if (state.atWar(j.sovereign, nationId)) return out('prohibited', `${state.nameOf(j.sovereign)} is at war with you`)
  // Passing through and docking are courtesies of a peaceful sovereign; stationing forces is not.
  return access === 'basing' ? out('needs-permission', `${state.nameOf(j.sovereign)} must agree to basing here`) : out('authorized', `${state.nameOf(j.sovereign)} lets peaceful ships ${access} here`)
}
