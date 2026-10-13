// District footprints in the live game: reads what is developed at each site from the stores and draws it onto the ground map
// (scene/footprint.ts has the rules). Only on bodies whose starting buildings have been assigned to sites ("seeded"), so a bare
// test body and unowned ground keep exactly the terrain the generator made.
//
// Read-only: it never writes a store, so it is safe inside render and inside the ground war's per-day step. The result is cached
// per base surface and per signature of the sizes, so asking again costs a handful of lookups and returns the SAME object until
// something is built or lost.
import { siteName, siteOwner, useLocationStore } from '../state/locationStore'
import { useZoneStore } from '../state/zoneStore'
import { usePlacementStore } from '../state/placementStore'
import { bodyPopulation } from './urbanPopulation'
import { maturityOf } from './urbanMaturity'
import { useGameTimeStore } from '../state/gameTimeStore'
import { populationCap, shareOutPopulation } from './urban'
import { applyFootprints, claimFootprints, footprintSize, type Footprint, type FootprintSite } from './footprint'
import { FOOTPRINT_TERRAIN } from '../data/footprintData'
import { baseCapacity, locationsOf } from './locations'
import type { BodySurface, KeySlot } from './planetTerrain'
import { groupAreas, type Area, type AreaSeed } from './areas'
import { surfaceMesh } from './surfaceMesh'

const sum = (rec: Record<string, number> | undefined): number => (rec ? Object.values(rec).reduce((n, v) => n + v, 0) : 0)

// The sites of a body with the size each should cover now.
export function footprintSites(bodyName: string): FootprintSite[] {
  const placement = usePlacementStore.getState()
  const sites = locationsOf(bodyName).filter((s) => s.node !== null && FOOTPRINT_TERRAIN[s.kind] !== undefined)
  const settlements = sites.filter((s) => s.kind === 'settlement' && siteOwner(s.id))
  // People are shared out by the room a site was generated with, not by its zone: redrawing a zone must not make a city bigger.
  const capacity = settlements.reduce((n, s) => n + baseCapacity(s), 0)
  const people = capacity > 0 ? bodyPopulation(bodyName) : 0
  const shares = new Map<string, number>()
  if (people > 0) {
    const now = useGameTimeStore.getState().simDays
    const out = shareOutPopulation(people, settlements.map((s) => baseCapacity(s) * maturityOf(useLocationStore.getState().established[s.id], now)), settlements.map((s) => populationCap(s.tags.includes('capital'))))
    settlements.forEach((s, i) => shares.set(s.id, out[i]))
  }
  return sites.map((s) => {
    const share = shares.get(s.id) ?? 0
    return { id: s.id, kind: s.kind, node: s.node!, size: footprintSize(s.kind, sum(placement.levels[s.id]), sum(placement.placed[s.id]), share) }
  })
}

// The redrawn zones of this body's sites, as sets (a site with none redrawn grows wherever its order leads).
function zoneSets(bodyName: string, sites: readonly FootprintSite[]): Record<string, ReadonlySet<number>> {
  const zones = useZoneStore.getState().zones
  const out: Record<string, ReadonlySet<number>> = {}
  for (const s of sites) if (zones[s.id] && s.id.startsWith(`${bodyName}#`)) out[s.id] = new Set(zones[s.id])
  return out
}

export function footprintsOf(bodyName: string, base: BodySurface): Footprint[] {
  const sites = footprintSites(bodyName)
  return claimFootprints(base, sites, zoneSets(bodyName, sites), reserveSet(bodyName))
}

function reserveSet(bodyName: string): ReadonlySet<number> | undefined {
  const cells = useZoneStore.getState().reserves[bodyName]
  return cells ? new Set(cells) : undefined
}

