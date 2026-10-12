// What the territory and development screens show, as plain data (docs/territorial-design.md M13): no React,
// no layout, so every line the player reads can be tested. Each layer of control is a row of its own, so
// nothing hides behind one "owner" label: who governs, who holds it by force, who owns what stands there,
// who holds the orbit, and why something is allowed, blocked or inefficient.
import { getCountry } from '../data/countryData'
import { FACILITY_SPECS } from '../data/orbitalData'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useInfrastructureStore } from '../state/infrastructureStore'
import { siteOwner } from '../state/locationStore'
import { useOrbitalStore } from '../state/orbitalStore'
import { usePlacementStore } from '../state/placementStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { isLive, scopeKey, type Claim } from './claims'
import { accessOnBody, capturedBy } from './infrastructureOrders'
import { isWorking } from './infrastructureNet'
import { locationsOf } from './locations'
import { orbitalControlNow } from './orbitalState'
import { facilityWorking, orbitalZonesOf } from './orbits'
import { decideConstructionNow, jurisdictionNow, jurisdictionState } from './sovereignty'
import { systemTerritoryNow } from './systemTerritory'
import { urbanNow } from './urbanState'

const nameOf = (id?: string): string => (id ? (getCountry(id)?.name ?? id) : 'nobody')

// ---- a body: who governs what, and how it got that way -------------------------------------

export interface ClaimLine {
  id: string
  claimant: string
  scope: string
  status: Claim['status']
  basis: Claim['basis']
  since: number
  evidence: number
}

export interface TerritoryView {
  bodyName: string
  // The layers, each by itself.
  sovereign: { name: string; from: string } | null
  groundControl: { name: string; occupied: boolean }
  frontier: boolean
  contested: boolean
  disputants: string[]
  claims: ClaimLine[]
  // Sites someone other than the sovereign owns here: enclaves.
  enclaves: { siteId: string; kind: string; owner: string }[]
  // Rights and bans in force, from treaties and decrees.
  agreements: string[]
  orbit: {
    zone: string
    kind: string
    // Who has the right to govern it.
    governs: string
    // Who holds it by force right now.
    holds: string
    contested: boolean
    facilities: { kind: string; owner: string; working: boolean }[]
  }[]
  // Recent happenings here (occupation, cession, incident), newest first.
  recent: string[]
}

export function territoryView(bodyName: string): TerritoryView {
  const territory = useTerritoryStore.getState()
  const j = jurisdictionNow({ kind: 'body', id: bodyName })
  const state = jurisdictionState()
  const controller = territory.bodyController[bodyName] ?? territory.bodyOwner[bodyName]
  // Live claims first, then the history (superseded and withdrawn claims are kept, not deleted).
  const claims = state.claims.filter((c) => (c.scope.id === bodyName || c.scope.id.startsWith(`${bodyName}#`) || c.scope.id.startsWith(`${bodyName}~`)))
  const sites = locationsOf(bodyName)
  const enclaves = sites
    .filter((s) => siteOwner(s.id) && j.sovereign && siteOwner(s.id) !== j.sovereign)
    .map((s) => ({ siteId: s.id, kind: s.kind, owner: nameOf(siteOwner(s.id)) }))
  const relevant = (scope: string) => scope === bodyName || scope.startsWith(`${bodyName}#`) || scope.startsWith(`${bodyName}~`)
  const agreements: string[] = [
    ...state.permissions.filter((p) => relevant(p.scope.id)).map((p) => `${p.effect === 'deny' ? 'Ban' : 'Right'} (${p.action ?? 'construct'}) ${p.holderId === '*' ? 'for all foreigners' : `for ${nameOf(p.holderId)}`}, from ${nameOf(p.grantorId)} by ${p.basis} — ${p.scope.id}`),
    ...(state.restrictions ?? []).filter((r) => relevant(r.scope.id)).map((r) => `Demilitarized by treaty: ${r.scope.id} (${r.parties.map(nameOf).join(', ')})`),
  ]
  const facilities = useOrbitalStore.getState().facilities
  const now = useGameTimeStore.getState().simDays
  const control = orbitalControlNow(bodyName)
  const orbit = orbitalZonesOf(bodyName).map((z) => {
    const zj = jurisdictionNow({ kind: 'orbit', id: z.id })
    return {
      zone: z.id,
      kind: z.kind,
      governs: nameOf(zj.sovereign),
      holds: control.contested ? 'contested' : nameOf(control.controller),
      contested: zj.contested,
      facilities: facilities.filter((f) => f.zone === z.id).map((f) => ({ kind: FACILITY_SPECS[f.kind].name, owner: nameOf(f.ownerId), working: facilityWorking(f, now) })),
    }
  })
  const events = useDiplomacyStore.getState().events.filter((e) => e.place?.bodyName === bodyName && ['body-occupied', 'body-ceded', 'territorial-incident'].includes(e.kind))
  return {
    bodyName,
    sovereign: j.sovereign ? { name: nameOf(j.sovereign), from: j.sovereignFrom ?? 'body' } : null,
    groundControl: { name: nameOf(controller), occupied: !!territory.bodyController[bodyName] && territory.bodyController[bodyName] !== territory.bodyOwner[bodyName] },
    frontier: j.frontier,
    contested: j.contested,
    disputants: j.disputants.map(nameOf),
    claims: [...claims].sort((a, b) => Number(isLive(b)) - Number(isLive(a))).map((c) => ({ id: c.id, claimant: nameOf(c.claimantId), scope: scopeKey(c.scope), status: c.status, basis: c.basis, since: c.since, evidence: c.evidence.length })),
    enclaves,
    agreements,
    orbit,
    recent: events.sort((a, b) => b.simDays - a.simDays).slice(0, 5).map((e) => e.text),
  }
}

