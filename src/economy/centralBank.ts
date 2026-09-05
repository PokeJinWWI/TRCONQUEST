// Central banking — the monetary institution of a country (design: the Central
// Banking System spec). This module is the pure, headless core of the feature:
// the institution shape, the seven law families that configure it, and the
// governance functions that decide who may actually pull the monetary levers.
//
// STAGE 1 (this file, first cut) models the INSTITUTION and its POLITICS: what
// kind of central bank a country runs, how independent it is, who controls
// policy, its mandate, its governor, and the crucial gate — whether the
// government (the player) may directly set monetary policy or must instead work
// THROUGH an independent bank (pressure, reform, appointments). The actual
// economic transmission (rates → credit → inflation → employment), the bank
// balance sheet, open-market operations, FX and crises arrive in later stages;
// the policy-lever fields (policyRate, reserveRequirement) live here now so the
// UI and store are stable, but nothing downstream reads them yet.
//
// Kept a pure module (no React/DOM, no store import) like the rest of
// src/economy/* so the whole monetary sim stays portable and headless-testable.

// --- Law family 1: Central Bank Status ---
// The single most important choice: does a central bank exist at all, and how
// far is it removed from the treasury? Drives base independence and what tools
// are even available.
export type CentralBankStatus =
  | 'no-bank'
  | 'treasury-office'
  | 'state-bank'
  | 'independent'
  | 'highly-independent'

export const CENTRAL_BANK_STATUSES: CentralBankStatus[] = [
  'no-bank',
  'treasury-office',
  'state-bank',
  'independent',
  'highly-independent',
]

export interface CentralBankStatusDef {
  id: CentralBankStatus
  name: string
  description: string
  // Base institutional independence this status confers, 0..1. Appointment
  // method and standing government pressure adjust the EFFECTIVE independence
  // around this (see effectiveIndependence).
  baseIndependence: number
  // Does this status constitute an actual central bank (vs. none / a treasury
  // desk)? Gates the monetary toolset.
  hasBank: boolean
}

export const CENTRAL_BANK_STATUS_DEFS: Record<CentralBankStatus, CentralBankStatusDef> = {
  'no-bank': {
    id: 'no-bank',
    name: 'No Central Bank',
    description: 'No monetary authority. Money and credit are left to private banks and the treasury; the state has no lever over interest rates or the money supply.',
    baseIndependence: 0,
    hasBank: false,
  },
  'treasury-office': {
    id: 'treasury-office',
    name: 'Treasury Banking Office',
    description: 'A banking desk inside the treasury. Monetary policy is simply an arm of fiscal policy — the government sets rates and prints money directly, with no separation.',
    baseIndependence: 0.05,
    hasBank: true,
  },
  'state-bank': {
    id: 'state-bank',
    name: 'State Central Bank',
    description: 'A national central bank subordinate to the government. It runs monetary operations, but the government retains final say over rates, lending and money creation.',
    baseIndependence: 0.35,
    hasBank: true,
  },
  independent: {
    id: 'independent',
    name: 'Independent Central Bank',
    description: 'A central bank with real legal independence. The government sets the mandate but cannot order day-to-day policy; the bank pursues its objectives on its own judgment.',
    baseIndependence: 0.7,
    hasBank: true,
  },
  'highly-independent': {
    id: 'highly-independent',
    name: 'Highly Independent Central Bank',
    description: 'Strong constitutional independence with long, staggered terms. The government has little direct control; credibility is high and politically-driven money creation is very hard.',
    baseIndependence: 0.92,
    hasBank: true,
  },
}

export function centralBankStatusDef(s: CentralBankStatus): CentralBankStatusDef {
  return CENTRAL_BANK_STATUS_DEFS[s]
}

// --- Law family 2: Organizational Structure ---
// How the institution is arranged. Mostly matters for the federal/regional
// systems (Stage 5 regional readouts); for now it colors the model label and a
// small coordination factor.
export type BankStructure =
  | 'single'
  | 'regional-branches'
  | 'federal-reserve'
  | 'decentralized'

