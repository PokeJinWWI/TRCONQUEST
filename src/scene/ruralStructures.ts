// Rural structures, pure: buildings that stand on a ground node of their own, outside any development site (the space-elevator anchor,
// and later radar or missile silos). Which node is allowed, which settlement a node counts as being in, and whether ground forces can
// take one. The ledger is state/structureStore.rural; the orders are scene/ruralOrders.ts.
import { TERRAIN } from '../data/groundData'
import { RECIPES } from '../economy/recipes'
import type { RuralStructure } from '../state/structureStore'
import { lonLatOf } from './mapProjection'
import { TERRAIN_IDS, type BodySurface, type KeySlot } from './planetTerrain'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'

// An anchor stands under the ring, which circles the equator: this far either side of it (one fine cell is ~4 degrees on Earth).
export const EQUATORIAL_BAND_DEG = 5
// Rural structures keep this many fine cells from each other and from key nodes on land.
export const RURAL_SEPARATION_CELLS = 1.5

export type NodeJudgement = { ok: true } | { ok: false; reason: string }

export const latitudeDeg = (node: number): number => (lonLatOf(nodePoint(node)).lat * 180) / Math.PI

export interface RuralRules {
  // Only on the equatorial band (an anchor).
  equatorial: boolean
  // May stand at sea (a floating platform moored to the sea floor).
  allowSea: boolean
}

export function judgeRuralNode(surface: BodySurface, node: number, others: readonly { node: number }[], rules: RuralRules): NodeJudgement {
  const mesh = surfaceMesh()
  if (!Number.isInteger(node) || node < 0 || node >= mesh.count.fine) return { ok: false, reason: 'That is not a place on the map.' }
  const terrain = TERRAIN_IDS[surface.terrain[node]]
  const sea = surface.landComponent[node] < 0 || terrain === 'ocean'
  if (sea && !rules.allowSea) return { ok: false, reason: 'This needs dry land.' }
  if (terrain === 'lava' || terrain === 'cloud' || (!sea && TERRAIN[terrain].passable === 'none')) return { ok: false, reason: 'Nothing can be built on that ground.' }
  if (rules.equatorial && Math.abs(latitudeDeg(node)) > EQUATORIAL_BAND_DEG) return { ok: false, reason: `This must stand within ${EQUATORIAL_BAND_DEG}° of the equator, beneath the ring.` }
  const p = nodePoint(node)
  const cell = mesh.fineSpacingRad
  if (others.some((o) => arc(nodePoint(o.node), p) / cell < RURAL_SEPARATION_CELLS)) return { ok: false, reason: 'Too close to another structure.' }
  if (!sea && surface.keySlots.some((k) => arc(nodePoint(k.node), p) / cell < RURAL_SEPARATION_CELLS)) return { ok: false, reason: 'Too close to another key site.' }
  return { ok: true }
}

// The settlement a structure counts as being in: the one whose footprint covers its node, or whose own site stands within a cell of it
// (a settlement just founded has no footprint yet); null = it is rural. Nothing about the structure changes either way.
export const IN_SETTLEMENT_CELLS = 1
export function ruralSiteFor(node: number, footprints: readonly { siteId: string; kind: string; cells: readonly number[] }[], sites: readonly { id: string; kind: string; node: number | null }[] = []): string | null {
  const covered = footprints.find((f) => f.kind === 'settlement' && f.cells.includes(node))?.siteId
  if (covered) return covered
  const p = nodePoint(node)
  const cell = surfaceMesh().fineSpacingRad
  return sites.find((s) => s.kind === 'settlement' && s.node !== null && arc(nodePoint(s.node), p) / cell <= IN_SETTLEMENT_CELLS)?.id ?? null
}

// Whether ground forces can take it. A platform at sea cannot be walked to: until naval and air rules exist it falls only to
// orbital control. The ONE place this is decided, so those rules can hook in later.
export function capturableByGround(surface: BodySurface, node: number): boolean {
  return surface.landComponent[node] >= 0 && TERRAIN_IDS[surface.terrain[node]] !== 'ocean'
}

// Land structures as key nodes of the ground map (a named, capturable target; a fortress-kind node). A platform at sea is left out.
export function ruralKeySlots(surface: BodySurface, list: readonly RuralStructure[]): KeySlot[] {
  return list.filter((r) => capturableByGround(surface, r.node) && !surface.keySlots.some((k) => k.node === r.node)).map((r) => ({ node: r.node, kind: 'fortress' as const, name: r.name ?? RECIPES[r.recipeId]?.label ?? 'Structure' }))
}
