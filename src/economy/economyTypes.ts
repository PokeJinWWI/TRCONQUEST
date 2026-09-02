import type { GoodId } from './goods'
import type { NeedTier } from './species'
import type { PopClass } from './recipes'
import type { EconomicSystem } from './laws'

// A pop cohort — one aggregated agent standing in for a slice of a world's
// population sharing all four social axes: species + culture + religion +
// class (design doc v2, Section 2). Population is in MILLIONS of people (so
// 4000 = 4 billion), displayed with M/B suffixes — no more bare "2.3".
export interface Pop {
  id: string
  class: PopClass
  speciesTemplateId: string
  cultureId: string
  religionId: string
  populationSize: number
  wealth: number
  educationLevel: number
  needsSatisfaction: Record<NeedTier, number>
}

// A queued construction project (see economyTick's construction step) — funded
// from the owning COUNTRY's treasury now, not a per-world one.
export interface ConstructionOrder {
  id: string
  recipeId: string
  cost: number
  progress: number
}

export interface Building {
  id: string
  recipeId: string
  // The production method currently in use (see recipes.ts). Player-switchable
  // on owned worlds; changes inputs, outputs, and the worker mix.
  methodId: string
  // Whether the STATE has pinned this building's method. On a private building
  // that pin is interference: under a market economy it drags output (the
  // economic-system malus, laws.ts). On a state-run building it is just
  // direction, no penalty. When false, a private owner picks the method itself.
  methodLocked: boolean
  level: number
  // State's ownership share, 0 (fully private) .. 1 (fully state-run). At or
  // above STATE_OWNERSHIP_THRESHOLD the state directs the building.
  stateFraction: number
  inventory: Partial<Record<GoodId, number>>
  // Operating rate in [0,1] — how much of full capacity the building is
  // actually running at. It ramps toward what labor, inputs and demand allow
  // rather than snapping there, so profit rises smoothly instead of teleporting
  // (design doc Section 3, "throughput"). Freshly built or newly expanded
  // buildings start low and climb.
  throughput: number
  lastProfit: number
  // Diagnostics for the tick just run (display only): how many people this
  // building actually employs, and how many job slots it posted.
  employed: number
  jobsPosted: number
}

export interface Market {
  prices: Record<GoodId, number>
}

export interface LaborMarket {
  wages: Record<PopClass, number>
}

// A single inhabited world — the LOCAL economy layer. It has pops, buildings, a
// local market and labor market, but NO treasury or tax policy: those belong to
// its owning country (the v1 mistake this restructure fixes).
export interface World {
  // The rendered body's name, e.g. 'Mars' / 'Lalande 21185 d'.
  id: string
  name: string
  // Owning country id (see countryData) — every inhabited world has one.
  ownerId: string
  // The dominant local culture (pops may vary; this is the world's character).
  cultureId: string
  populationCapacity: number
  pops: Pop[]
  buildings: Building[]
  constructionQueue: ConstructionOrder[]
  market: Market
  labor: LaborMarket
}

// A country — the NATIONAL government layer. One treasury, one tax/welfare
// policy, one debt, spanning all the worlds it owns.
export interface Country {
  id: string
  // Player-controllable fiscal policy.
  taxRate: number
  welfarePerCapita: number
  // National cash; negative = national debt.
  treasury: number
  // Economic-system law (laws.ts) — governs owner autonomy and the penalty for
  // the state overriding a private building's production method.
  economicSystem: EconomicSystem
}

export interface EconomyState {
  countries: Country[]
  worlds: World[]
  tick: number
}

// Per-world market/labor diagnostics for a tick.
export interface WorldReport {
  goods: Record<GoodId, { supply: number; demand: number; transacted: number; price: number }>
  // Per class: headcount of pops, qualification-weighted labor actually
  // available (qualified), job slots posted, the resulting employment rate, and
  // the cleared wage. `qualifiedRate` is qualified/workers — how job-ready the
  // class's labor pool is.
  labor: Record<PopClass, { workers: number; qualified: number; qualifiedRate: number; jobs: number; employmentRate: number; wage: number }>
}

export type CreditRating = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC'

// Per-country national fiscal diagnostics for a tick — the numbers the finance
// UI and graphs read.
export interface CountryFiscal {
  gdp: number
  priceLevel: number
  inflation: number
  revenue: number
  welfare: number
  admin: number
  interest: number
  construction: number
  expenditure: number
  balance: number
  treasury: number
  debt: number
  debtToGdp: number
  rating: CreditRating
  population: number
}

export interface TickReports {
  worlds: Record<string, WorldReport>
  countries: Record<string, CountryFiscal>
}