export const BANK_STRUCTURES: BankStructure[] = ['single', 'regional-branches', 'federal-reserve', 'decentralized']

export interface BankStructureDef {
  id: BankStructure
  name: string
  description: string
  // How tightly national policy can be coordinated, 0..1 (1 = a single bank
  // acts instantly and uniformly; lower = regional interests dilute/slow it).
  coordination: number
  // Are there autonomous regional reserve banks whose local conditions feed
  // into policy? (Stage 5 regional monitoring.)
  regional: boolean
}

export const BANK_STRUCTURE_DEFS: Record<BankStructure, BankStructureDef> = {
  single: {
    id: 'single',
    name: 'Single National Bank',
    description: 'One national institution. Policy is uniform and instantly coordinated across every world.',
    coordination: 1,
    regional: false,
  },
  'regional-branches': {
    id: 'regional-branches',
    name: 'National Bank with Regional Branches',
    description: 'A national bank with administrative branches. Branches execute policy locally but hold no independent authority.',
    coordination: 0.9,
    regional: false,
  },
  'federal-reserve': {
    id: 'federal-reserve',
    name: 'Federal Reserve System',
    description: 'A central board over multiple regional reserve banks. National policy is coordinated, but regional economic conditions influence some decisions.',
    coordination: 0.75,
    regional: true,
  },
  decentralized: {
    id: 'decentralized',
    name: 'Decentralized Banking System',
    description: 'Strongly regionalized monetary authority. Broad national direction with substantial regional latitude — hardest to coordinate quickly.',
    coordination: 0.6,
    regional: true,
  },
}

export function bankStructureDef(s: BankStructure): BankStructureDef {
  return BANK_STRUCTURE_DEFS[s]
}

// --- Law family 3: Monetary Policy Authority ---
// Who has final say over monetary policy. Government/finance-ministry authority
// means the state pulls the levers directly (dependent bank); a governor,
// board or committee means the institution decides (independent bank).
export type PolicyAuthority =
  | 'government'
  | 'finance-ministry'
  | 'governor'
  | 'board'
  | 'mpc'

export const POLICY_AUTHORITIES: PolicyAuthority[] = ['government', 'finance-ministry', 'governor', 'board', 'mpc']

export interface PolicyAuthorityDef {
  id: PolicyAuthority
  name: string
  description: string
  // Does final authority rest with the GOVERNMENT (true) or with the bank
  // itself (false)? The core gate on whether the player may set policy directly.
  governmentControlled: boolean
}

export const POLICY_AUTHORITY_DEFS: Record<PolicyAuthority, PolicyAuthorityDef> = {
  government: { id: 'government', name: 'Government / Treasury', description: 'The government has final authority over monetary policy.', governmentControlled: true },
  'finance-ministry': { id: 'finance-ministry', name: 'Finance Ministry', description: 'The finance ministry directs monetary policy as an extension of fiscal policy.', governmentControlled: true },
  governor: { id: 'governor', name: 'Central Bank Governor', description: 'The governor sets monetary policy at their own discretion, within the mandate.', governmentControlled: false },
  board: { id: 'board', name: 'Central Bank Board', description: 'A governing board decides monetary policy collectively.', governmentControlled: false },
  mpc: { id: 'mpc', name: 'Independent Monetary Policy Committee', description: 'A dedicated, insulated committee sets policy — the strongest procedural independence.', governmentControlled: false },
}

export function policyAuthorityDef(a: PolicyAuthority): PolicyAuthorityDef {
  return POLICY_AUTHORITY_DEFS[a]
}

// --- Law family 4: Governor Appointment ---
// How the governor is chosen — affects independence and term length.
export type GovernorAppointment =
  | 'government'
  | 'head-of-state'
  | 'legislature'
  | 'joint'
  | 'fixed-term'
  | 'staggered'

