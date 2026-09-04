// The economy simulation — pure functions, no store access, same style as the
// combat resolver. Layers (design doc v2):
//   - tickWorld: one inhabited world's LOCAL economy (labor, market, needs +
//     Standard of Living, production, construction). Reports tax/admin/GDP up.
//   - tickEconomy: runs every world, settles each COUNTRY's national budget into
//     one treasury, and pays each CORPORATION its buildings' profit.
//
// Milestone 2 added Production Methods, qualification-gated employment and
// throughput ramping. Milestone 3 adds the Standard-of-Living loop (wealth +
// needs → SoL → population growth, education drift, and how far up the needs
// tiers a pop reaches) and building OWNERSHIP (state / corporation / worker),
// which routes each building's profit to a different place.

import { GOOD_IDS, GOODS, priceFloor, priceCeiling, type GoodId } from './goods'
import { NEED_TIERS, SPECIES_TEMPLATES, type NeedTier } from './species'
import { POP_CLASSES, RECIPES, BUREAUCRACY_OUTPUT, LOGISTICS_OUTPUT, DISTRICT_TYPES, getMethod, qualificationFraction, districtOfRecipe, type PopClass, type ProductionMethod, type DistrictType } from './recipes'
import { economicSystemDef, healthcareSystemDef, RETOOL_THROUGHPUT_FACTOR, OWNER_SWITCH_MARGIN, type EconomicSystem } from './laws'
import type {
  Building,
  Corporation,
  Country,
  CreditRating,
  LaborMarket,
  NeedDetailEntry,
  Pop,
  World,
  WorldReport,
  TickReports,
} from './economyTypes'
import { runCountryAI, type CountryAIOptions } from './countryAI'
import { runCorporationAI } from './corporationAI'

const PRICE_ADJUST = 0.15
const WAGE_ADJUST = 0.1
const WAGE_FLOOR = 1.0
const WAGE_CEILING = 40
// Baseline informal/subsistence income every pop earns regardless of formal
// employment (self-provision, barter, the gray economy). Keeps under-employed
// worlds — where there aren't enough building jobs for everyone — from
// collapsing into destitution, without needing a job for every last pop.
const SUBSISTENCE_INCOME = 3.5

// How fast a building's throughput closes on what labor, inputs and demand
// allow. Ramp-up is deliberately slow (kills "profit teleporting"); ramp-down
// is quicker (losing workforce or market bites sooner).
const THROUGHPUT_RAMP_UP = 0.05
const THROUGHPUT_RAMP_DOWN = 0.15
export const NEW_BUILDING_THROUGHPUT = 0.1

// Workers per job slot. Recipe job counts are written at a "hands on the floor"
// scale; this factor sets how many people (in millions) one slot actually
// employs, so the whole building roster's labor demand fits the population.
// Raising it makes labor scarcer (higher wages, more understaffing); lowering
// it means each worker is more productive. Tuned so a world can staff its
// buildings and they run near capacity.
export const JOB_SCALE = 0.15

// --- Standard of Living loop (Milestone 3) ---
// SoL is a weighted blend of how well the pop meets each needs tier; it moves
// smoothly. It drives population growth (well-off pops grow, immiserated ones
// shrink) and education drift (wealthier pops get schooled, qualifying for
// higher jobs — feeding back into the labor market).
const SOL_TIER_WEIGHT: Record<NeedTier, number> = { basic: 0.4, everyday: 0.25, healthcare: 0.15, comfort: 0.12, luxury: 0.08 }
const SOL_SMOOTHING = 0.5
// Growth is SLOW and realistic. Ticks are monthly (12/year), so at the very top
// of the SoL scale a population grows on the order of ~2–3%/year, and real
// deprivation shrinks it at a similar gentle pace. The midpoint sits below 0.5
// so a modest standard of living is roughly stable.
const GROWTH_RATE = 0.0016
const GROWTH_MIDPOINT = 0.35
const EDU_DRIFT = 0.012 // education creeps toward SoL each tick (slow)
const EDU_MAX = 0.98

// Fiscal constants — scaled for a population measured in millions.
const ADMIN_PER_BUILDING_LEVEL = 60
// Baseline public spending per capita — administration, defense, infrastructure
// and the social state beyond healthcare/welfare. Set high enough that a
// generous default government runs a DEFICIT and must manage it (cut spending,
// raise tax, or borrow) — real states rarely run surpluses.
const PUBLIC_SPENDING_PER_CAPITA = 4.5
const DEBT_INTEREST_RATE = 0.008
// Goods depreciate / spoil / are held at a cost, so a glut can't accumulate
// without bound: unsold stock shrinks each tick. This lets buildings run on
// what labor and inputs allow (a deep production chain flows) while a chronic
// oversupply is bled off through the price floor instead of throttling the
// whole chain to a halt.
const INVENTORY_DECAY = 0.08

// Genuinely finite raw resources — extraction buildings producing these are
// capped by (and draw down) `World.resourceDeposits` each tick. Farm crops
// regrow and power/manufactured goods aren't a deposit, so they're excluded.
export const DEPLETABLE_GOODS: GoodId[] = ['ironOre', 'coal', 'oil', 'rareMetals', 'sulfur', 'hardwood', 'timber', 'phosphate']
export const BUILD_COST_PER_LEVEL = 6000
const CONSTRUCTION_CAPACITY = 400
export const TICKS_PER_YEAR = 12

// --- Strategic stockpiles (batch 3) — a simple buffer/reserve, not a full
// commodities model. Each tick closes a CAPPED fraction of the gap between
// current holdings and the player's target: filling from genuine market
// surplus (funded from the treasury, like construction) when below target,
// releasing into that tick's supply to cushion a genuine shortage when
// demand outruns supply. Both directions are additionally capped as a
// fraction of the surplus/shortage itself so the reserve never dominates the
// market it's supposed to be smoothing.
const STOCKPILE_FILL_RATE = 0.1 // fraction of (target - current) bought per tick
const STOCKPILE_RELEASE_RATE = 0.1 // fraction of current holdings released per tick
const STOCKPILE_MAX_SURPLUS_FRACTION = 0.5 // never buy more than half this tick's surplus
const STOCKPILE_MAX_RELEASE_FRACTION = 0.5 // never release more than half this tick's shortage

