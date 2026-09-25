// The Abstract-Simplistic economy (Stellaris/HOI4/TNO-Requiem-inspired) — a
// single macro model per nation, chosen at the main menu. No pops-as-consumers
// market, no per-good prices, no banking: one set of national numbers, a
// production pool the player allocates, a budget, and a stability stat.
//
// Pure and headless (no store/DOM), like src/economy/*. The store
// (state/abstractEconomyStore.ts) wraps it; the clock advances it.

export type EconomyType = 'market' | 'corporatist' | 'planned'
export const ECONOMY_TYPES: EconomyType[] = ['market', 'corporatist', 'planned']

export type CreditRating = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC'

// How the national production pool is split (fractions, normalized to sum to 1).
export interface Allocation {
  civilian: number // construction & investment (grows GDP, builds things)
  military: number // military output (equipment/alloys for the war machine)
  consumer: number // consumer goods for the population (keeps stability up)
}

export interface AbstractEconomyState {
  countryId: string
  // TNO-style aggregate population (millions) — a workforce and a source of
  // consumer demand, not a per-pop simulation.
  population: number
  gdp: number // national output, in abstract $B
  inflation: number // annualized fraction
  stability: number // 0..1 — order/contentment; consumer shortfalls erode it
  // Fiscal
  treasury: number // cash on hand, $B
  reserves: number // a savings buffer built in good times (Invest); spent on debt or crises
  debt: number // national debt, $B
  taxRate: number // 0..1 policy
  // Policies
  economyType: EconomyType
  moneyCreation: number // 0..1 — share of any deficit covered by printing money (rest is borrowed); printing spikes inflation
  warTaxes: boolean // emergency revenue at a stability cost
  // Player-set production split.
  allocation: Allocation
}

// The debt ceiling as a multiple of GDP, from the credit rating — borrowing past
// it tips the nation toward fiscal crisis.
export function debtCeiling(rating: CreditRating): number {
  const byRating: Record<CreditRating, number> = { AAA: 1.6, AA: 1.5, A: 1.4, BBB: 1.2, BB: 1.0, B: 0.8, CCC: 0.6 }
  return byRating[rating]
}
const WAR_TAX_REVENUE = 0.25 // war taxes add this fraction to revenue
const WAR_TAX_STABILITY = 0.08 // …at this standing stability cost

// Per-tick diagnostics for the UI (not stored).
export interface AbstractReport {
  productionUnits: number
  civilianProduction: number
  militaryProduction: number
  consumerProduction: number
  consumerDemand: number
  consumerBalance: number // surplus (+) or shortfall (−)
  revenue: number
  spending: number
  balance: number // annual budget balance (revenue − spending)
  deficitPctGdp: number // balance as a share of GDP (negative = deficit)
  realGrowth: number // annualized real GDP growth
  nominalGrowth: number
  debtToGdp: number
  debtCeilingPct: number // ceiling as % of GDP
  rating: CreditRating
  // Revenue breakdown (display) — income / business / excise / other.
  revIncome: number
  revBusiness: number
  revExcise: number
  revOther: number
  // Expenditure breakdown — military / civil / debt-service / other.
  expMilitary: number
  expCivil: number
  expDebt: number
  expOther: number
}

// --- Balance constants ------------------------------------------------------
const PRODUCTION_PER_GDP = 0.5 // production units the economy can field, relative to GDP
const CONSUMER_PER_CAPITA = 0.28 // consumer-goods units one unit of population demands
const TAX_YIELD = 1.0 // scales tax revenue off GDP
const BASE_SPEND_PER_POP = 0.02 // baseline public spending per unit population
const MILITARY_UPKEEP = 0.25 // spending per unit of military production maintained
const DEBT_SERVICE_RATE = 0.05 // annual interest on debt
const BASE_GROWTH = 0.015 // baseline annual nominal growth
const INVEST_GROWTH = 0.25 // growth per unit of (civilian production / GDP)
const STAB_GROWTH = 0.04 // growth swing from stability around 0.5
const STAB_SPEED = 0.15 // how fast stability tracks its target
const PRINT_INFLATION = 0.8 // inflation added per (printed / GDP)
const INFLATION_DECAY = 0.1 // inflation mean-reversion per tick
const POP_GROWTH = 0.012 // baseline annual population growth (× stability factor)
const TICKS_PER_YEAR = 12

