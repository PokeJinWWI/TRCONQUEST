import type { GoodId } from './goods'

// The five needs tiers (design doc Section 1). A pop satisfies them in priority
// order — it won't spend on Comfort while Basic is unmet (see economyTick's
// pop-consumption step). Each tier holds one or more NEED GROUPS.
export type NeedTier = 'basic' | 'everyday' | 'healthcare' | 'comfort' | 'luxury'

export const NEED_TIERS: NeedTier[] = ['basic', 'everyday', 'healthcare', 'comfort', 'luxury']

// One good that can satisfy a need group, with a preference weight (Vic3-style
// "buy package"): a higher weight means the pop leans toward that good when
// filling the group, but any good in the group substitutes for the others.
export interface NeedGoodOption {
  good: GoodId
  weight: number
}

// A NEED GROUP is a single want (e.g. "Basic Food", "Household Goods") that can
// be met by any of several substitutable goods (grain vs. meat, plain consumer
// goods vs. furniture). `base` is the need-units one unit of population wants at
// a neutral standard of living; the actual want is scaled by wealth per tier
// (Engel's law — the rich want far more comfort/luxury, the poor mostly food).
// Same unit scale as population_size / job counts / recipe amounts throughout.
export interface NeedGroup {
  id: string
  label: string
  base: number
  goods: NeedGoodOption[]
}

export interface SpeciesTemplate {
  id: string
  name: string
  // Needs are DATA keyed by tier — a synthetic or hive-mind species is a new
  // entry here, not a code change (design doc Section 1). An empty tier is
  // trivially satisfied.
  needs: Record<NeedTier, NeedGroup[]>
}

// The baseline organic (human) template. Groups now offer real substitutes: a
// pop's food can be met by staple food or premium meat, its household need by
// plain consumer goods or furniture, its durables by electronics or automobiles,
// its luxuries by luxury goods or art — so shortages cause substitution and the
// wealthy buy a richer mix.
export const BASELINE_ORGANIC: SpeciesTemplate = {
  id: 'baseline-organic',
  name: 'Human',
  needs: {
    basic: [
      // Food: grains are the cheap staple, groceries the processed everyday food,
      // and meat/fish the proteins — all substitutable (no meat → eat more fish
      // and grain). Weights are the preferred mix; shortages shift it.
      { id: 'staple-food', label: 'Staple Food', base: 0.55, goods: [{ good: 'grains', weight: 3 }, { good: 'groceries', weight: 2 }] },
      { id: 'protein', label: 'Protein', base: 0.22, goods: [{ good: 'meat', weight: 1 }, { good: 'fish', weight: 1 }] },
    ],
    everyday: [
      { id: 'household-goods', label: 'Household Goods', base: 0.3, goods: [{ good: 'consumerGoods', weight: 3 }, { good: 'furniture', weight: 1 }] },
      { id: 'energy', label: 'Energy', base: 0.15, goods: [{ good: 'electricity', weight: 1 }] },
      { id: 'everyday-services', label: 'Services', base: 0.12, goods: [{ good: 'retail', weight: 1 }] },
      { id: 'infrastructure', label: 'Infrastructure', base: 0.06, goods: [{ good: 'infrastructure', weight: 1 }] },
    ],
    healthcare: [
      { id: 'healthcare', label: 'Healthcare', base: 0.15, goods: [{ good: 'healthcare', weight: 3 }, { good: 'dental', weight: 1 }] },
    ],
    comfort: [
      { id: 'durables', label: 'Durables', base: 0.03, goods: [{ good: 'electronics', weight: 2 }, { good: 'automobiles', weight: 1 }] },
      { id: 'education', label: 'Education', base: 0.08, goods: [{ good: 'education', weight: 1 }] },
      { id: 'digital', label: 'Digital Services', base: 0.05, goods: [{ good: 'onlineServices', weight: 1 }] },
    ],
    luxury: [
      { id: 'luxuries', label: 'Luxuries', base: 0.02, goods: [{ good: 'luxuryGoods', weight: 2 }, { good: 'art', weight: 1 }] },
      { id: 'fine-transport', label: 'Fine Transport', base: 0.0025, goods: [{ good: 'aircraft', weight: 1 }] },
    ],
  },
}