// --- Bureaucracy ---
// Storage capacity from government buildings (plus a small base), and the
// per-level cost of the state administering things directly. Running a building
// DIRECTLY (state-owned) costs the most bureaucracy; running it through a
// state-owned CORPORATION costs far less (the company's own management does the
// work); a standing decree has an ongoing upkeep too.
const BUREAUCRACY_BASE_CAPACITY = 3000
const BUREAUCRACY_CAP_PER_GOV_LEVEL = 2600
const BUREAUCRACY_PER_STATE_BUILDING_LEVEL = 24
const BUREAUCRACY_PER_STATECORP_BUILDING_LEVEL = 7
const BUREAUCRACY_PER_DECREE = 200
// When the state runs out of bureaucracy, its directly-run enterprises seize up.
const BUREAUCRACY_SHORTAGE_MALUS = 0.6
// Consumer goods the CPI tracks (what households actually buy).
const CPI_WEIGHTS: Partial<Record<GoodId, number>> = {
  food: 1.0,
  consumerGoods: 0.5,
  electricity: 0.3,
  healthcare: 0.2,
  retail: 0.15,
  education: 0.1,
  luxuryGoods: 0.05,
}

export function constructionCost(): number {
  return BUILD_COST_PER_LEVEL
}

export function creditRating(debtToGdp: number): CreditRating {
  if (debtToGdp < 0.3) return 'AAA'
  if (debtToGdp < 0.6) return 'AA'
  if (debtToGdp < 1.0) return 'A'
  if (debtToGdp < 1.5) return 'BBB'
  if (debtToGdp < 2.5) return 'BB'
  if (debtToGdp < 4) return 'B'
  return 'CCC'
}

type PerGood = Record<GoodId, number>
type PerClass = Record<PopClass, number>

