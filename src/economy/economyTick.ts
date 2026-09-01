// The economy simulation — pure functions, no store access, same style as the
// combat resolver. Restructured (design doc v2) into two layers:
//   - tickWorld: one inhabited world's LOCAL economy (labor, market, needs,
//     production, construction). It computes tax owed and admin cost but does
//     NOT hold a treasury — it reports those up.
//   - tickEconomy: runs every world, then settles each COUNTRY's national
//     budget (welfare, tax, admin, debt interest, construction) into one
//     treasury, and computes national GDP / inflation / debt / credit rating.
//
// The local market mechanics are ported directly from v1 (they were correct
// and tested); what moved is the fiscal layer, from per-planet to per-country.

import { GOOD_IDS, GOODS, PRICE_FLOOR, priceCeiling, type GoodId } from './goods'
import { NEED_TIERS, SPECIES_TEMPLATES } from './species'
import { POP_CLASSES, RECIPES, type PopClass } from './recipes'
import type { Building, Country, CountryFiscal, CreditRating, LaborMarket, Pop, World, WorldReport, TickReports } from './economyTypes'

const PRICE_ADJUST = 0.15
const WAGE_ADJUST = 0.1
const WAGE_FLOOR = 0.1
const WAGE_CEILING = 40
const MAX_GROWTH_RATE = 0 // off in M1 (see v1 note); headroom kept for later

// Fiscal constants — scaled for a population measured in millions.
const ADMIN_PER_BUILDING_LEVEL = 60
const DEBT_INTEREST_RATE = 0.002
const BUILD_COST_PER_LEVEL = 6000
const CONSTRUCTION_CAPACITY = 400
const TICKS_PER_YEAR = 52
const CPI_WEIGHTS: Partial<Record<GoodId, number>> = { food: 1.0, consumerGoods: 0.5, medicine: 0.2 }

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
  return { food: 0, minerals: 0, consumerGoods: 0, medicine: 0 }
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
function jobSlots(building: Building, cls: PopClass): number {
  const recipe = RECIPES[building.recipeId]
  const job = recipe?.jobs.find((j) => j.class === cls)
  return job ? job.count * building.level : 0
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
  for (const c of POP_CLASSES) labor[c] = { workers: 0, jobs: 0, employmentRate: 0, wage: 0 }
  return { goods, labor }
}

// What a world hands up to its country each tick, alongside the advanced world.
interface WorldTickResult {
  world: World
  report: WorldReport
  tax: number // government revenue collected here (tax + state profit share)
  admin: number // admin cost of this world's buildings
  gdp: number // output value at this tick's prices
  cpi: number // this world's CPI (new prices)
  prevCpi: number // this world's CPI (old prices)
  population: number
  constructionSpend: number // money drawn from the country treasury for building
}

