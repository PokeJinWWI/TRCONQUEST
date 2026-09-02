import type { GoodId } from './goods'

// The six social classes from the design doc (Section 1). Milestone 1 only
// hires the four working classes into building jobs; Investor pops earn
// dividends instead of wages, and Political pops have no state jobs yet (that
// arrives with the political layer), so both simply hold and spend wealth for
// now.
export type PopClass = 'subsistence' | 'labor' | 'technical' | 'professional' | 'investor' | 'political'

export const POP_CLASSES: PopClass[] = ['subsistence', 'labor', 'technical', 'professional', 'investor', 'political']

// Qualification a class of job demands of the pops that fill it (design doc
// Section 3: "it only fills them with qualified, available pops"). A pop's
// educationLevel is measured against this: below the requirement the pop is
// only partially qualified, so a building drawing on an under-educated labor
// pool ends up understaffed and throttled. Manual classes ask little; the
// technical and professional rungs need real schooling. Investor/Political take
// no building jobs, so their requirement is moot.
export const CLASS_QUALIFICATION: Record<PopClass, number> = {
  subsistence: 0,
  labor: 0.1,
  technical: 0.4,
  professional: 0.7,
  investor: 0,
  political: 0,
}

// How qualified a pop of `cls` with the given education is for a job of its
// class: fully (1) once it meets the requirement, scaling down to a floor below
// it (never zero — an under-schooled worker is inefficient, not useless).
export function qualificationFraction(cls: PopClass, educationLevel: number): number {
  const req = CLASS_QUALIFICATION[cls]
  if (req <= 0) return 1
  const ratio = educationLevel / req
  return Math.max(0.25, Math.min(1, ratio))
}

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

// A Production Method — the selectable way a building runs (design doc Section
// 3). Each method is a full input/output/labor profile: a *manual* method
// leans on many low-qualification workers and few material inputs; a
// *mechanized* one trades some of that labor for higher output, a richer input
// bill, and more skilled staff. Switching method is a real player tradeoff
// (labor vs inputs vs qualification), and because buildings ramp (throughput)
// the gains from a better method arrive over several ticks, not overnight.
export interface ProductionMethod {
  id: string
  label: string
  description: string
  inputs: RecipeIO[]
  outputs: RecipeIO[]
  jobs: RecipeJob[]
}

export interface Recipe {
  id: string
  label: string
  category: 'extraction' | 'agriculture' | 'industry' | 'healthcare'
  // Selectable production methods; the first is the default a fresh building
  // starts on.
  methods: ProductionMethod[]
}

// Four building types forming one connected chain (design doc Section 4's
// "minimum: one Extraction, one food-producing, one Industry" plus a
// healthcare producer so the Healthcare needs tier has a real supplier):
//   mine  → minerals
//   farm  → food
//   factory: minerals → consumer goods
//   clinic:  consumer goods → medicine
// So a shock to mining ripples through industry into healthcare, and the
// labor market spans all four working classes. Each type now offers a manual
// and a mechanized method: the manual one preserves Milestone 1's numbers (so
// the seeded economy behaves as before), the mechanized one is the player's
// upgrade lever — more output for fewer but more-skilled workers plus a
// material input.
export const RECIPES: Record<string, Recipe> = {
  farm: {
    id: 'farm',
    label: 'Farm',
    category: 'agriculture',
    methods: [
      {
        id: 'manual',
        label: 'Subsistence Farming',
        description: 'Hands and simple tools. Employs many, needs no inputs.',
        inputs: [],
        outputs: [{ good: 'food', amount: 1200 }],
        jobs: [
          { class: 'subsistence', count: 300 },
          { class: 'labor', count: 100 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Farming',
        description: 'Machinery raises yields with fewer, more skilled hands — but consumes minerals for equipment.',
        inputs: [{ good: 'minerals', amount: 120 }],
        outputs: [{ good: 'food', amount: 1900 }],
        jobs: [
          { class: 'subsistence', count: 100 },
          { class: 'labor', count: 90 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },
  mine: {
    id: 'mine',
    label: 'Mine',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Pick & Shovel',
        description: 'Labor-intensive extraction. No inputs, modest yield.',
        inputs: [],
        outputs: [{ good: 'minerals', amount: 600 }],
        jobs: [{ class: 'labor', count: 300 }],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Extraction',
        description: 'Drilling rigs lift output sharply, run on consumer-grade equipment and a skilled crew.',
        inputs: [{ good: 'consumerGoods', amount: 90 }],
        outputs: [{ good: 'minerals', amount: 1050 }],
        jobs: [
          { class: 'labor', count: 160 },
          { class: 'technical', count: 120 },
        ],
      },
    ],
  },
  factory: {
    id: 'factory',
    label: 'Factory',
    category: 'industry',
    methods: [
      {
        id: 'manual',
        label: 'Assembly Line',
        description: 'A balanced line of labor and technicians turning minerals into goods.',
        inputs: [{ good: 'minerals', amount: 300 }],
        outputs: [{ good: 'consumerGoods', amount: 800 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 200 },
        ],
      },
      {
        id: 'automated',
        label: 'Automated Line',
        description: 'Automation raises throughput and skill demand, consuming more minerals per run.',
        inputs: [{ good: 'minerals', amount: 380 }],
        outputs: [{ good: 'consumerGoods', amount: 1150 }],
        jobs: [
          { class: 'labor', count: 90 },
          { class: 'technical', count: 240 },
          { class: 'professional', count: 60 },
        ],
      },
    ],
  },
  clinic: {
    id: 'clinic',
    label: 'Clinic',
    category: 'healthcare',
    methods: [
      {
        id: 'manual',
        label: 'General Practice',
        description: 'Technicians and physicians providing basic care from consumer supplies.',
        inputs: [{ good: 'consumerGoods', amount: 200 }],
        outputs: [{ good: 'medicine', amount: 400 }],
        jobs: [
          { class: 'technical', count: 100 },
          { class: 'professional', count: 100 },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced Medicine',
        description: 'A specialist-heavy hospital producing far more care from a larger supply bill.',
        inputs: [{ good: 'consumerGoods', amount: 300 }],
        outputs: [{ good: 'medicine', amount: 680 }],
        jobs: [
          { class: 'technical', count: 120 },
          { class: 'professional', count: 190 },
        ],
      },
    ],
  },
}

// The production method a building is currently running (falling back to the
// recipe's default), plus a plain lookup for a specific method id. Centralised
// so the tick loop and the UI resolve methods the same way.
export function defaultMethodId(recipeId: string): string {
  return RECIPES[recipeId]?.methods[0]?.id ?? ''
}

export function getMethod(recipeId: string, methodId: string | undefined): ProductionMethod | undefined {
  const recipe = RECIPES[recipeId]
  if (!recipe) return undefined
  return recipe.methods.find((m) => m.id === methodId) ?? recipe.methods[0]
}
