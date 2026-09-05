// Currencies + foreign exchange (design: Central Banking System, Stage 3 — full
// multi-currency). Every country issues its own currency with a floating (or
// pegged) exchange rate against a common numeraire, the Terra Standard Credit
// (TSC). Domestic economies are unchanged — every treasury, price, wage and cash
// balance is simply reinterpreted as being denominated in that country's own
// currency. The exchange rate matters ONLY where value crosses a border:
// repatriated dividends, buying foreign equity, and cross-border construction
// financing all convert through it here. A country's central bank manages the
// rate per its exchange-rate regime (Stage 1 law), spending FX reserves to
// defend a peg — and a peg it can no longer fund breaks, devaluing and costing
// credibility.
//
// Rate convention: `Currency.rate` is the TSC value of ONE unit of that currency
// (so a stronger currency has a higher rate). To move value from country A to
// country B: amount_B = amount_A * rateA / rateB. Pure/headless.

import type { Country } from './economyTypes'
import { exchangeRateRegimeDef, hasCentralBank, type DebtFinancingRegime } from './centralBank'

export interface Currency {
  name: string
  code: string // short ticker, e.g. 'VNC'
  // TSC value of one unit of this currency. Floats over time; defended toward
  // `target` under a peg/band/managed regime.
  rate: number
  // The rate the central bank steers toward under a non-floating regime (the peg
  // level). Ignored under a free float.
  target: number
}

// --- Rate-pressure model -----------------------------------------------------
// A country's currency drifts on deterministic fundamentals we already track:
// monetary credibility, government pressure on the bank, the debt-financing
// regime (money-printing depreciates), and the policy rate (higher rates attract
// capital and appreciate). This stands in for a full inflation/BoP model until
// Stage 4 wires inflation as a driver; the signs and relative magnitudes are the
// point. A POSITIVE bias means the currency wants to depreciate.
const REF_POLICY_RATE = 0.03
const CRED_WEIGHT = 0.03 // credibility below 0.6 → depreciation pressure
const PRESSURE_WEIGHT = 0.02 // political pressure on the bank weakens the currency
const FINANCING_WEIGHT = 0.03 // monetary financing of the deficit weakens it
const RATE_WEIGHT = 0.3 // a higher policy rate strengthens it (capital inflow)

const FINANCING_BIAS: Record<DebtFinancingRegime, number> = {
  prohibited: -0.1,
  restricted: 0,
  'secondary-only': 0,
  supported: 0.5,
  direct: 1,
}

// How fast the market moves the rate toward its fundamental pull each tick, and
// the per-tick FX-reserve cost of defending a unit of rate gap under a peg.
const FLOAT_SPEED = 0.3
const DEFEND_COST = 150000 // reserve units spent per 1.0 of rate gap defended
const PEG_BREAK_CRED_HIT = 0.06 // credibility lost the tick a peg defense is exhausted
const RATE_FLOOR = 0.1
const RATE_CEIL = 5

// Depreciation bias (positive) or appreciation bias (negative) for a country,
// from its central bank's stance. A country with no central bank is inert.
export function depreciationBias(country: Country): number {
  const cb = country.centralBank
  if (!hasCentralBank(cb) || !cb) return 0
  const credGap = 0.6 - cb.credibility
  const finBias = FINANCING_BIAS[cb.debtFinancing]
  const rateBias = cb.policyRate - REF_POLICY_RATE
  return CRED_WEIGHT * credGap + PRESSURE_WEIGHT * cb.governmentPressure + FINANCING_WEIGHT * finBias - RATE_WEIGHT * rateBias
}

function clampRate(r: number): number {
  return Math.max(RATE_FLOOR, Math.min(RATE_CEIL, r))
}

// Convert an amount from one currency to another given their TSC rates.
export function convert(amount: number, fromRate: number, toRate: number): number {
  if (toRate <= 0) return amount
  return (amount * fromRate) / toRate
}

// Convert between two countries by id, using their currencies. Same country (or
// a missing currency) is a no-op passthrough.
export function convertBetween(amount: number, fromCountryId: string, toCountryId: string, countries: Country[]): number {
  if (fromCountryId === toCountryId) return amount
  const from = countries.find((c) => c.id === fromCountryId)?.currency
  const to = countries.find((c) => c.id === toCountryId)?.currency
  if (!from || !to) return amount
  return convert(amount, from.rate, to.rate)
}

// Advance every country's exchange rate one tick: float toward fundamentals, or
// defend a peg with FX reserves (breaking, and losing credibility, when reserves
// run out). Returns updated countries (currency.rate, and cb.fxReserves/
// credibility patched for defenders). Pure.
export function updateExchangeRates(countries: Country[]): Country[] {
  return countries.map((country) => {
    const cb = country.centralBank
    if (!hasCentralBank(cb) || !cb) return country
    const cur = country.currency
    if (!cur) return country
    const bias = depreciationBias(country)
    // Where the market alone would take the rate this tick.
    const marketPull = cur.rate * (1 - bias)
    const marketRate = cur.rate + (marketPull - cur.rate) * FLOAT_SPEED

    if (cb.exchangeRegime === 'float') {
      return { ...country, currency: { ...cur, rate: clampRate(marketRate) } }
    }

    // Defended regimes steer toward the peg target, spending reserves.
    const defense = exchangeRateRegimeDef(cb.exchangeRegime).defenseIntensity
    const gap = cur.target - marketRate // >0: currency too weak, CB must prop it up (sell FX)
    let fxReserves = cb.fxReserves
    let credibility = cb.credibility
    let newRate: number
    if (gap > 0) {
      // A harder regime holds the rate tighter AND spends more reserves doing so;
      // a managed float leans gently and cheaply.
      const cost = gap * DEFEND_COST * defense
      if (fxReserves >= cost) {
        fxReserves -= cost
        newRate = marketRate + gap * defense
      } else {
        // Reserves exhausted — partial defense, then the peg gives way.
        const frac = cost > 0 ? fxReserves / cost : 0
        newRate = marketRate + gap * defense * frac
        fxReserves = 0
        credibility = Math.max(0, credibility - PEG_BREAK_CRED_HIT)
      }
    } else {
      // Currency stronger than the peg — the CB buys FX (accumulating reserves)
      // and eases it back down. Cheap and self-financing.
      fxReserves += -gap * DEFEND_COST * defense * 0.5
      newRate = marketRate + gap * defense
    }
    return { ...country, currency: { ...cur, rate: clampRate(newRate) }, centralBank: { ...cb, fxReserves, credibility } }
  })
}