function zeroGoods(): PerGood {
  const g = {} as PerGood
  for (const id of GOOD_IDS) g[id] = 0
  return g
}
function zeroClasses(): PerClass {
  return { subsistence: 0, labor: 0, technical: 0, professional: 0, investor: 0, political: 0 }
}
function clearingStep(value: number, demand: number, supply: number, rate: number): number {
  const imbalance = (demand - supply) / Math.max(1, demand + supply)
  return value * (1 + rate * imbalance)
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function rampToward(current: number, target: number): number {
  const delta = target - current
  const step = delta >= 0 ? Math.min(delta, THROUGHPUT_RAMP_UP) : Math.max(delta, -THROUGHPUT_RAMP_DOWN)
  return clamp(current + step, 0, 1)
}
function buildingMethod(building: Building): ProductionMethod | undefined {
  return getMethod(building.recipeId, building.methodId)
}
function jobSlots(building: Building, cls: PopClass): number {
  const method = buildingMethod(building)
  const job = method?.jobs.find((j) => j.class === cls)
  return job ? job.count * building.level * JOB_SCALE : 0
}
// The state runs a building directly only if it OWNS it. Corporation- and
// worker-owned buildings are run by their owners (autonomy applies).
function isStateRun(building: Building): boolean {
  return building.owner.kind === 'state'
}
// Output multiplier: a NON-state building whose method the state has pinned
// suffers the interference malus under a market economy (laws.ts).
function interferenceMultiplier(building: Building, system: EconomicSystem): number {
  if (isStateRun(building) || !building.methodLocked) return 1
  return economicSystemDef(system).interferenceMalus
}
function estimateMethodProfit(method: ProductionMethod, level: number, prices: PerGood, wages: PerClass): number {
  let revenue = 0
  for (const out of method.outputs) revenue += out.amount * level * prices[out.good]
  let cost = 0
  for (const input of method.inputs) cost += input.amount * level * prices[input.good]
  let wageBill = 0
  for (const job of method.jobs) wageBill += job.count * level * JOB_SCALE * wages[job.class]
  return revenue - cost - wageBill
}
function cpi(priceMap: PerGood): number {
  let num = 0
  let den = 0
  for (const g of GOOD_IDS) {
    const w = CPI_WEIGHTS[g] ?? 0
    num += w * priceMap[g]
    den += w * GOODS[g].basePrice
  }
  return den > 0 ? num / den : 1
}

function emptyWorldReport(): WorldReport {
  const goods = {} as WorldReport['goods']
  for (const g of GOOD_IDS) goods[g] = { supply: 0, demand: 0, transacted: 0, price: 0 }
  const labor = {} as WorldReport['labor']
  for (const c of POP_CLASSES) labor[c] = { workers: 0, qualified: 0, qualifiedRate: 0, jobs: 0, employmentRate: 0, wage: 0 }
  return { goods, labor }
}

interface WorldTickResult {
  world: World
  report: WorldReport
  tax: number // government revenue collected here (income + corporate tax + state-enterprise profit)
  admin: number
  gdp: number
  cpi: number
  prevCpi: number
  population: number
  constructionSpend: number
  // Net profit earned by corporation-owned buildings on this world, by corp id.
  corpProfit: Map<string, number>
  // What the government pays this tick to fund services (healthcare) for pops.
  serviceSubsidy: number
  // Cash a corporation spent on its own construction here this tick, by corp id.
  corpConstructionSpend: Map<string, number>
  // Treasury spent this tick buying goods into this world's stockpiles.
  stockpileSpend: number
}

// Building materials consumed while a building is under construction — this
// demand is what makes construction fuel the wider economy.
const CONSTRUCTION_MATERIALS: { good: GoodId; amount: number }[] = [
  { good: 'steel', amount: 220 },
  { good: 'tools', amount: 60 },
  { good: 'machinery', amount: 50 },
  { good: 'heavyMachinery', amount: 30 },
  { good: 'consumerGoods', amount: 80 },
]

// Fraction of a shipment lost in transit (the transport cost of inter-world
// trade). What arrives is (1 − loss) of what was shipped.
const TRANSPORT_LOSS = 0.12

// Remove `amount` of a good from a world's building inventories (proportionally)
// — used when the world EXPORTS its surplus.
function exportFromWorld(world: World, good: GoodId, amount: number): World {
  const total = world.buildings.reduce((s, b) => s + (b.inventory[good] ?? 0), 0)
  if (total <= 0 || amount <= 0) return world
  const frac = Math.min(1, amount / total)
  return {
    ...world,
    buildings: world.buildings.map((b) => {
      const have = b.inventory[good] ?? 0
      if (have <= 0) return b
      return { ...b, inventory: { ...b.inventory, [good]: have * (1 - frac) } }
    }),
  }
}

// Advance one world's local economy. `govHealthShare` is the fraction of pops'
// healthcare the state pays for (the healthcare law).
function tickWorld(
  world: World,
  taxRate: number,
  welfarePerUnit: number,
  system: EconomicSystem,
  govHealthShare: number,
  stateBureaucracyMalus: number,
  treasuryAvailable: number,
  corpCash: Map<string, number>,
): WorldTickResult {
  const report = emptyWorldReport()
  const law = economicSystemDef(system)
  const govShareOf = (good: GoodId) => (good === 'healthcare' ? govHealthShare : 0)
  // Directly-state-run buildings seize up when the state has no bureaucracy.
  const outputFactor = (b: Building) => interferenceMultiplier(b, system) * (b.owner.kind === 'state' ? stateBureaucracyMalus : 1)

  // --- Labor market (qualification-gated) ---
  const workers = zeroClasses()
  const qualified = zeroClasses()
  for (const pop of world.pops) {
    workers[pop.class] += pop.populationSize
    qualified[pop.class] += pop.populationSize * qualificationFraction(pop.class, pop.educationLevel)
  }
  const jobDemand = zeroClasses()
  for (const b of world.buildings) for (const cls of POP_CLASSES) jobDemand[cls] += jobSlots(b, cls)

  const staffFraction = zeroClasses()
  const wages: LaborMarket['wages'] = { ...world.labor.wages }
  for (const cls of POP_CLASSES) {
    staffFraction[cls] = jobDemand[cls] > 0 ? Math.min(1, qualified[cls] / jobDemand[cls]) : 0
    const employmentRate = workers[cls] > 0 ? Math.min(1, jobDemand[cls] / workers[cls]) : 0
    wages[cls] = clamp(clearingStep(wages[cls], jobDemand[cls], qualified[cls], WAGE_ADJUST), WAGE_FLOOR, WAGE_CEILING)
    const qualifiedRate = workers[cls] > 0 ? qualified[cls] / workers[cls] : 0
    report.labor[cls] = { workers: workers[cls], qualified: qualified[cls], qualifiedRate, jobs: jobDemand[cls], employmentRate, wage: wages[cls] }
  }
  const buildingLaborScale = new Map<string, number>()
  const buildingPlannedRun = new Map<string, number>()
  for (const b of world.buildings) {
    const method = buildingMethod(b)
    let scale = 1
    if (method) for (const job of method.jobs) scale = Math.min(scale, staffFraction[job.class])
    buildingLaborScale.set(b.id, scale)
    buildingPlannedRun.set(b.id, Math.min(scale, b.throughput + THROUGHPUT_RAMP_UP))
  }

  // --- Supply (existing inventories + goods imported by trade) ---
  const supply = zeroGoods()
  for (const b of world.buildings) for (const g of GOOD_IDS) supply[g] += b.inventory[g] ?? 0
  for (const g of GOOD_IDS) supply[g] += world.importStock[g] ?? 0
  const prices: PerGood = { ...world.market.prices }

  // --- Demand: building inputs + pop consumption (budget-constrained) ---
  const buildingInputDemand = zeroGoods()
  for (const b of world.buildings) {
    const method = buildingMethod(b)
    if (!method) continue
    const plan = buildingPlannedRun.get(b.id) ?? 0
    for (const input of method.inputs) buildingInputDemand[input.good] += input.amount * b.level * plan
  }
  // Active construction pulls building materials from the market (fuels demand).
  if (world.constructionQueue.length > 0) {
    for (const m of CONSTRUCTION_MATERIALS) buildingInputDemand[m.good] += m.amount
  }

  const popIncome: number[] = []
  const popDemand = zeroGoods()
  let incomeTaxRevenue = 0
  world.pops.forEach((pop) => {
    const filledJobs = Math.min(qualified[pop.class], jobDemand[pop.class])
    const wageIncome = workers[pop.class] > 0 ? wages[pop.class] * filledJobs * (pop.populationSize / workers[pop.class]) : 0
    const incomeTax = wageIncome * taxRate
    incomeTaxRevenue += incomeTax
    const income = wageIncome - incomeTax + (welfarePerUnit + SUBSISTENCE_INCOME) * pop.populationSize
    popIncome.push(income)

    let budget = pop.wealth + income
    const species = SPECIES_TEMPLATES[pop.speciesTemplateId]
    if (species) {
      for (const tier of NEED_TIERS) {
        for (const need of species.needs[tier]) {
          const want = need.amountPerPop * pop.populationSize
          const price = prices[need.good]
          // The pop only pays its share; the state covers the rest (healthcare
          // law), so subsidized care is not throttled by a poor pop's budget.
          const effPrice = price * (1 - govShareOf(need.good))
          const affordable = effPrice > 0 ? budget / effPrice : want
          const buy = Math.max(0, Math.min(want, affordable))
          popDemand[need.good] += buy
          budget -= buy * effPrice
        }
      }
    }
  })

  const totalDemand = zeroGoods()
  for (const g of GOOD_IDS) totalDemand[g] = buildingInputDemand[g] + popDemand[g]

  // --- Stockpile release: cushion a genuine shortage (demand > supply) before
  // the market clears, so the relief actually reaches this tick's buyers
  // instead of only showing up as a number for next tick. Filling the reserve
  // (the opposite direction) happens further below, once we know how much
  // supply is genuinely left over after demand is satisfied. ---
  const stockpiles: Partial<Record<GoodId, number>> = { ...world.stockpiles }
  const stockpileTargets = world.stockpileTargets ?? {}
  for (const g of GOOD_IDS) {
    if (stockpileTargets[g] === undefined) continue
    const current = stockpiles[g] ?? 0
    if (current <= 0) continue
    const shortage = Math.max(0, totalDemand[g] - supply[g])
    if (shortage <= 0) continue
    const release = Math.min(STOCKPILE_RELEASE_RATE * current, shortage * STOCKPILE_MAX_RELEASE_FRACTION, current)
    if (release <= 0) continue
    supply[g] += release
    stockpiles[g] = current - release
  }

  // --- Clear market ---
  const fulfill = zeroGoods()
  const sellThrough = zeroGoods()
  for (const g of GOOD_IDS) {
    fulfill[g] = totalDemand[g] > 0 ? Math.min(1, supply[g] / totalDemand[g]) : 1
    sellThrough[g] = supply[g] > 0 ? Math.min(1, totalDemand[g] / supply[g]) : 1
    prices[g] = clamp(clearingStep(prices[g], totalDemand[g], supply[g], PRICE_ADJUST), priceFloor(g), priceCeiling(g))
    report.goods[g] = { supply: supply[g], demand: totalDemand[g], transacted: Math.min(supply[g], totalDemand[g]), price: prices[g] }
  }

  const revenueByBuilding = new Map<string, number>()
  const nextInventories = new Map<string, Partial<Record<GoodId, number>>>()
  for (const b of world.buildings) nextInventories.set(b.id, { ...b.inventory })
  let stockpileSpend = 0
  for (const g of GOOD_IDS) {
    const sold = Math.min(supply[g], totalDemand[g])
    if (sold > 0 && supply[g] > 0) {
      for (const b of world.buildings) {
        const have = b.inventory[g] ?? 0
        if (have <= 0) continue
        const soldShare = sold * (have / supply[g])
        const inv = nextInventories.get(b.id)!
        inv[g] = (inv[g] ?? 0) - soldShare
        revenueByBuilding.set(b.id, (revenueByBuilding.get(b.id) ?? 0) + soldShare * prices[g])
      }
    }

    // --- Stockpile fill: divert a capped fraction of whatever's genuinely
    // left over (unsold, would otherwise just decay) into the reserve, paid
    // for out of the treasury at the market price like any other purchase —
    // it is a real transaction, not free goods, so it is drawn from building
    // inventories and credited to their owners exactly like a normal sale.
    const target = stockpileTargets[g]
    if (target === undefined) continue
    const current = stockpiles[g] ?? 0
    const leftover = Math.max(0, supply[g] - sold)
    if (target <= current || leftover <= 0) continue
    const price = prices[g]
    let buy = Math.min(STOCKPILE_FILL_RATE * (target - current), leftover * STOCKPILE_MAX_SURPLUS_FRACTION)
    if (price > 0) buy = Math.min(buy, Math.max(0, treasuryAvailable - stockpileSpend) / price)
    if (buy <= 0) continue
    for (const b of world.buildings) {
      const have = b.inventory[g] ?? 0
      if (have <= 0) continue
      const share = buy * (have / supply[g])
      const inv = nextInventories.get(b.id)!
      inv[g] = (inv[g] ?? 0) - share
      revenueByBuilding.set(b.id, (revenueByBuilding.get(b.id) ?? 0) + share * price)
    }
    stockpiles[g] = current + buy
    stockpileSpend += buy * price
  }

  // --- Pops consume; update needs satisfaction, wealth, SoL ---
  // Recomputed per tier (a good may appear in more than one tier, e.g. consumer
  // goods in everyday AND comfort), spending the budget in tier order and only
  // getting the market-fulfilled fraction of what's bought.
  let serviceSubsidy = 0
  const nextPops: Pop[] = world.pops.map((pop, i) => {
    let budget = pop.wealth + popIncome[i]
    const species = SPECIES_TEMPLATES[pop.speciesTemplateId]
    const nextSatisfaction = { ...pop.needsSatisfaction }
    // Per-good breakdown behind nextSatisfaction (needs/SoL presentation
    // rework) — same want/got numbers the satisfaction ratio below is
    // computed from, just kept per-good instead of only summed into a tier
    // total, so the UI can show real consumption per good.
    const nextDetail: Record<NeedTier, NeedDetailEntry[]> = { basic: [], everyday: [], healthcare: [], comfort: [], luxury: [] }
    if (species) {
      for (const tier of NEED_TIERS) {
        const entries = species.needs[tier]
        if (entries.length === 0) {
          nextSatisfaction[tier] = 1
          continue
        }
        let got = 0
        let want = 0
        for (const need of entries) {
          const desired = need.amountPerPop * pop.populationSize
          want += desired
          const price = prices[need.good]
          const gShare = govShareOf(need.good)
          const effPrice = price * (1 - gShare)
          const affordable = effPrice > 0 ? budget / effPrice : desired
          const buy = Math.max(0, Math.min(desired, affordable))
          const bought = buy * fulfill[need.good]
          budget -= bought * effPrice
          serviceSubsidy += gShare * price * bought // the state's share of what was delivered
          got += bought
          nextDetail[tier].push({ good: need.good, wanted: desired, consumed: bought })
        }
        nextSatisfaction[tier] = want > 0 ? Math.min(1, got / want) : 1
      }
    }
    // Standard of Living: weighted needs satisfaction, smoothed.
    let solRaw = 0
    for (const tier of NEED_TIERS) solRaw += SOL_TIER_WEIGHT[tier] * nextSatisfaction[tier]
    const standardOfLiving = clamp(pop.standardOfLiving * (1 - SOL_SMOOTHING) + solRaw * SOL_SMOOTHING, 0, 1)
    return { ...pop, wealth: Math.max(0, budget), needsSatisfaction: nextSatisfaction, needsDetail: nextDetail, standardOfLiving }
  })

  // --- Buildings produce; profit is booked to its OWNER ---
  let govRevenue = incomeTaxRevenue
  const corpProfit = new Map<string, number>()
  let workerDividendPool = 0
  // Remaining resource deposits, drawn down as extraction buildings produce
  // below (shared across every building extracting the same good this world).
  const deposits: Partial<Record<GoodId, number>> = { ...world.resourceDeposits }
  const nextBuildings: Building[] = world.buildings.map((b) => {
    const method = buildingMethod(b)
    const inv = nextInventories.get(b.id) ?? {}
    if (!method) return { ...b, inventory: inv, employed: 0, jobsPosted: 0 }
    const laborScale = buildingLaborScale.get(b.id) ?? 0
    const plan = buildingPlannedRun.get(b.id) ?? 0

    let inputScale = 1
    let inputCost = 0
    for (const input of method.inputs) {
      const want = input.amount * b.level * plan
      const got = want * fulfill[input.good]
      inputCost += got * prices[input.good]
      inputScale = Math.min(inputScale, want > 0 ? got / want : 1)
    }
    // Throughput ramps toward what labor and inputs allow. Demand is NOT a
    // throttle here (that cascades and deadlocks a long chain); instead a glut
    // is bled off by inventory decay + the price floor below.
    const instantScale = laborScale * inputScale
    const throughput = rampToward(b.throughput, instantScale)
    const runScale = throughput
    const outputMalus = outputFactor(b)
    const isExtraction = RECIPES[b.recipeId]?.category === 'extraction'
    for (const out of method.outputs) {
      let produced = out.amount * b.level * runScale * outputMalus
      if (isExtraction && DEPLETABLE_GOODS.includes(out.good)) {
        const remaining = deposits[out.good]
        if (remaining !== undefined) {
          produced = Math.min(produced, Math.max(0, remaining))
          deposits[out.good] = Math.max(0, remaining - produced)
        }
      }
      inv[out.good] = (inv[out.good] ?? 0) + produced
    }
    // Decay carried stock so oversupply doesn't accumulate forever.
    for (const g of GOOD_IDS) if (inv[g]) inv[g] = inv[g]! * (1 - INVENTORY_DECAY)

    let wageBill = 0
    let employed = 0
    let jobsPosted = 0
    for (const job of method.jobs) {
      const slots = job.count * b.level * JOB_SCALE
      jobsPosted += slots
      employed += slots * runScale
      wageBill += wages[job.class] * slots * runScale
    }

    const revenue = revenueByBuilding.get(b.id) ?? 0
    const grossProfit = revenue - inputCost - wageBill
    const tax = grossProfit > 0 ? grossProfit * taxRate : 0
    govRevenue += tax
    const netProfit = grossProfit - tax
    // Route net profit by ownership.
    if (b.owner.kind === 'state') govRevenue += Math.max(0, netProfit)
    else if (b.owner.kind === 'corporation') corpProfit.set(b.owner.corporationId, (corpProfit.get(b.owner.corporationId) ?? 0) + netProfit)
    else if (b.owner.kind === 'worker') workerDividendPool += Math.max(0, netProfit)

    const unprofitableStreak = netProfit < 0 ? (b.unprofitableStreak ?? 0) + 1 : 0
    return { ...b, inventory: inv, throughput, lastProfit: netProfit, unprofitableStreak, employed, jobsPosted }
  })

  // --- Construction: EVERY queued order progresses at once (Victoria 3 style),
  //     the world's construction capacity split evenly across them. Government
  //     pool (treasury) funds state/worker orders; the private pool (a company's
  //     own cash) funds that corporation's orders. Several can finish in a tick. ---
  let builtBuildings = nextBuildings
  let nextQueue = world.constructionQueue
  let constructionSpend = 0 // drawn from the treasury (government pool)
  const corpConstructionSpend = new Map<string, number>()
  if (world.constructionQueue.length > 0) {
    const queue = world.constructionQueue.map((o) => ({ ...o }))
    const perOrder = CONSTRUCTION_CAPACITY / queue.length
    let govBudget = Math.max(0, treasuryAvailable) // shared across all gov/worker orders
    const corpBudget = new Map<string, number>() // per-corp remaining cash this tick
    for (const o of queue) {
      const remaining = o.cost - o.progress
      if (remaining <= 0) continue
      if (o.owner.kind === 'corporation') {
        const corpId = o.owner.corporationId
        if (!corpBudget.has(corpId)) corpBudget.set(corpId, Math.max(0, corpCash.get(corpId) ?? 0))
        const fund = Math.min(perOrder, remaining, corpBudget.get(corpId)!)
        if (fund > 0) {
          o.progress += fund
          corpBudget.set(corpId, corpBudget.get(corpId)! - fund)
          corpConstructionSpend.set(corpId, (corpConstructionSpend.get(corpId) ?? 0) + fund)
        }
      } else {
        const fund = Math.min(perOrder, remaining, govBudget)
        if (fund > 0) {
          o.progress += fund
          govBudget -= fund
          constructionSpend += fund
        }
      }
    }
    // Land every order that finished this tick (processed in order so two orders
    // for the same recipe+owner stack onto each other correctly).
    const sameOwner = (a: Building['owner'], o: Building['owner']) =>
      a.kind === o.kind && (a.kind !== 'corporation' || a.corporationId === (o as { corporationId: string }).corporationId)
    for (const o of queue) {
      if (o.progress < o.cost - 1e-9) continue
      const existing = builtBuildings.find((b) => b.recipeId === o.recipeId && sameOwner(b.owner, o.owner))
      if (existing)
        builtBuildings = builtBuildings.map((b) =>
          b.id === existing.id ? { ...b, level: b.level + 1, throughput: (b.throughput * b.level) / (b.level + 1) } : b,
        )
      else
        builtBuildings = [
          ...builtBuildings,
          {
            id: `${o.id}-built`,
            recipeId: o.recipeId,
            methodId: getMethod(o.recipeId, undefined)?.id ?? '',
            methodLocked: false,
            level: 1,
            owner: o.owner,
            inventory: {},
            throughput: NEW_BUILDING_THROUGHPUT,
            lastProfit: 0,
            employed: 0,
            jobsPosted: 0,
          },
        ]
    }
    nextQueue = queue.filter((o) => o.progress < o.cost - 1e-9)
  }

  // --- Admin + GDP ---
  const admin = ADMIN_PER_BUILDING_LEVEL * world.buildings.reduce((s, b) => s + b.level, 0)
  let gdp = 0
  for (const b of builtBuildings) {
    const method = buildingMethod(b)
    if (!method) continue
    const malus = outputFactor(b)
    for (const out of method.outputs) gdp += out.amount * b.level * b.throughput * malus * prices[out.good]
  }

  // --- Owner autonomy: private (corp/worker) un-pinned buildings pick method ---
  const finalBuildings = law.ownerAutonomy
    ? builtBuildings.map((b) => {
        if (isStateRun(b) || b.methodLocked) return b
        const recipe = RECIPES[b.recipeId]
        if (!recipe || recipe.methods.length < 2) return b
        const current = getMethod(b.recipeId, b.methodId)
        if (!current) return b
        const currentProfit = estimateMethodProfit(current, b.level, prices, wages)
        let best = current
        let bestProfit = currentProfit
        for (const m of recipe.methods) {
          const p = estimateMethodProfit(m, b.level, prices, wages)
          if (p > bestProfit) {
            best = m
            bestProfit = p
          }
        }
        const threshold = OWNER_SWITCH_MARGIN * (Math.abs(currentProfit) + Math.abs(bestProfit) + 1)
        if (best.id !== b.methodId && bestProfit - currentProfit > threshold) {
          return { ...b, methodId: best.id, throughput: b.throughput * RETOOL_THROUGHPUT_FACTOR }
        }
        return b
      })
    : builtBuildings

  // --- Population growth + education drift (SoL loop) + worker dividends ---
  const population = nextPops.reduce((s, p) => s + p.populationSize, 0)
  const capacity = world.populationCapacity
  const headroom = capacity > 0 ? Math.max(0, 1 - population / capacity) : 0
  const dividendPerPop = population > 0 ? workerDividendPool / population : 0
  const grownPops = nextPops.map((pop) => {
    const growth = GROWTH_RATE * (pop.standardOfLiving - GROWTH_MIDPOINT) * 2 * (pop.standardOfLiving >= GROWTH_MIDPOINT ? headroom : 1)
    const nextSize = Math.max(0.001, pop.populationSize * (1 + growth))
    const educationLevel = clamp(pop.educationLevel + EDU_DRIFT * (pop.standardOfLiving - pop.educationLevel), 0, EDU_MAX)
    const wealth = pop.wealth + dividendPerPop * pop.populationSize
    return { ...pop, populationSize: nextSize, educationLevel, wealth }
  })
  const grownPopulation = grownPops.reduce((s, p) => s + p.populationSize, 0)

  return {
    // importStock is consumed this tick; the logistics step refills it after.
    world: {
      ...world,
      pops: grownPops,
      buildings: finalBuildings,
      constructionQueue: nextQueue,
      market: { prices },
      labor: { wages },
      importStock: {},
      resourceDeposits: deposits,
      stockpiles,
    },
    report,
    tax: govRevenue,
    admin,
    gdp,
    cpi: cpi(prices),
    prevCpi: cpi(world.market.prices),
    population: grownPopulation,
    constructionSpend,
    corpProfit,
    serviceSubsidy,
    corpConstructionSpend,
    stockpileSpend,
  }
}

// Advance the whole economy one tick: every world locally, then each country's
// national budget, then pay corporations their buildings' profit.
export function tickEconomy(
  countries: Country[],
  worlds: World[],
  corporations: Corporation[] = [],
  ai: CountryAIOptions = {},
): { countries: Country[]; worlds: World[]; corporations: Corporation[]; reports: TickReports } {
  const reports: TickReports = { worlds: {}, countries: {} }
  const nextWorlds: World[] = [...worlds]
  const nextCountries: Country[] = []
  const corpProfitTotal = new Map<string, number>()
  // Subsidies folded into corpProfitTotal above — tracked separately so
  // dividends are paid on OPERATING profit only, never on government subsidy
  // money (the state should not be funding shareholder payouts).
  const corpSubsidyTotal = new Map<string, number>()
  // Cash each corporation has available for its own construction this tick.
  const corpCash = new Map<string, number>()
  for (const c of corporations) corpCash.set(c.id, c.cash)
  const corpConstructionTotal = new Map<string, number>()

  for (const country of countries) {
    const owned = worlds.map((w, idx) => ({ w, idx })).filter(({ w }) => w.ownerId === country.id)

    let govRevenue = 0
    let adminTotal = 0
    let gdpTotal = 0
    let population = 0
    let cpiNum = 0
    let prevCpiNum = 0
    let constructionSpend = 0
    let stockpileSpend = 0
    let serviceSubsidy = 0
    let runningTreasury = country.treasury
    const govHealthShare = healthcareSystemDef(country.healthcareSystem).publicFunding
    // If the state ran out of bureaucracy last tick, its own enterprises are
    // hobbled this tick.
    const stateBureaucracyMalus = country.bureaucracy > 0 ? 1 : BUREAUCRACY_SHORTAGE_MALUS

    for (const { w, idx } of owned) {
      const res = tickWorld(w, country.taxRate, country.welfarePerCapita, country.economicSystem, govHealthShare, stateBureaucracyMalus, runningTreasury, corpCash)
      runningTreasury -= res.constructionSpend + res.stockpileSpend
      constructionSpend += res.constructionSpend
      stockpileSpend += res.stockpileSpend
      govRevenue += res.tax
      adminTotal += res.admin
      serviceSubsidy += res.serviceSubsidy
      gdpTotal += res.gdp
      population += res.population
      cpiNum += res.cpi * res.population
      prevCpiNum += res.prevCpi * res.population
      nextWorlds[idx] = res.world
      reports.worlds[w.id] = res.report
      for (const [corpId, profit] of res.corpProfit) corpProfitTotal.set(corpId, (corpProfitTotal.get(corpId) ?? 0) + profit)
      for (const [corpId, spend] of res.corpConstructionSpend) {
        corpConstructionTotal.set(corpId, (corpConstructionTotal.get(corpId) ?? 0) + spend)
        corpCash.set(corpId, (corpCash.get(corpId) ?? 0) - spend) // so a corp can't double-spend across worlds this tick
      }
    }

    // --- Milestone 5: inter-world trade & logistics ---
    // Ship each good's surplus (unsold production) to the country's worlds that
    // fell short, within the freight capacity, losing a fraction in transit. The
    // delivered goods become import stock those worlds draw on NEXT tick — so a
    // world can specialize and import what it doesn't make.
    // Market access: freight capacity is the country's base plus what its
    // infrastructure buildings (roads, railways, spaceports) provide.
    let infraLogistics = 0
    for (const { idx } of owned) for (const b of nextWorlds[idx].buildings) infraLogistics += (LOGISTICS_OUTPUT[b.recipeId] ?? 0) * b.level * b.throughput
    const effectiveLogistics = country.logisticsCapacity + infraLogistics
    let tradeVolume = 0
    {
      let capacity = effectiveLogistics
      const idxs = owned.map((o) => o.idx)
      for (const g of GOOD_IDS) {
        if (capacity <= 1e-6) break
        const surplus = idxs.map((i) => nextWorlds[i].buildings.reduce((s, b) => s + (b.inventory[g] ?? 0), 0))
        const deficit = idxs.map((i) => {
          const r = reports.worlds[nextWorlds[i].id]?.goods[g]
          return r ? Math.max(0, r.demand - r.transacted) : 0
        })
        const totalSurplus = surplus.reduce((a, b) => a + b, 0)
        const totalDeficit = deficit.reduce((a, b) => a + b, 0)
        const ship = Math.min(totalSurplus, totalDeficit, capacity)
        if (ship <= 1e-6) continue
        capacity -= ship
        tradeVolume += ship
        idxs.forEach((i, k) => {
          if (surplus[k] > 0) nextWorlds[i] = exportFromWorld(nextWorlds[i], g, ship * (surplus[k] / totalSurplus))
          if (deficit[k] > 0) {
            const arrived = ship * (deficit[k] / totalDeficit) * (1 - TRANSPORT_LOSS)
            const w = nextWorlds[i]
            nextWorlds[i] = { ...w, importStock: { ...w.importStock, [g]: (w.importStock[g] ?? 0) + arrived } }
          }
        })
      }
    }

    // --- Subsidies: a per-tick cash transfer FROM the treasury. A corporation
    //     subsidy credits that company's cash directly. A building subsidy does
    //     the same when the building is corporation-owned (credited to its
    //     owning corp, exactly like a corp subsidy); a state- or worker-owned
    //     building has no separate cash account to credit, so its subsidy is
    //     simply spent — real treasury outlay that funds the building's upkeep
    //     without a further transfer (there's nowhere else for state money paid
    //     to a state asset to go). Either way it is a REAL cost, folded into
    //     this country's expenditure below — never free money.
    let subsidiesSpent = 0
    for (const [corpId, amt] of Object.entries(country.subsidies.corporations)) {
      if (amt <= 0) continue
      subsidiesSpent += amt
      corpProfitTotal.set(corpId, (corpProfitTotal.get(corpId) ?? 0) + amt)
      corpSubsidyTotal.set(corpId, (corpSubsidyTotal.get(corpId) ?? 0) + amt)
    }
    for (const [key, amt] of Object.entries(country.subsidies.buildings)) {
      if (amt <= 0) continue
      const sep = key.indexOf(':')
      if (sep < 0) continue
      const worldId = key.slice(0, sep)
      const buildingId = key.slice(sep + 1)
      const ownedIdx = owned.find(({ w }) => w.id === worldId)?.idx
      if (ownedIdx === undefined) continue
      const building = nextWorlds[ownedIdx].buildings.find((b) => b.id === buildingId)
      if (!building) continue
      subsidiesSpent += amt
      if (building.owner.kind === 'corporation') {
        corpProfitTotal.set(building.owner.corporationId, (corpProfitTotal.get(building.owner.corporationId) ?? 0) + amt)
        corpSubsidyTotal.set(building.owner.corporationId, (corpSubsidyTotal.get(building.owner.corporationId) ?? 0) + amt)
      }
    }

    const priceLevel = population > 0 ? cpiNum / population : 1
    const prevPriceLevel = population > 0 ? prevCpiNum / population : 1
    const inflation = prevPriceLevel > 0 ? priceLevel / prevPriceLevel - 1 : 0

    // --- Bureaucracy: production (government buildings) vs consumption (state
    //     ownership + decrees), settled into the stored stock. ---
    let bureaucracyProduced = 0
    let bureaucracyConsumed = 0
    let bureaucracyCapacity = BUREAUCRACY_BASE_CAPACITY
    for (const { idx } of owned) {
      for (const b of nextWorlds[idx].buildings) {
        const rec = RECIPES[b.recipeId]
        if (rec?.category === 'government') {
          bureaucracyProduced += (BUREAUCRACY_OUTPUT[b.recipeId] ?? 0) * b.level * b.throughput
          bureaucracyCapacity += BUREAUCRACY_CAP_PER_GOV_LEVEL * b.level
        }
        if (b.owner.kind === 'state') bureaucracyConsumed += BUREAUCRACY_PER_STATE_BUILDING_LEVEL * b.level
        else if (b.owner.kind === 'corporation') {
          const corpId = b.owner.corporationId
          const corp = corporations.find((c) => c.id === corpId)
          if (corp?.kind === 'state') bureaucracyConsumed += BUREAUCRACY_PER_STATECORP_BUILDING_LEVEL * b.level
        }
      }
    }
    bureaucracyConsumed += country.decrees.length * BUREAUCRACY_PER_DECREE
    const bureaucracy = clamp(country.bureaucracy + bureaucracyProduced - bureaucracyConsumed, 0, bureaucracyCapacity)

    // Administration + defense + infrastructure baseline (scales with pop).
    adminTotal += PUBLIC_SPENDING_PER_CAPITA * population
    const welfare = country.welfarePerCapita * population
    // Debt service: coupon on outstanding bonds + a penalty on any unfunded
    // overdraft (negative treasury) to push the player to fund deficits by bonds.
    const totalBonds = country.bonds.pops + country.bonds.corporations + country.bonds.foreign
    const bondInterest = totalBonds * country.bondRate
    const overdraft = Math.max(0, -country.treasury) * DEBT_INTEREST_RATE
    const interest = bondInterest + overdraft
    const expenditure = welfare + adminTotal + serviceSubsidy + interest + subsidiesSpent
    const balance = govRevenue - expenditure
    const treasury = country.treasury + balance - constructionSpend - stockpileSpend
    const debt = totalBonds + Math.max(0, -treasury)
    const annualGdp = gdpTotal * TICKS_PER_YEAR
    const debtToGdp = debt / Math.max(1, annualGdp)

    reports.countries[country.id] = {
      gdp: gdpTotal,
      priceLevel,
      inflation,
      revenue: govRevenue,
      welfare,
      admin: adminTotal,
      services: serviceSubsidy,
      interest,
      construction: constructionSpend,
      expenditure: expenditure + constructionSpend + stockpileSpend,
      balance,
      treasury,
      debt,
      debtToGdp,
      rating: creditRating(debtToGdp),
      population,
      bureaucracy,
      bureaucracyCapacity,
      bureaucracyProduced,
      bureaucracyConsumed,
      tradeVolume,
      logisticsCapacity: effectiveLogistics,
      subsidiesSpent,
      stockpileSpend,
    }
    nextCountries.push({ ...country, treasury, bureaucracy })
  }

  // Pay corporations the net profit of the buildings they own, less what they
  // spent on their own construction this tick.
  const paidCorporations = corporations.map((c) => {
    const profit = corpProfitTotal.get(c.id) ?? 0
    const built = corpConstructionTotal.get(c.id) ?? 0
    return { ...c, cash: c.cash + profit - built, lastProfit: profit }
  })

  // Distribute dividends: a company pays part of its profit out to its
  // shareholders (the state, the public, financial districts) — the income side
  // of the for-profit economy. This is what makes owning shares, and the whole
  // stock exchange and financial-district layer, actually pay. Paid on OPERATING
  // profit only (subsidies excluded — see corpSubsidyTotal).
  const operatingProfit = new Map<string, number>()
  for (const [id, p] of corpProfitTotal) operatingProfit.set(id, p - (corpSubsidyTotal.get(id) ?? 0))
  const dv = distributeDividends(paidCorporations, nextCountries, nextWorlds, operatingProfit)
  const nextCorporations = dv.corporations
  for (let i = 0; i < nextCountries.length; i++) nextCountries[i] = dv.countries[i]
  for (let i = 0; i < nextWorlds.length; i++) nextWorlds[i] = dv.worlds[i]

  // --- AI: run each NON-PLAYER nation's brain and every company's brain now
  //     that this tick's production, fiscal and reports are settled, so their
  //     policy/investment decisions land for next tick. Off unless the caller
  //     opts in, so headless callers and tests keep their exact prior behavior.
  let aiCountries = nextCountries
  let aiWorlds = nextWorlds
  let aiCorporations = nextCorporations
  if (ai.enableAI) {
    const tick = ai.tick ?? 0
    const humans = ai.humanCountryIds
    // Country AI (governments): non-player nations only.
    aiCountries = nextCountries.map((country) => {
      if (humans && humans.includes(country.id)) return country
      const report = reports.countries[country.id]
      if (!report) return country
      const decided = runCountryAI(country, report, aiWorlds, aiCorporations, tick)
      aiWorlds = decided.worlds
      return decided.country
    })
    // Corporation AI (the invisible hand): every company, in the player's nation
    // too — a market economy's firms run themselves; the player governs via law.
    aiCorporations = aiCorporations.map((corp) => {
      const decided = runCorporationAI(corp, aiWorlds, tick)
      aiWorlds = decided.worlds
      return decided.corp
    })
  }

  return { countries: aiCountries, worlds: aiWorlds, corporations: aiCorporations, reports }
}

// The share of a company's profit paid out to shareholders each tick; the rest
// is retained as cash for reinvestment (the corporation AI spends it). Shares
// held by individual CHARACTERS are retained too for now (character wealth is
// settled elsewhere), so only the state/public/financial portions actually leave
// the company.
const DIVIDEND_RATE = 0.35

// Pay each profitable company's dividends to its shareholders: the state's share
// to its treasury, a financial district's share to that district's cash, and the
// public's share spread across the company's home-nation pops as wealth. Pure:
// returns new arrays, positionally matching the inputs.
export function distributeDividends(
  corporations: Corporation[],
  countries: Country[],
  worlds: World[],
  profitByCorp: Map<string, number>,
): { corporations: Corporation[]; countries: Country[]; worlds: World[] } {
  const corpCashDelta = new Map<string, number>()
  const treasuryDelta = new Map<string, number>()
  const popDividendByCountry = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)

  for (const corp of corporations) {
    const profit = profitByCorp.get(corp.id) ?? 0
    if (profit <= 0 || corp.totalShares <= 0) continue
    const pool = profit * DIVIDEND_RATE
    for (const holding of corp.shares) {
      const amt = pool * (holding.shares / corp.totalShares)
      if (amt <= 0) continue
      switch (holding.holder.kind) {
        case 'state':
          add(treasuryDelta, corp.countryId, amt)
          add(corpCashDelta, corp.id, -amt)
          break
        case 'financial':
          add(corpCashDelta, holding.holder.id, amt) // the district earns from its stake
          add(corpCashDelta, corp.id, -amt)
          break
        case 'public':
          add(popDividendByCountry, corp.countryId, amt)
          add(corpCashDelta, corp.id, -amt)
          break
        case 'character':
          // Retained by the company for now (character wealth settled elsewhere).
          break
      }
    }
  }

  const nextCorporations = corporations.map((c) => (corpCashDelta.has(c.id) ? { ...c, cash: c.cash + corpCashDelta.get(c.id)! } : c))
  const nextCountries = countries.map((c) => (treasuryDelta.has(c.id) ? { ...c, treasury: c.treasury + treasuryDelta.get(c.id)! } : c))

  // Spread each nation's public-dividend pool across its worlds' pops in
  // proportion to population.
  const nextWorlds = worlds.map((w) => {
    const pool = popDividendByCountry.get(w.ownerId)
    if (!pool) return w
    const countryPop = worlds.filter((x) => x.ownerId === w.ownerId).reduce((s, x) => s + x.pops.reduce((n, p) => n + p.populationSize, 0), 0)
    if (countryPop <= 0) return w
    const perCapita = pool / countryPop
    return { ...w, pops: w.pops.map((p) => ({ ...p, wealth: p.wealth + perCapita * p.populationSize })) }
  })

  return { corporations: nextCorporations, countries: nextCountries, worlds: nextWorlds }
}

