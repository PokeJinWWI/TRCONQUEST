import type { GoodId } from './goods'

// The six social classes from the design doc (Section 1). Milestone 1 only
// hires the four working classes into building jobs; Investor pops earn
// dividends instead of wages, and Political pops have no state jobs yet (that
// arrives with the political layer), so both simply hold and spend wealth for
// now.
export type PopClass = 'subsistence' | 'labor' | 'technical' | 'professional' | 'investor' | 'political'

export const POP_CLASSES: PopClass[] = ['subsistence', 'labor', 'technical', 'professional', 'investor', 'political']

export interface RecipeIO {
  good: GoodId
  // Per building level, at full operating scale, per tick.
  amount: number
}

export interface RecipeJob {
  class: PopClass
  // Job slots per building level.
  count: number
}

export interface Recipe {
  id: string
  label: string
  category: 'extraction' | 'agriculture' | 'industry' | 'healthcare'
  inputs: RecipeIO[]
  outputs: RecipeIO[]
  jobs: RecipeJob[]
}

// Four building types forming one connected chain (design doc Section 4's
// "minimum: one Extraction, one food-producing, one Industry" plus a
// healthcare producer so the Healthcare needs tier has a real supplier):
//   mine  → minerals
//   farm  → food
//   factory: minerals → consumer goods
//   clinic:  consumer goods → medicine
// So a shock to mining ripples through industry into healthcare, and the
// labor market spans all four working classes.
export const RECIPES: Record<string, Recipe> = {
  farm: {
    id: 'farm',
    label: 'Farm',
    category: 'agriculture',
    inputs: [],
    outputs: [{ good: 'food', amount: 1200 }],
    jobs: [
      { class: 'subsistence', count: 300 },
      { class: 'labor', count: 100 },
    ],
  },
  mine: {
    id: 'mine',
    label: 'Mine',
    category: 'extraction',
    inputs: [],
    outputs: [{ good: 'minerals', amount: 600 }],
    jobs: [{ class: 'labor', count: 300 }],
  },
  factory: {
    id: 'factory',
    label: 'Factory',
    category: 'industry',
    inputs: [{ good: 'minerals', amount: 300 }],
    outputs: [{ good: 'consumerGoods', amount: 800 }],
    jobs: [
      { class: 'labor', count: 200 },
      { class: 'technical', count: 200 },
    ],
  },
  clinic: {
    id: 'clinic',
    label: 'Clinic',
    category: 'healthcare',
    inputs: [{ good: 'consumerGoods', amount: 200 }],
    outputs: [{ good: 'medicine', amount: 400 }],
    jobs: [
      { class: 'technical', count: 100 },
      { class: 'professional', count: 100 },
    ],
  },
}
