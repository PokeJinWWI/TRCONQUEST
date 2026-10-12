// Tuning for development locations (scene/locations.ts): how many sites of each
// kind a body gets, how suitable each terrain is, and which natural resource a
// terrain tends to hold. Balance lives here, not inline.
import type { TerrainId } from './groundData'
import type { PlanetClass } from '../scene/planetData'

export type LocationKind = 'resource' | 'settlement' | 'industrial' | 'infrastructure' | 'strategic' | 'agricultural'
// `agricultural` (farmland) comes last: sites of it are generated after every other kind from a stream of their own, so adding them moved no existing site id.
export const LOCATION_KINDS: LocationKind[] = ['resource', 'settlement', 'industrial', 'infrastructure', 'strategic', 'agricultural']

// A finite raw resource a site can hold: the depletable goods of Complex mode
// (economy/economyTick.DEPLETABLE_GOODS), the same list Simple's "minerals" stand for.
export type SiteGood = 'ironOre' | 'coal' | 'oil' | 'rareMetals' | 'sulfur' | 'hardwood' | 'timber' | 'phosphate'

export type LocationTag =
  | 'capital'
  | 'city'
  | 'spaceport'
  | 'aerostat'
  | 'coastal'
  | 'high-ground'
  | 'belt'
  | 'hyperium'
  | 'exotic-matter'

// Per planet class: how much of each kind of site the body supports, as a
// multiplier on the size-based counts. 0 = none at all (a lava world has no
// settlement sites; a gas giant's only ground is its aerostat belt).
export interface ClassProfile {
  settlement: number
  industrial: number
  resource: number
  strategic: number
  agricultural: number
}

export const CLASS_PROFILE: Record<PlanetClass, ClassProfile> = {
  continental: { settlement: 1, industrial: 1, resource: 1, strategic: 1, agricultural: 1 },
  ocean: { settlement: 0.8, industrial: 0.7, resource: 0.8, strategic: 0.8, agricultural: 0.6 },
  hycean: { settlement: 0.3, industrial: 0.3, resource: 0.5, strategic: 0.5, agricultural: 0.2 },
  desert: { settlement: 0.7, industrial: 1, resource: 1.2, strategic: 1, agricultural: 0.4 },
  toxic: { settlement: 0.4, industrial: 0.8, resource: 1.2, strategic: 1, agricultural: 0 },
  barren: { settlement: 0.5, industrial: 0.8, resource: 1.4, strategic: 1, agricultural: 0.3 },
  ice: { settlement: 0.4, industrial: 0.5, resource: 1, strategic: 1, agricultural: 0.3 },
  lava: { settlement: 0, industrial: 0.4, resource: 1, strategic: 0.5, agricultural: 0 },
  eyeball: { settlement: 0.6, industrial: 0.7, resource: 1, strategic: 1, agricultural: 0.6 },
  'gas-giant': { settlement: 0.5, industrial: 0.5, resource: 0.5, strategic: 0, agricultural: 0.3 },
  'ice-giant': { settlement: 0.5, industrial: 0.5, resource: 0.5, strategic: 0, agricultural: 0.3 },
}

// How good a patch of ground is to live on, 0..1 (urban already is a city).
export const SETTLEMENT_SUITABILITY: Record<TerrainId, number> = {
  ocean: 0,
  plains: 0.9,
  forest: 0.7,
  desert: 0.5,
  tundra: 0.4,
  mountains: 0.2,
  plateau: 0.6,
  urban: 1,
  industrial: 0.8,
  mining: 0.3,
  farmland: 0.8,
  rock: 0.35,
  lava: 0,
  cloud: 0,
  aerostat: 0.5,
}

// How good a patch of ground is for heavy industry: flat, solid and open.
export const INDUSTRIAL_SUITABILITY: Record<TerrainId, number> = {
  ocean: 0,
  plains: 0.9,
  forest: 0.4,
  desert: 0.8,
  tundra: 0.5,
  mountains: 0.15,
  plateau: 0.85,
  urban: 0.6,
  industrial: 0.9,
  mining: 0.5,
  farmland: 0.6,
  rock: 0.7,
  lava: 0,
  cloud: 0,
  aerostat: 0.5,
}

// How good a patch of ground is to farm.
export const AGRICULTURAL_SUITABILITY: Record<TerrainId, number> = {
  ocean: 0,
  plains: 0.9,
  forest: 0.5,
  desert: 0.3,
  tundra: 0.2,
  mountains: 0,
  plateau: 0.4,
  urban: 0.1,
  industrial: 0,
  mining: 0,
  farmland: 0.95,
  rock: 0.05,
  lava: 0,
  cloud: 0,
  aerostat: 0.5,
}

// Which resource a terrain tends to hold, as weights (a draw picks one).
export const TERRAIN_RESOURCES: Partial<Record<TerrainId, Partial<Record<SiteGood, number>>>> = {
  forest: { hardwood: 3, timber: 3, phosphate: 1 },
  plains: { coal: 2, oil: 2, phosphate: 2, ironOre: 1 },
  desert: { oil: 3, sulfur: 1, ironOre: 1, rareMetals: 1 },
  tundra: { oil: 2, coal: 1, ironOre: 1 },
  mountains: { ironOre: 3, rareMetals: 2, coal: 1 },
  plateau: { ironOre: 2, rareMetals: 1, coal: 1 },
  rock: { ironOre: 3, rareMetals: 2, sulfur: 1 },
  aerostat: { sulfur: 3, phosphate: 1 },
}

// A belt's resources (no ground to speak of).
export const BELT_RESOURCES: Partial<Record<SiteGood, number>> = { ironOre: 3, rareMetals: 2, sulfur: 1 }
export const BELT_SITES = 4

// Site counts: per size district (planetStats.estimateSize), times the class profile.
export const SETTLEMENTS_PER_DISTRICT = 1 / 4
export const INDUSTRIAL_PER_DISTRICT = 1 / 3
export const RESOURCES_PER_DISTRICT = 1 / 3
export const STRATEGIC_PER_DISTRICT = 1 / 5
export const AGRICULTURAL_PER_DISTRICT = 1 / 3
export const MAX_SITES_PER_KIND = 12

// Sites keep this many fine cells apart (the ground war's own key-node spacing,
// groundData.KEY_MIN_SEPARATION_CELLS, is the floor).
export const SITE_MIN_SEPARATION_CELLS = 4

// Capacity of a site, in district-level equivalents (the unit both economies' `land`
// is counted in): 1 at the poorest, this many more at the best.
export const SITE_CAPACITY_RANGE = 3

// Building slots a site holds per unit of capacity (one district level houses this many
// buildings: economy/districts.SLOTS_PER_DISTRICT_LEVEL).
export const SITE_SLOTS_PER_CAPACITY = 8
