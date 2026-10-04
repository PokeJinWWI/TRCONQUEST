// Simple mode's economy (`economyModel: 'abstract'`; Stellaris/HOI4/TNO-
// inspired) — one macro state per nation plus a few buildings on each world it
// controls. Complex mode (src/economy/*) never touches this.
//
//   Worlds     each owned, un-occupied world has a population and building
//              levels (factories, farms, mines, power plants, labs, refineries).
//              Buildings need workers: a world with more jobs than workers runs
//              every building at the staffed fraction.
//   Factories  are industrial capacity — Production Units (PU). The allocation
//              splits PU into civilian (construction points that build new
//              buildings), military (alloys) and consumer (consumer goods +
//              electronics). Factories burn minerals and energy.
//   Goods      Stellaris-style stockpiles, no prices (the resourceStore
//              stockpile ships and armies are paid from).
//   Productivity  output per worker, growing each month with research per
//              person (labs) — the main source of long-run growth, as in a
//              developed economy; population grows slowly (~0.4%/yr).
//   Pops       Stellaris-style strata (workers / specialists / unemployed), each
//              with a goods upkeep — food to survive (shortage starves them),
//              consumer goods and electronics to be content — and a happiness.
//              Approval (weighted happiness) drives stability; stability above
//              50% boosts output, below it cuts output, below 25% is unrest.
//   GDP        value added: what was produced (at fixed GOOD_VALUE) minus the
//              inputs used up, plus services from the population — so it grows
//              by BUILDING things and by population, not by itself.
//   Budget     taxes on GDP vs civil/welfare/military/debt spending; deficits
//              are borrowed or printed (inflation). A price level tracks
//              cumulative inflation; nominal GDP = real × price level.
//   Currency   a floating exchange rate vs the Earth Dollar, driven by
//              inflation, stability, debt and the trade balance; it prices
//              imports/exports on the interstellar market.
//
// Pure and headless (no store/DOM). The store (state/abstractEconomyStore.ts)
// holds the states, syncs the stockpile and advances it monthly.

import {
  ACADEMIC_TO_INDUSTRIAL,
  CLUSTER_MAX,
  CLUSTER_PER_BUILDING,
  DECONSTRUCT_MONTHS_BUILDING,
  DECONSTRUCT_MONTHS_DISTRICT,
  DISTRICT_COST,
  DISTRICT_OF_BUILDING,
  LINK_MAX,
  SIMPLE_DISTRICT_DEFS,
  SIMPLE_DISTRICTS,
  SLOTS_PER_DISTRICT,
  type SimpleDistrictId,
  GOOD_VALUE,
  SIMPLE_BUILDING_DEFS,
  SIMPLE_BUILDINGS,
  SIMPLE_GOODS,
  type BuildingLevels,
  type SimpleBuildingId,
  type SimpleGood,
  type SimpleProduct,
  AMENITIES_PER_POP,
  CITY_AMENITIES_PER_POP,
  AMENITIES_MIN_POP,
  takesSlot,
} from '../data/simplisticEconomyData'
import type { TechCategory } from '../data/techData'
import { DEVASTATION_OUTPUT_LOSS } from '../data/defenseData'

export type EconomyType = 'market' | 'corporatist' | 'planned'

// The central bank's stance (TNO-style central bank policy): tight money pulls
// inflation down but makes credit dear, slowing construction; loose money does
// the opposite.
export type MonetaryStance = 'loose' | 'neutral' | 'tight'
export const MONETARY_STANCES: MonetaryStance[] = ['loose', 'neutral', 'tight']
export const ECONOMY_TYPES: EconomyType[] = ['market', 'corporatist', 'planned']

export type CreditRating = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC'

export type Stockpile = Record<SimpleGood, number>

export interface WorldState {
  bodyName: string
  population: number // millions
  buildings: BuildingLevels
  // District levels built, per district (see SIMPLE_DISTRICT_DEFS). Optional: a
  // world without it is treated as having just enough districts to house its
  // buildings (districtsOf).
  districts?: Partial<Record<SimpleDistrictId, number>>
  // District levels the world's land can hold (from its size). Optional —
  // defaults via landOf.
  land?: number
  // Legacy flat building-slot count (pre-districts); only read by landOf.
  slots?: number
  // Orbital bombardment damage 0–1 (scene/bombardment.ts): cuts this world's
  // building output. Optional: absent = none.
  devastation?: number
  // Urban slots taken by other nations' embassies and branch offices
  // (scene/holdings.ts, kept in sync by the holdings store). Absent = 0.
  foreignSlots?: number
  // Military slots taken by planetary defenses (state/defenseStore.ts keeps it
  // in sync). Absent = 0.
  militarySlots?: number
}

// A project in the construction queue: one building level, or one district level.
export interface ConstructionOrder {
  id: number
  bodyName: string
  building?: SimpleBuildingId
  district?: SimpleDistrictId
  progress: number // construction points put in so far
}

// A building or district level being deconstructed: a bar that runs backwards.
// `progress` is what is left, in construction points' worth: it starts at the
// build cost and falls by cost / months each month, independent of the
// construction queue; at 0 the thing is removed. Never takes a slot.
export interface Teardown {
  id: number
  bodyName: string
  building?: SimpleBuildingId
  district?: SimpleDistrictId
  progress: number
}

export interface Currency {
  code: string
  name: string
  rate: number // E$ value of one unit (higher = stronger)
  baseRate: number // where fundamentals-neutral sits
}

// Standing trade orders on the interstellar market, units per month: positive
// imports, negative exports.
export type TradeOrders = Partial<Record<SimpleGood, number>>

