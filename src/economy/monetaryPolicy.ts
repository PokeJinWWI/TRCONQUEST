// Monetary transmission + inflation (design: Central Banking System, Stage 4).
// This is where the policy levers finally reach the real economy — with LAGS,
// not instantly. The chain: the policy rate (relative to neutral) and money/
// credit growth set a demand impulse; a lagged OUTPUT GAP responds to it; the
// gap plus imported inflation (currency depreciation), monetary deficit
// financing, and inertia feed a lagged INFLATION rate; expectations drift toward
// actual inflation, anchored by credibility. An INDEPENDENT bank then reacts —
// a mandate-weighted Taylor rule nudges its policy rate toward stabilizing
// inflation and the gap — while a GOVERNMENT-CONTROLLED bank does NOT auto-react
// (the government holds the rate where it set it, so a development bank that
// keeps rates low and prints money runs inflation hot: a real tradeoff).
//
// Because the response is lagged and multi-source, there is no "raise rates =
// fix inflation" button: a supply/imported shock or fiscal financing can lift
// inflation even as the bank tightens. Pure/headless like the rest.

import type { CentralBankEvent, Country, MonetaryAggregates, TickReports } from './economyTypes'
import { centralBankMandateDef, governmentControlsPolicy, hasCentralBank, monetaryFinancingCap } from './centralBank'

// Thresholds for the political/crisis events (Stage 5).
const INFLATION_CRISIS = 0.15 // annualized inflation above this is a crisis
const DEPRECIATION_CRISIS = 0.06 // a one-tick currency drop this large is a crisis
const GOVERNORS = ['Gov. Sana Ridley', 'Gov. Piotr Wale', 'Gov. Amara Osei', 'Chair Nils Brandt', 'Gov. Yuki Tanaka', 'Gov. Rosa Delacroix', 'Gov. Idris Kane', 'Chair Wen Li']
function pickGovernor(seed: number): string {
  return GOVERNORS[Math.abs(seed) % GOVERNORS.length]
}

const TICKS_PER_YEAR = 12

// The rate the bank treats as neither stimulative nor contractionary.
const NEUTRAL_RATE = 0.03

// Demand impulse: how a real-rate gap and money growth push the output gap.
const DEMAND_SENS = 2.5 // per unit of (neutral − real rate)
const MONEY_SENS = 1.2 // per unit of per-tick broad-money growth
const GAP_SPEED = 0.15 // output gap lags toward its impulse (transmission lag #1)

// Inflation pressures and how fast inflation tracks them (transmission lag #2).
const DEMAND_INFL = 0.5 // output gap → demand-pull inflation
const IMPORT_INFL = 0.35 // currency depreciation → imported inflation
const FIN_INFL = 0.25 // monetary deficit financing → inflation
const INFL_SPEED = 0.2
const EXP_SPEED = 0.15 // expectations drift toward actual, scaled by (1 − credibility)
const INFLATION_NORM = 0.02 // the "well-anchored" inflation level

// The bank's reaction function (Taylor rule), applied only to a bank that runs
// its own policy (an independent bank).
const TAYLOR_INFL = 1.5
const TAYLOR_GAP = 0.5
const RATE_ADJ_SPEED = 0.2 // the policy rate moves gradually toward its target
const RATE_MIN = 0
const RATE_MAX = 0.25

// Credit-conditions feedback into real investment: loose money (a positive gap)
// grows the investment pool, tight money restrains it.
const INVEST_FEEDBACK = 0.03

// Credibility drifts toward a level set by how near inflation sits to the norm.
const CRED_SPEED = 0.03

// One country's monetary state — carried on Country.monetary. Evolves each tick.
export interface MonetaryState {
  inflation: number // modeled annualized inflation (drives fiscal.inflation now)
  expectation: number // inflation expectations
  outputGap: number // demand pressure, roughly [-0.2, 0.2] (loose money → positive)
  neutralRate: number // the bank's estimate of the neutral policy rate
  lastBroadMoney: number // previous tick's broad money, for the growth term
  lastRate: number // previous tick's exchange rate, for the imported-inflation term
}

