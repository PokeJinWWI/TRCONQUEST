// The economy simulation — pure functions over (PlanetEconomy) → PlanetEconomy,
// no store reads or writes, exactly like this project's combat resolver
// (combatResolution.ts). That's what makes it testable headlessly (see
// tests/economy.test.ts) and deterministic: same input, same output, no
// randomness anywhere in Milestone 1.
//
// One tick, per planet, in order:
//   1. Labor market — how many of each class's jobs can be staffed, and the
//      wage that clears toward.
//   2. Supply — each good's existing building inventories. Production has a
//      one-tick pipeline lag (it lands in inventory for NEXT tick), which is
//      what keeps within-tick supply/demand well-defined rather than circular.
//   3. Effective demand — building input needs plus pops' budget-and-price-
//      constrained purchases in needs-tier order. Using *effective* demand
//      (what buyers will actually pay for at the current price), not raw
//      desired demand, is what lets prices settle at a real clearing level
//      instead of pinning to the ceiling on any permanent physical shortage.
//   4. Clear — move each price toward balance from effective-demand vs supply,
//      allocate scarce supply pro-rata, hand sellers their revenue, update pop
//      needs-satisfaction and wealth.
//   5. Buildings produce into inventory, then book revenue − input cost −
//      wages − tax as profit, paying tax + state-share to the treasury and the
//      private share to Investor pops as dividends.
//   6. Population drifts toward capacity, scaled by how well-fed pops are.

import { GOOD_IDS, PRICE_FLOOR, priceCeiling, type GoodId } from './goods'
import { NEED_TIERS, SPECIES_TEMPLATES } from './species'
import { POP_CLASSES, RECIPES, type PopClass } from './recipes'
import type { Building, LaborMarket, PlanetEconomy, Pop, TickReport } from './economyTypes'

// How aggressively a single tick moves a price/wage toward clearing. Small, so
// prices ease toward balance over many ticks rather than oscillating.
const PRICE_ADJUST = 0.15
const WAGE_ADJUST = 0.1
const WAGE_FLOOR = 0.1
const WAGE_CEILING = 40

// Fraction of the treasury paid back out to pops as welfare each tick. Taxes
// otherwise pile up in the treasury and never return, draining money from
// circulation until prices collapse to the floor — a deflationary money sink.
// Recirculating most of it (the Welfare Institution's job in the design doc,
// Section 2g) closes the loop: tax → treasury → welfare → pop spending →
// building revenue → wages/tax, keeping a sensible, non-floored price level.
// A later milestone splits this into real healthcare/pension/unemployment
// coverage with its own generosity slider; for now it's one flat transfer.
const WELFARE_PAYOUT = 0.5

// Population growth is OFF in Milestone 1. Without a building-construction
// system (a later milestone) to add jobs, any growth just piles up as an
// ever-larger labor surplus that collapses wages to the floor and drags the
// whole economy into a subsistence trap — not a bug in the market so much as
// the honest consequence of growing workers with a fixed number of jobs. The
// mechanism (headroom × how-well-fed) is left wired below at rate 0 so turning
// it on is a one-constant change once construction exists to absorb it. The
// seeded populations sit below capacity specifically so that headroom is
// waiting when growth is switched on.
const MAX_GROWTH_RATE = 0

type PerGood = Record<GoodId, number>
type PerClass = Record<PopClass, number>

function zeroGoods(): PerGood {
  return { food: 0, minerals: 0, consumerGoods: 0, medicine: 0 }
}
function zeroClasses(): PerClass {
  return { subsistence: 0, labor: 0, technical: 0, professional: 0, investor: 0, political: 0 }
}