export interface AbstractEconomyState {
  countryId: string
  population: number // total over the nation's worlds, as of the last tick (display/AI)
  gdp: number // nominal annual GDP, as of the last tick
  realGdp: number // annual GDP at base prices, as of the last tick
  priceLevel: number // cumulative inflation (1 at game start)
  inflation: number // annualized fraction
  stability: number // 0..1
  // Fiscal
  treasury: number
  reserves: number
  debt: number
  taxRate: number
  // Policies
  economyType: EconomyType
  moneyCreation: number // 0..1 share of a deficit printed rather than borrowed
  warTaxes: boolean
  welfare: number // 0..1 welfare spending level — costs budget, buys stability and growth
  monetaryStance?: MonetaryStance // default neutral
  // Productivity: output per worker, 1 at game start. Everything buildings and
  // services produce is multiplied by it; it grows every month, faster the more
  // research the nation does per person (see productivityGrowth). Optional so
  // older states and test literals default to 1.
  productivity?: number
  // Construction queue (worked in order) and the next order id.
  queue: ConstructionOrder[]
  nextOrderId: number
  // Deconstructions under way (ids share `nextOrderId`). Optional: absent = none.
  teardowns?: Teardown[]
  currency: Currency
  trade: TradeOrders
  // Special Economic Zone (optional, default false): Simple mode has no
  // per-world building sim to hang a tax override on, so the nation's SEZ is a
  // flag that lifts its trade capacity (its abstract equivalent of attracting
  // foreign capital and freight). See SEZ_TRADE_BONUS.
  specialEconomicZone?: boolean
  // Spaceport production method (Simple parity with Complex's spaceport methods):
  // which way the nation's spaceports specialise — balanced, lift, or merchant
  // marine. Absent = 'standard'. Reshapes launch vs interstellarTransport.
  spaceportMethod?: SimpleSpaceportMethod
}

export type SimpleSpaceportMethod = 'standard' | 'launch-complex' | 'interstellar-port'

// Simple-mode transport capacity tuning (parallels economy/transport.ts).
export const SIMPLE_INFRA_BASE = 40
export const SIMPLE_LAUNCH_BASE = 3000
export const SIMPLE_INTERSTELLAR_BASE = 1500
const SIMPLE_SPACEPORT_LAUNCH: Record<SimpleSpaceportMethod, number> = { standard: 1400, 'launch-complex': 3200, 'interstellar-port': 500 }
const SIMPLE_SPACEPORT_INTERSTELLAR: Record<SimpleSpaceportMethod, number> = { standard: 1200, 'launch-complex': 300, 'interstellar-port': 3000 }

// How much a Special Economic Zone lifts a Simple-mode nation's trade capacity.
export const SEZ_TRADE_BONUS = 0.25

// --- Balance constants ---------------------------------------------------------
const WORKFORCE_SHARE = 0.42 // share of a world's population in the labour force (the rest: children, retirees, carers)
export const MAX_CP_PER_ORDER = 40 // one project can absorb at most this per month
// --- Pops: strata, upkeep, happiness (Stellaris-style) ---------------------------
// Everyone belongs to a stratum by the job their household works: WORKERS
// (farms, mines, power plants, factories), SPECIALISTS (labs, refineries) or
// UNEMPLOYED. Each stratum has a monthly goods upkeep per million people — food
// is survival (a food shortage starves people), consumer goods and electronics
// are what keeps them content. Each stratum has a happiness; the population-
// weighted happiness is APPROVAL, and planet-style stability follows approval.
export type Stratum = 'workers' | 'specialists' | 'unemployed'
export const STRATA: Stratum[] = ['workers', 'specialists', 'unemployed']
export type NeedGood = 'food' | 'consumerGoods' | 'electronics'
export const NEED_GOODS: NeedGood[] = ['food', 'consumerGoods', 'electronics']
// Amenities (Stellaris): a world's comfort, services and leisure. Its people
// use some; urban buildings supply it. A shortfall costs happiness in
// proportion, a surplus adds a little — up to this ratio of supply to need.
export const AMENITIES_RATIO_CAP = 1.5
const AMENITIES_SHORTFALL_HAPPINESS = 0.25
const AMENITIES_SURPLUS_HAPPINESS = 0.1 // per unit of ratio above 1 (so +5% at the cap)
export const POP_UPKEEP: Record<Stratum, Record<NeedGood, number>> = {
  workers: { food: 0.01, consumerGoods: 0.006, electronics: 0.001 },
  specialists: { food: 0.01, consumerGoods: 0.012, electronics: 0.004 },
  unemployed: { food: 0.01, consumerGoods: 0.003, electronics: 0 },
}
// Happiness a shortage of each good costs (at a total shortage).
const SHORTAGE_HAPPINESS: Record<NeedGood, number> = { food: 0.5, consumerGoods: 0.25, electronics: 0.15 }
const STRATUM_HAPPINESS: Record<Stratum, number> = { workers: 0, specialists: 0.05, unemployed: -0.2 }
const WELFARE_HAPPINESS: Record<Stratum, number> = { workers: 0.15, specialists: 0.05, unemployed: 0.25 }
const TYPE_HAPPINESS: Record<EconomyType, Record<Stratum, number>> = {
  market: { workers: -0.05, specialists: 0.1, unemployed: -0.05 },
  corporatist: { workers: 0.03, specialists: 0.05, unemployed: 0 },
  planned: { workers: 0.1, specialists: -0.05, unemployed: 0.1 },
}
const WAR_TAX_HAPPINESS = 0.08
const INFLATION_HAPPINESS = 2 // happiness lost per point of inflation (5% → −10%), capped
export const UNREST_BELOW = 0.25 // stability under which there's unrest
const UNREST_TAX_PENALTY = 0.2 // tax yield lost in unrest
const CP_VALUE = 2.0 // GDP value of a construction point
const RESEARCH_VALUE = 0.4
const SERVICES_PER_POP = 0.006 // monthly services GDP per million pop (× 0.5+stability)
const TAX_YIELD = 1.0
const GOV_SHARE_OF_GDP = 0.045 // civil + other spending, as a share of GDP (the state grows with the economy)
const WELFARE_PER_POP = 0.04 // annual welfare cost per million pop at full welfare
const MILITARY_UPKEEP_PER_PU = 6 // annual
const DEBT_SERVICE_RATE = 0.05
const PRINT_INFLATION = 0.8
// Inflation drifts each month toward a target set by the economy's pressures —
// the jobs market, shortages, the budget, the currency and the central bank —
// closing INFLATION_DECAY of the gap per month. Printing money spikes it on top.
const INFLATION_DECAY = 0.1
const BASE_INFLATION = 0.02
const NATURAL_UNEMPLOYMENT = 0.05 // unemployment at which wages neither push nor pull prices
const PHILLIPS = 0.25 // inflation per point of unemployment below the natural rate (and disinflation above it)
const SHORTAGE_INFLATION = 0.06 // at a total shortage of consumer goods (electronics count half)
const DEFICIT_INFLATION = 0.3 // per unit of deficit/GDP (a surplus cools prices the same way)
const IMPORT_INFLATION = 0.05 // per unit of currency weakness vs its base rate (imports are only part of what people buy)
const STANCE_INFLATION: Record<MonetaryStance, number> = { loose: 0.015, neutral: 0, tight: -0.015 }
const STANCE_CONSTRUCTION: Record<MonetaryStance, number> = { loose: 1.1, neutral: 1, tight: 0.9 }
const MAX_INFLATION_TARGET = 0.25
const MIN_INFLATION_TARGET = -0.03
const STAB_SPEED = 0.15 // how fast stability follows approval
const POP_GROWTH = 0.004 // annual, × (0.5 + approval) — a developed nation's pace
// Productivity growth (annual): a base drift plus a research-driven part with
// diminishing returns — research per billion people per month, r, adds
// PRODUCTIVITY_RESEARCH_MAX · r / (r + PRODUCTIVITY_RESEARCH_HALF). The starting
// nations' labs give about 1%/yr in total; a nation that goes all-in on labs
// approaches base + max (~4%/yr, a space-age science boom), one with none
// drifts at the base.
const PRODUCTIVITY_BASE = 0.003
const PRODUCTIVITY_RESEARCH_MAX = 0.04
const PRODUCTIVITY_RESEARCH_HALF = 10
const STARVATION = 0.1 // annual population loss at zero food
const WAR_TAX_REVENUE = 0.25
const IMPORT_MARKUP = 1.1
const EXPORT_DISCOUNT = 0.9
const FX_SPEED = 0.08
const TICKS_PER_YEAR = 12

