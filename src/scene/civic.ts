// A world's civic buildings: the capital's Government Seat and landmarks, each city's Municipal Government Building and a
// colony's Outpost Station (docs/territorial-design.md section 12). They are real buildings that stand in the Core district at a
// settlement site and that you can open; they have no slot cost and no economic effect of their own, and the ground war's key
// node at their place is the node they stand on (taking the node is taking the site: scene/infrastructureOrders.capturedBy).
//
// Spaceports are NOT civic buildings: they are ordinary Urban-district buildings (the economy's `spaceport`). The key-node
// names, roles and landmarks come from scene/keyBuildings.ts (one source with the ground war).
import { arc, nodePoint } from './surfaceMesh'
import { keyBuildingsOf, type KeyBuildingKind } from './keyBuildings'
import type { DevLocation } from './locations'
import type { Area } from './areas'
import type { BodySurface } from './planetTerrain'
import { KEY_ROLE } from './keyNames'

export type CivicKind = Extract<KeyBuildingKind, 'seat' | 'landmark' | 'cityHall' | 'outpostStation'>

export interface CivicBuilding {
  id: string
  kind: CivicKind
  name: string
  description: string
  // The key node's own label ("Akakyō (capital)") and its native-script name.
  place: string
  native?: string
  // What holding the node does (scene/keyNames.KEY_ROLE).
  role: string
  node: number
  // The settlement site it stands on.
  siteId?: string
}

export const CIVIC_KINDS: CivicKind[] = ['seat', 'landmark', 'cityHall', 'outpostStation']

// The settlement site a key node belongs to: the one on that very node, else the nearest settlement site.
export function siteForNode(sites: readonly DevLocation[], node: number): string | undefined {
  const settlements = sites.filter((s) => s.kind === 'settlement' && s.node !== null)
  const exact = settlements.find((s) => s.node === node)
  if (exact) return exact.id
  const here = nodePoint(node)
  return [...settlements].sort((a, b) => arc(here, nodePoint(a.node!)) - arc(here, nodePoint(b.node!)) || (a.id < b.id ? -1 : 1))[0]?.id
}

// The civic buildings of a body from its key-node surface. Pure.
export function civicOf(surface: BodySurface, sites: readonly DevLocation[]): CivicBuilding[] {
  return keyBuildingsOf(surface, [], 0, {}, {})
    .filter((k): k is typeof k & { kind: CivicKind } => (CIVIC_KINDS as string[]).includes(k.kind) && !k.building)
    .map((k) => ({ id: k.id, kind: k.kind, name: k.name, description: k.description, place: k.place, native: k.native, role: k.role, node: k.node, siteId: siteForNode(sites, k.node) }))
}

// A colony's landing is an Outpost Station; once its people number `threshold` (millions) the outpost is upgraded: it is dropped
// from the civic list here and withSettlementHalls puts the municipal hall in its place. Returns the same array when nothing
// changes (under the threshold, or no outpost at that node). The upgrade is one way: a hall is not an outpost again.
export function withoutGrownOutpost(list: readonly CivicBuilding[], node: number, populationMillions: number, threshold: number): CivicBuilding[] {
  if (populationMillions < threshold) return list as CivicBuilding[]
  const next = list.filter((c) => !(c.kind === 'outpostStation' && c.node === node))
  return next.length === list.length ? (list as CivicBuilding[]) : next
}

export const HALL_ID_PREFIX = 'hall-'

// Every urban area (scene/areas.ts) has one municipal government building: an area holding a key-node civic building already has its
// hall (civicOf), so this adds one at the primary seed of each other established urban area (a town the world grew into or one
// founded in play). Two towns that grow into one city share one hall; one that splits off gets its own. Derived halls (ids
// `hall-<seed>`) keep up with their area: a hall whose area was given up or merged is dropped, a renamed area renames it.
// Seat, landmark and key-node entries are never touched. Pure: returns the new list, or the same array when nothing changed.
export function withSettlementHalls(list: readonly CivicBuilding[], areas: readonly Area[], established: (siteId: string) => boolean, nameOf: (siteId: string) => string): CivicBuilding[] {
  const urban = areas.filter((a) => a.kind === 'settlement' && a.node !== null && established(a.id))
  const fixed = list.filter((c) => !c.id.startsWith(HALL_ID_PREFIX))
  const out: CivicBuilding[] = [...fixed]
  for (const a of urban) {
    if (fixed.some((c) => c.siteId !== undefined && a.seedIds.includes(c.siteId))) continue
    const town = nameOf(a.id)
    out.push({ id: `${HALL_ID_PREFIX}${a.id}`, kind: 'cityHall', name: `${town} Municipal Government Building`, description: `The seat of municipal government of ${town}.`, place: town, role: KEY_ROLE.city, node: a.node!, siteId: a.id })
  }
  const same = out.length === list.length && out.every((c, i) => c.id === list[i]?.id && c.name === list[i]?.name)
  return same ? (list as CivicBuilding[]) : out
}

// The civic buildings that stand in an area.
export function civicInArea(list: readonly CivicBuilding[], area: Area): CivicBuilding[] {
  return list.filter((c) => c.siteId !== undefined && area.seedIds.includes(c.siteId))
}
