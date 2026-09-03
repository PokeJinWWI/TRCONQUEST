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
  // Martians, Venusians and Arcadians are all HUMANS — different cultures, one
  // species. Only the Tidalians are a separate (alien) species.
  name: 'Human',
  needs: {
    basic: [{ good: 'food', amountPerPop: 0.8 }],
    everyday: [
      { good: 'consumerGoods', amountPerPop: 0.3 },
      { good: 'electricity', amountPerPop: 0.15 },
      { good: 'retail', amountPerPop: 0.12 },
      { good: 'infrastructure', amountPerPop: 0.06 },
    ],
    healthcare: [{ good: 'healthcare', amountPerPop: 0.15 }],
    comfort: [
      { good: 'electronics', amountPerPop: 0.03 },
      { good: 'education', amountPerPop: 0.08 },
      { good: 'automobiles', amountPerPop: 0.012 },
    ],
    luxury: [
      { good: 'luxuryGoods', amountPerPop: 0.02 },
      { good: 'aircraft', amountPerPop: 0.0025 },
    ],
  },
}

// The Tidalians — the aquatic aliens of Lalande 21185 d (an eyeball/tidally-
// locked world). A different needs template: they consume water and biomass as
// their basic staples rather than terrestrial food, and reef-culture goods
// where humans want consumer goods. Same tier shape, different baskets — the
// whole point of species being data (design doc: adding a species is content,
// not code). For Milestone 1 they map onto the existing goods; later milestones
// give them their own (water, biomass) once those goods exist.
export const TIDALIAN: SpeciesTemplate = {
  id: 'tidalian',
  name: 'Tidalian',
  needs: {
    basic: [{ good: 'food', amountPerPop: 0.85 }],
    everyday: [
      { good: 'consumerGoods', amountPerPop: 0.25 },
      { good: 'electricity', amountPerPop: 0.12 },
      { good: 'retail', amountPerPop: 0.1 },
      { good: 'infrastructure', amountPerPop: 0.05 },
    ],
    healthcare: [{ good: 'healthcare', amountPerPop: 0.13 }],
    comfort: [
      { good: 'education', amountPerPop: 0.06 },
      { good: 'automobiles', amountPerPop: 0.01 },
    ],
    luxury: [{ good: 'luxuryGoods', amountPerPop: 0.02 }],
  },
}

export const SPECIES_TEMPLATES: Record<string, SpeciesTemplate> = {
  [BASELINE_ORGANIC.id]: BASELINE_ORGANIC,
  [TIDALIAN.id]: TIDALIAN,
}
