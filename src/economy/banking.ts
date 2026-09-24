// Commercial banking + the money supply (design: Central Banking System, Stage
// 2). Distinct `Bank` entities with real balance sheets take deposits, hold
// reserves at the central bank, make loans (creating deposits — broad money),
// hold government securities, and borrow from the discount window when short of
// reserves. Their lending is gated by the central bank's reserve requirement and
// their own capital; their margins move with the policy rate. This is where the
// Stage 1 monetary levers (reserveRequirement, policyRate) finally BITE — raising
// the reserve requirement shrinks broad money over the following ticks, a higher
// policy rate widens/narrows bank margins, and a bank left short of reserves
// draws on the central bank.
//
// Deliberately self-contained for Stage 2: the banking system ticks and responds
// to monetary policy, but does NOT yet feed back into pop investment, inflation
// or employment — that transmission is Stage 4. Pure/headless like the rest of
// src/economy/*.

import type { Bank, CentralBankEvent, Country, MonetaryAggregates } from './economyTypes'
import { hasCentralBank, type CentralBank } from './centralBank'

const TICKS_PER_YEAR = 12

// Loan losses in a downturn (Stage 5): when the economy is in a deep recession
// (a strongly negative output gap from the monetary model LAST tick), a fraction
// of loans defaults and is written off — the emergent trigger for banking stress.
const LOSS_GAP_THRESHOLD = 0.1 // no losses until the gap is worse than −10%
const LOAN_LOSS_RATE = 0.25 // of loans, per unit of gap beyond the threshold, annualized
// Bailout: an insolvent bank is recapitalized by the state (lender of last
// resort / resolution) up to this capital ratio, funded from the treasury.
const RECAP_TARGET_RATIO = 0.08

// Interest rates, all annualized, derived from the policy rate.
const LOAN_SPREAD = 0.03 // banks lend at policy + 3%
const DEPOSIT_PASSTHROUGH = 0.5 // depositors get 50% of the policy rate
const SECURITY_YIELD_FRACTION = 0.9 // government bonds yield ~90% of the policy rate
const DISCOUNT_SPREAD = 0.01 // the discount window costs policy + 1% (a penalty rate)

// Balance-sheet dynamics.
const LOAN_AMORTIZATION = 0.03 // 3% of loans repaid each tick (money destruction)
const LENDING_SPEED = 0.4 // fraction of excess reserves deployed into new loans per tick
const CAPITAL_TARGET = 0.08 // a bank keeps capital ≥ 8% of loans (Basel-ish); below = stressed
const DISCOUNT_DRAW_SPEED = 0.5 // fraction of a reserve shortfall covered by CB borrowing per tick
const MIN_RR = 0.01 // floor on the reserve requirement used in the multiplier math

// Commercial-bank equity: assets (reserves + loans + securities) minus
// liabilities (deposits + discount-window borrowings). The buffer that absorbs
// losses and caps how much a bank may lend.
export function bankCapital(b: Bank): number {
  return b.reserves + b.loans + b.securities - b.deposits - b.cbBorrowings
}

export function bankAssets(b: Bank): number {
  return b.reserves + b.loans + b.securities
}

// Capital as a fraction of loans — the ratio banks manage against CAPITAL_TARGET.
export function capitalRatio(b: Bank): number {
  return b.loans > 0 ? bankCapital(b) / b.loans : 1
}

export function lendingRate(policyRate: number): number {
  return policyRate + LOAN_SPREAD
}
export function depositRate(policyRate: number): number {
  return Math.max(0, policyRate * DEPOSIT_PASSTHROUGH)
}
export function discountRate(policyRate: number): number {
  return policyRate + DISCOUNT_SPREAD
}