// Advance one world's local economy. `taxRate` and `welfarePerUnit` are the
// owning country's policy; `treasuryAvailable` is how much national cash is
// currently free to fund this world's construction this tick.
function tickWorld(world: World, taxRate: number, welfarePerUnit: number, treasuryAvailable: number): WorldTickResult {
  const report = emptyWorldReport()

  // --- Labor market ---
  const workers = zeroClasses()
  for (const pop of world.pops) workers[pop.class] += pop.populationSize
  const jobDemand = zeroClasses()
  for (const b of world.buildings) for (const cls of POP_CLASSES) jobDemand[cls] += jobSlots(b, cls)

  const staffFraction = zeroClasses()
  const employmentRate = zeroClasses()
  const wages: LaborMarket['wages'] = { ...world.labor.wages }
  for (const cls of POP_CLASSES) {
    staffFraction[cls] = jobDemand[cls] > 0 ? Math.min(1, workers[cls] / jobDemand[cls]) : 0
    employmentRate[cls] = workers[cls] > 0 ? Math.min(1, jobDemand[cls] / workers[cls]) : 0
    wages[cls] = clamp(clearingStep(wages[cls], jobDemand[cls], workers[cls], WAGE_ADJUST), WAGE_FLOOR, WAGE_CEILING)
    report.labor[cls] = { workers: workers[cls], jobs: jobDemand[cls], employmentRate: employmentRate[cls], wage: wages[cls] }
  }
  const buildingLaborScale = new Map<string, number>()
  for (const b of world.buildings) {
    const recipe = RECIPES[b.recipeId]
    let scale = 1
    if (recipe) for (const job of recipe.jobs) scale = Math.min(scale, staffFraction[job.class])
    buildingLaborScale.set(b.id, scale)
  }

  // --- Supply (existing inventories) ---
  const supply = zeroGoods()
  for (const b of world.buildings) for (const g of GOOD_IDS) supply[g] += b.inventory[g] ?? 0
  const prices: PerGood = { ...world.market.prices }

  // --- Demand: building inputs + pop consumption (with wage income, taxed, +
  //     welfare), tracked as budget-constrained effective demand. ---
  const buildingInputDemand = zeroGoods()
  for (const b of world.buildings) {
    const recipe = RECIPES[b.recipeId]
    if (!recipe) continue
    const scale = buildingLaborScale.get(b.id) ?? 0
    for (const input of recipe.inputs) buildingInputDemand[input.good] += input.amount * b.level * scale
  }

  const popIntended: PerGood[] = []
  const popIncome: number[] = []
  const popDemand = zeroGoods()
  let incomeTaxRevenue = 0
  world.pops.forEach((pop) => {
    const filledJobs = Math.min(workers[pop.class], jobDemand[pop.class])
    const wageIncome = workers[pop.class] > 0 ? wages[pop.class] * filledJobs * (pop.populationSize / workers[pop.class]) : 0
    const incomeTax = wageIncome * taxRate
    incomeTaxRevenue += incomeTax
    const income = wageIncome - incomeTax + welfarePerUnit * pop.populationSize
    popIncome.push(income)

    let budget = pop.wealth + income
    const intended = zeroGoods()
    const species = SPECIES_TEMPLATES[pop.speciesTemplateId]
    if (species) {
      for (const tier of NEED_TIERS) {
        for (const need of species.needs[tier]) {
          const want = need.amountPerPop * pop.populationSize
          const price = prices[need.good]
          const affordable = price > 0 ? budget / price : want
          const buy = Math.max(0, Math.min(want, affordable))
          intended[need.good] += buy
          popDemand[need.good] += buy
          budget -= buy * price
        }
      }
    }
    popIntended.push(intended)
  })

  const totalDemand = zeroGoods()
  for (const g of GOOD_IDS) totalDemand[g] = buildingInputDemand[g] + popDemand[g]

  // --- Clear market ---
  const fulfill = zeroGoods()
  const sellThrough = zeroGoods()
  for (const g of GOOD_IDS) {
    fulfill[g] = totalDemand[g] > 0 ? Math.min(1, supply[g] / totalDemand[g]) : 1
    sellThrough[g] = supply[g] > 0 ? Math.min(1, totalDemand[g] / supply[g]) : 1
    prices[g] = clamp(clearingStep(prices[g], totalDemand[g], supply[g], PRICE_ADJUST), PRICE_FLOOR, priceCeiling(g))
    report.goods[g] = { supply: supply[g], demand: totalDemand[g], transacted: Math.min(supply[g], totalDemand[g]), price: prices[g] }
  }

  const revenueByBuilding = new Map<string, number>()
  const nextInventories = new Map<string, Partial<Record<GoodId, number>>>()
  for (const b of world.buildings) nextInventories.set(b.id, { ...b.inventory })
  for (const g of GOOD_IDS) {
    const sold = Math.min(supply[g], totalDemand[g])
    if (sold <= 0 || supply[g] <= 0) continue
    for (const b of world.buildings) {
      const have = b.inventory[g] ?? 0
      if (have <= 0) continue
      const soldShare = sold * (have / supply[g])
      const inv = nextInventories.get(b.id)!
      inv[g] = (inv[g] ?? 0) - soldShare
      revenueByBuilding.set(b.id, (revenueByBuilding.get(b.id) ?? 0) + soldShare * prices[g])
    }
  }

  // --- Pops consume, update satisfaction + wealth ---
  const nextPops: Pop[] = world.pops.map((pop, i) => {
    const intended = popIntended[i]
    let budget = pop.wealth + popIncome[i]
    const species = SPECIES_TEMPLATES[pop.speciesTemplateId]
    const nextSatisfaction = { ...pop.needsSatisfaction }
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
          const bought = intended[need.good] * fulfill[need.good]
          budget -= bought * prices[need.good]
          got += bought
        }
        nextSatisfaction[tier] = want > 0 ? got / want : 1
      }
    }
    return { ...pop, wealth: Math.max(0, budget), needsSatisfaction: nextSatisfaction }
  })

  // --- Buildings produce, book profit (tax owed reported up) ---
  let govRevenue = incomeTaxRevenue
  const nextBuildings: Building[] = world.buildings.map((b) => {
    const recipe = RECIPES[b.recipeId]
    const inv = nextInventories.get(b.id) ?? {}
    if (!recipe) return { ...b, inventory: inv }
    const laborScale = buildingLaborScale.get(b.id) ?? 0
    let inputScale = 1
    let inputCost = 0
    for (const input of recipe.inputs) {
      const want = input.amount * b.level * laborScale
      const got = want * fulfill[input.good]
      inputCost += got * prices[input.good]
      inputScale = Math.min(inputScale, want > 0 ? got / want : 1)
    }
    let demandScale = 1
    for (const out of recipe.outputs) demandScale = Math.min(demandScale, sellThrough[out.good])
    const runScale = laborScale * inputScale * demandScale
    for (const out of recipe.outputs) inv[out.good] = (inv[out.good] ?? 0) + out.amount * b.level * runScale
    let wageBill = 0
    for (const job of recipe.jobs) wageBill += wages[job.class] * job.count * b.level * staffFraction[job.class]
    const revenue = revenueByBuilding.get(b.id) ?? 0
    const grossProfit = revenue - inputCost - wageBill
    const tax = grossProfit > 0 ? grossProfit * taxRate : 0
    govRevenue += tax
    const netProfit = grossProfit - tax
    govRevenue += Math.max(0, netProfit) * b.stateFraction
    return { ...b, inventory: inv, lastProfit: netProfit }
  })

  // --- Construction funded from national treasury ---
  let builtBuildings = nextBuildings
  let nextQueue = world.constructionQueue
  let constructionSpend = 0
  if (world.constructionQueue.length > 0 && treasuryAvailable > 0) {
    const queue = world.constructionQueue.map((o) => ({ ...o }))
    const front = queue[0]
    const fund = Math.min(CONSTRUCTION_CAPACITY, treasuryAvailable, front.cost - front.progress)
    constructionSpend = fund
    front.progress += fund
    if (front.progress >= front.cost - 1e-9) {
      const existing = builtBuildings.find((b) => b.recipeId === front.recipeId)
      if (existing) builtBuildings = builtBuildings.map((b) => (b.id === existing.id ? { ...b, level: b.level + 1 } : b))
      else
        builtBuildings = [
          ...builtBuildings,
          { id: `${front.id}-built`, recipeId: front.recipeId, level: 1, stateFraction: 0, inventory: {}, lastProfit: 0 },
        ]
      queue.shift()
    }
    nextQueue = queue
  }

  // --- Admin + GDP ---
  const admin = ADMIN_PER_BUILDING_LEVEL * world.buildings.reduce((s, b) => s + b.level, 0)
  let gdp = 0
  for (const b of builtBuildings) {
    const recipe = RECIPES[b.recipeId]
    if (!recipe) continue
    for (const out of recipe.outputs) gdp += out.amount * b.level * prices[out.good]
  }

  // --- Population growth (off in M1) ---
  const population = nextPops.reduce((s, p) => s + p.populationSize, 0)
  const capacity = world.populationCapacity
  const headroom = capacity > 0 ? Math.max(0, 1 - population / capacity) : 0
  const grownPops =
    MAX_GROWTH_RATE > 0
      ? nextPops.map((pop) => {
          const wellFed = (pop.needsSatisfaction.basic + pop.needsSatisfaction.everyday) / 2
          const growth = MAX_GROWTH_RATE * (wellFed - 0.5) * 2 * headroom
          return { ...pop, populationSize: Math.max(0.001, pop.populationSize * (1 + growth)) }
        })
      : nextPops

  return {
    world: { ...world, pops: grownPops, buildings: builtBuildings, constructionQueue: nextQueue, market: { prices }, labor: { wages } },
    report,
    tax: govRevenue,
    admin,
    gdp,
    cpi: cpi(prices),
    prevCpi: cpi(world.market.prices),
    population,
    constructionSpend,
  }
}

