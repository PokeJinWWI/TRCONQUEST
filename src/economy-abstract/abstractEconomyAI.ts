// Simple mode's economy AI: how a non-player nation runs its own economy
// each month. Complex mode never calls this.
//
// Pure and headless: takes a nation's state plus what it can see (its worlds,
// stockpile, this month's report, whether it's at war) and returns the state
// with its levers moved. Levers move GRADUALLY (the allocation eases toward a
// target, tax and welfare step) so a nation doesn't whipsaw month to month.
// Economy type is left alone — it's the nation's identity, not a dial.

import {
  consumerPUNeeded,
  debtCeiling,
  freeSlots,
  freeLand,
  normalizeAllocation,
  worldJobs,
  worldWorkforce,
  MAX_CP_PER_ORDER,
  type AbstractEconomyState,
  type AbstractReport,
  type Allocation,
  type Stockpile,
  type TradeOrders,
  type WorldState,
} from './abstractEconomy'
import { DISTRICT_OF_BUILDING, SIMPLE_BUILDING_DEFS, type SimpleBuildingId } from '../data/simplisticEconomyData'

export interface AbstractAIContext {
  atWar: boolean
  worlds: WorldState[]
  stock: Stockpile
  report: AbstractReport
}

// --- Tuning ---------------------------------------------------------------------
const MILITARY_SHARE_PEACE = 0.15
const MILITARY_SHARE_WAR = 0.35
const CONSUMER_MARGIN = 1.05 // aim consumer output this far above need
const CONSUMER_SHARE_MIN = 0.1
const CONSUMER_SHARE_MAX = 0.6
const UNREST_CONSUMER_BONUS = 0.1 // extra consumer share when stability is low
const CIVILIAN_SHARE_MIN = 0.1
const ALLOCATION_EASE = 0.25 // fraction of the gap to the target closed per month
const LOW_STABILITY = 0.35
const WAR_TAX_MIN_STABILITY = 0.45
const TAX_STEP = 0.005
const TAX_MIN = 0.05
const TAX_MAX = 0.3
const DEFICIT_RAISE = -0.01
const SURPLUS_SPEND = 0.02 // a surplus past this share of GDP is spent: welfare first, then tax cuts
const PAY_DEBT_ABOVE = 0.5
const CEILING_PRESSURE = 0.9
const PRINT_RATE = 0.5
const PRINT_MAX_INFLATION = 0.06
const CASH_HIGH_MONTHS = 6
const CASH_KEEP_MONTHS = 3
const CASH_LOW_MONTHS = 1
const CASH_REFILL_MONTHS = 2
const WELFARE_STEP = 0.05
const WELFARE_RAISE_BELOW = 0.5 // stability under which welfare goes up (if affordable)
const WELFARE_CUT_ABOVE = 0.6 // stability over which a deficit cuts welfare
const IMPORT_COVER_MONTHS = 6 // import a need once the stockpile covers fewer months of shortfall
const IMPORT_MARGIN = 1.2
const EXPORT_ABOVE = 3000 // export part of a bulk good's surplus once stockpiled past this
const EXPORT_SHARE = 0.25
const EXOTIC_TARGET = 2 // keep at least this much exotic matter coming in per month
const FACTORIES_PER_LAB = 6
const JOB_HEADROOM = 0.05
const TIGHTEN_ABOVE = 0.04 // inflation above this → tight money…
const UNTIGHTEN_BELOW = 0.025 // …held until it's back under this
const LOOSEN_BELOW = 0.01 // below this → loose money…
const UNLOOSEN_ABOVE = 0.0175 // …held until it's back over this // build until jobs exceed the workforce by this much
const FACTORIES_PER_REFINERY = 8

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

// The production split the nation wants.
export function targetAllocation(s: AbstractEconomyState, ctx: Pick<AbstractAIContext, 'atWar' | 'report'>): Allocation {
  const r = ctx.report
  let consumer = r.productionUnits > 0 ? (consumerPUNeeded(r) * CONSUMER_MARGIN) / r.productionUnits : CONSUMER_SHARE_MAX
  if (s.stability < LOW_STABILITY) consumer += UNREST_CONSUMER_BONUS
  consumer = clamp(consumer, CONSUMER_SHARE_MIN, CONSUMER_SHARE_MAX)
  let military = ctx.atWar ? MILITARY_SHARE_WAR : MILITARY_SHARE_PEACE
  military = Math.min(military, 1 - consumer - CIVILIAN_SHARE_MIN)
  return normalizeAllocation({ civilian: 1 - consumer - military, military, consumer })
}