// ---- a system ------------------------------------------------------------------------------

export interface SystemView {
  relation: string
  sovereign: string | null
  claimants: string[]
  presence: string[]
  bodies: { body: string; sovereign: string }[]
  note: string
}

export function systemView(starId: string): SystemView {
  const t = systemTerritoryNow(starId)
  const note = {
    sovereign: `${nameOf(t.sovereign)} governs the system; bodies keep their own sovereigns`,
    split: 'No one governs the system as a whole: each world has its own sovereign',
    contested: 'Rival claims stand on this system',
    frontier: 'Open frontier: nobody governs here yet',
  }[t.relation]
  return { relation: t.relation, sovereign: t.sovereign ? nameOf(t.sovereign) : null, claimants: t.claimants.map(nameOf), presence: t.presence.map(nameOf), bodies: Object.entries(t.bodySovereigns).map(([body, id]) => ({ body, sovereign: nameOf(id) })), note }
}

// ---- development: sites, buildings, routes, settlements ---------------------------------------

export interface SiteRow {
  id: string
  kind: string
  terrain: string | null
  suitability: number
  capacity: number
  tags: string[]
  // What lies there.
  holds: string | null
  owner: string | null
  buildings: { id: string; count: number }[]
  // The share of its output that reaches a hub, for its owner (1 = fully connected).
  access: number | null
  // An enemy's ground forces hold this site: what stands here makes nothing for its owner while they do.
  captured: boolean
  // Whether the player could build here, with the LEGAL and PHYSICAL answers apart.
  forPlayer: { legal: string; physical: string | null; why: string } | null
}

export interface DevelopmentView {
  bodyName: string
  sites: SiteRow[]
  routes: { id: string; kind: string; owner: string; working: boolean; open: boolean; cells: number; disrepair: boolean; between: string }[]
  settlements: { id: string; tier: string; population: number; specializations: string[]; jobs: number; access: number; overcrowded: boolean; next: string | null }[]
}

export function developmentView(bodyName: string, playerId: string | null): DevelopmentView {
  const sites = locationsOf(bodyName)
  const placed = usePlacementStore.getState().placed
  const now = useGameTimeStore.getState().simDays
  const accessByNation = new Map<string, Record<string, number>>()
  const accessFor = (nation: string) => {
    if (!accessByNation.has(nation)) accessByNation.set(nation, accessOnBody(bodyName, nation, now))
    return accessByNation.get(nation)!
  }
  const rows: SiteRow[] = sites.map((s) => {
    const owner = siteOwner(s.id)
    const decision = playerId ? decideConstructionNow(playerId, { kind: 'location', id: s.id }, s.kind) : null
    return {
      id: s.id,
      kind: s.kind,
      terrain: s.terrain,
      suitability: s.suitability,
      capacity: s.capacity,
      tags: s.tags,
      holds: s.material ?? s.good ?? null,
      owner: owner ? nameOf(owner) : null,
      buildings: Object.entries(placed[s.id] ?? {}).map(([id, count]) => ({ id, count })),
      captured: !!owner && s.node !== null && capturedBy(bodyName, s.node, siteOwner(s.id)!),
      access: owner ? (accessFor(owner)[s.id] ?? 1) : null,
      forPlayer: decision ? { legal: decision.legal, physical: decision.physical.ok ? null : decision.physical.reason, why: decision.reason } : null,
    }
  })
  const routes = useInfrastructureStore.getState().routes.filter((r) => r.bodyName === bodyName).map((r) => ({ id: r.id, kind: r.kind, owner: nameOf(r.ownerId), working: isWorking(r, now), open: r.open, cells: r.cells, disrepair: !!r.disrepair, between: `${r.a} — ${r.b}` }))
  const nations = [...new Set(sites.map((s) => siteOwner(s.id)).filter((n): n is string => !!n))]
  const settlements = nations.flatMap((n) => urbanNow(bodyName, n)).map((u) => ({ id: u.id, tier: u.tier, population: Math.round(u.population), specializations: u.specializations, jobs: u.jobs, access: Math.round(u.access * 100) / 100, overcrowded: u.overcrowded, next: u.next ? `${u.next.tier}: ${u.next.needs.join('; ') || 'ready'}` : null }))
  return { bodyName, sites: rows, routes, settlements }
}