// Economy-type modifiers (TNO capitalism/corporatism/planned).
const TYPE_MODS: Record<EconomyType, { production: number; growth: number; stability: number; taxYield: number }> = {
  market: { production: 1.1, growth: 1.15, stability: -0.05, taxYield: 0.9 },
  corporatist: { production: 1.0, growth: 1.0, stability: 0.05, taxYield: 1.0 },
  planned: { production: 0.9, growth: 0.85, stability: 0.1, taxYield: 1.15 },
}
export function economyTypeLabel(t: EconomyType): string {
  return t === 'market' ? 'Market' : t === 'corporatist' ? 'Corporatist' : 'Planned'
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function creditRating(debtToGdp: number): CreditRating {
  if (debtToGdp < 0.3) return 'AAA'
  if (debtToGdp < 0.6) return 'AA'
  if (debtToGdp < 0.9) return 'A'
  if (debtToGdp < 1.2) return 'BBB'
  if (debtToGdp < 1.6) return 'BB'
  if (debtToGdp < 2.2) return 'B'
  return 'CCC'
}

// Normalize an allocation to sum to 1 (guarding against a zero/degenerate set).
export function normalizeAllocation(a: Allocation): Allocation {
  const sum = a.civilian + a.military + a.consumer
  if (sum <= 0) return { civilian: 1 / 3, military: 1 / 3, consumer: 1 / 3 }
  return { civilian: a.civilian / sum, military: a.military / sum, consumer: a.consumer / sum }
}

// The macro numbers a UI reads, derived from the current state (no evolution).
export function abstractReport(s: AbstractEconomyState): AbstractReport {
  const mods = TYPE_MODS[s.economyType]
  const alloc = normalizeAllocation(s.allocation)
  const stabilityMult = 0.6 + 0.4 * s.stability
  const P = Math.max(0, s.gdp * PRODUCTION_PER_GDP * mods.production * stabilityMult)
  const civ = P * alloc.civilian
  const mil = P * alloc.military
  const con = P * alloc.consumer
  const demand = s.population * CONSUMER_PER_CAPITA
  const baseRevenue = s.taxRate * s.gdp * TAX_YIELD * mods.taxYield
  const revenue = baseRevenue * (s.warTaxes ? 1 + WAR_TAX_REVENUE : 1)
  const expMilitary = MILITARY_UPKEEP * mil
  const expDebt = DEBT_SERVICE_RATE * s.debt
  const expCivil = BASE_SPEND_PER_POP * s.population * 0.6
  const expOther = BASE_SPEND_PER_POP * s.population * 0.4
  const spending = expMilitary + expDebt + expCivil + expOther
  const investRate = s.gdp > 0 ? civ / s.gdp : 0
  const nominalGrowth = (BASE_GROWTH + INVEST_GROWTH * investRate + STAB_GROWTH * (s.stability - 0.5)) * mods.growth
  const debtToGdp = s.gdp > 0 ? s.debt / s.gdp : 0
  const rating = creditRating(debtToGdp)
  const balance = revenue - spending
  return {
    productionUnits: P,
    civilianProduction: civ,
    militaryProduction: mil,
    consumerProduction: con,
    consumerDemand: demand,
    consumerBalance: con - demand,
    revenue,
    spending,
    balance,
    deficitPctGdp: s.gdp > 0 ? balance / s.gdp : 0,
    realGrowth: nominalGrowth - s.inflation,
    nominalGrowth,
    debtToGdp,
    debtCeilingPct: debtCeiling(rating),
    rating,
    // Revenue split (display): income 55% / business 20% / excise 20% / other 5%.
    revIncome: revenue * 0.55,
    revBusiness: revenue * 0.2,
    revExcise: revenue * 0.2,
    revOther: revenue * 0.05,
    expMilitary,
    expCivil,
    expDebt,
    expOther,
  }
}

// Advance one nation's abstract economy by one monthly tick. Pure: returns a new
// state. Also returns the report for the UI/AI.
export function tickAbstractEconomy(s: AbstractEconomyState): { state: AbstractEconomyState; report: AbstractReport } {
  const mods = TYPE_MODS[s.economyType]
  const r = abstractReport(s)

  // Stability tracks a target set by the consumer-goods balance and economy type,
  // dragged by inflation and (if enacted) war taxes.
  const relBalance = r.consumerDemand > 0 ? r.consumerBalance / r.consumerDemand : 0
  const stabTarget = clamp(0.5 + 0.5 * relBalance + mods.stability - Math.min(0.3, s.inflation) - (s.warTaxes ? WAR_TAX_STABILITY : 0), 0, 1)
  const stability = clamp(s.stability + (stabTarget - s.stability) * STAB_SPEED, 0, 1)

  // Budget settles into the treasury; a shortfall is part-printed (per the money-
  // creation rate, inflationary) and part-borrowed (adds to debt).
  let treasury = s.treasury + r.balance / TICKS_PER_YEAR
  let debt = s.debt
  let inflation = s.inflation
  if (treasury < 0) {
    const gap = -treasury
    const printed = gap * clamp(s.moneyCreation, 0, 1)
    const borrowed = gap - printed
    inflation += (s.gdp > 0 ? printed / s.gdp : 0) * PRINT_INFLATION
    debt += borrowed
    treasury = 0
  }
  // Pay down a little debt when in surplus.
  if (treasury > 0 && debt > 0 && r.balance > 0) {
    const repay = Math.min(debt, treasury * 0.2)
    debt -= repay
    treasury -= repay
  }
  inflation = Math.max(0, inflation * (1 - INFLATION_DECAY))

  // GDP grows by real growth (monthly).
  const gdp = Math.max(1, s.gdp * (1 + r.realGrowth / TICKS_PER_YEAR))

  // Population grows slowly, scaled by stability and dampened by consumer shortfall.
  const popFactor = (POP_GROWTH * (0.5 + stability)) / TICKS_PER_YEAR
  const population = Math.max(0, s.population * (1 + (r.consumerBalance >= 0 ? popFactor : popFactor - 0.001)))

  return { state: { ...s, gdp, population, inflation, stability, treasury, debt }, report: abstractReport({ ...s, gdp, population, inflation, stability, treasury, debt }) }
}