function levels(worlds: WorldState[], b: SimpleBuildingId): number {
  return worlds.reduce((n, w) => n + (w.buildings[b] ?? 0), 0)
}

// What to build next, by need: feed people, then keep industry's inputs
// flowing, then strategic fuel and research, then more industry.
export function nextBuilding(s: AbstractEconomyState, ctx: AbstractAIContext): SimpleBuildingId {
  const r = ctx.report
  const queued = (b: SimpleBuildingId) => s.queue.some((o) => o.building === b || (o.district && o.district === DISTRICT_OF_BUILDING[b]))
  const factories = levels(ctx.worlds, 'factory')
  // A drained stockpile shows a net of 0, not a deficit — so compare this
  // month's output against what's wanted too.
  const energyShort = r.net.energy < 0 || r.produced.energy < r.energyNeeded
  const mineralsShort = r.net.minerals < 0 || r.produced.minerals < r.mineralsNeeded
  if ((r.net.food < 0 || r.produced.food < r.needs.food.demand) && !queued('farm')) return 'farm'
  if (energyShort && !queued('powerPlant')) return 'powerPlant'
  if (mineralsShort && !queued('mine')) return 'mine'
  if (r.net.exoticMatter < EXOTIC_TARGET && levels(ctx.worlds, 'exoticRefinery') * FACTORIES_PER_REFINERY < factories && !queued('exoticRefinery')) return 'exoticRefinery'
  if (levels(ctx.worlds, 'researchLab') * FACTORIES_PER_LAB < factories && !queued('researchLab')) return 'researchLab'
  return 'factory'
}

// The world with the most spare workers that can take the building — one with a
// free slot in the building's district, or land to develop that district first.
// A nation builds a little AHEAD of its labour force (up to JOB_HEADROOM more
// jobs than workers): the new jobs fill as the population grows, so output rises
// month by month instead of in a step every time enough idle workers pile up.
export function worldFor(s: AbstractEconomyState, worlds: WorldState[], b: SimpleBuildingId): WorldState | null {
  const need = SIMPLE_BUILDING_DEFS[b].jobs
  const d = DISTRICT_OF_BUILDING[b]
  let best: WorldState | null = null
  let bestSpare = -Infinity
  for (const w of worlds) {
    const queuedJobs = s.queue.filter((o) => o.bodyName === w.bodyName && o.building).reduce((n, o) => n + SIMPLE_BUILDING_DEFS[o.building!].jobs, 0)
    const spare = worldWorkforce(w) * (1 + JOB_HEADROOM) - worldJobs(w) - queuedJobs
    if (spare < need || (freeSlots(w, s.queue, d) <= 0 && freeLand(w, s.queue) <= 0)) continue
    if (spare > bestSpare) {
      bestSpare = spare
      best = w
    }
  }
  return best
}

// Standing trade orders: import a need that's running out; export part of the
// surplus of a bulk good piling up.
export function tradeOrders(ctx: AbstractAIContext): TradeOrders {
  const r = ctx.report
  const trade: TradeOrders = {}
  for (const g of ['food', 'consumerGoods', 'electronics'] as const) {
    const netWithoutTrade = r.net[g] - r.traded[g]
    if (netWithoutTrade < 0 && ctx.stock[g] < -netWithoutTrade * IMPORT_COVER_MONTHS) trade[g] = Math.ceil(-netWithoutTrade * IMPORT_MARGIN)
  }
  for (const g of ['food', 'minerals', 'energy'] as const) {
    if (trade[g]) continue
    const netWithoutTrade = r.net[g] - r.traded[g]
    if (netWithoutTrade > 0 && ctx.stock[g] > EXPORT_ABOVE) trade[g] = -Math.floor(netWithoutTrade * EXPORT_SHARE)
  }
  return trade
}

