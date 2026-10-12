// District footprints in the live game: reads what is developed at each site from the stores and draws it onto the ground map
// (scene/footprint.ts has the rules). Only on bodies whose starting buildings have been assigned to sites ("seeded"), so a bare
// test body and unowned ground keep exactly the terrain the generator made.
//
// Read-only: it never writes a store, so it is safe inside render and inside the ground war's per-day step. The result is cached
// per base surface and per signature of the sizes, so asking again costs a handful of lookups and returns the SAME object until
// something is built or lost.
import { siteOwner } from '../state/locationStore'
import { useZoneStore } from '../state/zoneStore'
import { usePlacementStore } from '../state/placementStore'
import { bodyPopulation } from './urbanPopulation'
import { applyFootprints, claimFootprints, footprintSize, type Footprint, type FootprintSite } from './footprint'
import { FOOTPRINT_TERRAIN } from '../data/footprintData'
import { baseCapacity, locationsOf } from './locations'
import type { BodySurface } from './planetTerrain'

const sum = (rec: Record<string, number> | undefined): number => (rec ? Object.values(rec).reduce((n, v) => n + v, 0) : 0)

// The sites of a body with the size each should cover now.
export function footprintSites(bodyName: string): FootprintSite[] {
  const placement = usePlacementStore.getState()
  const sites = locationsOf(bodyName).filter((s) => s.node !== null && FOOTPRINT_TERRAIN[s.kind] !== undefined)
  const settlements = sites.filter((s) => s.kind === 'settlement' && siteOwner(s.id))
  // People are shared out by the room a site was generated with, not by its zone: redrawing a zone must not make a city bigger.
  const capacity = settlements.reduce((n, s) => n + baseCapacity(s), 0)
  const people = capacity > 0 ? bodyPopulation(bodyName) : 0
  return sites.map((s) => {
    const share = s.kind === 'settlement' && siteOwner(s.id) && capacity > 0 ? (people * baseCapacity(s)) / capacity : 0
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

const memo = new WeakMap<BodySurface, { sig: string; zones: unknown; reserves: unknown; surface: BodySurface }>()

// The ground map of a seeded body with its districts drawn on. Any other surface comes back as it is.
export function withFootprints(base: BodySurface): BodySurface {
  if (!usePlacementStore.getState().seeded[base.bodyName]) return base
  const sites = footprintSites(base.bodyName)
  // The custom-site list is part of the signature through the ids and nodes below.
  const sig = sites
    .filter((s) => s.size > 0)
    .map((s) => `${s.id}@${s.node}:${s.size}`)
    .join('|')
  const { zones, reserves } = useZoneStore.getState()
  const hit = memo.get(base)
  if (hit && hit.sig === sig && hit.zones === zones && hit.reserves === reserves) return hit.surface
  const surface = sig === '' ? base : applyFootprints(base, claimFootprints(base, sites, zoneSets(base.bodyName, sites), reserveSet(base.bodyName)))
  memo.set(base, { sig, zones, reserves, surface })
  return surface
}

