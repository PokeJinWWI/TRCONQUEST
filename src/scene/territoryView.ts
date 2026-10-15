// What the territory and development screens show, as plain data (docs/territorial-design.md M13): no React,
// no layout, so every line the player reads can be tested. Each layer of control is a row of its own, so
// nothing hides behind one "owner" label: who governs, who holds it by force, who owns what stands there,
// who holds the orbit, and why something is allowed, blocked or inefficient.
import { getCountry } from '../data/countryData'
import { FACILITY_SPECS } from '../data/orbitalData'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useInfrastructureStore } from '../state/infrastructureStore'
import { siteName, siteOwner, useLocationStore } from '../state/locationStore'
import { useOrbitalStore } from '../state/orbitalStore'
import { usePlacementStore } from '../state/placementStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { isLive, type Claim } from './claims'
import { accessOnBody, capturedBy } from './infrastructureOrders'
import { isWorking } from './infrastructureNet'
import { locationsOf } from './locations'
import { orbitalControlNow } from './orbitalState'
import { facilityWorking, orbitalZonesOf } from './orbits'
import { decideConstructionNow, jurisdictionNow, jurisdictionState } from './sovereignty'
import { systemTerritoryNow } from './systemTerritory'
import { urbanNow } from './urbanState'
import { RECIPES } from '../economy/recipes'
import { groundKeySurface, portBaseSurface } from '../state/defenseStore'
import { bodyAreas, footprintsOf } from './footprintState'
import { areaAtNode, areaOfSeed } from './areas'
import { STANDALONE_BUILDINGS } from './placement'
import { portList, type PortList } from './portList'
import { civicInArea } from './civic'
import { keyNameOf } from './keyNames'
import { useCivicStore } from '../state/civicStore'
import { lonLatOf } from './mapProjection'
import { ruralOf } from './ruralOrders'
import { capturableByGround, ruralSiteFor } from './ruralStructures'
import { nodePoint } from './surfaceMesh'
import { zoneBase } from './zoneOrders'

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
    claims: claimLines(bodyName, claims),
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

// The claims on a body as the player reads them: by place name (the area a site is in, an orbit, the whole world), never by
// internal id, and the several settlement claims of one area (towns that grew together) as one line.
function claimLines(bodyName: string, claims: readonly Claim[]): ClaimLine[] {
  const base = zoneBase(bodyName)
  const areas = base ? bodyAreas(bodyName, base) : []
  const place = (c: Claim): string => {
    const id = c.scope.id
    if (id === bodyName) return 'the whole world'
    const orbit = id.indexOf('~')
    if (orbit >= 0) return `${id.slice(orbit + 1)} orbit`
    if (id.includes('#')) return siteName(areaOfSeed(areas, id)?.id ?? id)
    return id
  }
  const out = new Map<string, ClaimLine>()
  for (const c of [...claims].sort((a, b) => Number(isLive(b)) - Number(isLive(a)))) {
    const scope = place(c)
    const key = `${c.claimantId}|${c.status}|${scope}`
    const had = out.get(key)
    if (had) had.evidence += c.evidence.length
    else out.set(key, { id: c.id, claimant: nameOf(c.claimantId), scope, status: c.status, basis: c.basis, since: c.since, evidence: c.evidence.length })
  }
  return [...out.values()]
}

// ---- development: sites, buildings, routes, settlements ---------------------------------------

export interface SiteRow {
  id: string
  // What the site is called (the player's name, else the generated one).
  name: string
  kind: string
  terrain: string | null
  suitability: number
  capacity: number
  tags: string[]
  // What lies there.
  holds: string | null
  owner: string | null
  // Held by the player's nation (only those can be renamed).
  mine: boolean
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
  settlements: { id: string; name: string; tier: string; population: number; specializations: string[]; jobs: number; access: number; overcrowded: boolean; filling: number | null; next: string | null }[]
  // The world's places as the map shows them (scene/areas.ts): what the tab lists. `sites` stays the per-seed detail they are made of.
  areas: AreaRow[]
  // Buildings held on ground no area covers (spaceports and other standalone works): just buildings, wherever they stand.
  standalone: { id: string; count: number }[]
  // The world's spaceports, one row per key node (scene/portList.ts).
  ports: PortList
}

