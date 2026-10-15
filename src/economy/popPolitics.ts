// What pops want and how they feel about it (pure; shared by both economies): wealth levels, the standard of living people EXPECT, their
// political strength, and whether they are loyalists, neutral or radicals. A pop is never both loyalists and radicals: `Pop.loyalty` is one
// number from -1 (all radicals) to +1 (all loyalists) that moves a step a month, so a pop changes its mind gradually and through neutral.
import { workforceOf } from './popRules'
import { CLASS_QUALIFICATION, type PopClass } from './recipes'

// ---- wealth levels -------------------------------------------------------------------------------------------------------------------

export const MAX_WEALTH_LEVEL = 30
// Per-person wealth -> a level from 1 up: each level is a third of a doubling, so it keeps meaning from the destitute to the rich.
export function wealthLevel(wealth: number, populationMillions: number): number {
  const perPerson = populationMillions > 0 ? Math.max(0, wealth) / populationMillions : 0
  return Math.max(1, Math.min(MAX_WEALTH_LEVEL, 1 + Math.floor(3 * Math.log2(1 + perPerson))))
}

// ---- expectations --------------------------------------------------------------------------------------------------------------------

// The standard of living a pop expects: it rises with literacy (the literate know what is possible). 0.5 at a literacy of 0.5.
export const EXPECTED_SOL_PER_LITERACY = 0.3
export const expectedSoL = (literacy: number): number => 0.5 + EXPECTED_SOL_PER_LITERACY * (literacy - 0.5)

// ---- political strength ----------------------------------------------------------------------------------------------------------------

// Not one-person-one-vote: richer, higher-status classes carry more clout. Dependents are politically unaligned and add nothing.
export const CLASS_POLITICAL_WEIGHT: Record<PopClass, number> = { subsistence: 0.5, labor: 1, technical: 1.5, professional: 2.5, investor: 4, political: 3 }
export const WEALTH_CLOUT_REFERENCE = 4 // per-person wealth at which the clout bonus is +100%
export const MAX_WEALTH_CLOUT = 2
export function politicalStrength(pop: { class: PopClass; populationSize: number; wealth: number; workforceShare?: number }, acceptance = 1): number {
  const perPerson = pop.populationSize > 0 ? pop.wealth / pop.populationSize : 0
  const wealthMult = 1 + Math.min(MAX_WEALTH_CLOUT, perPerson / WEALTH_CLOUT_REFERENCE)
  return workforceOf(pop) * CLASS_POLITICAL_WEIGHT[pop.class] * wealthMult * acceptance
}

// ---- loyalists, neutrals, radicals -----------------------------------------------------------------------------------------------------

// How far (in standard of living) a pop must be from what it expects before its mood moves, and how fast it moves.
export const MOOD_DEADBAND = 0.05
export const LOYALTY_STEP = 0.04
export const MOOD_FULL = 0.2 // the shortfall that moves a pop at the full step

export const loyaltyOf = (pop: { loyalty?: number }): number => pop.loyalty ?? 0
export const radicalShare = (pop: { loyalty?: number }): number => Math.max(0, -loyaltyOf(pop))
export const loyalistShare = (pop: { loyalty?: number }): number => Math.max(0, loyaltyOf(pop))

// One month of mood: standard of living above expectations raises loyalty, below lowers it; inside the dead band nothing moves.
// `grievance` is anything else that angers a pop (discrimination, a war's taxes), in the same units as the standard of living.
export function stepLoyalty(loyalty: number, standardOfLiving: number, literacy: number, grievance = 0): number {
  const mood = standardOfLiving - expectedSoL(literacy) - grievance
  if (Math.abs(mood) <= MOOD_DEADBAND) return loyalty
  const push = Math.max(-1, Math.min(1, (mood - Math.sign(mood) * MOOD_DEADBAND) / MOOD_FULL))
  return Math.max(-1, Math.min(1, loyalty + LOYALTY_STEP * push))
}

// Radicals strike, sabotage and slow work down: a world with every pop radical makes this much less (a calm one loses nothing).
export const TURMOIL_OUTPUT_LOSS = 0.12

// A world's or nation's turmoil: the people-weighted share of radicals.
export function turmoilOf(pops: readonly { populationSize: number; loyalty?: number }[]): number {
  let total = 0
  let radicals = 0
  for (const p of pops) {
    total += p.populationSize
    radicals += p.populationSize * radicalShare(p)
  }
  return total > 0 ? radicals / total : 0
}

// Whether a class could be expected to be moved by schooling alone (a hint the Society menu shows next to literacy).
export const REQUIRED_LITERACY = (cls: PopClass): number => CLASS_QUALIFICATION[cls]

// Simple mode has no pops to carry a mood: a stratum's mood is read straight off its happiness (derived, never stored), so both modes
// show the same words. Radical below 40% happy, loyalist above 60%.
export const SIMPLE_RADICAL_BELOW = 0.4
export const SIMPLE_LOYAL_ABOVE = 0.6
export const simpleRadicals = (happiness: number): number => Math.max(0, Math.min(1, (SIMPLE_RADICAL_BELOW - happiness) / SIMPLE_RADICAL_BELOW))
export const simpleLoyalists = (happiness: number): number => Math.max(0, Math.min(1, (happiness - SIMPLE_LOYAL_ABOVE) / (1 - SIMPLE_LOYAL_ABOVE)))
