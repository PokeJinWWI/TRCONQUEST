import type { GoodId } from './goods'

// The five needs tiers from the design doc (Section 1). A pop satisfies them
// in order — it won't spend on Comfort while Basic is unmet (see
// economyTick's pop-consumption step) — and each tier maps, per species, to a
// basket of goods.
export type NeedTier = 'basic' | 'everyday' | 'healthcare' | 'comfort' | 'luxury'

export const NEED_TIERS: NeedTier[] = ['basic', 'everyday', 'healthcare', 'comfort', 'luxury']

export interface NeedEntry {
  good: GoodId
  // Units of the good one unit of population wants each tick. Same unit scale
  // as population_size, building job counts, and recipe amounts throughout
  // the sim, so market supply and demand are directly comparable numbers.
  amountPerPop: number
}

export interface SpeciesTemplate {
  id: string
  name: string
  // The whole point of species being a *template*: needs are data keyed by
  // tier, so a synthetic ('maintenance' goods instead of food/medicine) or a
  // hive-mind is a new entry here, not a code change (design doc Section 1).
  // Empty tiers (Comfort/Luxury here) are trivially satisfied — they matter
  // once higher-class pops and luxury goods exist in a later milestone.
  needs: Record<NeedTier, NeedEntry[]>
}

// The one baseline organic template Milestone 1 ships with. Comfort and
// Luxury are intentionally empty for now — the good set is kept minimal, and
// those tiers only start to bite for the wealthy classes a later milestone
// adds real luxury goods for.
export const BASELINE_ORGANIC: SpeciesTemplate = {
  id: 'baseline-organic',
  name: 'Baseline Organic',
  needs: {
    basic: [{ good: 'food', amountPerPop: 1.0 }],
    everyday: [{ good: 'consumerGoods', amountPerPop: 0.5 }],
    healthcare: [{ good: 'medicine', amountPerPop: 0.2 }],
    comfort: [],
    luxury: [],
  },
}

export const SPECIES_TEMPLATES: Record<string, SpeciesTemplate> = {
  [BASELINE_ORGANIC.id]: BASELINE_ORGANIC,
}
