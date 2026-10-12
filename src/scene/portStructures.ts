// Spaceports on the ground map, store side: where each of a world's ports stands and what it is called. The economy decides HOW
// MANY a world runs; this records WHICH nodes (state/structureStore), starting from the auto-placed ones exactly as they were so
// nothing moves, and adding the places the player chooses.
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { portBaseSurface } from '../state/defenseStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { spaceportSitesOf } from '../state/nationEconomy'
import { isAbstractEconomy } from '../state/playerStore'
import { useStructureStore, type PortStructure } from '../state/structureStore'
import { useTerritoryStore } from '../state/territoryStore'
import { TERRAIN_IDS, type BodySurface } from './planetTerrain'
import { TERRAIN } from '../data/groundData'
import { controllerOf } from './territory'
import { extraSpaceportNodes } from './spaceportSites'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'
import { orderBuildingAt, type OrderResult } from './lensOrders'
import { locationsOf } from './locations'
import { siteOwner } from '../state/locationStore'

const SPACEPORT_SEPARATION_CELLS = 2 // from any other key node, as the auto-placed ones keep

// Records the world's auto-placed ports as structures (once). Idempotent; a world with none to record stays empty.
export function seedPorts(bodyName: string): void {
  const store = useStructureStore.getState()
  if (store.ports[bodyName]) return
  const surface = portBaseSurface(bodyName)
  const sites = spaceportSitesOf(bodyName)
  if (!surface || sites.length === 0) return
  const owner = useTerritoryStore.getState().bodyOwner[bodyName] ?? ''
  const extras = extraSpaceportNodes(surface, sites.length)
  store.setPorts(
    bodyName,
    extras.map((e, i): PortStructure => ({ id: `${bodyName}#port-${i}`, node: e.node, ownerId: owner, ...(e.outlier ? { outlier: true } : {}) })),
  )
}

// Ports that are ordered but not built yet (the player chose their place when ordering).
function pendingPorts(bodyName: string): number {
  if (isAbstractEconomy()) {
    const owner = useTerritoryStore.getState().bodyOwner[bodyName]
    return owner ? (useAbstractEconomyStore.getState().byCountry[owner]?.queue ?? []).filter((o) => o.bodyName === bodyName && o.building === 'spaceport').length : 0
  }
  return worldByName(useEconomyStore.getState().worlds, bodyName)?.constructionQueue.filter((o) => o.recipeId === 'spaceport' && !o.district).length ?? 0
}

// Forgets ports the economy no longer has or has on order (a cancelled order, a demolished port): the latest give theirs up first.
export function reconcilePorts(bodyName: string): void {
  const store = useStructureStore.getState()
  const list = store.ports[bodyName]
  if (!list || list.length === 0) return
  const surface = portBaseSurface(bodyName)
  const live = spaceportSitesOf(bodyName).length
  const main = surface ? surface.keySlots.filter((k) => k.kind === 'spaceport').length : 0
  const keep = Math.max(0, live - main) + pendingPorts(bodyName)
  if (list.length > keep) store.setPorts(bodyName, list.slice(0, keep))
}

export type PortNodeJudgement = { ok: true } | { ok: false; reason: string }

// May a spaceport stand at `node`? Ground a port can use (not mountains, not the sea), clear of every other key node.
export function judgePortNode(surface: BodySurface, node: number): PortNodeJudgement {
  const mesh = surfaceMesh()
  if (!Number.isInteger(node) || node < 0 || node >= mesh.count.fine) return { ok: false, reason: 'That is not a place on the map.' }
  if (surface.landComponent[node] < 0) return { ok: false, reason: 'A spaceport needs dry land.' }
  const terrain = TERRAIN_IDS[surface.terrain[node]]
  if (terrain === 'mountains' || !TERRAIN[terrain].paintable) return { ok: false, reason: 'A spaceport cannot stand on that ground.' }
  const p = nodePoint(node)
  const cell = mesh.fineSpacingRad
  if (surface.keySlots.some((k) => arc(nodePoint(k.node), p) / cell < SPACEPORT_SEPARATION_CELLS)) return { ok: false, reason: 'Too close to another key site.' }
  return { ok: true }
}

// The infrastructure site a port at `node` is booked on (its freight leaves from there): the nearest the builder may use.
function nearestPortSite(builderId: string, bodyName: string, node: number): string | null {
  const p = nodePoint(node)
  const sites = locationsOf(bodyName)
    .filter((s) => s.kind === 'infrastructure' && s.node !== null && (!siteOwner(s.id) || siteOwner(s.id) === builderId))
    .sort((a, b) => arc(p, nodePoint(a.node!)) - arc(p, nodePoint(b.node!)))
  return sites[0]?.id ?? null
}

// Orders a spaceport and pins it to the node the player clicked.
export function placePort(builderId: string, bodyName: string, node: number, name?: string): OrderResult {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  if (bodyOwner[bodyName] !== builderId) return { ok: false, reason: `You do not govern ${bodyName}.` }
  if (controllerOf(bodyName, bodyOwner, bodyController) !== builderId) return { ok: false, reason: `${bodyName} is occupied.` }
  const surface = portBaseSurface(bodyName)
  if (!surface) return { ok: false, reason: 'No ground here.' }
  seedPorts(bodyName)
  reconcilePorts(bodyName)
  const store = useStructureStore.getState()
  const keyed = { ...surface, keySlots: [...surface.keySlots, ...(store.ports[bodyName] ?? []).map((p) => ({ node: p.node, kind: 'spaceport' as const }))] }
  const judged = judgePortNode(keyed, node)
  if (!judged.ok) return judged
  const siteId = nearestPortSite(builderId, bodyName, node)
  if (!siteId) return { ok: false, reason: `${bodyName} has no site a spaceport could be booked on.` }
  const ordered = orderBuildingAt(builderId, bodyName, 'spaceport', siteId)
  if (!ordered.ok) return ordered
  const id = `${bodyName}#port-${Date.now().toString(36)}-${(store.ports[bodyName] ?? []).length}`
  store.addPort(bodyName, { id, node, ownerId: builderId, chosen: true, ...(name?.trim() ? { name: name.trim().slice(0, 40) } : {}) })
  return { ok: true }
}

export function renamePort(bodyName: string, id: string, name: string): void {
  useStructureStore.getState().renamePort(bodyName, id, name)
}

// The port structure at a node, if the map shows one there.
export function portAt(bodyName: string, node: number): PortStructure | undefined {
  return useStructureStore.getState().ports[bodyName]?.find((p) => p.node === node)
}