// A rough headline GDP for one world at its current prices — display only.
export function estimateWorldGdp(world: World): number {
  let gdp = 0
  for (const b of world.buildings) {
    const method = getMethod(b.recipeId, b.methodId)
    if (!method) continue
    for (const out of method.outputs) gdp += out.amount * b.level * b.throughput * world.market.prices[out.good]
  }
  return gdp
}

// The book value of a corporation: its cash plus the capital in the buildings it
// owns (a simple per-level valuation). Drives the share price on the exchange.
export function corporationValue(corp: Corporation, worlds: World[]): number {
  let capital = 0
  for (const w of worlds) {
    for (const b of w.buildings) {
      if (b.owner.kind === 'corporation' && b.owner.corporationId === corp.id) capital += b.level * BUILD_COST_PER_LEVEL
    }
  }
  return corp.cash + capital
}

export function sharePrice(corp: Corporation, worlds: World[]): number {
  if (corp.totalShares <= 0) return 0
  return Math.max(0, corporationValue(corp, worlds)) / corp.totalShares
}

// Building slots used per district on a world (existing buildings by level +
// queued construction). Compared against world.districtCapacity to see whether
// there is room to build.
export function districtUsage(world: World): Record<DistrictType, number> {
  const used = { core: 0, urban: 0, industrial: 0, resource: 0 } as Record<DistrictType, number>
  for (const b of world.buildings) used[districtOfRecipe(b.recipeId)] += b.level
  for (const o of world.constructionQueue) used[districtOfRecipe(o.recipeId)] += 1
  return used
}

// Whether there's room in the target district to queue another building.
export function canBuild(world: World, recipeId: string): boolean {
  const d = districtOfRecipe(recipeId)
  return districtUsage(world)[d] < world.districtCapacity[d]
}

// Re-export for UI use.
export { DISTRICT_TYPES, districtOfRecipe }
export type { DistrictType }
