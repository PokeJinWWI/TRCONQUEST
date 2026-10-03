// One economy advance as a PURE function: the loop economyStore.advance used to
// run inline, lifted out so it can run anywhere. No React, DOM, Three or
// zustand: the Web Worker (economyWorker.ts), the Node tests and the
// synchronous fallback (state/economyEngine.ts) all call exactly this, so they
// cannot disagree. Everything it needs comes in through `EconomyStepInput`
// (plain, structured-clonable data: a function such as `atWar` cannot cross a
// worker boundary, so the wars come as a list of pairs), and everything it
// produces goes out through `EconomyStepOutput`.
import { tickEconomy } from './economyTick'
import type { Bank, CentralBankEvent, Corporation, Country, CountryFiscal, MonetaryAggregates, World, WorldReport } from './economyTypes'
import type { TradePolicy } from '../data/tradePolicyData'

// One sampled point of a country's headline fiscal metrics, appended each tick
// — the series the finance graphs plot.
export interface FiscalSample {
  gdp: number
  priceLevel: number
  inflation: number
  revenue: number
  expenditure: number
  debtToGdp: number
  treasury: number
  // More headline series for the Economy Overview and Central Bank graphs.
  // Optional so older samples (and anything building one by hand) still fit.
  balance?: number
  debt?: number
  population?: number // millions — for GDP per capita
  unemployment?: number // share of the labour force without a job, across the country's worlds
  policyRate?: number
  realRate?: number
  inflationExpectation?: number
  outputGap?: number
  baseMoney?: number
  broadMoney?: number
  loans?: number
  deposits?: number
  exchangeRate?: number
  pegTarget?: number
  fxReserves?: number
  credibility?: number
}

// Unemployment across a country's worlds: 1 − employed / labour force. The
// labour force is the working classes plus the subsistence class's formal
// jobholders; subsistence people without a formal job are the informal sector
// (self-provision, the grey economy), not unemployed — counting them read as
// 60% unemployment on worlds whose working classes were nearly all in work.
// Investors hold no jobs and aren't in it.
export function unemploymentOf(countryId: string, worlds: World[], worldReports: Record<string, WorldReport>): number {
  let force = 0
  let employed = 0
  for (const w of worlds) {
    if (w.ownerId !== countryId) continue
    const labor = worldReports[w.id]?.labor
    if (!labor) continue
    for (const [cls, l] of Object.entries(labor)) {
      if (cls === 'investor') continue
      const inWork = l.workers * l.employmentRate
      force += cls === 'subsistence' ? inWork : l.workers
      employed += inWork
    }
  }
  return force > 0 ? Math.max(0, 1 - employed / force) : 0
}

export function sampleOf(f: CountryFiscal, country?: Country, money?: MonetaryAggregates, unemployment?: number): FiscalSample {
  const cb = country?.centralBank
  return {
    gdp: f.gdp,
    priceLevel: f.priceLevel,
    inflation: f.inflation,
    revenue: f.revenue,
    expenditure: f.expenditure,
    debtToGdp: f.debtToGdp,
    treasury: f.treasury,
    balance: f.balance,
    debt: f.debt,
    population: f.population,
    unemployment,
    policyRate: f.policyRate,
    realRate: f.realRate,
    inflationExpectation: f.inflationExpectation,
    outputGap: f.outputGap,
    baseMoney: money?.baseMoney,
    broadMoney: money?.broadMoney,
    loans: money?.loans,
    deposits: money?.deposits,
    exchangeRate: country?.currency?.rate,
    pegTarget: cb && cb.exchangeRegime !== 'float' ? country?.currency?.target : undefined,
    fxReserves: cb?.fxReserves,
    credibility: cb?.credibility,
  }
}


export const HISTORY_LENGTH = 104
// A catch-up never runs more than this many months in one request.
export const MAX_CATCH_UP_TICKS = 40