// One area: a connected patch of one district kind, with everything that stands in it.
export interface AreaRow {
  id: string
  name: string
  kind: string
  // Seeds merged into it (more than one = towns that grew together).
  seeds: number
  seedIds: string[]
  cells: number
  owner: string | null
  mine: boolean
  buildings: { id: string; count: number }[]
  // The worst access among its parts (1 = fully connected), and the part that has it (what Connect joins up).
  access: number | null
  worstPart: string | null
  captured: boolean
  holds: string | null
  // Its own city key node(s) on the ground map.
  keyNodes: string[]
  civic: string[]
  // Urban areas only.
  urban: { tier: string; population: number; specializations: string[]; overcrowded: boolean; filling: number | null; next: string | null } | null
}

export function developmentView(bodyName: string, playerId: string | null): DevelopmentView {
  const sites = locationsOf(bodyName)
  const names = useLocationStore.getState().names
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
      name: siteName(s.id, names),
      kind: s.kind,
      terrain: s.terrain,
      suitability: s.suitability,
      capacity: s.capacity,
      tags: s.tags,
      holds: s.material ?? s.good ?? null,
      owner: owner ? nameOf(owner) : null,
      mine: !!owner && owner === playerId,
      buildings: Object.entries(placed[s.id] ?? {}).filter(([id]) => !STANDALONE_BUILDINGS.has(id)).map(([id, count]) => ({ id, count })),
      captured: !!owner && s.node !== null && capturedBy(bodyName, s.node, siteOwner(s.id)!),
      access: owner ? (accessFor(owner)[s.id] ?? 1) : null,
      forPlayer: decision ? { legal: decision.legal, physical: decision.physical.ok ? null : decision.physical.reason, why: decision.reason } : null,
    }
  })
  const routes = useInfrastructureStore.getState().routes.filter((r) => r.bodyName === bodyName).map((r) => ({ id: r.id, kind: r.kind, owner: nameOf(r.ownerId), working: isWorking(r, now), open: r.open, cells: r.cells, disrepair: !!r.disrepair, between: `${r.a} — ${r.b}` }))
  const nations = [...new Set(sites.map((s) => siteOwner(s.id)).filter((n): n is string => !!n))]
  const settlements = nations.flatMap((n) => urbanNow(bodyName, n)).map((u) => ({ id: u.id, name: siteName(u.id, names), tier: u.tier, population: Math.round(u.population), specializations: u.specializations, jobs: u.jobs, access: Math.round(u.access * 100) / 100, overcrowded: u.overcrowded, filling: u.maturity < 0.99 ? Math.round(u.maturity * 100) : null, next: u.next ? `${u.next.tier}: ${u.next.needs.join('; ') || 'ready'}` : null }))
  const areas = areaRows(bodyName, rows, settlements)
  const inAreas = new Set(areas.flatMap((a) => a.seedIds))
  const standalone = new Map<string, number>()
  for (const r of rows) if (r.owner && !inAreas.has(r.id)) for (const b of r.buildings.filter((x) => !STANDALONE_BUILDINGS.has(x.id))) standalone.set(b.id, (standalone.get(b.id) ?? 0) + b.count)
  return { bodyName, sites: rows, routes, settlements, areas, standalone: [...standalone].map(([id, count]) => ({ id, count })), ports: portList(bodyName) }
}

