// Zones, pure: the cells a district may grow into. Every site has one. A site the player never redrew has a DEFAULT zone, the
// first cells of its growth order, sized so it holds exactly what the site was generated to hold (capacity levels, each full of
// buildings); a redrawn zone is the cells the player painted. A district's capacity is what its zone can hold, so drawing a bigger
// zone is how it gets room, and shrinking one takes room away. Untouched buildable ground that is in no zone is the RURAL district.
import { CELLS_PER_BUILDING, CELLS_PER_LEVEL } from '../data/footprintData'
import { MAX_ZONE_CELLS } from '../data/zoningData'
import { SITE_SLOTS_PER_CAPACITY, type LocationKind } from '../data/locationData'
import { TERRAIN } from '../data/groundData'
import { growthOrder } from './footprint'
import { terrainAt, type BodySurface } from './planetTerrain'
import { surfaceMesh } from './surfaceMesh'

// Kinds that cover ground (and so have a zone). A spaceport or strategic site is a point.
export const hasZone = (kind: LocationKind): boolean => CELLS_PER_LEVEL[kind] !== undefined

// Cells one unit of capacity needs: a district level and the buildings that fill it.
export function cellsPerCapacity(kind: LocationKind): number {
  return (CELLS_PER_LEVEL[kind] ?? 0) + SITE_SLOTS_PER_CAPACITY * (CELLS_PER_BUILDING[kind] ?? 0)
}

// Capacity (district levels) a zone of `cells` cells holds.
export const capacityFromZone = (kind: LocationKind, cells: number): number => Math.floor(cells / cellsPerCapacity(kind))

// Cells of the default zone of a site of `capacity`: exactly enough for `capacity` full levels, so capacityFromZone gives it back.
export function defaultZoneSize(kind: LocationKind, capacity: number): number {
  return Math.min(MAX_ZONE_CELLS, Math.max(1, Math.ceil(capacity * cellsPerCapacity(kind))))
}

export interface ZoneSite {
  id: string
  kind: LocationKind
  node: number
  // The capacity the site was generated with (the default zone's size).
  capacity: number
}

// The default zone of a site.
export function defaultZone(base: BodySurface, site: ZoneSite): number[] {
  return growthOrder(base, site.node).slice(0, defaultZoneSize(site.kind, site.capacity))
}

// The zone of a site: the painted one, else the default.
export function zoneOf(base: BodySurface, site: ZoneSite, edited: readonly number[] | undefined): number[] {
  return edited ? [...edited] : defaultZone(base, site)
}

// Buildable ground: walkable land of a landmass.
export const isBuildable = (base: BodySurface, cell: number): boolean => base.landComponent[cell] >= 0 && TERRAIN[terrainAt(base, cell)].passable === 'all'

// The rural district: buildable ground in no zone. `zones` are all the zones on the body.
export function ruralCells(base: BodySurface, zones: readonly (readonly number[])[]): number[] {
  const inZone = new Set<number>()
  for (const z of zones) for (const c of z) inZone.add(c)
  const out: number[] = []
  for (let i = 0; i < base.terrain.length; i++) if (!inZone.has(i) && isBuildable(base, i)) out.push(i)
  return out
}

// The cells within `radius` rings of a node (the paint brush), buildable only.
export function brushCells(base: BodySurface, center: number, radius: number): number[] {
  const mesh = surfaceMesh()
  const seen = new Set<number>([center])
  let ring = [center]
  for (let r = 0; r < radius; r++) {
    const next: number[] = []
    for (const c of ring) for (const n of mesh.neighbors.fine[c]) if (!seen.has(n)) (seen.add(n), next.push(n))
    ring = next
  }
  return [...seen].filter((c) => isBuildable(base, c))
}

export interface ZoneEdit {
  add: readonly number[]
  remove: readonly number[]
}

export type ZoneEditJudgement =
  | { ok: false; reason: string }
  | {
      ok: true
      // The zone after the edit.
      cells: number[]
      // How many of the added cells were rural (untouched) ground: the part the land-use law is about.
      ruralAdded: number
      capacityBefore: number
      capacityAfter: number
    }

// May the zone of `site` be redrawn this way? Ground rules only (the law and the cost are scene/zoneOrders): added cells must be
// buildable ground of the site's own landmass that no other zone holds; the result may not be empty or over MAX_ZONE_CELLS and
// must keep the site's own node.
export function judgeZoneEdit(base: BodySurface, site: ZoneSite, current: readonly number[], edit: ZoneEdit, otherZones: ReadonlySet<number>, ruralNow: ReadonlySet<number>): ZoneEditJudgement {
  if (!hasZone(site.kind)) return { ok: false, reason: 'This site covers no ground of its own.' }
  const component = base.landComponent[site.node]
  const next = new Set(current)
  let ruralAdded = 0
  for (const c of edit.add) {
    if (next.has(c)) continue
    if (!isBuildable(base, c)) continue
    if (base.landComponent[c] !== component) continue
    if (otherZones.has(c)) continue
    next.add(c)
    if (ruralNow.has(c)) ruralAdded++
  }
  for (const c of edit.remove) if (c !== site.node) next.delete(c)
  if (next.size > MAX_ZONE_CELLS) return { ok: false, reason: `A zone holds at most ${MAX_ZONE_CELLS} cells.` }
  if (!next.has(site.node)) return { ok: false, reason: 'A zone keeps the ground the district itself stands on.' }
  const cells = [...next].sort((a, b) => a - b)
  return { ok: true, cells, ruralAdded, capacityBefore: capacityFromZone(site.kind, current.length), capacityAfter: capacityFromZone(site.kind, cells.length) }
}

// What the footprint of a site loses when its zone shrinks: the cells it covers that fall outside the new zone.
export function footprintLoss(footprintCells: readonly number[], newZone: ReadonlySet<number>): number {
  return footprintCells.filter((c) => !newZone.has(c)).length
}