// Advance one commercial bank by a tick under its central bank's policy. Pure:
// returns a new Bank. Order: earn the net interest margin (retained as reserves),
// amortize loans, deploy excess reserves into new lending (gated by the reserve
// requirement and capital), then reconcile reserves with the discount window.
function tickBank(b: Bank, cb: CentralBank, distressGap: number): Bank {
  const policy = cb.policyRate
  const rr = Math.max(MIN_RR, cb.reserveRequirement)

  let { reserves, loans, securities, deposits, cbBorrowings } = b

  // 1. Net interest margin (annual rates → per tick). Retained earnings sit as
  //    reserves, so both assets and equity move by the profit.
  const income = lendingRate(policy) * loans + policy * SECURITY_YIELD_FRACTION * securities
  const expense = depositRate(policy) * deposits + discountRate(policy) * cbBorrowings
  const interestProfit = (income - expense) / TICKS_PER_YEAR
  reserves += interestProfit // retained earnings sit as reserves

  // 1b. Loan losses in a deep downturn: write off a fraction of loans directly —
  //     the loan ASSET falls, so capital falls with it (the emergent driver of
  //     banking crises). Reserves are untouched (the write-off is not a cash
  //     outflow); the loss shows in lastProfit.
  let losses = 0
  if (distressGap < -LOSS_GAP_THRESHOLD) {
    losses = ((-distressGap - LOSS_GAP_THRESHOLD) * LOAN_LOSS_RATE * loans) / TICKS_PER_YEAR
    loans = Math.max(0, loans - losses)
  }
  const profit = interestProfit - losses

  // 2. Loan amortization — borrowers repay from their deposits (money destroyed).
  const repaid = loans * LOAN_AMORTIZATION
  loans -= repaid
  deposits = Math.max(0, deposits - repaid)

  // 3. New lending out of EXCESS reserves, capped by the capital requirement.
  //    Lending creates a matching deposit at the bank (broad-money creation),
  //    which raises required reserves and self-limits the expansion over ticks.
  const requiredReserves = rr * deposits
  const excess = reserves - requiredReserves
  const capital = reserves + loans + securities - deposits - cbBorrowings
  const maxLoansByCapital = capital / CAPITAL_TARGET
  const capitalRoom = Math.max(0, maxLoansByCapital - loans)
  if (excess > 0 && capitalRoom > 0) {
    const newLoans = Math.min(b.riskAppetite * LENDING_SPEED * excess, capitalRoom)
    loans += newLoans
    deposits += newLoans
  }

  // 4. Reconcile reserves with the requirement via the discount window. If short
  //    (e.g. the reserve requirement was just raised), borrow a fraction of the
  //    shortfall from the central bank; if flush, repay outstanding borrowings.
  const requiredAfter = rr * deposits
  const shortfall = requiredAfter - reserves
  if (shortfall > 0) {
    const borrow = shortfall * DISCOUNT_DRAW_SPEED
    cbBorrowings += borrow
    reserves += borrow
  } else if (cbBorrowings > 0) {
    const repay = Math.min(-shortfall, cbBorrowings)
    cbBorrowings -= repay
    reserves -= repay
  }

  const nowCapital = reserves + loans + securities - deposits - cbBorrowings
  const stressed = loans > 0 && nowCapital / loans < CAPITAL_TARGET
  return {
    ...b,
    reserves,
    loans,
    securities,
    deposits,
    cbBorrowings,
    lastProfit: profit,
    stressStreak: stressed ? (b.stressStreak ?? 0) + 1 : 0,
  }
}

// Sum a country's banks + its central bank's currency into the monetary
// aggregates readout.
export function monetaryAggregatesFor(countryId: string, banks: Bank[], cb: CentralBank | undefined): MonetaryAggregates {
  const mine = banks.filter((b) => b.countryId === countryId)
  const bankReserves = sum(mine, (b) => b.reserves)
  const deposits = sum(mine, (b) => b.deposits)
  const loans = sum(mine, (b) => b.loans)
  const cbBorrowings = sum(mine, (b) => b.cbBorrowings)
  const capital = sum(mine, bankCapital)
  const currency = cb ? cb.currencyInCirculation : 0
  return {
    baseMoney: currency + bankReserves,
    currency,
    bankReserves,
    deposits,
    broadMoney: currency + deposits,
    loans,
    bankCapital: capital,
    reserveRatio: deposits > 0 ? bankReserves / deposits : 0,
    loanToDeposit: deposits > 0 ? loans / deposits : 0,
    cbBorrowings,
  }
}

