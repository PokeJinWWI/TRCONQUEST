import { levelAtSite } from '../economy/buildingSites'
// The route network, store side: building and running routes, paying for them, and handing
// what the network means for production to both economies. The rules are
// scene/infrastructureNet.ts; who may build where is jurisdiction (scene/sovereignty).
import { ROUTE_SPECS, type RouteKind } from '../data/infrastructureData'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore } from '../state/economyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useInfrastructureStore } from '../state/infrastructureStore'
import { siteOwner, useLocationStore } from '../state/locationStore'
import { usePlacementStore } from '../state/placementStore'
import { isAbstractEconomy } from '../state/playerStore'
import { useTerritoryStore } from '../state/territoryStore'
import { pay, paysFromEconomy, shortOf } from './economyPayment'
import { decideConstruction } from './jurisdiction'
import { quoteRoute, siteAccess, surveyRoute, upkeepOf, isWorking, usableBy, type Route, type RouteQuote } from './infrastructureNet'
import { locationById, locationsOf } from './locations'
import { placeUnplacedOrders, reconcileBody, usedSlots } from './placementOrders'
import { defaultGeo, jurisdictionState } from './sovereignty'
import { recordTerritorialIncident } from './territorialIncidents'
import { CAPTURED_FACTOR, FREIGHT_PER_SLOT, ISOLATION_FACTOR } from '../data/infrastructureData'
import { atWar } from '../state/diplomacyStore'
import { syncUnrest } from './unrestSync'
import { reconcilePorts } from './portStructures'
import { useStructureStore } from '../state/structureStore'
import { resolveZonePermits } from './zoneOrders'

export type RoutePlan = { ok: true; quote: RouteQuote; cells: number; bodyName: string } | { ok: false; reason: string }

// Can `builderId` build a `kind` route between two sites right now, and at what price?
export function planRoute(builderId: string, a: string, b: string, kind: RouteKind): RoutePlan {
  const sa = locationById(a)
  const sb = locationById(b)
  if (!sa || !sb) return { ok: false, reason: 'Both ends of a route must be development sites' }
  if (sa.bodyName !== sb.bodyName) return { ok: false, reason: 'A surface route stays on one body' }
  if (a === b || sa.node === null || sb.node === null) return { ok: false, reason: 'A route needs two different sites' }
  if (useInfrastructureStore.getState().routes.some((r) => r.kind === kind && ((r.a === a && r.b === b) || (r.a === b && r.b === a)))) return { ok: false, reason: `There is already a ${ROUTE_SPECS[kind].name.toLowerCase()} between these sites` }
  // The law at each end (a route is infrastructure; it does not need a site of its own kind).
  for (const site of [sa, sb]) {
    const d = decideConstruction({ builderId, scope: { kind: 'location', id: site.id }, asset: 'infrastructure' }, jurisdictionState())
    if (!d.allowed) return { ok: false, reason: d.reason }
  }
  const survey = surveyRoute(sa.bodyName, sa.node, sb.node)
  if (survey.blocked) return { ok: false, reason: `Cannot build there: ${survey.blocked}` }
  const quote = quoteRoute(kind, survey.cells, survey.difficulty)
  const short = shortOf(builderId, quote.goods, quote.resources)
  if (short.length > 0) return { ok: false, reason: `Not enough ${short.join(', ')}${paysFromEconomy(builderId) ? ' in the capital stockpile' : ''}` }
  return { ok: true, quote, cells: survey.cells, bodyName: sa.bodyName }
}

let routeCounter = 0

export function buildRoute(builderId: string, a: string, b: string, kind: RouteKind, opts: { open?: boolean } = {}): { ok: true; route: Route } | { ok: false; reason: string } {
  const plan = planRoute(builderId, a, b, kind)
  if (!plan.ok) return plan
  pay(builderId, plan.quote.goods, plan.quote.resources)
  const now = useGameTimeStore.getState().simDays
  routeCounter += 1
  const route: Route = { id: `route-${a}-${b}-${kind}-${routeCounter}`, bodyName: plan.bodyName, a, b, kind, ownerId: builderId, users: [], open: opts.open ?? true, cells: plan.cells, builtSimDays: now, readySimDays: now + plan.quote.days }
  for (const site of [a, b]) recordTerritorialIncident(builderId, { kind: 'location', id: site }, 'infrastructure', now)
  useInfrastructureStore.getState().addRoute(route)
  return { ok: true, route }
}

