// Where a building may stand, pure: the rules both economies share (docs/territorial-design.md
// M5). A building (a Simple building id or a Complex recipe id) goes on a development site
// of the right KIND, with room, and an extractor on a resource site that holds what it
// extracts. Whether the BUILDER may build there at all is jurisdiction (scene/jurisdiction),
// reported separately.
//
// What a site records is WHERE a building stands; HOW MANY exist stays with the economies
// (Simple `WorldState.buildings`, Complex `World.buildings`). Buildings seeded at the start,
// and any built before placement existed, are simply unplaced: nothing invents a site for them.
import { SLOT_FREE_RECIPES } from '../economy/economyTick'
import { DEPLETABLE_GOODS } from '../economy/economyTick'
import { getMethod } from '../economy/recipes'
import { SIMPLE_BUILDING_DEFS, takesSlot, type SimpleBuildingId } from '../data/simplisticEconomyData'
import { SITE_SLOTS_PER_CAPACITY, type LocationKind, type SiteGood } from '../data/locationData'
import type { DevLocation } from './locations'
import type { PhysicalResult } from './jurisdiction'
import { districtOfBuilding, siteKindsOfDistrict } from './districtSites'

export interface BuildingRef {
  mode: 'simple' | 'complex'
  // Simple building id, or Complex recipe id.
  id: string
}

const INFRASTRUCTURE_RECIPES = new Set(['spaceport', 'seaport', 'roadNetwork'])

// The kind of site a building stands on: the one its DISTRICT is developed on (scene/districtSites), except that
// spaceports, seaports and road networks (Urban district) stand on infrastructure sites, and a Simple noSlot building
// (a spaceport) likewise.
export function siteKindOf(ref: BuildingRef): LocationKind {
  if (ref.mode === 'simple') {
    const def = SIMPLE_BUILDING_DEFS[ref.id as SimpleBuildingId]
    if (!def) return 'industrial'
    if (def.noSlot) return 'infrastructure'
  } else if (INFRASTRUCTURE_RECIPES.has(ref.id)) return 'infrastructure'
  return siteKindsOfDistrict(ref.mode, districtOfBuilding(ref))[0] ?? 'industrial'
}

// The kinds of site a building may stand on, best first: a port, a road network or a railway belongs on infrastructure ground
// but can also stand in a city (a city spaceport), where the Urban district's slots are; a factory goes on industrial ground first
// and otherwise in a city's industrial share.
export function siteKindsFor(ref: BuildingRef): LocationKind[] {
  const primary = siteKindOf(ref)
  return primary === 'infrastructure' || primary === 'industrial' ? [primary, 'settlement'] : [primary]
}

// What an extractor draws from the ground: the finite goods a Complex recipe outputs, or 'any'
// for a Simple mine (its "minerals" are every natural resource at once). null = not an extractor.
export function extractsFrom(ref: BuildingRef): SiteGood[] | 'any' | null {
  if (siteKindOf(ref) !== 'resource') return null
  if (ref.mode === 'simple') return 'any'
  const outs = getMethod(ref.id, undefined)?.outputs.map((o) => o.good) ?? []
  const goods = outs.filter((g): g is SiteGood => (DEPLETABLE_GOODS as string[]).includes(g))
  // A farm or fishery is "extraction" in no case that needs a deposit: it needs open ground.
  return goods.length > 0 ? goods : null
}

// Slots a site holds, and what one building uses of them.
export const slotsOfSite = (site: DevLocation): number => site.capacity * SITE_SLOTS_PER_CAPACITY
export const slotsUsedBy = (ref: BuildingRef): number => ((ref.mode === 'simple' && !takesSlot(ref.id as SimpleBuildingId)) || (ref.mode === 'complex' && SLOT_FREE_RECIPES.has(ref.id)) ? 0 : 1)

// Can this building physically go on this site? `used` is the slots already taken. Without `developed`, the site's own
// capacity is the room (a body whose starting buildings have not been assigned to sites: scene/seedPlacement). With it,
// `developed` is the slots of the building's DISTRICT that have been developed at this site, and `used` the slots of that
// district already taken there: a building needs a developed slot.
export function physicalFit(site: DevLocation, ref: BuildingRef, used: number, developed?: number): PhysicalResult {
  const kinds = siteKindsFor(ref)
  if (!kinds.includes(site.kind)) return { ok: false, reason: `this site is for ${site.kind} use; the building needs ${kinds[0]} ground` }
  const extracts = extractsFrom(ref)
  if (extracts) {
    if (site.material) return { ok: false, reason: 'this deposit is drawn by extraction technology, not by a mine' }
    if (!site.good) return { ok: false, reason: 'there is nothing to extract here' }
    if (extracts !== 'any' && !extracts.includes(site.good)) return { ok: false, reason: `the ground here holds ${site.good}, which this does not extract` }
  }
  if (developed === undefined) {
    if (used + slotsUsedBy(ref) > slotsOfSite(site)) return { ok: false, reason: 'the site is full' }
  } else if (used + slotsUsedBy(ref) > developed) {
    return { ok: false, reason: developed === 0 ? `no ${districtOfBuilding(ref)} district is developed here: develop a level first` : `the ${districtOfBuilding(ref)} district here is full: develop another level` }
  }
  return { ok: true }
}

// The best site on a body for a building: the highest suitability among those it fits.
// `used` gives each site's taken slots. null when none fits.
export function pickSite(sites: readonly DevLocation[], ref: BuildingRef, used: (siteId: string) => number): DevLocation | null {
  const fits = sites.filter((s) => physicalFit(s, ref, used(s.id)).ok)
  if (fits.length === 0) return null
  return [...fits].sort((a, b) => b.suitability - a.suitability || a.id.localeCompare(b.id))[0]
}
