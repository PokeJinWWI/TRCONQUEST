// Corporation AI — the "invisible hand." Where the country AI (countryAI.ts)
// runs a government's fiscal policy, this runs a COMPANY, and its single goal is
// profit. It is deliberately amoral: it pours capital into whatever earns the
// highest margin, expands the winners it already owns, and refuses to prop up a
// loss-maker — it will happily abandon a socially essential but low-margin trade
// (food, healthcare, power) and pile into luxuries and capital goods, leaving
// the state to cover what the market won't. That "exploitative" behavior isn't a
// special case; it falls straight out of ranking everything by margin.
//
// This runs for EVERY company (in the player's nation too — like a market
// economy, the player sets the laws, the firms run themselves), except that a
// building whose method the player has pinned is left as pinned. Per-building
// production-method optimization already happens in the tick loop (owner
// autonomy); this layer is the capital-ALLOCATION decision the tick loop has no
// concept of: what to build next, and where.
//
// Pure and headless like the rest of the sim. It returns construction orders to
// append to worlds (funded from the company's own cash by the tick loop); it
// does not mutate cash itself.

import type { Corporation, World, ConstructionOrder, Building } from './economyTypes'
import { RECIPES, districtOfRecipe, type DistrictType } from './recipes'
import { GOODS } from './goods'

// Review twice a year, staggered per-company so they don't all act at once.
const INVEST_REVIEW_PERIOD = 6
const BUILD_COST = 6000
// Keep a cash cushion beyond one building's cost before investing, so a company
// doesn't spend itself to zero (it still needs to ride out loss-making ticks).
const INVEST_CASH_BUFFER = BUILD_COST * 2.5
// A proven, profitable building is worth expanding once its per-tick profit
// clears this bar — cheap insurance against pouring money into a marginal line.
const EXPAND_PROFIT_FLOOR = 1

// Divestment: a company PULLS OUT of a building only after the tick loop has run
// it at its best available method and it STILL lost money for this many
// consecutive ticks (~a year). The firm tries first, then exits — it doesn't
// bail on one bad month. On exit it recovers a fraction of the asset's book
// value as salvage; the workers return to the labor market.
const DIVEST_STREAK = 12
const SALVAGE_FRACTION = 0.3

// The sectors a profit-seeking firm will FOUND from scratch. Deliberately the
// margin-rich manufacturing/luxury/capital lines — NOT the essentials (food,
// healthcare, education, basic power, raw extraction), which a firm only runs if
// it inherited them: it will expand an essential it already owns and profits
// from, but it won't newly invest in one when a luxury earns more. That's the
// exploitation, made concrete as a list rather than hidden in the numbers.
const FOUNDABLE_SECTORS: string[] = [
  'consumerGoodsFactory',
  'luxuryFactory',
  'automobilePlant',
  'aircraftFactory',
  'electronicsFactory',
  'semiconductorFab',
  'toolWorkshop',
  'machineryFactory',
  'heavyMachineryPlant',
  'electricalMachineryPlant',
  'precisionMachineryPlant',
  'engineFactory',
  'steelMill',
  'dyeWorks',
  'paperMill',
  'artStudio',
  'dataCenter',
  'shipyard',
]

// A stable per-company phase so companies act on different ticks.
function phase(id: string, period: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % period
}

// A rough per-level gross margin for a recipe at a world's current prices: the
// value of what it makes minus the value of what it consumes (labor aside — this
// is a ranking signal, not an accounting figure). Higher = a hotter market to
// enter. Uses the recipe's first (baseline) method.
function grossMargin(recipeId: string, world: World): number {
  const method = RECIPES[recipeId]?.methods[0]
  if (!method) return -Infinity
  const price = (g: string) => world.market.prices[g as keyof typeof world.market.prices] ?? GOODS[g as keyof typeof GOODS]?.basePrice ?? 0
  let revenue = 0
  for (const o of method.outputs) revenue += o.amount * price(o.good)
  let cost = 0
  for (const inp of method.inputs) cost += inp.amount * price(inp.good)
  return revenue - cost
}

function districtRoom(world: World, recipeId: string): boolean {
  const d: DistrictType = districtOfRecipe(recipeId)
  const used = world.buildings.reduce((n, b) => n + (districtOfRecipe(b.recipeId) === d ? b.level : 0), 0) + world.constructionQueue.filter((o) => districtOfRecipe(o.recipeId) === d).length
  return used < world.districtCapacity[d]
}