function areaRows(bodyName: string, rows: readonly SiteRow[], settlements: DevelopmentView['settlements']): AreaRow[] {
  const base = zoneBase(bodyName)
  if (!base) return []
  const areas = bodyAreas(bodyName, base)
  const surface = groundKeySurface(bodyName)
  const names = useLocationStore.getState().names
  const civic = useCivicStore.getState().civic[bodyName] ?? []
  const byId = new Map(rows.map((r) => [r.id, r]))
  // An area's key nodes are its own city: spaceports and other buildings are key nodes of the map wherever they stand, not of an area.
  const keysIn = new Map<string, string[]>()
  for (const k of surface?.keySlots ?? []) {
    if (k.kind !== 'capital' && k.kind !== 'city' && k.kind !== 'outpost') continue
    const a = areaAtNode(areas, k.node)
    if (a) keysIn.set(a.id, [...(keysIn.get(a.id) ?? []), keyNameOf(surface!, k).label])
  }
  return areas.map((a) => {
    const parts = a.seedIds.map((id) => byId.get(id)).filter((r): r is SiteRow => !!r)
    const primary = byId.get(a.id)
    const buildings = new Map<string, number>()
    for (const p of parts) for (const b of p.buildings) buildings.set(b.id, (buildings.get(b.id) ?? 0) + b.count)
    const accesses = parts.map((p) => p.access).filter((x): x is number => x !== null)
    const towns = settlements.filter((t) => a.seedIds.includes(t.id))
    const biggest = [...towns].sort((x, y) => y.population - x.population)[0]
    const filling = towns.filter((t) => t.filling !== null)
    return {
      id: a.id,
      name: siteName(a.id, names),
      kind: a.kind,
      seeds: a.seedIds.length,
      seedIds: a.seedIds,
      cells: a.cells.length,
      owner: primary?.owner ?? parts.find((p) => p.owner)?.owner ?? null,
      mine: parts.some((p) => p.mine),
      buildings: [...buildings].map(([id, count]) => ({ id, count })).sort((x, y) => (x.id < y.id ? -1 : 1)),
      access: accesses.length > 0 ? Math.min(...accesses) : null,
      worstPart: [...parts].filter((p) => p.access !== null).sort((x, y) => x.access! - y.access!)[0]?.id ?? null,
      captured: parts.some((p) => p.captured),
      holds: [...new Set(parts.map((p) => p.holds).filter(Boolean))].join(', ') || null,
      keyNodes: keysIn.get(a.id) ?? [],
      civic: civicInArea(civic, a).map((c) => c.name),
      urban: biggest
        ? { tier: biggest.tier, population: towns.reduce((n, t) => n + t.population, 0), specializations: [...new Set(towns.flatMap((t) => t.specializations))], overcrowded: towns.some((t) => t.overcrowded), filling: filling.length > 0 ? Math.min(...filling.map((t) => t.filling!)) : null, next: biggest.next }
        : null,
    }
  })
}


// The rural structures of a body for the Development tab: what each is called, its latitude/longitude, and the settlement it counts as
// being in (if any). Nothing about a structure changes when a settlement grows around it.
export interface RuralRow {
  id: string
  name: string
  where: string
  sea: boolean
  seeded: boolean
}

export function ruralRows(bodyName: string): RuralRow[] {
  const list = ruralOf(bodyName)
  if (list.length === 0) return []
  const surface = portBaseSurface(bodyName)
  const sites = locationsOf(bodyName)
  const base = zoneBase(bodyName)
  const footprints = base ? footprintsOf(bodyName, base) : []
  const areas = base ? bodyAreas(bodyName, base) : []
  const names = useLocationStore.getState().names
  return list.map((r) => {
    const ll = lonLatOf(nodePoint(r.node))
    const coord = `${Math.abs(Math.round((ll.lat * 180) / Math.PI * 10) / 10)}°${ll.lat >= 0 ? 'N' : 'S'} ${Math.abs(Math.round((ll.lon * 180) / Math.PI))}°${ll.lon >= 0 ? 'E' : 'W'}`
    const inSite = ruralSiteFor(r.node, footprints, sites)
    const area = inSite ? areaOfSeed(areas, inSite)?.id ?? inSite : null
    return { id: r.id, name: r.name ?? RECIPES[r.recipeId]?.label ?? 'Structure', where: area ? `in ${siteName(area, names)} (${coord})` : `rural (${coord})`, sea: !!surface && !capturableByGround(surface, r.node), seeded: !!r.seeded }
  })
}