// Advance the whole economy one tick: every world locally, then each country's
// national budget.
export function tickEconomy(countries: Country[], worlds: World[]): { countries: Country[]; worlds: World[]; reports: TickReports } {
  const reports: TickReports = { worlds: {}, countries: {} }
  const nextWorlds: World[] = [...worlds]
  const nextCountries: Country[] = []

  for (const country of countries) {
    const owned = worlds
      .map((w, idx) => ({ w, idx }))
      .filter(({ w }) => w.ownerId === country.id)

    let govRevenue = 0
    let adminTotal = 0
    let gdpTotal = 0
    let population = 0
    let cpiNum = 0
    let prevCpiNum = 0
    let constructionSpend = 0
    let runningTreasury = country.treasury

    for (const { w, idx } of owned) {
      const res = tickWorld(w, country.taxRate, country.welfarePerCapita, runningTreasury)
      runningTreasury -= res.constructionSpend
      constructionSpend += res.constructionSpend
      govRevenue += res.tax
      adminTotal += res.admin
      gdpTotal += res.gdp
      population += res.population
      cpiNum += res.cpi * res.population
      prevCpiNum += res.prevCpi * res.population
      nextWorlds[idx] = res.world
      reports.worlds[w.id] = res.report
    }

    const priceLevel = population > 0 ? cpiNum / population : 1
    const prevPriceLevel = population > 0 ? prevCpiNum / population : 1
    const inflation = prevPriceLevel > 0 ? priceLevel / prevPriceLevel - 1 : 0

    const welfare = country.welfarePerCapita * population
    const interest = Math.max(0, -country.treasury) * DEBT_INTEREST_RATE
    const expenditure = welfare + adminTotal + interest
    const balance = govRevenue - expenditure
    const treasury = country.treasury + balance - constructionSpend
    const debt = Math.max(0, -treasury)
    const annualGdp = gdpTotal * TICKS_PER_YEAR
    const debtToGdp = debt / Math.max(1, annualGdp)

    const fiscal: CountryFiscal = {
      gdp: gdpTotal,
      priceLevel,
      inflation,
      revenue: govRevenue,
      welfare,
      admin: adminTotal,
      interest,
      construction: constructionSpend,
      expenditure: expenditure + constructionSpend,
      balance,
      treasury,
      debt,
      debtToGdp,
      rating: creditRating(debtToGdp),
      population,
    }
    reports.countries[country.id] = fiscal
    nextCountries.push({ ...country, treasury })
  }

  return { countries: nextCountries, worlds: nextWorlds, reports }
}

// A rough headline GDP for one world at its current prices — display only.
export function estimateWorldGdp(world: World): number {
  let gdp = 0
  for (const b of world.buildings) {
    const recipe = RECIPES[b.recipeId]
    if (!recipe) continue
    for (const out of recipe.outputs) gdp += out.amount * b.level * world.market.prices[out.good]
  }
  return gdp
}
