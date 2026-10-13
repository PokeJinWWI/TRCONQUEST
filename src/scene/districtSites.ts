// Which district a building belongs to, which kinds of site a district can be developed on, and how many building
// slots one developed level holds, in either economy (docs/territorial-design.md section 12). The districts are
// the economies' own; this only says where on a body they stand: each district level is developed AT a site.
//
//   Complex   core: settlement   urban: settlement (services) or infrastructure (spaceports, seaports, roads)
//             industrial: industrial   mining: resource (mines, wells, forestry)   agricultural: agricultural (farms, ranches)   military: not placed
//   Simple    core / academic / urban: settlement (urban also infrastructure)   mining: resource   agricultural: agricultural
//             industrial / generator: industrial   military: not placed
import { SLOTS_PER_DISTRICT_LEVEL } from '../economy/districts'
import { districtOfRecipe } from '../economy/recipes'
import { DISTRICT_OF_BUILDING, SLOTS_PER_DISTRICT, type SimpleBuildingId } from '../data/simplisticEconomyData'
import type { LocationKind } from '../data/locationData'

export type EconomyMode = 'simple' | 'complex'
export interface BuildingRefLike {
  mode: EconomyMode
  id: string
}

export const districtOfBuilding = (ref: BuildingRefLike): string => (ref.mode === 'simple' ? (DISTRICT_OF_BUILDING[ref.id as SimpleBuildingId] ?? 'industrial') : districtOfRecipe(ref.id))

export const slotsPerLevel = (mode: EconomyMode): number => (mode === 'simple' ? SLOTS_PER_DISTRICT : SLOTS_PER_DISTRICT_LEVEL)

// A district nobody places: its levels are the world's planetary defenses (state/defenseStore), not sites.
export const isPlacedDistrict = (district: string): boolean => district !== 'military'

// The part of a settlement's room (capacity) that can be developed as industry.
export const INDUSTRY_SHARE_OF_SETTLEMENT = 1 / 3

export function siteKindsOfDistrict(mode: EconomyMode, district: string): LocationKind[] {
  switch (district) {
    case 'core':
    case 'academic':
      return ['settlement']
    case 'urban':
      return ['settlement', 'infrastructure']
    case 'industrial':
    case 'generator':
      // Industry belongs on industrial ground first, but a city has its own factories (a share of its room: INDUSTRY_SHARE_OF_SETTLEMENT).
      return ['industrial', 'settlement']
    case 'resource':
    case 'mining':
      return ['resource']
    case 'agricultural':
      return ['agricultural']
    default:
      void mode
      return []
  }
}
