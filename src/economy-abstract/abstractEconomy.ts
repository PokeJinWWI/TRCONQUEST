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
//   Currency   a floating exchange rate vs the Terra Standard Credit, driven by
//              inflation, stability, debt and the trade balance; it prices
//              imports/exports on the interstellar market.
//
// Pure and headless (no store/DOM). The store (state/abstractEconomyStore.ts)
// holds the states, syncs the stockpile and advances it monthly.

import {
  ACADEMIC_TO_INDUSTRIAL,
  CLUSTER_MAX,
  CLUSTER_PER_BUILDING,
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

// How the national production pool is split (fractions, normalized to sum to 1).
export interface Allocation {
  civilian: number // construction points — builds new buildings
  military: number // alloys for the war machine
  consumer: number // consumer goods + electronics for the population
}

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
}

// A project in the construction queue: one building level, or one district level.
export interface ConstructionOrder {
  id: number
  bodyName: string
  building?: SimpleBuildingId
  district?: SimpleDistrictId
  progress: number // construction points put in so far
}

export interface Currency {
  code: string
  name: string
  rate: number // TSC value of one unit (higher = stronger)
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
  allocation: Allocation
  researchFocus: TechCategory
  monetaryStance?: MonetaryStance // default neutral
  // Productivity: output per worker, 1 at game start. Everything buildings and
  // services produce is multiplied by it; it grows every month, faster the more
  // research the nation does per person (see productivityGrowth). Optional so
  // older states and test literals default to 1.
  productivity?: number
  // Construction queue (worked in order) and the next order id.
  queue: ConstructionOrder[]
  nextOrderId: number
  currency: Currency
  trade: TradeOrders
}

// --- Balance constants ---------------------------------------------------------
const WORKFORCE_SHARE = 0.42 // share of a world's population in the labour force (the rest: children, retirees, carers)
const PU_PER_FACTORY = 10
const FARM_FOOD = 6
const MINE_MINERALS = 25
const POWER_ENERGY = 30
const LAB_RESEARCH = 2.5
const LAB_ENERGY = 3
const LAB_ELECTRONICS = 0.5
const REFINERY_EXOTIC = 3
const REFINERY_HYPERIUM = 0.5
const REFINERY_ENERGY = 10
const MINERALS_PER_PU = 1 // military + consumer PU
const ENERGY_PER_PU = 0.5 // every PU
const ALLOYS_PER_PU = 1.5
const CONSUMER_GOODS_PER_PU = 0.5
const ELECTRONICS_PER_PU = 0.1
const CP_PER_PU = 1
const MINERALS_PER_CP = 0.3
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
const SPECIALIST_BUILDINGS: SimpleBuildingId[] = ['researchLab', 'exoticRefinery']
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