function ownsHere(building: Building, corpId: string): boolean {
  return building.owner.kind === 'corporation' && building.owner.corporationId === corpId
}

// Run one company's decisions for this tick. Returns the (possibly updated)
// company — its cash credited with any salvage from a building it closed — and
// the worlds, with that building removed and/or a single new construction order
// appended (owned by, and funded from, this company). Financial districts don't
// operate ordinary industry — they're institutional investors, not operating
// companies — so they're left alone here.
export function runCorporationAI(corp: Corporation, worlds: World[], tick: number): { corp: Corporation; worlds: World[] } {
  if (corp.kind === 'financial') return { corp, worlds }
  if (tick % INVEST_REVIEW_PERIOD !== phase(corp.id, INVEST_REVIEW_PERIOD)) return { corp, worlds }

  // --- Divestment first: pull out of the worst chronic loss-maker (if any),
  //     freeing capital and district space before deciding where to invest. ---
  let nextCorp = corp
  let nextWorlds = worlds
  let worstLoser: { worldId: string; buildingId: string; level: number; loss: number } | null = null
  for (const w of worlds) {
    for (const b of w.buildings) {
      if (!ownsHere(b, corp.id)) continue
      if ((b.unprofitableStreak ?? 0) < DIVEST_STREAK) continue
      if (!worstLoser || b.lastProfit < worstLoser.loss) worstLoser = { worldId: w.id, buildingId: b.id, level: b.level, loss: b.lastProfit }
    }
  }
  if (worstLoser) {
    const salvage = worstLoser.level * BUILD_COST * SALVAGE_FRACTION
    nextCorp = { ...corp, cash: corp.cash + salvage }
    nextWorlds = worlds.map((w) => (w.id === worstLoser!.worldId ? { ...w, buildings: w.buildings.filter((b) => b.id !== worstLoser!.buildingId) } : w))
  }

  const invested = invest(nextCorp, nextWorlds, tick)
  return { corp: nextCorp, worlds: invested }
}

// The investment half of the decision: expand a winner or found a new venture.
function invest(corp: Corporation, worlds: World[], tick: number): World[] {
  if (corp.cash < INVEST_CASH_BUFFER) return worlds // too poor to invest — it must fix its books first
  // One order at a time: don't stack up spend it can't cover.
  const alreadyBuilding = worlds.some((w) => w.constructionQueue.some((o) => o.owner.kind === 'corporation' && o.owner.corporationId === corp.id))
  if (alreadyBuilding) return worlds

  const order = (recipeId: string): ConstructionOrder => ({
    id: `cai-${corp.id}-${tick}-${recipeId}`,
    recipeId,
    cost: BUILD_COST,
    progress: 0,
    owner: { kind: 'corporation', corporationId: corp.id },
  })

  // --- Option 1: EXPAND the company's most profitable existing building.
  //     A proven winner is the safest use of capital. Leveling it up needs room
  //     in its own world's district. ---
  let bestExpand: { recipeId: string; worldId: string; score: number } | null = null
  for (const w of worlds) {
    for (const b of w.buildings) {
      if (!ownsHere(b, corp.id)) continue
      const perLevelProfit = b.lastProfit / Math.max(1, b.level)
      if (perLevelProfit <= EXPAND_PROFIT_FLOOR) continue
      if (!districtRoom(w, b.recipeId)) continue
      if (!bestExpand || perLevelProfit > bestExpand.score) bestExpand = { recipeId: b.recipeId, worldId: w.id, score: perLevelProfit }
    }
  }

  // --- Option 2: FOUND a new building in the highest-margin foundable sector,
  //     on one of the company's home-country worlds with district room. ---
  const homeWorlds = worlds.filter((w) => w.ownerId === corp.countryId)
  let bestFound: { recipeId: string; worldId: string; score: number } | null = null
  for (const w of homeWorlds) {
    for (const recipeId of FOUNDABLE_SECTORS) {
      if (!districtRoom(w, recipeId)) continue
      const m = grossMargin(recipeId, w)
      if (m <= 0) continue
      if (!bestFound || m > bestFound.score) bestFound = { recipeId, worldId: w.id, score: m }
    }
  }

  // Prefer expanding a proven, cash-generating winner over the paper margin of a
  // greenfield bet; only found new capacity when there's no winner to grow.
  const pick = bestExpand ?? bestFound
  if (!pick) return worlds
  return worlds.map((w) => (w.id === pick.worldId ? { ...w, constructionQueue: [...w.constructionQueue, order(pick.recipeId)] } : w))
}
