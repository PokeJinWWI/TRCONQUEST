// Tuning for tearing districts and buildings down (scene/demolition.ts). Taking something down costs money and materials, and
// how much depends on what it was: farmland is cheap to turn back, a factory park is heavy work, a mine leaves a clean-up
// proportional to how deeply it was worked, and a city is the heaviest of all (and its people have to go somewhere).
import type { GoodCost, ResourceCost } from './shipyardData'

export type DemolitionDistrict = 'agricultural' | 'industrial' | 'mining' | 'urban' | 'core' | 'military'

export interface DemolitionRate {
  goods: GoodCost
  resources: ResourceCost
}

// To take down ONE district level (the level's land becomes free again).
export const LEVEL_DEMOLITION: Record<DemolitionDistrict, DemolitionRate> = {
  agricultural: { goods: { tools: 1 }, resources: { minerals: 2 } },
  industrial: { goods: { concrete: 8, tools: 4, steel: 2 }, resources: { minerals: 14, alloys: 3 } },
  mining: { goods: { concrete: 6, tools: 5, chemicals: 4 }, resources: { minerals: 16, alloys: 2 } },
  urban: { goods: { concrete: 14, tools: 6, steel: 4 }, resources: { minerals: 24, alloys: 5 } },
  core: { goods: { concrete: 16, tools: 8, steel: 5 }, resources: { minerals: 30, alloys: 6 } },
  military: { goods: { concrete: 6, steel: 3 }, resources: { minerals: 10, alloys: 3 } },
}

// To take down ONE building, as a share of its district's level rate.
export const BUILDING_DEMOLITION_SHARE = 0.3

// A mine's clean-up grows with how much of the site is worked: each further level at the same site adds this share.
export const MINING_DEPTH_STEP = 0.25
// Urban and core: people to rehouse, extra cost per million of them displaced.
export const DEMOLITION_PER_MILLION_PEOPLE: DemolitionRate = { goods: { concrete: 4, tools: 1 }, resources: { minerals: 6 } }
// Share of the people of a demolished urban level that leave the world (the rest are rehoused in the settlement).
export const DISPLACED_SHARE = 0.5

// Unrest from displacing people: points per million, fading to nothing over this many days.
export const UNREST_PER_MILLION_DISPLACED = 1
export const UNREST_DECAY_DAYS = 360

// How unrest bites. Complex: standard of living lost per point (capped); Simple: happiness lost per point (capped).
export const UNREST_SOL_PER_POINT = 0.01
export const UNREST_SOL_CAP = 0.2
export const UNREST_HAPPINESS_PER_POINT = 0.01
export const UNREST_HAPPINESS_CAP = 0.2