export interface EconomyStepInput {
  countries: Country[]
  worlds: World[]
  corporations: Corporation[]
  banks: Bank[]
  // The store's tick counter when the request was made; the steps are
  // startTick + 1 ... startTick + steps.
  startTick: number
  steps: number
  // The human-controlled nations: never driven by the country AI.
  humanCountryIds: string[]
  // Every pair of nations at war, as pairKey strings (data/diplomacyData.pairKey).
  warPairs: string[]
  // Which nations can reach each other (goods and capital, economy/
  // internationalTrade and foreignInvestmentAI): nation id -> reach group, and two
  // nations deal only within a group. A nation with no entry is in the shared
  // 'core' group (the original four, as always). Absent = everyone reaches
  // everyone.
  tradeGroups?: Record<string, string>
  // --- Trade policy (state/tradePolicyStore.ts), serialized for the worker. ---
  // Each nation's tariff/subvention schedule by good id; absent = none.
  tradePolicies?: Record<string, TradePolicy>
  // Pairs (pairKey strings) under a blanket embargo — no trade at all.
  embargoPairs?: string[]
  // Pairs (pairKey strings) in a shared market — trade tariff-free.
  sharedMarketPairs?: string[]
  // Body names with a completed orbital space-elevator tether (starbase module):
  // a paired ground anchor there gives fuel-free launch (economy/transport.ts).
  tetheredBodyNames?: string[]
  // Extra national interstellar (merchant-marine) capacity from starbase
  // trade-hub modules, by country id.
  interstellarBonusByCountry?: Record<string, number>
}

export interface EconomyStepOutput {
  countries: Country[]
  worlds: World[]
  corporations: Corporation[]
  banks: Bank[]
  tick: number
  // The LAST step's reports (what the panels show).
  worldReports: Record<string, WorldReport>
  countryReports: Record<string, CountryFiscal>
  moneyReports: Record<string, MonetaryAggregates>
  // Every step's central-banking events, oldest first.
  events: CentralBankEvent[]
  // One fiscal sample per step per country, oldest first.
  samples: Record<string, FiscalSample[]>
}

const pairKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function runEconomySteps(input: EconomyStepInput): EconomyStepOutput {
  const wars = new Set(input.warPairs)
  const atWar = (a: string, b: string) => a !== b && wars.has(pairKeyOf(a, b))
  const groups = input.tradeGroups
  const canTrade = groups ? (a: string, b: string) => (groups[a] ?? 'core') === (groups[b] ?? 'core') : undefined
  const policies = input.tradePolicies
  const tariffRate = policies ? (buyer: string, good: string) => policies[buyer]?.tariffs[good] ?? 0 : undefined
  const importSubvention = policies ? (buyer: string, good: string) => policies[buyer]?.importSubventions[good] ?? 0 : undefined
  const exportSubvention = policies ? (seller: string, good: string) => policies[seller]?.exportSubventions[good] ?? 0 : undefined
  const embargoes = input.embargoPairs ? new Set(input.embargoPairs) : undefined
  const embargoed = embargoes ? (a: string, b: string) => embargoes.has(pairKeyOf(a, b)) : undefined
  const sharedPairs = input.sharedMarketPairs ? new Set(input.sharedMarketPairs) : undefined
  const sharedMarket = sharedPairs ? (a: string, b: string) => sharedPairs.has(pairKeyOf(a, b)) : undefined
  const tetheredBodies = input.tetheredBodyNames ? new Set(input.tetheredBodyNames) : undefined
  const interstellarByCountry = input.interstellarBonusByCountry
  const interstellarBonus = interstellarByCountry ? (id: string) => interstellarByCountry[id] ?? 0 : undefined
  let { countries, worlds, corporations, banks } = input
  let worldReports: Record<string, WorldReport> = {}
  let countryReports: Record<string, CountryFiscal> = {}
  let moneyReports: Record<string, MonetaryAggregates> = {}
  const events: CentralBankEvent[] = []
  const samples: Record<string, FiscalSample[]> = {}
  for (let i = 0; i < input.steps; i++) {
    const res = tickEconomy(countries, worlds, corporations, { humanCountryIds: input.humanCountryIds, tick: input.startTick + i + 1, enableAI: true, atWar, canTrade, embargoed, sharedMarket, tariffRate, importSubvention, exportSubvention, tetheredBodies, interstellarBonus }, banks)
    countries = res.countries
    worlds = res.worlds
    corporations = res.corporations
    banks = res.banks
    worldReports = res.reports.worlds
    countryReports = res.reports.countries
    moneyReports = res.reports.money
    events.push(...res.reports.events)
    for (const c of countries) (samples[c.id] ??= []).push(sampleOf(countryReports[c.id], c, moneyReports[c.id], unemploymentOf(c.id, worlds, worldReports)))
  }
  return { countries, worlds, corporations, banks, tick: input.startTick + input.steps, worldReports, countryReports, moneyReports, events, samples }
}
