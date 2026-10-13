// Tuning for settlement growth and specialization (scene/urban.ts).
export type SettlementTier = 'outpost' | 'town' | 'city' | 'metropolis'
export const TIERS: SettlementTier[] = ['outpost', 'town', 'city', 'metropolis']

// Minimum population (millions) for a tier, AND the capacity (district-level equivalents) the site must have
// and the output share (transport access) it must keep: a big city needs the room and the roads.
export const TIER_RULES: Record<SettlementTier, { minPopulation: number; minCapacity: number; minAccess: number }> = {
  outpost: { minPopulation: 0, minCapacity: 0, minAccess: 0 },
  town: { minPopulation: 1, minCapacity: 2, minAccess: 0.6 },
  city: { minPopulation: 10, minCapacity: 3, minAccess: 0.8 },
  metropolis: { minPopulation: 50, minCapacity: 4, minAccess: 0.9 },
}

// The most people (millions) one settlement holds before the rest go to other places: the nations hold billions, so a
// settlement of 150M is a hypercity. A capital may be bigger. Only when EVERY place is full do people overflow (overcrowding).
export const MAX_SETTLEMENT_POPULATION = 150
export const MAX_CAPITAL_POPULATION = 250

// How many people (millions) a site can house per unit of capacity before it is overcrowded.
export const POP_PER_CAPACITY = 60

// How strongly work nearby pulls people in: each placed building slot within the catchment adds this to a
// settlement's weight, on top of its own capacity x suitability.
export const JOB_PULL = 0.25
// Sites this close (fine cells) to a settlement work for it.
export const CATCHMENT_CELLS = 10

export type Specialization = 'capital' | 'mining' | 'industry' | 'port' | 'agriculture' | 'services'
// A settlement is specialized in a field when it holds at least this share of its jobs and at least this many slots.
export const SPECIALIZATION_SHARE = 0.4
export const SPECIALIZATION_MIN_SLOTS = 2

// Starting worlds are settled enough to house their people: one settlement per this many millions (scene/seedPlacementOrders).
export const SEED_POP_PER_SETTLEMENT = 100