// Economy-type modifiers (TNO capitalism / corporatism / planned).
// (Their effect on each stratum's happiness is TYPE_HAPPINESS.)
const TYPE_MODS: Record<EconomyType, { production: number; construction: number; taxYield: number }> = {
  market: { production: 1.1, construction: 1.15, taxYield: 0.9 },
  corporatist: { production: 1.0, construction: 1.0, taxYield: 1.0 },
  planned: { production: 0.9, construction: 1.1, taxYield: 1.15 },
}
export function economyTypeLabel(t: EconomyType): string {
  return t === 'market' ? 'Market' : t === 'corporatist' ? 'Corporatist' : 'Planned'
}

export function debtCeiling(rating: CreditRating): number {
  const byRating: Record<CreditRating, number> = { AAA: 1.6, AA: 1.5, A: 1.4, BBB: 1.2, BB: 1.0, B: 0.8, CCC: 0.6 }
  return byRating[rating]
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

export function emptyStockpile(): Stockpile {
  return Object.fromEntries(SIMPLE_GOODS.map((g) => [g, 0])) as Stockpile
}

// --- World helpers -------------------------------------------------------------
export function worldJobs(w: WorldState): number {
  let jobs = 0
  for (const b of SIMPLE_BUILDINGS) jobs += (w.buildings[b] ?? 0) * SIMPLE_BUILDING_DEFS[b].jobs
  return jobs
}
export function worldWorkforce(w: WorldState): number {
  return w.population * WORKFORCE_SHARE
}
// Fraction of its jobs a world can fill (1 = fully staffed).
export function worldStaffing(w: WorldState): number {
  const jobs = worldJobs(w)
  return jobs <= 0 ? 1 : Math.min(1, worldWorkforce(w) / jobs)
}
export function worldLevels(w: WorldState): number {
  let n = 0
  for (const b of SIMPLE_BUILDINGS) n += w.buildings[b] ?? 0
  return n
}

// --- Districts -------------------------------------------------------------------
// Buildings in a district (across its building families).
export function buildingsInDistrict(w: WorldState, d: SimpleDistrictId): number {
  let n = d === 'urban' ? w.foreignSlots ?? 0 : d === 'military' ? w.militarySlots ?? 0 : 0
  for (const b of SIMPLE_DISTRICT_DEFS[d].buildings) if (takesSlot(b)) n += w.buildings[b] ?? 0
  return n
}
// District levels built — or, for a world that predates districts, just enough
// to house what's on it.
export function districtsOf(w: WorldState): Record<SimpleDistrictId, number> {
  const out = {} as Record<SimpleDistrictId, number>
  for (const d of SIMPLE_DISTRICTS) out[d] = w.districts ? (w.districts[d] ?? 0) : Math.ceil(buildingsInDistrict(w, d) / SLOTS_PER_DISTRICT)
  return out
}
export function districtLevelsTotal(w: WorldState): number {
  const ds = districtsOf(w)
  return SIMPLE_DISTRICTS.reduce((n, d) => n + ds[d], 0)
}
// District levels the world's land holds.
export function landOf(w: WorldState): number {
  if (w.land !== undefined) return w.land
  if (w.slots !== undefined) return Math.floor(w.slots / SLOTS_PER_DISTRICT)
  return districtLevelsTotal(w) + 4
}
// Building slots a district offers.
export function districtSlots(w: WorldState, d: SimpleDistrictId): number {
  return districtsOf(w)[d] * SLOTS_PER_DISTRICT
}
// Free slots in the district a building belongs to, counting queued buildings
// AND queued levels of that district: a building can be queued into a slot a
// queued level will add (the monthly step holds a finished building until its
// slot exists).
export function freeSlots(w: WorldState, queue: ConstructionOrder[], d: SimpleDistrictId): number {
  const mine = queue.filter((o) => o.bodyName === w.bodyName)
  const queued = mine.filter((o) => o.building && takesSlot(o.building) && DISTRICT_OF_BUILDING[o.building] === d).length
  const comingLevels = mine.filter((o) => o.district === d).length
  return districtSlots(w, d) + comingLevels * SLOTS_PER_DISTRICT - buildingsInDistrict(w, d) - queued
}
// Free land for more district levels, counting queued districts.
export function freeLand(w: WorldState, queue: ConstructionOrder[]): number {
  const queued = queue.filter((o) => o.bodyName === w.bodyName && o.district).length
  return landOf(w) - districtLevelsTotal(w) - queued
}
export function orderCost(o: Pick<ConstructionOrder, 'building' | 'district'>): number {
  return o.district ? DISTRICT_COST : o.building ? SIMPLE_BUILDING_DEFS[o.building].cost : 0
}
// What a teardown started from (its bar's full length) and how long it runs.
export function teardownCost(t: Pick<Teardown, 'building' | 'district'>): number {
  return t.district ? DISTRICT_COST : t.building ? SIMPLE_BUILDING_DEFS[t.building].cost : 0
}
export function teardownMonths(t: Pick<Teardown, 'building' | 'district'>): number {
  return t.district ? DECONSTRUCT_MONTHS_DISTRICT : DECONSTRUCT_MONTHS_BUILDING
}
export function orderName(o: Pick<ConstructionOrder, 'building' | 'district'>): string {
  return o.district ? `${SIMPLE_DISTRICT_DEFS[o.district].name} level` : o.building ? SIMPLE_BUILDING_DEFS[o.building].name : 'Project'
}

// One world's people by stratum (millions, dependants included) and its jobs
// by building — the planet screen's Population tab.
export function worldStrata(w: WorldState): { workers: number; specialists: number; unemployed: number; jobsByBuilding: Partial<Record<SimpleBuildingId, number>> } {
  const staffing = worldStaffing(w)
  const workforce = worldWorkforce(w)
  let specialistJobs = 0
  let workerJobs = 0
  const jobsByBuilding: Partial<Record<SimpleBuildingId, number>> = {}
  for (const b of SIMPLE_BUILDINGS) {
    const jobs = (w.buildings[b] ?? 0) * SIMPLE_BUILDING_DEFS[b].jobs
    if (jobs <= 0) continue
    jobsByBuilding[b] = jobs
    if (SIMPLE_BUILDING_DEFS[b].stratum === 'specialists') specialistJobs += jobs * staffing
    else workerJobs += jobs * staffing
  }
  const perWorker = workforce > 0 ? w.population / workforce : 0
  return {
    workers: workerJobs * perWorker,
    specialists: specialistJobs * perWorker,
    unemployed: Math.max(0, workforce - workerJobs - specialistJobs) * perWorker,
    jobsByBuilding,
  }
}

// A world's amenities this month: what its people need (a little per million;
// nothing on a small outpost) and what it has — the city's own services plus
// its urban buildings (staffed, scaled by economy type and productivity but not
// stability, so happiness doesn't feed back into itself).
export function worldAmenities(w: WorldState, efficiency: number): { need: number; supply: number } {
  if (w.population < AMENITIES_MIN_POP) return { need: 0, supply: 0 }
  const need = w.population * AMENITIES_PER_POP
  const staffing = worldStaffing(w)
  const intact = 1 - DEVASTATION_OUTPUT_LOSS * Math.min(1, Math.max(0, w.devastation ?? 0))
  let supply = w.population * CITY_AMENITIES_PER_POP
  for (const b of SIMPLE_BUILDINGS) {
    const per = SIMPLE_BUILDING_DEFS[b].outputs.amenities
    if (per) supply += (w.buildings[b] ?? 0) * staffing * intact * per * efficiency * (1 + districtBonus(w, DISTRICT_OF_BUILDING[b]).total)
  }
  return { need, supply }
}
// Happiness from an amenities ratio (supply / need).
export function amenitiesHappiness(ratio: number): number {
  const r = clamp(ratio, 0, AMENITIES_RATIO_CAP)
  return r < 1 ? -AMENITIES_SHORTFALL_HAPPINESS * (1 - r) : AMENITIES_SURPLUS_HAPPINESS * (r - 1)
}

// The ecosystem bonus a district gives the buildings in it: a cluster bonus for
// every building beyond the first (suppliers, skilled labour, shared
// infrastructure), capped; industry also gains from research parks (academic
// district levels) on the same world.
export function districtBonus(w: WorldState, d: SimpleDistrictId): { cluster: number; link: number; total: number } {
  // Defenses in the military district make nothing, so they cluster nothing.
  const cluster = d === 'military' ? 0 : Math.min(CLUSTER_MAX, CLUSTER_PER_BUILDING * Math.max(0, buildingsInDistrict(w, d) - 1))
  const link = d === 'industrial' ? Math.min(LINK_MAX, ACADEMIC_TO_INDUSTRIAL * districtsOf(w).academic) : 0
  return { cluster, link, total: cluster + link }
}

// --- The monthly flows ----------------------------------------------------------
// Everything one month produces and consumes, computed from the state, the
// nation's worlds and its stockpile — without changing anything. The tick
// applies it; the UI and AI read it as the report.
export interface AbstractReport {
  population: number
  efficiency: number // output multiplier from stability × economy type × productivity
  productivity: number
  productivityGrowth: number // annual rate it is growing at this month
  workforce: number
  jobs: number
  productionUnits: number // total factory capacity (display)
  militaryPU: number // alloy foundry capacity — what military upkeep follows
  inputSatisfaction: number // the worst-supplied building input's share met (1 = every building fully supplied)
  inputShortages: SimpleGood[] // building inputs not fully supplied this month
  mineralsNeeded: number // what industry + construction wanted this month
  energyNeeded: number
  constructionPoints: number
  research: number
  researchByTree: Record<TechCategory, number>
  // Per building type, nationally: levels built and this month's output and
  // upkeep (after staffing, bonuses, efficiency and input shortages).
  byBuilding: Partial<Record<SimpleBuildingId, BuildingReport>>
  amenities: { need: number; supply: number; ratio: number } // national; ratio is pop-weighted over worlds
  // Per good, this month: produced, used by industry/labs/construction,
  // consumed by the population, traded (+ in / − out) and the net change.
  produced: Stockpile
  used: Stockpile
  consumed: Stockpile
  traded: Stockpile
  net: Stockpile
  // Pop upkeep, nationally: what the strata wanted and got, and the share met per good.
  needs: Record<NeedGood, { demand: number; got: number }>
  goodSatisfaction: Record<NeedGood, number>
  upkeepMet: number // 0..1, the worst good's share met (a diagnostic, not a stat)
  foodSatisfaction: number
  strata: Record<Stratum, StratumReport>
  approval: number // population-weighted happiness, 0..1
  // Trade (local money, per month)
  importCost: number
  exportRevenue: number
  tradeBalance: number // exports − imports, per month
  tradeCapacity: number // E$ of goods (at GOOD_VALUE) its spaceports can trade a month, bought and sold together
  // Transport capacities (Vic3-style, Simple parity with Complex's transport.ts):
  // infrastructure gates MARKET ACCESS (how much of its trade a nation can run);
  // launch is surface↔orbit lift; interstellarTransport is merchant-marine freight.
  infrastructure: number
  infrastructureUsage: number
  marketAccess: number // 0..1
  launch: number
  interstellarTransport: number
  // National accounts (annual)
  realGdp: number
  gdp: number // nominal
  revenue: number
  spending: number
  balance: number
  deficitPctGdp: number
  debtToGdp: number
  debtCeilingPct: number
  rating: CreditRating
  revIncome: number
  revBusiness: number
  revExcise: number
  revOther: number
  expMilitary: number
  expCivil: number
  expWelfare: number
  expDebt: number
  expOther: number
  // Stability follows approval; below UNREST_BELOW the nation is in unrest.
  stabilityTarget: number
  // Where inflation is heading and what pushes it (signed annual rates; the
  // target is BASE_INFLATION + their sum, clamped).
  inflationTarget: number
  inflationParts: { label: string; value: number }[]
  unrest: boolean
}

export interface BuildingReport {
  levels: number
  output: Partial<Record<SimpleProduct, number>>
  upkeep: Partial<Record<SimpleGood, number>>
}

export interface StratumReport {
  population: number // millions, dependants included
  happiness: number // 0..1
  // What moves this stratum's happiness (signed parts; happiness = 0.5 + Σ, clamped).
  parts: { label: string; value: number }[]
}

// What one unit of a good costs a nation to import, in its own currency.
export function importUnitCost(s: Pick<AbstractEconomyState, 'currency'>, g: SimpleGood): number {
  return (GOOD_VALUE[g] * IMPORT_MARKUP) / Math.max(0.01, s.currency.rate)
}

export function abstractReport(s: AbstractEconomyState, worlds: WorldState[], stock: Stockpile): AbstractReport {
  const mods = TYPE_MODS[s.economyType]
  const productivity = s.productivity ?? 1
  const efficiency = (0.8 + 0.4 * s.stability) * mods.production * productivity
  const stance = s.monetaryStance ?? 'neutral'

  // Staffed building levels, nationally, with each world's district bonus and
  // devastation folded in; and the raw (activity) levels upkeep is paid on.
  const L = Object.fromEntries(SIMPLE_BUILDINGS.map((b) => [b, 0])) as Record<SimpleBuildingId, number>
  const active = Object.fromEntries(SIMPLE_BUILDINGS.map((b) => [b, 0])) as Record<SimpleBuildingId, number>
  let population = 0
  let workforce = 0
  let jobs = 0
  let amenitySupplyWeighted = 0 // Σ over worlds of pop × (their amenities ratio, capped)
  let amenitySupply = 0
  let amenityNeed = 0
  for (const w of worlds) {
    const staffing = worldStaffing(w)
    const intact = 1 - DEVASTATION_OUTPUT_LOSS * Math.min(1, Math.max(0, w.devastation ?? 0))
    for (const b of SIMPLE_BUILDINGS) {
      const levels = w.buildings[b] ?? 0
      if (levels <= 0) continue
      active[b] += levels * staffing
      L[b] += levels * staffing * intact * (1 + districtBonus(w, DISTRICT_OF_BUILDING[b]).total)
    }
    population += w.population
    workforce += worldWorkforce(w)
    jobs += worldJobs(w)
    const am = worldAmenities(w, mods.production * productivity)
    amenitySupply += am.supply
    amenityNeed += am.need
    amenitySupplyWeighted += w.population * Math.min(AMENITIES_RATIO_CAP, am.need > 0 ? am.supply / am.need : AMENITIES_RATIO_CAP)
  }

  const produced = emptyStockpile()
  const used = emptyStockpile()
  const consumed = emptyStockpile()
  const traded = emptyStockpile()

  // Upkeep: what every consuming building wants this month. Buildings without
  // upkeep (farms, mines, power plants) always run; the rest slow when one of
  // THEIR inputs runs short (a foundry doesn't care about electronics). A good's
  // supply is the stockpile plus this month's output, and since some producers
  // have upkeep of their own (a fusion reactor needs electronics), the shares
  // are settled by a few rounds starting from the upkeep-free output alone.
  const need = emptyStockpile()
  for (const b of SIMPLE_BUILDINGS) for (const [g, n] of Object.entries(SIMPLE_BUILDING_DEFS[b].upkeep) as [SimpleGood, number][]) need[g] += active[b] * n
  const goodSat = Object.fromEntries(SIMPLE_GOODS.map((g) => [g, 1])) as Stockpile
  const runOf = (b: SimpleBuildingId) => {
    let run = 1
    for (const g of Object.keys(SIMPLE_BUILDING_DEFS[b].upkeep) as SimpleGood[]) run = Math.min(run, goodSat[g])
    return run
  }
  for (let round = 0; round < 5; round++) {
    const supply = emptyStockpile()
    for (const g of SIMPLE_GOODS) supply[g] = Math.max(0, stock[g])
    for (const b of SIMPLE_BUILDINGS) {
      const def = SIMPLE_BUILDING_DEFS[b]
      const run = round === 0 && Object.keys(def.upkeep).length > 0 ? 0 : runOf(b)
      for (const [g, n] of Object.entries(def.outputs) as [string, number][]) if (g in supply) supply[g as SimpleGood] += L[b] * n * efficiency * run
    }
    for (const g of SIMPLE_GOODS) goodSat[g] = need[g] > 0 ? Math.min(1, supply[g] / need[g]) : 1
  }
  const runs = Object.fromEntries(SIMPLE_BUILDINGS.map((b) => [b, runOf(b)])) as Record<SimpleBuildingId, number>
  for (const b of SIMPLE_BUILDINGS) for (const [g, n] of Object.entries(SIMPLE_BUILDING_DEFS[b].upkeep) as [SimpleGood, number][]) used[g] += active[b] * n * runs[b]
  // Trade capacity: what the spaceports can move this month (staffed levels,
  // slowed when short of rockets or spaceships).
  let tradeCapacity = 0
  for (const b of SIMPLE_BUILDINGS) tradeCapacity += active[b] * runs[b] * (SIMPLE_BUILDING_DEFS[b].tradeCapacity ?? 0)
  if (s.specialEconomicZone) tradeCapacity *= 1 + SEZ_TRADE_BONUS

  // --- Transport capacities (Vic3-style, Simple parity with economy/transport.ts) ---
  const popTotal = worlds.reduce((n, w) => n + w.population, 0)
  let infrastructure = SIMPLE_INFRA_BASE + Math.min(100, popTotal * 0.02)
  let infrastructureUsage = 0
  for (const b of SIMPLE_BUILDINGS) {
    infrastructure += (SIMPLE_BUILDING_DEFS[b].infrastructure ?? 0) * active[b] * runs[b]
  }
  // Usage is on RAW built levels (a built mine needs the roads whether or not it
  // is fully staffed), summed over the nation's worlds.
  for (const w of worlds) for (const b of SIMPLE_BUILDINGS) infrastructureUsage += w.buildings[b] ?? 0
  const marketAccess = infrastructureUsage <= 1e-9 ? 1 : Math.max(0, Math.min(1, infrastructure / infrastructureUsage))
  const spMethod = s.spaceportMethod ?? 'standard'
  const spLevels = active.spaceport * runs.spaceport
  const elevatorLevels = active.spaceElevatorAnchor * runs.spaceElevatorAnchor
  const launch = SIMPLE_LAUNCH_BASE + SIMPLE_SPACEPORT_LAUNCH[spMethod] * spLevels + 3000 * elevatorLevels
  const interstellarTransport = SIMPLE_INTERSTELLAR_BASE + SIMPLE_SPACEPORT_INTERSTELLAR[spMethod] * spLevels
  // A poorly-connected nation runs less of its trade (market access).
  tradeCapacity *= marketAccess
  // The worst-supplied input, over the goods buildings need (a diagnostic).
  const inputSatisfaction = Math.min(1, ...SIMPLE_GOODS.filter((g) => need[g] > 0).map((g) => goodSat[g]))

  // Output.
  const researchByTree: Record<TechCategory, number> = { physics: 0, society: 0, engineering: 0 }
  let constructionPoints = 0
  let amenityServices = 0 // commercial services GDP ($B a month)
  let productionUnits = 0
  let militaryPU = 0
  const byBuilding: Partial<Record<SimpleBuildingId, BuildingReport>> = {}
  for (const b of SIMPLE_BUILDINGS) {
    const def = SIMPLE_BUILDING_DEFS[b]
    const run = runs[b]
    const scale = L[b] * efficiency * run
    const built = worlds.reduce((n, w) => n + (w.buildings[b] ?? 0), 0)
    if (built > 0) {
      const output: Partial<Record<SimpleProduct, number>> = {}
      for (const [prod, n] of Object.entries(def.outputs) as [SimpleProduct, number][]) output[prod] = scale * n * (prod === 'construction' ? mods.construction * STANCE_CONSTRUCTION[stance] : 1)
      const upkeep: Partial<Record<SimpleGood, number>> = {}
      for (const [g, n] of Object.entries(def.upkeep) as [SimpleGood, number][]) upkeep[g] = active[b] * n * run
      byBuilding[b] = { levels: built, output, upkeep }
    }
    if (def.pu) {
      productionUnits += L[b] * def.pu * efficiency
      if (def.outputs.alloys) militaryPU += L[b] * def.pu * efficiency
    }
    for (const [prod, n] of Object.entries(def.outputs) as [SimpleProduct, number][]) {
      if (prod === 'construction') constructionPoints += scale * n * mods.construction * STANCE_CONSTRUCTION[stance]
      else if (prod === 'physics' || prod === 'society' || prod === 'engineering') researchByTree[prod as TechCategory] += scale * n
      else if (prod === 'services') amenityServices += scale * n
      else if (prod === 'amenities') continue // counted per world (worldAmenities)
      else produced[prod as SimpleGood] += scale * n
    }
  }
  const research = researchByTree.physics + researchByTree.society + researchByTree.engineering
  const amenitiesRatio = population > 0 ? amenitySupplyWeighted / population : 1

  // Trade on the interstellar market, at fixed values through the exchange rate.
  // Exports are limited by what's on hand; imports by the treasury.
  let importCost = 0
  let exportRevenue = 0
  let cash = Math.max(0, s.treasury)
  const rate = Math.max(0.01, s.currency.rate)
  for (const g of SIMPLE_GOODS) {
    const q = s.trade[g] ?? 0
    if (q < 0) {
      const onHand = Math.max(0, stock[g] + produced[g] - used[g])
      const sell = Math.min(-q, onHand)
      traded[g] = -sell
      exportRevenue += (sell * GOOD_VALUE[g] * EXPORT_DISCOUNT) / rate
    } else if (q > 0) {
      const unit = importUnitCost(s, g)
      const buy = Math.min(q, unit > 0 ? cash / unit : q)
      traded[g] = buy
      importCost += buy * unit
      cash -= buy * unit
    }
  }

  // Strata: each household belongs to the stratum of the job it works (the
  // dependants who don't work follow their household's share).
  let specialistJobs = 0
  let workerJobs = 0
  for (const w of worlds) {
    const staffing = worldStaffing(w)
    for (const b of SIMPLE_BUILDINGS) {
      const filled = (w.buildings[b] ?? 0) * SIMPLE_BUILDING_DEFS[b].jobs * staffing
      if (SIMPLE_BUILDING_DEFS[b].stratum === 'specialists') specialistJobs += filled
      else workerJobs += filled
    }
  }
  const unemployedWorkers = Math.max(0, workforce - specialistJobs - workerJobs)
  const perWorker = workforce > 0 ? population / workforce : 0
  const stratumPop: Record<Stratum, number> = {
    workers: workerJobs * perWorker,
    specialists: specialistJobs * perWorker,
    unemployed: unemployedWorkers * perWorker,
  }

  // Pop upkeep comes out of what's left; a shortage is shared by everyone.
  const needs = Object.fromEntries(NEED_GOODS.map((g) => [g, { demand: 0, got: 0 }])) as Record<NeedGood, { demand: number; got: number }>
  const goodSatisfaction = {} as Record<NeedGood, number>
  for (const g of NEED_GOODS) {
    for (const st of STRATA) needs[g].demand += stratumPop[st] * POP_UPKEEP[st][g]
    const avail = Math.max(0, stock[g] + produced[g] - used[g] + traded[g])
    needs[g].got = Math.min(needs[g].demand, avail)
    consumed[g] = needs[g].got
    goodSatisfaction[g] = needs[g].demand > 0 ? needs[g].got / needs[g].demand : 1
  }
  const foodSatisfaction = goodSatisfaction.food
  const upkeepMet = Math.min(...NEED_GOODS.map((g) => goodSatisfaction[g]))

  // Happiness per stratum, and approval.
  const welfare = clamp(s.welfare, 0, 1)
  const strata = {} as Record<Stratum, StratumReport>
  let approvalSum = 0
  for (const st of STRATA) {
    const parts: { label: string; value: number }[] = []
    const add = (label: string, value: number) => {
      if (Math.abs(value) > 1e-6) parts.push({ label, value })
    }
    add(st === 'unemployed' ? 'No job' : st === 'specialists' ? 'Specialist work' : 'Work', STRATUM_HAPPINESS[st])
    add('Welfare', WELFARE_HAPPINESS[st] * welfare)
    add(economyTypeLabel(s.economyType) + ' economy', TYPE_HAPPINESS[s.economyType][st])
    for (const g of NEED_GOODS) {
      if (POP_UPKEEP[st][g] > 0) add(`${g === 'food' ? 'Food' : g === 'consumerGoods' ? 'Consumer goods' : 'Electronics'} shortage`, -SHORTAGE_HAPPINESS[g] * (1 - goodSatisfaction[g]))
    }
    add('Amenities', amenitiesHappiness(amenitiesRatio))
    add('Inflation', -Math.min(0.3, Math.max(0, s.inflation) * INFLATION_HAPPINESS))
    if (s.warTaxes) add('War taxes', -WAR_TAX_HAPPINESS)
    const happiness = clamp(0.5 + parts.reduce((n, p) => n + p.value, 0), 0, 1)
    strata[st] = { population: stratumPop[st], happiness, parts }
    approvalSum += stratumPop[st] * happiness
  }
  const approval = population > 0 ? approvalSum / population : 0.5

  const net = emptyStockpile()
  for (const g of SIMPLE_GOODS) net[g] = produced[g] - used[g] - consumed[g] + traded[g]

  // GDP — value added (output minus inputs used up) plus services.
  let grossValue = constructionPoints * CP_VALUE + research * RESEARCH_VALUE
  for (const g of SIMPLE_GOODS) grossValue += produced[g] * GOOD_VALUE[g]
  let inputValue = 0
  for (const g of SIMPLE_GOODS) inputValue += used[g] * GOOD_VALUE[g]
  const services = population * SERVICES_PER_POP * (0.5 + s.stability) * productivity + amenityServices
  const productivityGrowth = productivityGrowthFor(research, population)
  const realGdp = Math.max(1, (grossValue - inputValue + services) * TICKS_PER_YEAR)
  const gdp = realGdp * s.priceLevel

  // Budget (annual).
  const unrest = s.stability < UNREST_BELOW
  const baseRevenue = s.taxRate * gdp * TAX_YIELD * mods.taxYield * (unrest ? 1 - UNREST_TAX_PENALTY : 1)
  const revenue = baseRevenue * (s.warTaxes ? 1 + WAR_TAX_REVENUE : 1)
  const expMilitary = MILITARY_UPKEEP_PER_PU * militaryPU * s.priceLevel
  const expCivil = GOV_SHARE_OF_GDP * gdp * 0.6
  const expOther = GOV_SHARE_OF_GDP * gdp * 0.4
  const expWelfare = clamp(s.welfare, 0, 1) * WELFARE_PER_POP * population * s.priceLevel
  const expDebt = DEBT_SERVICE_RATE * s.debt
  const spending = expMilitary + expCivil + expOther + expWelfare + expDebt
  const balance = revenue - spending
  const debtToGdp = gdp > 0 ? s.debt / gdp : 0
  const rating = creditRating(debtToGdp)

  // Stability follows approval (50% approval holds it at 50%).
  const stabilityTarget = clamp(approval, 0, 1)

  // Inflation's pressures.
  const unemploymentRate = workforce > 0 ? unemployedWorkers / workforce : 0
  const consumerShortage = 1 - goodSatisfaction.consumerGoods + 0.5 * (1 - goodSatisfaction.electronics)
  const currencyWeakness = s.currency.baseRate > 0 ? 1 - s.currency.rate / s.currency.baseRate : 0
  const inflationParts = [
    { label: 'Base', value: BASE_INFLATION },
    { label: unemploymentRate < NATURAL_UNEMPLOYMENT ? 'Tight jobs market' : 'Unemployment', value: PHILLIPS * (NATURAL_UNEMPLOYMENT - unemploymentRate) },
    { label: 'Shortages', value: SHORTAGE_INFLATION * consumerShortage },
    { label: balance < 0 ? 'Budget deficit' : 'Budget surplus', value: -DEFICIT_INFLATION * (gdp > 0 ? balance / gdp : 0) },
    { label: currencyWeakness > 0 ? 'Weak currency' : 'Strong currency', value: IMPORT_INFLATION * currencyWeakness },
    { label: `${stance[0].toUpperCase()}${stance.slice(1)} money`, value: STANCE_INFLATION[stance] },
  ].filter((p) => Math.abs(p.value) > 5e-5)
  const inflationTarget = clamp(
    inflationParts.reduce((n, p) => n + p.value, 0),
    MIN_INFLATION_TARGET,
    MAX_INFLATION_TARGET,
  )

  return {
    population,
    efficiency,
    workforce,
    jobs,
    productionUnits,
    militaryPU,
    inputSatisfaction,
    inputShortages: SIMPLE_GOODS.filter((g) => need[g] > 0 && goodSat[g] < 0.999),
    mineralsNeeded: need.minerals,
    energyNeeded: need.energy,
    constructionPoints,
    research,
    researchByTree,
    byBuilding,
    amenities: { need: amenityNeed, supply: amenitySupply, ratio: amenitiesRatio },
    productivity,
    productivityGrowth,
    produced,
    used,
    consumed,
    traded,
    net,
    needs,
    goodSatisfaction,
    upkeepMet,
    foodSatisfaction,
    strata,
    approval,
    importCost,
    exportRevenue,
    tradeBalance: exportRevenue - importCost,
    tradeCapacity,
    infrastructure,
    infrastructureUsage,
    marketAccess,
    launch,
    interstellarTransport,
    realGdp,
    gdp,
    revenue,
    spending,
    balance,
    deficitPctGdp: gdp > 0 ? balance / gdp : 0,
    debtToGdp,
    debtCeilingPct: debtCeiling(rating),
    rating,
    revIncome: revenue * 0.55,
    revBusiness: revenue * 0.2,
    revExcise: revenue * 0.2,
    revOther: revenue * 0.05,
    expMilitary,
    expCivil,
    expWelfare,
    expDebt,
    expOther,
    stabilityTarget,
    inflationTarget,
    inflationParts,
    unrest,
  }
}

// Annual productivity growth from a month's research and the population
// (millions) — see PRODUCTIVITY_*.
export function productivityGrowthFor(researchPerMonth: number, populationMillions: number): number {
  const perBillion = populationMillions > 0 ? researchPerMonth / (populationMillions / 1000) : 0
  return PRODUCTIVITY_BASE + (PRODUCTIVITY_RESEARCH_MAX * perBillion) / (perBillion + PRODUCTIVITY_RESEARCH_HALF)
}

// The exchange rate fundamentals pull toward: low inflation, stability, low
// debt and a trade surplus strengthen a currency.
export function fundamentalRate(s: AbstractEconomyState, r: Pick<AbstractReport, 'debtToGdp' | 'tradeBalance' | 'gdp'>): number {
  const tradePct = r.gdp > 0 ? clamp((r.tradeBalance * TICKS_PER_YEAR) / r.gdp, -0.2, 0.2) : 0
  return clamp(
    s.currency.baseRate *
      Math.exp(-4 * (s.inflation - 0.02)) *
      (1 + 0.3 * (s.stability - 0.6)) *
      Math.exp(-0.3 * Math.max(0, r.debtToGdp - 0.6)) *
      Math.exp(3 * tradePct),
    0.05,
    10,
  )
}

export interface TickResult {
  state: AbstractEconomyState
  worlds: WorldState[]
  stock: Stockpile
  report: AbstractReport // the month just run
  completed: ConstructionOrder[]
}

// Advance one nation by one month. `worlds` are the worlds it controls (owned
// and not occupied); orders for any other world are paused. Pure.
export function tickAbstractEconomy(s: AbstractEconomyState, worlds: WorldState[], stock: Stockpile): TickResult {
  const r = abstractReport(s, worlds, stock)

  // Stockpile.
  const nextStock = { ...stock }
  for (const g of SIMPLE_GOODS) nextStock[g] = Math.max(0, stock[g] + r.net[g])

  // Construction: points go to the queue in order, each project capped per month.
  let cp = r.constructionPoints
  const byName = new Map(worlds.map((w) => [w.bodyName, { ...w, buildings: { ...w.buildings } }]))
  const queue: ConstructionOrder[] = []
  const completed: ConstructionOrder[] = []
  for (const o of s.queue) {
    const w = byName.get(o.bodyName)
    if (!w || cp <= 0) {
      queue.push(o)
      continue
    }
    const put = Math.min(cp, MAX_CP_PER_ORDER, orderCost(o) - o.progress)
    cp -= put
    const next = { ...o, progress: o.progress + put }
    const done = next.progress >= orderCost(o) - 1e-9
    if (done && o.district && districtLevelsTotal(w) < landOf(w)) {
      w.districts = { ...districtsOf(w), [o.district]: districtsOf(w)[o.district] + 1 }
      completed.push(next)
    } else if (done && o.building && (!takesSlot(o.building) || buildingsInDistrict(w, DISTRICT_OF_BUILDING[o.building]) < districtSlots(w, DISTRICT_OF_BUILDING[o.building]))) {
      w.buildings[o.building] = (w.buildings[o.building] ?? 0) + 1
      completed.push(next)
    } else queue.push(next)
  }

  // Deconstruction: each bar runs down on its own clock (no construction points,
  // no queue place) and the thing is removed when it reaches zero.
  const teardowns: Teardown[] = []
  for (const t of s.teardowns ?? []) {
    const w = byName.get(t.bodyName)
    if (!w) {
      teardowns.push(t) // paused: the world isn't ours to work right now
      continue
    }
    const left = t.progress - teardownCost(t) / teardownMonths(t)
    if (left > 1e-9) {
      teardowns.push({ ...t, progress: left })
      continue
    }
    if (t.building && (w.buildings[t.building] ?? 0) > 0) w.buildings[t.building] = w.buildings[t.building]! - 1
    // A district level only goes if what stands here still fits without it.
    else if (t.district && districtsOf(w)[t.district] > 0 && buildingsInDistrict(w, t.district) <= districtSlots(w, t.district) - SLOTS_PER_DISTRICT) {
      w.districts = { ...districtsOf(w), [t.district]: districtsOf(w)[t.district] - 1 }
    }
  }

  // Population, per world.
  const growth = (POP_GROWTH * (0.5 + r.approval) * (1 + 0.3 * clamp(s.welfare, 0, 1))) / TICKS_PER_YEAR
  const starve = (STARVATION * (1 - r.foodSatisfaction)) / TICKS_PER_YEAR
  const popFactor = 1 + (r.foodSatisfaction >= 0.95 ? growth : -starve)
  const nextWorlds = [...byName.values()].map((w) => {
    // Clinics add their own growth on their world (only while the people are fed).
    let clinic = 0
    if (r.foodSatisfaction >= 0.95) for (const b of SIMPLE_BUILDINGS) clinic += (w.buildings[b] ?? 0) * (SIMPLE_BUILDING_DEFS[b].popGrowth ?? 0)
    return { ...w, population: Math.max(0, w.population * (popFactor + (clinic * worldStaffing(w)) / TICKS_PER_YEAR)) }
  })

  // Stability eases toward its target.
  const stability = clamp(s.stability + (r.stabilityTarget - s.stability) * STAB_SPEED, 0, 1)

  // Budget and trade settle into the treasury; a shortfall is printed or borrowed.
  let treasury = s.treasury + r.balance / TICKS_PER_YEAR + r.tradeBalance
  let debt = s.debt
  let inflation = s.inflation
  if (treasury < 0) {
    const gap = -treasury
    const printed = gap * clamp(s.moneyCreation, 0, 1)
    debt += gap - printed
    inflation += (r.gdp > 0 ? printed / r.gdp : 0) * PRINT_INFLATION
    treasury = 0
  }
  // A surplus stays in the treasury (as the balance shows); paying down debt is
  // a choice — the player's Pay Debt button, the AI's cash rules.
  inflation = r.inflationTarget + (inflation - r.inflationTarget) * (1 - INFLATION_DECAY)
  const priceLevel = s.priceLevel * (1 + inflation / TICKS_PER_YEAR)

  // Currency drifts toward its fundamentals.
  const fund = fundamentalRate(s, r)
  const currency = { ...s.currency, rate: clamp(s.currency.rate + (fund - s.currency.rate) * FX_SPEED, 0.05, 10) }

  const state: AbstractEconomyState = {
    ...s,
    productivity: r.productivity * (1 + r.productivityGrowth / TICKS_PER_YEAR),
    population: r.population,
    gdp: r.gdp,
    realGdp: r.realGdp,
    priceLevel,
    inflation,
    stability,
    treasury,
    debt,
    queue,
    teardowns,
    currency,
  }
  return { state, worlds: nextWorlds, stock: nextStock, report: r, completed }
}