// The seeds areas are made of: every site that is somebody's or has ground drawn. Capital first, then the map's own cities.
function areaSeeds(bodyName: string, sized: readonly FootprintSite[]): AreaSeed[] {
  const size = new Map(sized.map((s) => [s.id, s.size]))
  return locationsOf(bodyName)
    .filter((s) => s.node !== null && FOOTPRINT_TERRAIN[s.kind] !== undefined && (!!siteOwner(s.id) || (size.get(s.id) ?? 0) > 0))
    .map((s) => ({ id: s.id, kind: s.kind, node: s.node, rank: s.tags.includes('capital') ? 0 : s.fixed ? 1 : 2 }))
}

function areasFrom(bodyName: string, sized: readonly FootprintSite[], footprints: readonly Footprint[]): Area[] {
  return groupAreas(areaSeeds(bodyName, sized), footprints, surfaceMesh().neighbors.fine)
}

// The areas of a body (scene/areas.ts) against its base ground (scene/zoneOrders.zoneBase).
export function bodyAreas(bodyName: string, base: BodySurface): Area[] {
  const sites = footprintSites(bodyName)
  return areasFrom(bodyName, sites, claimFootprints(base, sites, zoneSets(bodyName, sites), reserveSet(bodyName)))
}

// Every urban area is a key node of the ground map: one that holds none of the map's own capital/city/outpost nodes gets a city
// node at its primary seed, named after the area.
export function areaKeySlots(base: BodySurface, areas: readonly Area[], names = useLocationStore.getState().names): KeySlot[] {
  const settled = new Set(base.keySlots.filter((k) => k.kind === 'capital' || k.kind === 'city' || k.kind === 'outpost').map((k) => k.node))
  const taken = new Set(base.keySlots.map((k) => k.node))
  const out: KeySlot[] = []
  for (const a of areas) {
    if (a.kind !== 'settlement' || a.node === null || taken.has(a.node)) continue
    if (a.cells.some((c) => settled.has(c))) continue
    out.push({ node: a.node, kind: 'city', name: siteName(a.id, names), area: true })
    taken.add(a.node)
  }
  return out
}

const memo = new WeakMap<BodySurface, { sig: string; zones: unknown; reserves: unknown; names: unknown; established: unknown; surface: BodySurface }>()

// The ground map of a seeded body with its districts drawn on, and a key node for each urban area. Any other surface comes back as it is.
export function withFootprints(base: BodySurface): BodySurface {
  if (!usePlacementStore.getState().seeded[base.bodyName]) return base
  const sites = footprintSites(base.bodyName)
  // The custom-site list is part of the signature through the ids and nodes below.
  const sig = sites
    .filter((s) => s.size > 0)
    .map((s) => `${s.id}@${s.node}:${s.size}`)
    .join('|')
  const { zones, reserves } = useZoneStore.getState()
  const { names, established } = useLocationStore.getState()
  const hit = memo.get(base)
  if (hit && hit.sig === sig && hit.zones === zones && hit.reserves === reserves && hit.names === names && hit.established === established) return hit.surface
  const footprints = sig === '' ? [] : claimFootprints(base, sites, zoneSets(base.bodyName, sites), reserveSet(base.bodyName))
  const surface = sig === '' ? base : applyFootprints(base, footprints)
  areaSlotMemo.set(surface, areaKeySlots(base, areasFrom(base.bodyName, sites, footprints), names))
  memo.set(base, { sig, zones, reserves, names, established, surface })
  return surface
}

const areaSlotMemo = new WeakMap<BodySurface, KeySlot[]>()

// Adds the urban areas' key nodes (areaKeySlots) to a surface built on top of `withFootprints`' result. Added LAST (after the
// spaceports), so where the auto-placed ports go and what they are called never depends on them. Skips any node already a key.
export function withAreaKeys(drawn: BodySurface, surface: BodySurface): BodySurface {
  const extra = areaSlotMemo.get(drawn)
  if (!extra || extra.length === 0) return surface
  const taken = new Set(surface.keySlots.map((k) => k.node))
  const add = extra.filter((k) => !taken.has(k.node))
  return add.length > 0 ? { ...surface, keySlots: [...surface.keySlots, ...add] } : surface
}