// The Tidalians — aquatic aliens of Lalande 21185 d. Same tier/group shape,
// leaner baskets (they map onto the shared goods for now; their own water/biomass
// goods can be added later as content).
export const TIDALIAN: SpeciesTemplate = {
  id: 'tidalian',
  name: 'Tidalian',
  needs: {
    basic: [
      // Tidalians (aquatic) lean toward fish over meat, but the same substitution.
      { id: 'staple-food', label: 'Staple Food', base: 0.55, goods: [{ good: 'grains', weight: 3 }, { good: 'groceries', weight: 2 }] },
      { id: 'protein', label: 'Protein', base: 0.26, goods: [{ good: 'fish', weight: 3 }, { good: 'meat', weight: 1 }] },
    ],
    everyday: [
      { id: 'household-goods', label: 'Household Goods', base: 0.25, goods: [{ good: 'consumerGoods', weight: 3 }, { good: 'furniture', weight: 1 }] },
      { id: 'energy', label: 'Energy', base: 0.12, goods: [{ good: 'electricity', weight: 1 }] },
      { id: 'everyday-services', label: 'Services', base: 0.1, goods: [{ good: 'retail', weight: 1 }] },
      { id: 'infrastructure', label: 'Infrastructure', base: 0.05, goods: [{ good: 'infrastructure', weight: 1 }] },
    ],
    healthcare: [
      { id: 'healthcare', label: 'Healthcare', base: 0.13, goods: [{ good: 'healthcare', weight: 3 }, { good: 'dental', weight: 1 }] },
    ],
    comfort: [
      { id: 'education', label: 'Education', base: 0.06, goods: [{ good: 'education', weight: 1 }] },
      { id: 'durables', label: 'Durables', base: 0.01, goods: [{ good: 'automobiles', weight: 1 }] },
    ],
    luxury: [
      { id: 'luxuries', label: 'Luxuries', base: 0.02, goods: [{ good: 'luxuryGoods', weight: 2 }, { good: 'art', weight: 1 }] },
    ],
  },
}

export const SPECIES_TEMPLATES: Record<string, SpeciesTemplate> = {
  [BASELINE_ORGANIC.id]: BASELINE_ORGANIC,
  [TIDALIAN.id]: TIDALIAN,
}

// --- Wealth-scaled buy packages (Engel's law) -------------------------------
// The want for a need group is its `base` times a per-tier factor that grows
// with the pop's standard of living. Basic needs are inelastic (everyone eats,
// roughly regardless of wealth); comfort and luxury are highly elastic (the rich
// want far more). factor = floor + slope * standardOfLiving.
const TIER_WEALTH_SCALE: Record<NeedTier, { floor: number; slope: number }> = {
  basic: { floor: 0.9, slope: 0.3 }, // ~0.9 → 1.2
  everyday: { floor: 0.6, slope: 0.9 }, // ~0.6 → 1.5
  healthcare: { floor: 0.7, slope: 0.6 }, // ~0.7 → 1.3
  comfort: { floor: 0.2, slope: 1.5 }, // ~0.2 → 1.7
  luxury: { floor: 0.05, slope: 2.0 }, // ~0.05 → 2.05
}

// The wealth multiplier applied to a tier's need groups for a pop at the given
// standard of living (0..1).
export function tierWealthFactor(tier: NeedTier, standardOfLiving: number): number {
  const s = TIER_WEALTH_SCALE[tier]
  const sol = standardOfLiving < 0 ? 0 : standardOfLiving > 1 ? 1 : standardOfLiving
  return s.floor + s.slope * sol
}