// Advance the whole banking system one tick: every bank steps under its country's
// central-bank policy, each central bank's balance sheet is reconciled with its
// banks (loansToBanks = Σ discount-window borrowings), and per-country aggregates
// are produced. Returns updated countries (CB balance-sheet fields patched),
// updated banks, and the money report. A country with no central bank still has
// its banks tick against a neutral default (they simply hold steady).
export function tickBanking(
  countries: Country[],
  banks: Bank[],
  tick = 0,
): { countries: Country[]; banks: Bank[]; money: Record<string, MonetaryAggregates>; events: CentralBankEvent[] } {
  const cbByCountry = new Map<string, CentralBank | undefined>()
  const distressByCountry = new Map<string, number>()
  for (const c of countries) {
    cbByCountry.set(c.id, hasCentralBank(c.centralBank) ? c.centralBank : undefined)
    distressByCountry.set(c.id, c.monetary?.outputGap ?? 0)
  }

  // Step every bank whose country has a functioning central bank; banks in a
  // no-bank country hold their balance sheet (no monetary authority to lend/borrow).
  let nextBanks = banks.map((b) => {
    const cb = cbByCountry.get(b.countryId)
    return cb ? tickBank(b, cb, distressByCountry.get(b.countryId) ?? 0) : b
  })

  // --- Banking crisis + lender of last resort (Stage 5) ---
  // An INSOLVENT bank (capital < 0) is recapitalized by the state up to a minimum
  // capital ratio — the backstop that keeps a solvent-but-illiquid system from
  // collapsing (the loss having already been written off). Funded from the home
  // treasury (a real fiscal cost); if the treasury can't cover it fully, the
  // bailout is partial and the bank limps on undercapitalized. Emits an event.
  const events: CentralBankEvent[] = []
  const treasuryDraw = new Map<string, number>()
  nextBanks = nextBanks.map((b) => {
    const cb = cbByCountry.get(b.countryId)
    if (!cb) return b
    const capital = bankCapital(b)
    if (capital >= 0) return b
    const need = RECAP_TARGET_RATIO * b.loans - capital
    const avail = Math.max(0, (countries.find((c) => c.id === b.countryId)?.treasury ?? 0) - (treasuryDraw.get(b.countryId) ?? 0))
    const inject = Math.min(need, avail)
    if (inject <= 0) return b
    treasuryDraw.set(b.countryId, (treasuryDraw.get(b.countryId) ?? 0) + inject)
    events.push({ id: `bank-${tick}-${b.id}`, tick, countryId: b.countryId, kind: 'bank-recapitalized', text: `${b.name} was insolvent and recapitalized by the state (lender of last resort).` })
    return { ...b, reserves: b.reserves + inject }
  })

  // Reconcile each central bank's balance sheet with its banks, debit any bailout
  // costs from treasuries, and build the money report.
  const money: Record<string, MonetaryAggregates> = {}
  const nextCountries = countries.map((c) => {
    const agg = monetaryAggregatesFor(c.id, nextBanks, cbByCountry.get(c.id))
    money[c.id] = agg
    const draw = treasuryDraw.get(c.id) ?? 0
    const cb = c.centralBank
    if (!cb || !hasCentralBank(cb)) return draw > 0 ? { ...c, treasury: c.treasury - draw } : c
    // The CB's loans-to-banks asset mirrors the banks' discount-window liability.
    return { ...c, treasury: c.treasury - draw, centralBank: { ...cb, loansToBanks: agg.cbBorrowings } }
  })

  return { countries: nextCountries, banks: nextBanks, money, events }
}

function sum<T>(xs: T[], f: (x: T) => number): number {
  let s = 0
  for (const x of xs) s += f(x)
  return s
}
