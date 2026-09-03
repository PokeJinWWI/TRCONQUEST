import type { GoodId } from './goods'
import type { NeedTier } from './species'
import type { PopClass, DistrictType } from './recipes'
import type { EconomicSystem, HealthcareSystem, ForeignBondPolicy } from './laws'

// Government bonds — the debt the state sells to finance deficits. Held by three
// classes of buyer; foreign holders are gated by law + an approval setting.
export interface BondBook {
  pops: number
  corporations: number
  foreign: number
}

// A foreign investor's standing offer to buy state bonds, awaiting approval when
// the foreign-approval setting is on.
export interface ForeignBondOffer {
  id: string
  amount: number
  investor: string
}

// Government subsidies — a per-tick cash transfer FROM the treasury TO either a
// whole corporation (boosts its cash directly) or one specific building (helps
// fund that building's production even at a loss, regardless of the wider
// company's health). `corporations` is keyed by corporationId; `buildings` is
// keyed by `${worldId}:${buildingId}`. A subsidy is a REAL fiscal cost — it is
// deducted from the treasury every tick like any other spending (see
// tickEconomy's `subsidiesSpent`) — not free money. Setting an amount to 0
// removes the entry (see economyStore's setSubsidyForCorporation/
// setSubsidyForBuilding).
export interface SubsidyBook {
  corporations: Record<string, number>
  buildings: Record<string, number>
}

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
  // Standard of Living, 0..1 — the growth engine (design doc Section 2a).
  // Derived each tick from how well the pop meets its needs relative to income;
  // drives population growth/decline, education drift, and how far up the needs
  // tiers the pop reaches. This is the legible headline number for a cohort.
  standardOfLiving: number
  needsSatisfaction: Record<NeedTier, number>
}

// Who owns a building and takes its profit (design doc Section 3, "Ownership").
//   - state:       the national government; profit flows to the treasury.
//   - corporation: a company (state or private); profit accrues to its cash.
//   - worker:      the pops who work there (a co-op); profit is paid out to them
//                  as dividends, raising their wealth.
export type BuildingOwner =
  | { kind: 'state' }
  | { kind: 'corporation'; corporationId: string }
  | { kind: 'worker' }

// A queued construction project (see economyTick's construction step) — funded
// from the owning COUNTRY's treasury now, not a per-world one.
export interface ConstructionOrder {
  id: string
  recipeId: string
  cost: number
  progress: number
  // Who will own the finished building (state, a corporation, or a co-op) — set
  // when the order is queued. Government orders are state-funded; private
  // (corporation) orders are funded from the company's cash.
  owner: BuildingOwner
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
  // Who owns this building and takes its profit (state / a corporation / its
  // own workers). The owner also decides who directs its production method.
  owner: BuildingOwner
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
  // Building slots available per district — the planet's finite space/resources.
  districtCapacity: Record<DistrictType, number>
  pops: Pop[]
  buildings: Building[]
  constructionQueue: ConstructionOrder[]
  market: Market
  labor: LaborMarket
  // Goods delivered here by inter-world trade (Milestone 5), available as extra
  // supply this tick. Refilled each tick by the logistics step from surplus
  // worlds; lets a world import what it can't make itself.
  importStock: Partial<Record<GoodId, number>>
  // Remaining extractable reserve, in the same units as one tick's output, for
  // genuinely finite raw resources (ore/coal/oil/rare metals/sulfur/hardwood/
  // timber/phosphate — not crops, which regrow, nor manufactured/power goods).
  // Optional: a good with no entry here is treated as unlimited. Extraction
  // buildings producing a tracked good are capped by what's left and draw the
  // deposit down each tick (economyTick); hitting 0 idles that building's
  // output for that good, a slow long-game depletion pressure.
  resourceDeposits?: Partial<Record<GoodId, number>>
}