export function normalizeAllocation(a: Allocation): Allocation {
  const sum = a.civilian + a.military + a.consumer
  if (sum <= 0) return { civilian: 1 / 3, military: 1 / 3, consumer: 1 / 3 }
  return { civilian: a.civilian / sum, military: a.military / sum, consumer: a.consumer / sum }
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
  let n = d === 'urban' ? w.foreignSlots ?? 0 : 0
  for (const b of SIMPLE_DISTRICT_DEFS[d].buildings) n += w.buildings[b] ?? 0
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
// Free slots in the district a building belongs to, counting queued buildings.
export function freeSlots(w: WorldState, queue: ConstructionOrder[], d: SimpleDistrictId): number {
  const queued = queue.filter((o) => o.bodyName === w.bodyName && o.building && DISTRICT_OF_BUILDING[o.building] === d).length
  return districtSlots(w, d) - buildingsInDistrict(w, d) - queued
}
// Free land for more district levels, counting queued districts.
export function freeLand(w: WorldState, queue: ConstructionOrder[]): number {
  const queued = queue.filter((o) => o.bodyName === w.bodyName && o.district).length
  return landOf(w) - districtLevelsTotal(w) - queued
}
export function orderCost(o: Pick<ConstructionOrder, 'building' | 'district'>): number {
  return o.district ? DISTRICT_COST : o.building ? SIMPLE_BUILDING_DEFS[o.building].cost : 0
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
    if (SPECIALIST_BUILDINGS.includes(b)) specialistJobs += jobs * staffing
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

// The ecosystem bonus a district gives the buildings in it: a cluster bonus for
// every building beyond the first (suppliers, skilled labour, shared
// infrastructure), capped; industry also gains from research parks (academic
// district levels) on the same world.
export function districtBonus(w: WorldState, d: SimpleDistrictId): { cluster: number; link: number; total: number } {
  const cluster = Math.min(CLUSTER_MAX, CLUSTER_PER_BUILDING * Math.max(0, buildingsInDistrict(w, d) - 1))
  const link = d === 'industrial' ? Math.min(LINK_MAX, ACADEMIC_TO_INDUSTRIAL * districtsOf(w).academic) : 0
  return { cluster, link, total: cluster + link }
}

// The consumer PU needed to cover the population's consumer goods and
// electronics (plus the labs' electronics) at this month's input satisfaction.
export function consumerPUNeeded(r: AbstractReport): number {
  const sat = Math.max(0.05, r.inputSatisfaction)
  const forGoods = r.needs.consumerGoods.demand / (CONSUMER_GOODS_PER_PU * sat)
  const forElectronics = (r.needs.electronics.demand + r.used.electronics) / (ELECTRONICS_PER_PU * sat)
  return Math.max(forGoods, forElectronics)
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
  productionUnits: number
  civilianPU: number
  militaryPU: number
  consumerPU: number
  inputSatisfaction: number // share of industry's minerals/energy needs met
  mineralsNeeded: number // what industry + construction wanted this month
  energyNeeded: number
  constructionPoints: number
  research: number
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

export interface StratumReport {
  population: number // millions, dependants included
  happiness: number // 0..1
  // What moves this stratum's happiness (signed parts; happiness = 0.5 + Σ, clamped).
  parts: { label: string; value: number }[]
}

export function abstractReport(s: AbstractEconomyState, worlds: WorldState[], stock: Stockpile): AbstractReport {
  const mods = TYPE_MODS[s.economyType]
  const productivity = s.productivity ?? 1
  const efficiency = (0.8 + 0.4 * s.stability) * mods.production * productivity
  const alloc = normalizeAllocation(s.allocation)

  // Staffed building levels, nationally.
  const L = Object.fromEntries(SIMPLE_BUILDINGS.map((b) => [b, 0])) as Record<SimpleBuildingId, number>
  let population = 0
  let workforce = 0
  let jobs = 0
  for (const w of worlds) {
    const staffing = worldStaffing(w)
    const intact = 1 - DEVASTATION_OUTPUT_LOSS * Math.min(1, Math.max(0, w.devastation ?? 0))
    for (const b of SIMPLE_BUILDINGS) L[b] += (w.buildings[b] ?? 0) * staffing * intact * (1 + districtBonus(w, DISTRICT_OF_BUILDING[b]).total)
    population += w.population
    workforce += worldWorkforce(w)
    jobs += worldJobs(w)
  }

  const produced = emptyStockpile()
  const used = emptyStockpile()
  const consumed = emptyStockpile()
  const traded = emptyStockpile()

  // Primary goods.
  produced.food = L.farm * FARM_FOOD * efficiency
  produced.minerals = L.mine * MINE_MINERALS * efficiency
  produced.energy = L.powerPlant * POWER_ENERGY * efficiency

  // Industry: PU split by allocation; inputs drawn from stock + this month's output.
  const PU = L.factory * PU_PER_FACTORY * efficiency
  const civilianPU = PU * alloc.civilian
  const militaryPU = PU * alloc.military
  const consumerPU = PU * alloc.consumer
  const stance = s.monetaryStance ?? 'neutral'
  const cpRaw = civilianPU * CP_PER_PU * mods.construction * STANCE_CONSTRUCTION[stance]
  const needMinerals = (militaryPU + consumerPU) * MINERALS_PER_PU + cpRaw * MINERALS_PER_CP
  const needEnergy = PU * ENERGY_PER_PU + L.researchLab * LAB_ENERGY + L.exoticRefinery * REFINERY_ENERGY
  const availMinerals = Math.max(0, stock.minerals) + produced.minerals
  const availEnergy = Math.max(0, stock.energy) + produced.energy
  const inputSatisfaction = Math.min(1, needMinerals > 0 ? availMinerals / needMinerals : 1, needEnergy > 0 ? availEnergy / needEnergy : 1)
  used.minerals = needMinerals * inputSatisfaction
  used.energy = needEnergy * inputSatisfaction

  produced.alloys = militaryPU * ALLOYS_PER_PU * inputSatisfaction
  produced.consumerGoods = consumerPU * CONSUMER_GOODS_PER_PU * inputSatisfaction
  produced.electronics = consumerPU * ELECTRONICS_PER_PU * inputSatisfaction
  produced.exoticMatter = L.exoticRefinery * REFINERY_EXOTIC * efficiency * inputSatisfaction
  produced.hyperium = L.exoticRefinery * REFINERY_HYPERIUM * efficiency * inputSatisfaction
  const constructionPoints = cpRaw * inputSatisfaction

  // Labs run on electronics (before the population gets any).
  const labElectronics = L.researchLab * LAB_ELECTRONICS
  const availElectronics = Math.max(0, stock.electronics) + produced.electronics
  const labSat = labElectronics > 0 ? Math.min(1, availElectronics / labElectronics) : 1
  used.electronics = labElectronics * labSat
  const research = L.researchLab * LAB_RESEARCH * efficiency * inputSatisfaction * labSat

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
      const unit = (GOOD_VALUE[g] * IMPORT_MARKUP) / rate
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
      if (SPECIALIST_BUILDINGS.includes(b)) specialistJobs += filled
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
  const services = population * SERVICES_PER_POP * (0.5 + s.stability) * productivity
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
    productionUnits: PU,
    civilianPU,
    militaryPU,
    consumerPU,
    inputSatisfaction,
    mineralsNeeded: needMinerals,
    energyNeeded: needEnergy,
    constructionPoints,
    research,
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
    } else if (done && o.building && buildingsInDistrict(w, DISTRICT_OF_BUILDING[o.building]) < districtSlots(w, DISTRICT_OF_BUILDING[o.building])) {
      w.buildings[o.building] = (w.buildings[o.building] ?? 0) + 1
      completed.push(next)
    } else queue.push(next)
  }

  // Population, per world.
  const growth = (POP_GROWTH * (0.5 + r.approval) * (1 + 0.3 * clamp(s.welfare, 0, 1))) / TICKS_PER_YEAR
  const starve = (STARVATION * (1 - r.foodSatisfaction)) / TICKS_PER_YEAR
  const popFactor = 1 + (r.foodSatisfaction >= 0.95 ? growth : -starve)
  const nextWorlds = [...byName.values()].map((w) => ({ ...w, population: Math.max(0, w.population * popFactor) }))

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
    currency,
  }
  return { state, worlds: nextWorlds, stock: nextStock, report: r, completed }
}
