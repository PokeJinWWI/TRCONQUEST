// Founding a district where the player clicks: the pure rules. A founded site is a DevLocation like the generated ones (so the
// placement, economy and jurisdiction code treat it identically), at a node of the player's choosing on ground that suits its kind.
// The legal half (may this nation build there?) is scene/siteFoundingOrders.ts; this file only knows the ground.
import {
  AGRICULTURAL_SUITABILITY,
  INDUSTRIAL_SUITABILITY,
  SETTLEMENT_SUITABILITY,
  SITE_CAPACITY_RANGE,
  SITE_MIN_SEPARATION_CELLS,
  TERRAIN_RESOURCES,
  type LocationKind,
  type LocationTag,
  type SiteGood,
} from '../data/locationData'
import { KEY_MIN_SEPARATION_CELLS, TERRAIN, type TerrainId } from '../data/groundData'
import { bodyGroundInfoAny, surfaceOf, terrainAt } from './planetTerrain'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'
import { rngFor, type DevLocation } from './locations'

// What can be founded by clicking. Spaceports and defences are structures (state/structureStore), strategic ground is the
// military's; neither is a district.
export const FOUNDABLE_KINDS: readonly LocationKind[] = ['settlement', 'industrial', 'resource', 'agricultural']

// Founded ids count from here, so they can never collide with a generated one (which count from 0, at most MAX_SITES_PER_KIND + spill).
export const FIRST_CUSTOM_INDEX = 100
// A body takes this many founded sites of one kind (the generated ones come on top).
export const MAX_FOUNDED_PER_KIND = 12

export type Founding = { ok: true; site: DevLocation } | { ok: false; reason: string }

const SUITABILITY: Record<'settlement' | 'industrial' | 'agricultural', Record<TerrainId, number>> = {
  settlement: SETTLEMENT_SUITABILITY,
  industrial: INDUSTRIAL_SUITABILITY,
  agricultural: AGRICULTURAL_SUITABILITY,
}

// How well the ground at `terrain` suits `kind`, 0..1 (a resource site's is how rich its terrain is in natural goods).
export function foundingSuitability(kind: LocationKind, terrain: TerrainId): number {
  if (kind === 'resource') return TERRAIN_RESOURCES[terrain] ? 0.9 : 0
  if (kind === 'settlement' || kind === 'industrial' || kind === 'agricultural') return SUITABILITY[kind][terrain]
  return 0
}

// Was this site founded during play (as opposed to found by the generator)?
export function isFounded(siteId: string): boolean {
  return Number(siteId.slice(siteId.lastIndexOf('-') + 1)) >= FIRST_CUSTOM_INDEX
}

export function nextCustomId(bodyName: string, kind: LocationKind, existing: readonly DevLocation[]): string {
  let n = FIRST_CUSTOM_INDEX
  const taken = new Set(existing.map((s) => s.id))
  while (taken.has(`${bodyName}#${kind}-${n}`)) n++
  return `${bodyName}#${kind}-${n}`
}

const FOUNDED_SUFFIX: Record<string, string> = { settlement: 'New Town', industrial: 'Industrial Zone', agricultural: 'Farmlands', resource: 'Workings', infrastructure: 'Spaceport', strategic: 'Outpost' }

// A founded site is named for the place it lies by (the nearest existing site), numbered so no two share a name.
function foundedName(bodyName: string, kind: LocationKind, node: number, existing: readonly DevLocation[], good?: SiteGood): string {
  let near: DevLocation | null = null
  let nearD = Infinity
  for (const s of existing) {
    if (s.node === null) continue
    const d = arc(nodePoint(node), nodePoint(s.node))
    if (d < nearD) { near = s; nearD = d }
  }
  const place = near?.name?.replace(/ (Industrial Zone|Farmlands|Spaceport|Heights|Watch|Workings|New Town)( [IVX]+)?$/, '') ?? bodyName
  const base = `${place} ${kind === 'resource' && good ? `${good.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())} ${FOUNDED_SUFFIX.resource}` : FOUNDED_SUFFIX[kind]}`
  const taken = new Set(existing.map((s) => s.name))
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`
  return name
}

// Can a `kind` district be founded at `node` of `bodyName`, given the sites already there? Ground only: land of a terrain that
// suits it, clear of every other site by the same distance the generator keeps. Returns the site it would be.
export function planFounding(bodyName: string, kind: LocationKind, node: number, existing: readonly DevLocation[]): Founding {
  if (!FOUNDABLE_KINDS.includes(kind)) return { ok: false, reason: `a ${kind} site is not founded by clicking the ground` }
  if (!bodyGroundInfoAny(bodyName)) return { ok: false, reason: 'there is no ground here to build on' }
  const mesh = surfaceMesh()
  if (!Number.isInteger(node) || node < 0 || node >= mesh.count.fine) return { ok: false, reason: 'that is not a place on the map' }
  const wild = surfaceOf(bodyName, 'wild')
  const terrain = terrainAt(wild, node)
  if (wild.landComponent[node] < 0 || TERRAIN[terrain].passable !== 'all') return { ok: false, reason: 'that ground cannot be built on' }
  const suitability = foundingSuitability(kind, terrain)
  if (suitability <= 0) return { ok: false, reason: kind === 'resource' ? `there is nothing to mine or cut on ${terrain}` : `${terrain} is no use for ${kind === 'agricultural' ? 'farming' : kind === 'industrial' ? 'industry' : 'a settlement'}` }
  const minSep = Math.max(SITE_MIN_SEPARATION_CELLS, KEY_MIN_SEPARATION_CELLS - 1) * mesh.fineSpacingRad
  // Sites of another kind may stand closer (a farm beside a town); the same kind keeps the full distance.
  const near = existing.find((s) => s.node !== null && arc(nodePoint(node), nodePoint(s.node)) < (s.kind === kind ? minSep : 0.9 * mesh.fineSpacingRad))
  if (near) return { ok: false, reason: `too close to another site (${near.name ?? near.id.slice(near.id.lastIndexOf('#') + 1)})` }
  if (existing.filter((s) => s.kind === kind && isFounded(s.id)).length >= MAX_FOUNDED_PER_KIND) {
    return { ok: false, reason: `this body already has ${MAX_FOUNDED_PER_KIND} founded ${kind} sites` }
  }
  const coastal = mesh.neighbors.fine[node].some((j) => wild.landComponent[j] < 0 && terrainAt(wild, j) === 'ocean')
  const tags: LocationTag[] = coastal ? ['coastal'] : []
  const extra: Partial<DevLocation> = {}
  if (kind === 'resource') {
    // What lies there is fixed by the place, not by when it was founded: its own stream.
    const rng = rngFor(`found:${bodyName}:${node}`)
    const table = TERRAIN_RESOURCES[terrain]!
    const goods = Object.entries(table) as [SiteGood, number][]
    let roll = rng() * goods.reduce((n, [, w]) => n + w, 0)
    let good = goods[goods.length - 1][0]
    for (const [g, w] of goods) {
      roll -= w
      if (roll < 0) {
        good = g
        break
      }
    }
    const weight = Math.round((0.3 + 0.7 * rng()) * 100) / 100
    extra.good = good
    extra.weight = weight
  }
  const capacity = Math.round(1 + SITE_CAPACITY_RANGE * (kind === 'resource' ? (extra.weight ?? 0.5) : suitability))
  extra.name = foundedName(bodyName, kind, node, existing, extra.good)
  return {
    ok: true,
    site: { id: nextCustomId(bodyName, kind, existing), bodyName, kind, tags, node, terrain, suitability: Math.round(suitability * 100) / 100, capacity, ...extra },
  }
}