// The owner closes a route to everyone but the countries it names (and itself).
export function setRouteAccess(routeId: string, ownerId: string, access: { open?: boolean; users?: string[] }): boolean {
  const route = useInfrastructureStore.getState().routes.find((r) => r.id === routeId)
  if (!route || route.ownerId !== ownerId) return false
  useInfrastructureStore.getState().patchRoute(routeId, { ...(access.open !== undefined ? { open: access.open } : {}), ...(access.users ? { users: access.users } : {}) })
  return true
}

// ---- upkeep ----------------------------------------------------------------------

// Each month that has passed: every working route's owner pays the upkeep, or the route falls
// into disrepair (and mends the month it is paid again).
export function resolveInfrastructure(simDays: number): void {
  const store = useInfrastructureStore.getState()
  const month = Math.floor(simDays / 30)
  const months = Math.min(12, month - store.maintainedMonth)
  if (months <= 0) return
  for (let m = 0; m < months; m++) {
    for (const route of useInfrastructureStore.getState().routes) {
      if (!isWorking(route, simDays)) continue
      const { goods, resources } = upkeepOf(route)
      const short = shortOf(route.ownerId, goods, resources)
      if (short.length === 0) pay(route.ownerId, goods, resources)
      if ((short.length > 0) !== !!route.disrepair) useInfrastructureStore.getState().patchRoute(route.id, { disrepair: short.length > 0 })
    }
  }
  store.setMaintainedMonth(month)
}

// ---- what the network means for production ----------------------------------------

// Every site of a body with the share of its output that reaches a hub, for the nation that holds it.
export function accessOnBody(bodyName: string, nationId: string, simDays = useGameTimeStore.getState().simDays): Record<string, number> {
  // Under an enemy's occupation the network does not carry a nation's freight: its supply connections are cut.
  const occupier = useTerritoryStore.getState().bodyController[bodyName]
  if (occupier && occupier !== nationId && atWar(occupier, nationId)) return Object.fromEntries(locationsOf(bodyName).map((s) => [s.id, ISOLATION_FACTOR]))
  const sites = locationsOf(bodyName).filter((s) => s.node !== null).map((s) => ({ id: s.id, node: s.node! }))
  // Ground war: a site an enemy's units hold is lost to its owner for now, and a route with such a site at either end is cut.
  const captured = new Set(sites.filter((s) => capturedBy(bodyName, s.node, nationId)).map((s) => s.id))
  const allHubs = locationsOf(bodyName).filter((s) => siteOwner(s.id) && (s.kind === 'settlement' || (s.kind === 'infrastructure' && s.tags.includes('spaceport')))).map((s) => s.id)
  const hubs = allHubs.filter((id) => !captured.has(id))
  // Every hub lost to the enemy: nothing is left to carry freight to (not "nothing to be cut off from").
  if (allHubs.length > 0 && hubs.length === 0) return Object.fromEntries(sites.map((s) => [s.id, captured.has(s.id) ? CAPTURED_FACTOR : ISOLATION_FACTOR]))
  const routes = useInfrastructureStore.getState().routes.filter((r) => r.bodyName === bodyName && isWorking(r, simDays) && usableBy(r, nationId) && !captured.has(r.a) && !captured.has(r.b))
  const factors = siteAccess({ bodyName, sites, routes, hubs, demand: (id) => (siteOwner(id) === nationId ? usedSlots(id) * FREIGHT_PER_SLOT : 0), cellsBetween: defaultGeo.cellsBetween })
  // Starting buildings were balanced with their freight already getting out: their sites count as connected.
  const established = useLocationStore.getState().established
  for (const s of sites) if (established[s.id]?.connected && !captured.has(s.id) && siteOwner(s.id) === nationId) factors[s.id] = 1
  for (const id of captured) factors[id] = CAPTURED_FACTOR
  return factors
}

