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
import type { BodySurface } from './planetTerrain'

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
