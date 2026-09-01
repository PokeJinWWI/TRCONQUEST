import type { GoodId } from './goods'
import type { NeedTier } from './species'
import type { PopClass } from './recipes'

// A pop cohort — one aggregated agent standing in for thousands-to-millions of
// individuals sharing class/species/culture (design doc Section 1). Milestone
// 1 carries only the fields the economic loop actually reads; culture/religion
// ids are present as data seams for the political layer but nothing branches
// on them yet.
export interface Pop {
  id: string
  class: PopClass
  speciesTemplateId: string
  cultureId: string
  religionId: string
  populationSize: number
  wealth: number
  educationLevel: number
  // 0..1 per tier — how much of each needs tier this pop could actually buy
  // last tick. Drives (eventually) happiness/politics; for now it's the
  // headline "is the economy feeding its people" readout.
  needsSatisfaction: Record<NeedTier, number>
}

export interface Building {
  id: string
  recipeId: string
  // Capacity multiplier on the recipe's inputs/outputs/jobs.
  level: number
  // 0..1 state-owned equity; the remainder is private (distributed to Investor
  // pops as dividends). Corporations, which would hold that private share at
  // scale, are a later milestone.
  stateFraction: number
  // Goods produced but not yet sold, carried between ticks — this inventory IS
  // the market's supply each tick (production this tick lands here for next
  // tick), which is what keeps within-tick supply/demand well-defined instead
  // of circular (see economyTick).
  inventory: Partial<Record<GoodId, number>>
  // Last tick's realized profit, kept for display and dividend distribution.
  lastProfit: number
}

export interface Market {
  prices: Record<GoodId, number>
}

export interface LaborMarket {
  // Market-clearing wage per class, adjusted each tick by job vacancies vs.
  // available workers — same supply/demand nudge the goods market uses.
  wages: Record<PopClass, number>
}

// One planet's whole economy. Per the project owner's steer, a planet is a
// single economic unit (no sub-planet regions/districts) — population capacity
// is just a scalar ceiling, not a surface-area model.
export interface PlanetEconomy {
  // Matches the rendered planet's name (see planetData.ts), e.g. 'Mars', so
  // the UI can find the economy for whatever planet/country is in focus.
  id: string
  name: string
  // Owning country (see countryData.ts); undefined for an unowned economy.
  ownerId?: string
  // Ceiling population growth approaches over time (design doc Section 1) —
  // seeded well above starting population so the sim has somewhere to go.
  populationCapacity: number
  pops: Pop[]
  buildings: Building[]
  market: Market
  labor: LaborMarket
  // State money, accumulated from taxes — the seed of the Budget system.
  treasury: number
  // Flat tax on positive building profit, 0..1.
  taxRate: number
}

export interface EconomyState {
  planets: PlanetEconomy[]
  tick: number
}

// Per-tick diagnostics a caller (tests, UI) can read without re-deriving them
// from the economy — what was demanded/supplied/transacted per good, and the
// labor picture per class. Returned alongside the advanced state so the tick
// stays a pure function of its input.
export interface TickReport {
  goods: Record<
    GoodId,
    { supply: number; demand: number; transacted: number; price: number }
  >
  labor: Record<PopClass, { workers: number; jobs: number; employmentRate: number; wage: number }>
}