// A country — the NATIONAL government layer. One treasury, one tax/welfare
// policy, one debt, spanning all the worlds it owns.
export interface Country {
  id: string
  // Player-controllable fiscal policy.
  taxRate: number
  welfarePerCapita: number
  // National cash; negative = an unfunded overdraft (issue bonds to cover it).
  treasury: number
  // Economic-system law (laws.ts) — governs owner autonomy and the penalty for
  // the state overriding a private building's production method.
  economicSystem: EconomicSystem
  // Healthcare law — how much of pops' healthcare the state pays for.
  healthcareSystem: HealthcareSystem
  // Bonds: the debt sold to finance deficits, and its coupon rate per tick.
  bonds: BondBook
  bondRate: number
  // Foreign-bond LAW (may we sell to foreigners at all) + the SETTING for
  // whether inbound foreign purchases need the player's approval.
  foreignBondPolicy: ForeignBondPolicy
  requireForeignApproval: boolean
  // Foreign purchase offers awaiting approval.
  pendingForeign: ForeignBondOffer[]
  // Bureaucracy — the administrative capacity the state runs on. It is PRODUCED
  // by government buildings (stored up to a capacity) and CONSUMED every tick by
  // directly-state-run buildings, public institutions, and standing decrees.
  // Running dry makes the state's own enterprises inefficient. Handing a
  // building to a state-owned CORPORATION instead of running it directly costs
  // far less bureaucracy.
  bureaucracy: number
  // Standing decrees the state has enacted (each costs bureaucracy per tick).
  decrees: string[]
  // Freight capacity (units of goods movable between the country's worlds per
  // tick) — the logistics backbone of inter-world trade (Milestone 5).
  logisticsCapacity: number
  // Standing per-tick subsidies to corporations and individual buildings.
  subsidies: SubsidyBook
}

// --- Corporations, shareholding, characters (design doc Sections 3e/6) ---

// A shareholder in a corporation. The state (the player, as government), a named
// character (a magnate), the anonymous public float traded on the exchange, or a
// world's financial district (an institutional investor).
export type ShareHolder = { kind: 'state' } | { kind: 'character'; id: string } | { kind: 'public' } | { kind: 'financial'; id: string }

export interface ShareHolding {
  holder: ShareHolder
  // Number of shares held (out of the corporation's total shares).
  shares: number
}

// A company that owns buildings and runs them for profit. A STATE corporation
// is an arm of the government (its profit ultimately serves the state); a
// PRIVATE one is owned by its shareholders. Either way it has a leader (a
// character), a cash balance, and a cap table.
export interface Corporation {
  id: string
  name: string
  countryId: string
  // 'financial' is a world's financial district — a co-op-like institutional
  // entity (auto-formed once a world is populous enough) that owns buildings and
  // holds shares in other companies, but is not a normal company.
  kind: 'state' | 'private' | 'financial'
  cash: number
  totalShares: number
  shares: ShareHolding[]
  leaderId?: string
  // Diagnostics from the last tick.
  lastProfit: number
  // Sector flavor label, e.g. 'Agriculture', 'Mining'.
  sector: string
}

// A person — a corporation leader for now, later ministers, officers, dynasts.
// Characters belong to families and carry traits and skills the player acts on.
export interface Character {
  id: string
  name: string
  familyId?: string
  age: number
  role: 'corp-leader' | 'unaffiliated'
  corporationId?: string
  cultureId: string
  religionId: string
  speciesTemplateId: string
  traits: string[]
  wealth: number
  // Skills, 0..10, that will gate outcomes as the character layer deepens.
  skills: { administration: number; finance: number; diplomacy: number }
  // A short log of interactions/events, newest last (display only).
  log: string[]
}

export interface Family {
  id: string
  name: string
  memberIds: string[]
  // Standing of the house, 0..100 (display + future politics weight).
  prestige: number
}

export interface EconomyState {
  countries: Country[]
  worlds: World[]
  corporations: Corporation[]
  characters: Character[]
  families: Family[]
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
  // Government spending on subsidised services (healthcare) this tick.
  services: number
  interest: number
  construction: number
  expenditure: number
  balance: number
  treasury: number
  debt: number
  debtToGdp: number
  rating: CreditRating
  population: number
  // Bureaucracy this tick: current stock, storage capacity, and the flows.
  bureaucracy: number
  bureaucracyCapacity: number
  bureaucracyProduced: number
  bureaucracyConsumed: number
  // Trade (Milestone 5): total goods shipped between the country's worlds this
  // tick, and the freight capacity available.
  tradeVolume: number
  logisticsCapacity: number
  // Government subsidies paid out to corporations + individual buildings this
  // tick — a real expenditure line, folded into `expenditure`/`balance`.
  subsidiesSpent: number
}

export interface TickReports {
  worlds: Record<string, WorldReport>
  countries: Record<string, CountryFiscal>
}
