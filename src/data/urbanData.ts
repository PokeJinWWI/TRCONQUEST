// Tuning for settlement growth and specialization (scene/urban.ts).
export type SettlementTier = 'outpost' | 'town' | 'city' | 'metropolis'
export const TIERS: SettlementTier[] = ['outpost', 'town', 'city', 'metropolis']

// Minimum population (millions) for a tier, AND the capacity (district-level equivalents) the site must have
// and the output share (transport access) it must keep: a big city needs the room and the roads.
export const TIER_RULES: Record<SettlementTier, { minPopulation: number; minCapacity: number; minAccess: number }> = {
  outpost: { minPopulation: 0, minCapacity: 0, minAccess: 0 },
  town: { minPopulation: 5, minCapacity: 2, minAccess: 0.6 },
  city: { minPopulation: 50, minCapacity: 3, minAccess: 0.8 },
  metropolis: { minPopulation: 500, minCapacity: 4, minAccess: 0.9 },
}

// How many people (millions) a site can house per unit of capacity before it is overcrowded.
export const POP_PER_CAPACITY = 800

// How strongly work nearby pulls people in: each placed building slot within the catchment adds this to a
// settlement's weight, on top of its own capacity x suitability.
export const JOB_PULL = 0.25
// Sites this close (fine cells) to a settlement work for it.
export const CATCHMENT_CELLS = 10

export type Specialization = 'capital' | 'mining' | 'industry' | 'port' | 'agriculture' | 'services'
// A settlement is specialized in a field when it holds at least this share of its jobs and at least this many slots.
export const SPECIALIZATION_SHARE = 0.4
export const SPECIALIZATION_MIN_SLOTS = 2