export function defaultMonetaryState(): MonetaryState {
  return { inflation: 0.02, expectation: 0.02, outputGap: 0, neutralRate: NEUTRAL_RATE, lastBroadMoney: 0, lastRate: 0 }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

// Append an event to the tick reports, capped so a single tick can't flood the
// log even if many nations hit a crisis at once.
function pushEvent(reports: TickReports, e: CentralBankEvent): void {
  if (reports.events.length < 24) reports.events.push(e)
}

// Advance the monetary/transmission state of every country one tick. Reads this
// tick's money aggregates and fiscal report; returns updated countries (monetary
// state, and — as a real consequence — the policy rate for an independent bank,
// credibility, currency-in-circulation and treasury from monetary financing, and
// the investment pool from credit conditions), and PATCHES the per-country fiscal
// report with the modeled inflation and the monetary readout. Pure w.r.t. inputs
// except that it fills reports.countries[id] monetary fields (reports is the
// tick's own mutable output).
export function tickMonetary(
  countries: Country[],
  money: Record<string, MonetaryAggregates>,
  reports: TickReports,
  tick = 0,
  humanCountryIds: readonly string[] = [],
): Country[] {
  const humans = new Set(humanCountryIds)
  return countries.map((country) => {
    const cb = country.centralBank
    const fiscal = reports.countries[country.id]
    if (!hasCentralBank(cb) || !cb || !fiscal) return country
    const ms = country.monetary ?? defaultMonetaryState()

    const broadMoney = money[country.id]?.broadMoney ?? 0
    const moneyGrowth = ms.lastBroadMoney > 0 ? broadMoney / ms.lastBroadMoney - 1 : 0
    const rate = country.currency?.rate ?? 1
    // Depreciation this tick (currency weaker than last tick → positive).
    const depreciation = ms.lastRate > 0 ? Math.max(0, ms.lastRate / rate - 1) : 0

    // Monetary deficit financing: under a permissive debt-financing regime the CB
    // may fund a share of the deficit by creating base money — the government gets
    // the cash, at an inflation and credibility cost.
    const cap = monetaryFinancingCap(cb)
    const deficit = Math.max(0, -fiscal.balance)
    const monetaryFinanced = deficit * cap
    const annualGdp = Math.max(1, fiscal.gdp * TICKS_PER_YEAR)

    // 1. Demand impulse → lagged output gap.
    const realRate = cb.policyRate - ms.expectation
    const impulse = (ms.neutralRate - realRate) * DEMAND_SENS + moneyGrowth * MONEY_SENS
    const outputGap = clamp(ms.outputGap + (impulse - ms.outputGap) * GAP_SPEED, -0.25, 0.25)

    // 2. Inflation pressures → lagged inflation, around expectations.
    const demandInfl = DEMAND_INFL * outputGap
    const importedInfl = IMPORT_INFL * depreciation
    const financeInfl = FIN_INFL * (monetaryFinanced / annualGdp)
    const inflationTarget = ms.expectation + demandInfl + importedInfl + financeInfl
    const inflation = ms.inflation + (inflationTarget - ms.inflation) * INFL_SPEED

    // 3. Expectations drift toward actual, less anchored the lower the credibility.
    const expectation = ms.expectation + (inflation - ms.expectation) * (1 - cb.credibility) * EXP_SPEED

    // 4. Credibility drifts toward a level set by distance from the inflation norm.
    const credTarget = clamp(0.9 - Math.abs(inflation - INFLATION_NORM) * 6, 0, 0.95)
    const credibility = clamp(cb.credibility + (credTarget - cb.credibility) * CRED_SPEED, 0, 1)

    // 5. Rate setting.
    //    - An INDEPENDENT bank moves its own rate (mandate-weighted Taylor rule),
    //      whoever runs the country — that is what independence means.
    //    - A GOVERNMENT-controlled bank in a NON-PLAYER nation is steered by the
    //      AI monetary manager: a development-minded government keeps rates low
    //      (tolerating inflation) but even it eventually leans against a runaway;
    //      a price/currency-minded one fights inflation harder.
    //    - A government-controlled bank in a PLAYER nation is left where the human
    //      set it — the player owns that decision (and its consequences).
    const w = centralBankMandateDef(cb.mandate).weights
    let policyRate = cb.policyRate
    if (!governmentControlsPolicy(cb)) {
      const inflGap = inflation - INFLATION_NORM
      const desired = ms.neutralRate + expectation + TAYLOR_INFL * w.inflation * inflGap - TAYLOR_GAP * w.employment * outputGap
      policyRate = clamp(cb.policyRate + (desired - cb.policyRate) * RATE_ADJ_SPEED, RATE_MIN, RATE_MAX)
    } else if (!humans.has(country.id)) {
      const inflGap = inflation - INFLATION_NORM
      const reactStrength = 0.3 + 0.9 * Math.max(w.inflation, w.currency)
      const desired = ms.neutralRate + reactStrength * inflGap - 0.02 * w.development
      policyRate = clamp(cb.policyRate + (desired - cb.policyRate) * RATE_ADJ_SPEED * 0.6, RATE_MIN, RATE_MAX)
    }

    // 6. Real-economy feedback: credit conditions nudge the investment pool.
    const investmentPool = Math.max(0, country.investmentPool * (1 + outputGap * INVEST_FEEDBACK))

    // 7. Monetary financing credits the treasury and expands base money.
    const treasury = country.treasury + monetaryFinanced
    const currencyInCirculation = cb.currencyInCirculation + monetaryFinanced

    // 8. Governor term: when it expires, a new governor is appointed (Stage 5).
    let governorName = cb.governorName
    let governorTermStart = cb.governorTermStart
    if (tick > 0 && tick - cb.governorTermStart >= cb.governorTermLength) {
      governorName = pickGovernor(tick + country.id.length)
      governorTermStart = tick
      pushEvent(reports, { id: `gov-${tick}-${country.id}`, tick, countryId: country.id, kind: 'governor-appointed', text: `${governorName} was appointed to head ${cb.name}.` })
    }

    // 9. Crisis events (throttled by crossing a threshold, not per tick).
    if (inflation > INFLATION_CRISIS && ms.inflation <= INFLATION_CRISIS) {
      pushEvent(reports, { id: `infl-${tick}-${country.id}`, tick, countryId: country.id, kind: 'inflation-crisis', text: `Inflation crisis in ${country.id}: prices rising ${(inflation * 100).toFixed(0)}%/yr.` })
    }
    if (depreciation > DEPRECIATION_CRISIS) {
      const kind = cb.exchangeRegime !== 'float' && cb.fxReserves <= 0 ? 'peg-broken' : 'currency-crisis'
      pushEvent(reports, { id: `cur-${tick}-${country.id}`, tick, countryId: country.id, kind, text: kind === 'peg-broken' ? `${country.currency?.code ?? country.id}'s peg broke — the currency is devaluing.` : `${country.currency?.code ?? country.id} fell ${(depreciation * 100).toFixed(0)}% this month.` })
    }

    // Patch the fiscal report with the modeled inflation + monetary readout.
    reports.countries[country.id] = {
      ...fiscal,
      inflation,
      policyRate,
      realRate,
      inflationExpectation: expectation,
      outputGap,
      monetaryFinanced,
    }

    return {
      ...country,
      treasury,
      investmentPool,
      centralBank: { ...cb, policyRate, credibility, currencyInCirculation, governorName, governorTermStart },
      monetary: { inflation, expectation, outputGap, neutralRate: ms.neutralRate, lastBroadMoney: broadMoney, lastRate: rate },
    }
  })
}