// Nudge a value toward clearing: positive imbalance (demand > supply) pushes it
// up, negative pushes it down, magnitude bounded to [-1, 1] and scaled by
// `rate`. The max(1, ...) denominator makes zero-supply / zero-demand safe (no
// division by zero) and keeps a market with tiny volume from swinging wildly.
function clearingStep(value: number, demand: number, supply: number, rate: number): number {
  const imbalance = (demand - supply) / Math.max(1, demand + supply)
  return value * (1 + rate * imbalance)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// A building's job slots for one class at its current level (0 if the recipe
// doesn't hire that class).
function jobSlots(building: Building, cls: PopClass): number {
  const recipe = RECIPES[building.recipeId]
  const job = recipe?.jobs.find((j) => j.class === cls)
  return job ? job.count * building.level : 0
}

function emptyReport(): TickReport {
  return {
    goods: {
      food: { supply: 0, demand: 0, transacted: 0, price: 0 },
      minerals: { supply: 0, demand: 0, transacted: 0, price: 0 },
      consumerGoods: { supply: 0, demand: 0, transacted: 0, price: 0 },
      medicine: { supply: 0, demand: 0, transacted: 0, price: 0 },
    },
    labor: {
      subsistence: { workers: 0, jobs: 0, employmentRate: 0, wage: 0 },
      labor: { workers: 0, jobs: 0, employmentRate: 0, wage: 0 },
      technical: { workers: 0, jobs: 0, employmentRate: 0, wage: 0 },
      professional: { workers: 0, jobs: 0, employmentRate: 0, wage: 0 },
      investor: { workers: 0, jobs: 0, employmentRate: 0, wage: 0 },
      political: { workers: 0, jobs: 0, employmentRate: 0, wage: 0 },
    },
  }
}

export function tickPlanet(planet: PlanetEconomy): { planet: PlanetEconomy; report: TickReport } {
  const report = emptyReport()

  // --- 1. Labor market -----------------------------------------------------
  const workers = zeroClasses()
  for (const pop of planet.pops) workers[pop.class] += pop.populationSize

  const jobDemand = zeroClasses()
  for (const b of planet.buildings) for (const cls of POP_CLASSES) jobDemand[cls] += jobSlots(b, cls)

  // staffFraction: fraction of a class's jobs that can be staffed (< 1 when
  // workers are scarce, throttling production). employmentRate: fraction of a
  // class's workers who have a job (< 1 = unemployment). Same supply/demand
  // pair, two different questions.
  const staffFraction = zeroClasses()
  const employmentRate = zeroClasses()
  const wages: LaborMarket['wages'] = { ...planet.labor.wages }
  for (const cls of POP_CLASSES) {
    staffFraction[cls] = jobDemand[cls] > 0 ? Math.min(1, workers[cls] / jobDemand[cls]) : 0
    employmentRate[cls] = workers[cls] > 0 ? Math.min(1, jobDemand[cls] / workers[cls]) : 0
    wages[cls] = clamp(clearingStep(wages[cls], jobDemand[cls], workers[cls], WAGE_ADJUST), WAGE_FLOOR, WAGE_CEILING)
    report.labor[cls] = { workers: workers[cls], jobs: jobDemand[cls], employmentRate: employmentRate[cls], wage: wages[cls] }
  }

  const buildingLaborScale = new Map<string, number>()
  for (const b of planet.buildings) {
    const recipe = RECIPES[b.recipeId]
    let scale = 1
    if (recipe) for (const job of recipe.jobs) scale = Math.min(scale, staffFraction[job.class])
    buildingLaborScale.set(b.id, scale)
  }

  // --- 2. Supply -----------------------------------------------------------
  const supply = zeroGoods()
  for (const b of planet.buildings) for (const g of GOOD_IDS) supply[g] += b.inventory[g] ?? 0

  const prices: PerGood = { ...planet.market.prices }

  // --- 3. Effective demand -------------------------------------------------
  // Building input demand — price-inelastic for now (a building buys what it
  // needs to run at its labor-limited scale). Corporations optimizing input
  // purchases against margin come later.
  const buildingInputDemand = zeroGoods()
  for (const b of planet.buildings) {
    const recipe = RECIPES[b.recipeId]
    if (!recipe) continue
    const scale = buildingLaborScale.get(b.id) ?? 0
    for (const input of recipe.inputs) buildingInputDemand[input.good] += input.amount * b.level * scale
  }

  // Welfare paid this tick, drawn from the treasury and split across pops by
  // size — the money-recirculation loop (see WELFARE_PAYOUT). Collected tax
  // (added at the building step below) refills the treasury after.
  const totalPopForWelfare = planet.pops.reduce((s, p) => s + p.populationSize, 0)
  const welfarePool = planet.treasury * WELFARE_PAYOUT
  const welfarePerUnit = totalPopForWelfare > 0 ? welfarePool / totalPopForWelfare : 0

  // Pop demand — budget-and-price constrained, in needs-tier order. First pass:
  // each pop's wage + welfare income is added to its wealth to form a budget,
  // then it "shops" tier by tier recording what it would buy at current prices
  // (ignoring availability, which is applied in the allocation pass). This is
  // the effective demand that actually sets price — a pop priced out of
  // medicine simply stops bidding for it, so its price can't run away.
  const popIntended: PerGood[] = []
  const popIncome: number[] = []
  const popDemand = zeroGoods()
  planet.pops.forEach((pop) => {
    const filledJobs = Math.min(workers[pop.class], jobDemand[pop.class])
    const wageIncome = workers[pop.class] > 0 ? wages[pop.class] * filledJobs * (pop.populationSize / workers[pop.class]) : 0
    const income = wageIncome + welfarePerUnit * pop.populationSize
    popIncome.push(income)

    let budget = pop.wealth + wageIncome
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

  // --- 4. Clear the market -------------------------------------------------
  // Price moves from effective demand vs supply; availability (fulfill) rations
  // scarce physical supply pro-rata across all bidders. sellThrough is the
  // seller's-eye view of the same ratio — < 1 means the good is glutted (more
  // on the market than buyers will take), which throttles production below so
  // inventory doesn't pile up without bound and crush the price to the floor
  // (design doc Section 4: "can't sell its goods → accumulate inventory and
  // eventually cut production").
  const fulfill = zeroGoods()
  const sellThrough = zeroGoods()
  for (const g of GOOD_IDS) {
    fulfill[g] = totalDemand[g] > 0 ? Math.min(1, supply[g] / totalDemand[g]) : 1
    sellThrough[g] = supply[g] > 0 ? Math.min(1, totalDemand[g] / supply[g]) : 1
    prices[g] = clamp(clearingStep(prices[g], totalDemand[g], supply[g], PRICE_ADJUST), PRICE_FLOOR, priceCeiling(g))
    report.goods[g] = { supply: supply[g], demand: totalDemand[g], transacted: Math.min(supply[g], totalDemand[g]), price: prices[g] }
  }

  // Sellers' revenue: each good's sold quantity, split across the buildings
  // holding its inventory pro-rata, drawing their inventory down.
  const revenueByBuilding = new Map<string, number>()
  const nextInventories = new Map<string, Partial<Record<GoodId, number>>>()
  for (const b of planet.buildings) nextInventories.set(b.id, { ...b.inventory })
  for (const g of GOOD_IDS) {
    const sold = Math.min(supply[g], totalDemand[g])
    if (sold <= 0 || supply[g] <= 0) continue
    for (const b of planet.buildings) {
      const have = b.inventory[g] ?? 0
      if (have <= 0) continue
      const soldShare = sold * (have / supply[g])
      const inv = nextInventories.get(b.id)!
      inv[g] = (inv[g] ?? 0) - soldShare
      revenueByBuilding.set(b.id, (revenueByBuilding.get(b.id) ?? 0) + soldShare * prices[g])
    }
  }

  // Allocation pass: each pop actually receives intended × fulfill of each
  // good, pays for it, and its needs-satisfaction reflects got / desired.
  const nextPops: Pop[] = planet.pops.map((pop, i) => {
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

  // --- 5. Buildings produce, then book profit ------------------------------
  // Treasury already paid out welfare above; taxes collected below refill it.
  let treasury = planet.treasury - welfarePool
  let totalPrivateProfit = 0
  const nextBuildings: Building[] = planet.buildings.map((b) => {
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
    // Cut production for a glutted output (see sellThrough) so unsold stock
    // doesn't accumulate forever — a building throttles to roughly what the
    // market is actually taking, its output's scarcest-selling good setting
    // the pace.
    let demandScale = 1
    for (const out of recipe.outputs) demandScale = Math.min(demandScale, sellThrough[out.good])
    const runScale = laborScale * inputScale * demandScale
    for (const out of recipe.outputs) inv[out.good] = (inv[out.good] ?? 0) + out.amount * b.level * runScale

    let wageBill = 0
    for (const job of recipe.jobs) wageBill += wages[job.class] * job.count * b.level * staffFraction[job.class]

    const revenue = revenueByBuilding.get(b.id) ?? 0
    const grossProfit = revenue - inputCost - wageBill
    const tax = grossProfit > 0 ? grossProfit * planet.taxRate : 0
    treasury += tax
    const netProfit = grossProfit - tax
    treasury += Math.max(0, netProfit) * b.stateFraction
    totalPrivateProfit += netProfit * (1 - b.stateFraction)

    return { ...b, inventory: inv, lastProfit: netProfit }
  })

  // Dividends: private profit to Investor pops by size, landing in wealth for
  // next tick (a one-tick lag that avoids a within-tick profit⇄spending cycle).
  const investorUnits = nextPops.filter((p) => p.class === 'investor').reduce((s, p) => s + p.populationSize, 0)
  const dividendPerUnit = investorUnits > 0 ? Math.max(0, totalPrivateProfit) / investorUnits : 0

  // --- 6. Population growth toward capacity --------------------------------
  const totalPop = nextPops.reduce((s, p) => s + p.populationSize, 0)
  const headroom = planet.populationCapacity > 0 ? Math.max(0, 1 - totalPop / planet.populationCapacity) : 0
  const grownPops = nextPops.map((pop) => {
    const dividend = pop.class === 'investor' ? dividendPerUnit * pop.populationSize : 0
    const wellFed = (pop.needsSatisfaction.basic + pop.needsSatisfaction.everyday) / 2
    const growth = MAX_GROWTH_RATE * (wellFed - 0.5) * 2 * headroom
    const populationSize = Math.max(0.001, pop.populationSize * (1 + growth))
    return { ...pop, wealth: pop.wealth + dividend, populationSize }
  })

  return {
    planet: { ...planet, pops: grownPops, buildings: nextBuildings, market: { prices }, labor: { wages }, treasury },
    report,
  }
}

// Advance the whole economy one tick. Each planet is independent in Milestone 1
// (no interplanetary trade yet), so this is a straight map.
export function tickEconomy(planets: PlanetEconomy[]): { planets: PlanetEconomy[]; reports: Record<string, TickReport> } {
  const reports: Record<string, TickReport> = {}
  const next = planets.map((p) => {
    const { planet, report } = tickPlanet(p)
    reports[planet.id] = report
    return planet
  })
  return { planets: next, reports }
}

// A rough headline "GDP": the market value of a planet's full output capacity
// at current prices. Display-only; the sim itself never reads it.
export function estimateGdp(planet: PlanetEconomy): number {
  let gdp = 0
  for (const b of planet.buildings) {
    const recipe = RECIPES[b.recipeId]
    if (!recipe) continue
    for (const out of recipe.outputs) gdp += out.amount * b.level * planet.market.prices[out.good]
  }
  return gdp
}