// Works out the output share of every building that has been placed on a site and gives it to the
// economy that runs it (Simple: a share per building kind per nation; Complex: per world and recipe).
// A building that was never placed (the seeded ones) runs at full, as it always did. Called at the
// start of every month's advance.
export function syncSiteAccess(): void {
  for (const body of Object.keys(useStructureStore.getState().ports)) reconcilePorts(body)
  syncUnrest()
  resolveZonePermits(useGameTimeStore.getState().simDays)
  placeUnplacedOrders()
  const placed = usePlacementStore.getState().placed
  const bodies = [...new Set(Object.keys(placed).map((id) => id.slice(0, id.lastIndexOf('#'))))]
  for (const body of bodies) reconcileBody(body)
  const simple = isAbstractEconomy()
  // [nation or world][building] -> { placed units, placed units x their share }
  const acc = new Map<string, Map<string, { n: number; share: number }>>()
  const now = useGameTimeStore.getState().simDays
  for (const body of bodies) {
    const bySiteOwner = new Map<string, string[]>()
    for (const site of Object.keys(usePlacementStore.getState().placed).filter((id) => id.startsWith(`${body}#`))) {
      const owner = siteOwner(site)
      if (owner) bySiteOwner.set(owner, [...(bySiteOwner.get(owner) ?? []), site])
    }
    for (const [owner, siteIds] of bySiteOwner) {
      const factors = accessOnBody(body, owner, now)
      for (const site of siteIds) {
        for (const [id, ledger] of Object.entries(usePlacementStore.getState().placed[site] ?? {})) {
          // Complex: a building tagged with this site gets its share below; only the units of an unplaced building count here.
          const tagged = simple ? 0 : levelAtSite(complexBuildings(body), id, site)
          const count = ledger - tagged
          if (count <= 0) continue
          const key = simple ? owner : body
          const row = acc.get(key) ?? new Map<string, { n: number; share: number }>()
          const cur = row.get(id) ?? { n: 0, share: 0 }
          row.set(id, { n: cur.n + count, share: cur.share + count * (factors[site] ?? 1) })
          acc.set(key, row)
        }
      }
    }
  }
  const owned = (key: string, id: string): number => {
    if (simple) {
      const worlds = useAbstractEconomyStore.getState().worlds
      return Object.values(worlds).filter((w) => ownerOfWorld(w.bodyName) === key).reduce((n, w) => n + ((w.buildings as Record<string, number>)[id] ?? 0), 0)
    }
    return useEconomyStore.getState().worlds.find((w) => w.id === key)?.buildings.filter((b) => b.recipeId === id && !b.siteId).reduce((n, b) => n + b.level, 0) ?? 0
  }
  const result = new Map<string, Record<string, number>>()
  for (const [key, row] of acc) {
    const out: Record<string, number> = {}
    for (const [id, { n, share }] of row) {
      const total = owned(key, id)
      if (total <= 0) continue
      // Placed units can only be the built ones; the rest of the building's count is unplaced and runs at full.
      const placedBuilt = Math.min(n, total)
      const f = (total - placedBuilt + (share * placedBuilt) / n) / total
      if (f < 0.999) out[id] = Math.round(f * 1000) / 1000
    }
    result.set(key, out)
  }
  if (simple) {
    for (const nation of Object.keys(useAbstractEconomyStore.getState().byCountry)) useAbstractEconomyStore.getState().setBuildingAccess(nation, result.get(nation) ?? {})
  } else {
    // Each building tagged with a site gets the share of THAT site (key "recipe@site"), the unplaced rest the aggregate (key "recipe").
    const byOwner = new Map<string, Record<string, number>>()
    for (const w of useEconomyStore.getState().worlds) {
      const out: Record<string, number> = { ...(result.get(w.id) ?? {}) }
      for (const b of w.buildings) {
        if (!b.siteId) continue
        const owner = siteOwner(b.siteId)
        if (!owner) continue
        const k = `${w.id}|${owner}`
        if (!byOwner.has(k)) byOwner.set(k, accessOnBody(w.id, owner, now))
        const f = byOwner.get(k)![b.siteId] ?? 1
        if (f < 0.999) out[`${b.recipeId}@${b.siteId}`] = Math.round(f * 1000) / 1000
      }
      result.set(w.id, out)
    }
    useEconomyStore.getState().setSiteAccess(Object.fromEntries(result))
  }
}

const complexBuildings = (body: string) => useEconomyStore.getState().worlds.find((w) => w.id === body)?.buildings ?? []

function ownerOfWorld(bodyName: string): string | undefined {
  return useTerritoryStore.getState().bodyOwner[bodyName]
}

// Whether an enemy's ground units hold this node of the body right now (the front lines the ground war paints:
// territoryStore.nodeHolders), from `nationId`'s point of view.
export function capturedBy(bodyName: string, node: number, nationId: string): boolean {
  const holder = useTerritoryStore.getState().nodeHolders[bodyName]?.[node]
  return !!holder && holder !== nationId && atWar(holder, nationId)
}
