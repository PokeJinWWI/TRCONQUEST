// Tuning for district footprints (scene/footprint.ts): how much ground a developed site covers, and what the ground becomes.
// Balance lives here. A cell is a fine node of the ground map (about 120 km across on Earth, 70 km on Mars).
import type { LocationKind } from './locationData'
import type { TerrainId } from './groundData'

// The ground a kind of site turns into where its district stands. Infrastructure (a spaceport) and strategic ground stay as they were.
export const FOOTPRINT_TERRAIN: Partial<Record<LocationKind, TerrainId>> = {
  settlement: 'urban',
  industrial: 'industrial',
  resource: 'mining',
  agricultural: 'farmland',
}

// Cells covered per developed district level at the site, and per building standing on it.
export const CELLS_PER_LEVEL: Partial<Record<LocationKind, number>> = { settlement: 2, industrial: 2, resource: 1.5, agricultural: 3 }
export const CELLS_PER_BUILDING: Partial<Record<LocationKind, number>> = { settlement: 0.5, industrial: 0.75, resource: 0.5, agricultural: 0.5 }
// A settlement also spreads with the people living in it: this many cells per million of them (a city packs thousands of
// people to the square kilometre, so a million fit in a few cells; Mars's 3,000M over a few cities come to a few dozen each).
export const CELLS_PER_MILLION_PEOPLE = 0.04

// A site's footprint never grows past this (the ground map's patch is not infinite) and one that holds anything covers at least one cell.
export const MAX_FOOTPRINT_CELLS = 120

// Sites claim ground in this order (settlements first, so a city is never eaten by a mine beside it).
export const FOOTPRINT_PRIORITY: LocationKind[] = ['settlement', 'industrial', 'resource', 'agricultural']

// How far a footprint's growth order reaches (it can skip cells other sites hold, so it is longer than the largest footprint).
export const GROWTH_ORDER_CELLS = MAX_FOOTPRINT_CELLS * 2 + 40

// Spreading over a cell costs this much more than flat ground: a city grows around a mountain before it climbs it.
export const GROWTH_COST: Partial<Record<TerrainId, number>> = { mountains: 4, plateau: 1.5, tundra: 1.2, forest: 1.2, desert: 1.1 }