export const GOVERNOR_APPOINTMENTS: GovernorAppointment[] = ['government', 'head-of-state', 'legislature', 'joint', 'fixed-term', 'staggered']

export interface GovernorAppointmentDef {
  id: GovernorAppointment
  name: string
  description: string
  // Independence contribution, additive around the status base (can be
  // negative). Longer/insulated appointments raise independence.
  independenceMod: number
  // Default governor term length, in economy ticks (12 ticks = 1 year).
  termTicks: number
}

export const GOVERNOR_APPOINTMENT_DEFS: Record<GovernorAppointment, GovernorAppointmentDef> = {
  government: { id: 'government', name: 'Appointed by Government', description: 'The government appoints and may replace the governor at will.', independenceMod: -0.15, termTicks: 48 },
  'head-of-state': { id: 'head-of-state', name: 'Appointed by Head of State', description: 'The head of state names the governor — some remove from day-to-day politics.', independenceMod: -0.05, termTicks: 60 },
  legislature: { id: 'legislature', name: 'Appointed by Legislature', description: 'The legislature confirms the governor, adding a layer of political insulation.', independenceMod: 0.05, termTicks: 60 },
  joint: { id: 'joint', name: 'Joint Government/Legislative', description: 'Executive nomination with legislative confirmation — a balanced appointment.', independenceMod: 0.08, termTicks: 72 },
  'fixed-term': { id: 'fixed-term', name: 'Fixed Independent Term', description: 'A long fixed term the government cannot cut short — strong independence.', independenceMod: 0.15, termTicks: 96 },
  staggered: { id: 'staggered', name: 'Staggered Board Terms', description: 'Overlapping long terms so no single government appoints the whole board — the strongest insulation.', independenceMod: 0.2, termTicks: 120 },
}

export function governorAppointmentDef(a: GovernorAppointment): GovernorAppointmentDef {
  return GOVERNOR_APPOINTMENT_DEFS[a]
}

// --- Law family 5: Central Bank Mandate ---
// What the bank prioritizes when it sets policy. Drives the AI (and, later, the
// player's own independent bank) toward different targets. The weights are read
// by the Stage 4 policy loop; defined now as data.
export type CentralBankMandate =
  | 'currency'
  | 'price'
  | 'employment'
  | 'financial'
  | 'exchange'
  | 'multiple'
  | 'development'

export const CENTRAL_BANK_MANDATES: CentralBankMandate[] = ['currency', 'price', 'employment', 'financial', 'exchange', 'multiple', 'development']

export interface MandateWeights {
  // How hard the bank leans against inflation, toward full employment, toward a
  // stable currency/exchange rate, toward financial-system stability, and toward
  // financing state development. Relative weights, not required to sum to 1.
  inflation: number
  employment: number
  currency: number
  financial: number
  development: number
}

export interface CentralBankMandateDef {
  id: CentralBankMandate
  name: string
  description: string
  weights: MandateWeights
}