// One month of AI policy for one nation. Returns a new state.
export function applyAbstractEconomyAI(s: AbstractEconomyState, ctx: AbstractAIContext): AbstractEconomyState {
  const r = ctx.report

  // Production split — ease toward the target.
  const cur = normalizeAllocation(s.allocation)
  const tgt = targetAllocation(s, ctx)
  const ease = (a: number, b: number) => a + (b - a) * ALLOCATION_EASE
  const allocation = normalizeAllocation({
    civilian: ease(cur.civilian, tgt.civilian),
    military: ease(cur.military, tgt.military),
    consumer: ease(cur.consumer, tgt.consumer),
  })

  // Budget — aim for a small surplus. A deficit raises taxes (and, when calm,
  // trims welfare); a big surplus buys welfare first, then cuts taxes. Unrest
  // buys welfare whenever the budget is in the black.
  let taxRate = s.taxRate
  let welfare = s.welfare
  if (r.deficitPctGdp < DEFICIT_RAISE) {
    taxRate += TAX_STEP
    if (s.stability > WELFARE_CUT_ABOVE) welfare -= WELFARE_STEP
  } else if (s.stability < WELFARE_RAISE_BELOW && r.balance > 0) welfare += WELFARE_STEP
  else if (r.deficitPctGdp > SURPLUS_SPEND) {
    if (welfare < 1) welfare += WELFARE_STEP
    else taxRate -= TAX_STEP
  }
  taxRate = clamp(taxRate, Math.min(TAX_MIN, s.taxRate), Math.max(TAX_MAX, s.taxRate))
  welfare = clamp(welfare, 0, 1)

  // Money creation — only near the debt ceiling with inflation tame.
  const nearCeiling = r.debtToGdp >= debtCeiling(r.rating) * CEILING_PRESSURE
  const moneyCreation = nearCeiling && s.inflation < PRINT_MAX_INFLATION ? PRINT_RATE : 0

  // Monetary stance — lean against inflation, holding a stance until inflation is
  // well back toward 2% (hysteresis), so it never flip-flops month to month.
  let monetaryStance = s.monetaryStance ?? 'neutral'
  if (s.inflation > TIGHTEN_ABOVE) monetaryStance = 'tight'
  else if (s.inflation < LOOSEN_BELOW) monetaryStance = 'loose'
  else if (monetaryStance === 'tight' && s.inflation < UNTIGHTEN_BELOW) monetaryStance = 'neutral'
  else if (monetaryStance === 'loose' && s.inflation > UNLOOSEN_ABOVE) monetaryStance = 'neutral'

  // War taxes — at war and stable enough; dropped in peace or unrest.
  const warTaxes = ctx.atWar && s.stability >= (s.warTaxes ? LOW_STABILITY : WAR_TAX_MIN_STABILITY)

  // Cash — spare treasury repays debt (or builds reserves); a thin one draws reserves.
  const monthly = r.spending / 12
  let treasury = s.treasury
  let reserves = s.reserves
  let debt = s.debt
  if (monthly > 0 && treasury > CASH_HIGH_MONTHS * monthly) {
    const spare = treasury - CASH_KEEP_MONTHS * monthly
    treasury -= spare
    if (r.debtToGdp > PAY_DEBT_ABOVE && debt > 0) {
      const paid = Math.min(debt, spare)
      debt -= paid
      reserves += spare - paid
    } else reserves += spare
  } else if (monthly > 0 && treasury < CASH_LOW_MONTHS * monthly && reserves > 0) {
    const draw = Math.min(reserves, CASH_REFILL_MONTHS * monthly - treasury)
    reserves -= draw
    treasury += draw
  }

  // Construction — keep enough projects queued to use every construction point.
  let queue = s.queue
  let nextOrderId = s.nextOrderId
  const wanted = Math.ceil(r.constructionPoints / MAX_CP_PER_ORDER)
  if (queue.length < wanted) {
    const building = nextBuilding(s, ctx)
    const world = worldFor(s, ctx.worlds, building)
    if (world) {
      // No free slot in its district yet: develop the district first; the
      // building follows once the district level stands.
      const d = DISTRICT_OF_BUILDING[building]
      const order = freeSlots(world, queue, d) > 0 ? { building } : { district: d }
      queue = [...queue, { id: nextOrderId, bodyName: world.bodyName, ...order, progress: 0 }]
      nextOrderId++
    }
  }

  return { ...s, allocation, taxRate, welfare, moneyCreation, monetaryStance, warTaxes, treasury, reserves, debt, queue, nextOrderId, trade: tradeOrders(ctx) }
}