export const CENTRAL_BANK_MANDATE_DEFS: Record<CentralBankMandate, CentralBankMandateDef> = {
  currency: {
    id: 'currency',
    name: 'Currency Stability',
    description: 'Above all, protect the value of the currency. Leans hard against inflation and depreciation, tolerating weaker employment.',
    weights: { inflation: 1.0, employment: 0.1, currency: 0.9, financial: 0.3, development: 0 },
  },
  price: {
    id: 'price',
    name: 'Price Stability',
    description: 'Keep inflation low and steady. The classic single mandate.',
    weights: { inflation: 1.0, employment: 0.2, currency: 0.3, financial: 0.3, development: 0 },
  },
  employment: {
    id: 'employment',
    name: 'Full Employment',
    description: 'Prioritize jobs and growth, accepting higher inflation to keep employment high.',
    weights: { inflation: 0.3, employment: 1.0, currency: 0.1, financial: 0.3, development: 0.2 },
  },
  financial: {
    id: 'financial',
    name: 'Financial Stability',
    description: 'Guard the banking system above all — quick to backstop banks, cautious about credit bubbles.',
    weights: { inflation: 0.5, employment: 0.3, currency: 0.3, financial: 1.0, development: 0 },
  },
  exchange: {
    id: 'exchange',
    name: 'Exchange-Rate Stability',
    description: 'Hold the exchange rate steady, subordinating domestic policy to defending the currency’s external value.',
    weights: { inflation: 0.6, employment: 0.1, currency: 1.0, financial: 0.3, development: 0 },
  },
  multiple: {
    id: 'multiple',
    name: 'Multiple Mandate',
    description: 'Balance price stability, employment and financial stability together — flexible but harder to hold credible.',
    weights: { inflation: 0.7, employment: 0.7, currency: 0.4, financial: 0.6, development: 0.1 },
  },
  development: {
    id: 'development',
    name: 'Government Financing / Development',
    description: 'Direct credit and money creation toward state development goals. Powerful for mobilization, but a standing inflation and credibility risk.',
    weights: { inflation: 0.15, employment: 0.6, currency: 0.1, financial: 0.2, development: 1.0 },
  },
}

export function centralBankMandateDef(m: CentralBankMandate): CentralBankMandateDef {
  return CENTRAL_BANK_MANDATE_DEFS[m]
}

// --- Law family 6: Government Debt Financing regime ---
// Whether — and how — the central bank may fund the government's debt. Ordinary
// open-market operations (secondary market) are very different from direct
// monetary financing (printing money to pay the state), which carries a heavy
// inflation/credibility cost (wired in Stage 4).
export type DebtFinancingRegime =
  | 'prohibited'
  | 'restricted'
  | 'secondary-only'
  | 'supported'
  | 'direct'

export const DEBT_FINANCING_REGIMES: DebtFinancingRegime[] = ['prohibited', 'restricted', 'secondary-only', 'supported', 'direct']

export interface DebtFinancingRegimeDef {
  id: DebtFinancingRegime
  name: string
  description: string
  // Fraction of a tick's government financing need the bank may cover by
  // creating money (0 = none, 1 = unlimited monetary financing). Used in
  // Stage 4; the higher it is, the greater the inflation/credibility risk.
  monetaryFinancingCap: number
  // May the bank hold/buy government securities on the SECONDARY market at all
  // (ordinary open-market operations)?
  secondaryMarket: boolean
}

export const DEBT_FINANCING_REGIME_DEFS: Record<DebtFinancingRegime, DebtFinancingRegimeDef> = {
  prohibited: { id: 'prohibited', name: 'Prohibited', description: 'The central bank may not hold or buy government debt in any form. Maximum monetary credibility, no fiscal cushion.', monetaryFinancingCap: 0, secondaryMarket: false },
  restricted: { id: 'restricted', name: 'Restricted', description: 'Tightly limited holdings of government debt, secondary market only and capped.', monetaryFinancingCap: 0, secondaryMarket: true },
  'secondary-only': { id: 'secondary-only', name: 'Secondary Market Only', description: 'Ordinary open-market operations are allowed — the bank buys and sells existing bonds — but it may not finance the government directly.', monetaryFinancingCap: 0, secondaryMarket: true },
  supported: { id: 'supported', name: 'Government Debt Support', description: 'The bank may actively support government debt, absorbing a limited share of new issuance to keep borrowing costs down.', monetaryFinancingCap: 0.35, secondaryMarket: true },
  direct: { id: 'direct', name: 'Direct Monetary Financing', description: 'The bank may print money to fund the government outright. Unlimited fiscal firepower, severe inflation and credibility consequences.', monetaryFinancingCap: 1, secondaryMarket: true },
}

export function debtFinancingRegimeDef(r: DebtFinancingRegime): DebtFinancingRegimeDef {
  return DEBT_FINANCING_REGIME_DEFS[r]
}

// --- Law family 7: Exchange-Rate Regime ---
// How the currency's external value is managed. Fully wired in Stage 3 with the
// multi-currency/FX system; defined here so the institution is complete and the
// law is enactable from the start.
export type ExchangeRateRegime =
  | 'float'
  | 'managed'
  | 'band'
  | 'fixed'
  | 'peg'

export const EXCHANGE_RATE_REGIMES: ExchangeRateRegime[] = ['float', 'managed', 'band', 'fixed', 'peg']

export interface ExchangeRateRegimeDef {
  id: ExchangeRateRegime
  name: string
  description: string
  // How hard the bank must work (and spend FX reserves) to hold the external
  // value, 0..1. A free float costs nothing; a hard peg costs the most and
  // constrains domestic policy the most.
  defenseIntensity: number
}

export const EXCHANGE_RATE_REGIME_DEFS: Record<ExchangeRateRegime, ExchangeRateRegimeDef> = {
  float: { id: 'float', name: 'Free Float', description: 'The market sets the exchange rate. Monetary policy is fully free; the currency absorbs shocks.', defenseIntensity: 0 },
  managed: { id: 'managed', name: 'Managed Float', description: 'The bank leans against sharp currency moves without committing to a level. Modest reserve use.', defenseIntensity: 0.3 },
  band: { id: 'band', name: 'Currency Band', description: 'The rate is kept within a target band. Defended with reserves and rate policy when it strays.', defenseIntensity: 0.6 },
  fixed: { id: 'fixed', name: 'Fixed Exchange Rate', description: 'A committed fixed rate. Requires ample reserves and subordinates domestic policy to the peg.', defenseIntensity: 0.85 },
  peg: { id: 'peg', name: 'Hard Peg', description: 'A rigid peg (or currency board). Maximum external stability, but domestic monetary policy is almost entirely surrendered.', defenseIntensity: 1 },
}

export function exchangeRateRegimeDef(r: ExchangeRateRegime): ExchangeRateRegimeDef {
  return EXCHANGE_RATE_REGIME_DEFS[r]
}

// --- The institution ---

// A country's central bank. Absent (or `established: false`) means the country
// has no central bank at all. The seven law selections above configure it; the
// dynamic fields (independence/credibility/governor/pressure) evolve through
// governance and events; the policy levers (policyRate/reserveRequirement/
// balance sheet) are acted on from Stage 3/4 onward.
export interface CentralBank {
  // The country this bank belongs to (mirrors Country.id for convenience when a
  // bank is passed around on its own).
  countryId: string
  // A country with status 'no-bank' still carries a CentralBank record so the
  // UI/laws can transition it into existence; `established` is derived from the
  // status (see hasCentralBank) but stored for clarity.
  name: string
  status: CentralBankStatus
  structure: BankStructure
  policyAuthority: PolicyAuthority
  appointment: GovernorAppointment
  mandate: CentralBankMandate
  debtFinancing: DebtFinancingRegime
  exchangeRegime: ExchangeRateRegime
  // Standing monetary credibility, 0..1. High credibility anchors inflation
  // expectations and lowers borrowing costs; politically-driven money creation
  // and broken pegs erode it. Evolves in later stages; seeded here.
  credibility: number
  // Standing government pressure on the bank, 0..1 — how hard the government is
  // currently leaning on it for easy money. Raised by `pressureCentralBank`,
  // decays over time; erodes effective independence and credibility.
  governmentPressure: number
  // Governance: the sitting governor and their term. Governor is a lightweight
  // named figure for now (a full Character link can come later); the term drives
  // reappointment events.
  governorName: string
  governorTermStart: number
  governorTermLength: number
  // Policy levers. `policyRate` is the annualized policy interest rate (0.03 =
  // 3%); `reserveRequirement` is the fraction of deposits banks must hold in
  // reserve (0.1 = 10%). Set directly by the government only when the bank is
  // government-controlled; otherwise managed by the bank per its mandate.
  policyRate: number
  reserveRequirement: number
}

// Does the country actually have a central bank (vs. none)? NOT a type predicate
// on purpose: a CentralBank record with status 'no-bank' is still a CentralBank
// object, so `cb is CentralBank` would mislead the narrower — this is a runtime
// "is there a functioning bank" check, distinct from "is the field defined".
export function hasCentralBank(cb: CentralBank | undefined | null): boolean {
  return !!cb && centralBankStatusDef(cb.status).hasBank
}

// A human-readable "model" label derived from status + structure — the broad
// institutional archetype from the spec (Federal Reserve System, Government-
// Controlled State Bank, Highly Independent Central Bank, ...). Purely for
// display; the behavior comes from the individual laws.
export function centralBankModelLabel(cb: CentralBank): string {
  if (!hasCentralBank(cb)) return 'No Central Bank'
  if (cb.status === 'treasury-office') return 'Treasury Banking System'
  if (cb.structure === 'federal-reserve') return 'Federal Reserve System'
  if (cb.structure === 'decentralized') return 'Decentralized Reserve System'
  if (cb.status === 'highly-independent') return 'Highly Independent Central Bank'
  if (cb.status === 'independent') return 'Independent Central Bank'
  if (cb.status === 'state-bank') return 'Government-Controlled State Bank'
  return 'Central Bank'
}

// Effective institutional independence, 0..1: the status base, adjusted by the
// appointment method and reduced by standing government pressure. This is the
// number the rest of the system reads — not the raw status base.
export function effectiveIndependence(cb: CentralBank): number {
  if (!hasCentralBank(cb)) return 0
  const base = centralBankStatusDef(cb.status).baseIndependence
  const mod = governorAppointmentDef(cb.appointment).independenceMod
  // Structural independence from the laws (status + appointment). Capped just
  // below 1 so even the most insulated bank leaves room for pressure to bite —
  // no institution is perfectly beyond politics.
  const structural = Math.min(0.95, Math.max(0, base + mod))
  // Standing government pressure erodes it (a simple linear term is enough).
  const pressurePenalty = cb.governmentPressure * 0.4
  return clamp01(structural - pressurePenalty)
}

// The core governance gate: may the GOVERNMENT (the player, for their own
// country) directly set monetary policy — the policy rate, reserve requirement,
// and later open-market operations? True when the bank is government-controlled
// by its policy-authority law OR its status is a treasury office / subordinate
// state bank AND it isn't strongly independent. An independent bank's levers are
// run BY THE BANK (its own logic/mandate), and the government must instead
// reform it, appoint a friendlier governor, or apply pressure.
export function governmentControlsPolicy(cb: CentralBank): boolean {
  if (!hasCentralBank(cb)) return false
  if (policyAuthorityDef(cb.policyAuthority).governmentControlled) return true
  // Even nominally independent authority yields to the government if effective
  // independence has collapsed (heavy pressure / weak appointment).
  return effectiveIndependence(cb) < 0.25
}

// May the bank create money to finance the government this tick, and up to what
// cap of the financing need? (Wired in Stage 4; exposed now for the UI.)
export function monetaryFinancingCap(cb: CentralBank): number {
  if (!hasCentralBank(cb)) return 0
  return debtFinancingRegimeDef(cb.debtFinancing).monetaryFinancingCap
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

// A sensible default central bank for a newly-established institution, so
// `establishCentralBank` and the seed don't repeat the shape.
export function defaultCentralBank(countryId: string, tick: number, overrides: Partial<CentralBank> = {}): CentralBank {
  return {
    countryId,
    name: 'Central Bank',
    status: 'state-bank',
    structure: 'single',
    policyAuthority: 'governor',
    appointment: 'government',
    mandate: 'price',
    debtFinancing: 'secondary-only',
    exchangeRegime: 'float',
    credibility: 0.5,
    governmentPressure: 0,
    governorName: 'Governor',
    governorTermStart: tick,
    governorTermLength: governorAppointmentDef('government').termTicks,
    policyRate: 0.03,
    reserveRequirement: 0.1,
    ...overrides,
  }
}
