// Country AI — the "brain" that runs a NON-PLAYER nation, in the spirit of a
// Paradox/Stellaris country AI: not one monolith, but a set of specialized
// MANAGER subsystems that share the nation's treasury and goals and coordinate
// each tick. This is deterministic, heuristic game-AI (no LLM) — it plays the
// exact same levers a human player does, so a nation the player is not running
// still raises taxes into a deficit, funds itself with bonds, and builds what
// it needs.
//
// Subsystems implemented here (v1):
//   - Fiscal manager       — tax & welfare, steering toward a sustainable budget
//   - Debt manager         — issues/redeems bonds, resolves foreign offers
//   - Governance manager   — government construction (bureaucracy, then growth)
//
// Future managers plug into the same per-country brain when their systems are
// wired for AI: a MILITARY manager (fleets/war), a DIPLOMACY manager (pacts,
// rivalries), a TECH/agenda planner. They are deliberately separate modules
// (separation of concerns), coordinated by `runCountryAI` below — the single
// entry point tickEconomy calls for each non-player country.

import type { Country, CountryFiscal, World, Corporation, ConstructionOrder } from './economyTypes'
import { RECIPES, districtOfRecipe, type DistrictType } from './recipes'
import { economicSystemDef } from './laws'

// --- Tunables (all deliberately gentle: the AI nudges, it does not lurch) ---

// How often each manager reviews. Reviews are staggered per-nation (see offset)
// so they don't all act on the same tick, and are spaced out so policy doesn't
// oscillate month to month.
const FISCAL_REVIEW_PERIOD = 12 // yearly: tax/welfare
const DEBT_REVIEW_PERIOD = 12 // yearly: bond issue/redeem housekeeping
const BUILD_REVIEW_PERIOD = 6 // twice-yearly: one construction decision

// Fiscal dead-bands, as a fraction of the nation's own revenue, so the same
// rule works for a small nation and a large one.
const DEFICIT_TRIGGER = 0.12 // balance below −12% of revenue = "too deep"
const SURPLUS_TRIGGER = 0.12 // balance above +12% of revenue = "can spend it"

const TAX_STEP = 0.02
const TAX_MIN = 0.05
const TAX_MAX = 0.5
const WELFARE_STEP = 0.3
const WELFARE_MAX = 8
const GENEROUS_WELFARE = 1.0 // above this, a struggling state trims welfare first

// Debt manager thresholds.
const OVERDRAFT_FUND_BUFFER = 200 // fund the overdraft once it passes this
const REDEEM_TREASURY_BUFFER = 40000 // only pay down debt when this flush
const MAX_DEBT_TO_GDP = 1.8 // stop borrowing past here (let the deficit bite)

// Construction manager thresholds.
const BUILD_TREASURY_BUFFER = 30000 // keep this much on hand before building
const BUREAUCRACY_STRAIN = 0.85 // consumed/capacity above this = build admin

// A stable per-nation phase offset so nations act on different ticks.
function phase(id: string, period: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % period
}

const RATING_ORDER = ['CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA']
function ratingAtLeast(r: CountryFiscal['rating'], min: CountryFiscal['rating']): boolean {
  return RATING_ORDER.indexOf(r) >= RATING_ORDER.indexOf(min)
}

// --- Fiscal manager: steer tax & welfare toward a sustainable budget. ---
function fiscalManager(country: Country, report: CountryFiscal): Country {
  const revenue = Math.max(1, report.revenue)
  const deficitDeep = report.balance < -DEFICIT_TRIGGER * revenue
  const surplusFat = report.balance > SURPLUS_TRIGGER * revenue
  const overIndebted = !ratingAtLeast(report.rating, 'A') // worse than A

  let taxRate = country.taxRate
  let welfarePerCapita = country.welfarePerCapita

  if (deficitDeep || overIndebted) {
    // Raise revenue; if welfare is generous, trim it before it consumes the
    // whole budget.
    taxRate = Math.min(TAX_MAX, taxRate + TAX_STEP)
    if (welfarePerCapita > GENEROUS_WELFARE) welfarePerCapita = Math.max(0, welfarePerCapita - WELFARE_STEP)
  } else if (surplusFat && ratingAtLeast(report.rating, 'AA')) {
    // A comfortable, low-debt state spends the surplus down toward its pops
    // (raising living standards) rather than hoarding.
    if (welfarePerCapita < WELFARE_MAX) welfarePerCapita = Math.min(WELFARE_MAX, welfarePerCapita + WELFARE_STEP)
    else taxRate = Math.max(TAX_MIN, taxRate - TAX_STEP)
  }

  if (taxRate === country.taxRate && welfarePerCapita === country.welfarePerCapita) return country
  return { ...country, taxRate, welfarePerCapita }
}

// --- Debt manager: fund overdrafts with bonds, pay down when flush, and
//     resolve foreign purchase offers (the AI has no human to approve them). ---
function debtManager(country: Country, report: CountryFiscal): Country {
  let treasury = country.treasury
  let bonds = country.bonds
  let pendingForeign = country.pendingForeign

  // Resolve any foreign offers: take the cash if we need it, decline if flush.
  if (pendingForeign.length > 0) {
    const needCash = treasury < 0
    if (needCash && country.foreignBondPolicy !== 'closed') {
      let foreign = bonds.foreign
      for (const o of pendingForeign) {
        foreign += o.amount
        treasury += o.amount
      }
      bonds = { ...bonds, foreign }
    }
    pendingForeign = []
  }

  // Fund an unfunded overdraft by selling bonds to domestic pops — unless debt
  // is already dangerously high, in which case let the deficit bite (the point
  // of deficits being real).
  if (treasury < -OVERDRAFT_FUND_BUFFER && report.debtToGdp < MAX_DEBT_TO_GDP) {
    const raise = -treasury
    bonds = { ...bonds, pops: bonds.pops + raise }
    treasury += raise
  } else if (treasury > REDEEM_TREASURY_BUFFER && bonds.pops > 0) {
    // Flush: retire some domestic debt.
    const pay = Math.min(bonds.pops, treasury - REDEEM_TREASURY_BUFFER)
    bonds = { ...bonds, pops: bonds.pops - pay }
    treasury -= pay
  }

  if (treasury === country.treasury && bonds === country.bonds && pendingForeign === country.pendingForeign) return country
  return { ...country, treasury, bonds, pendingForeign }
}

// The state buildings the governance manager may fund for GROWTH, keyed by the
// output good it relieves. Kept to essentials the state plausibly runs directly;
// private industry (via corp AI, later) covers the rest.
const GROWTH_BUILDINGS: { recipeId: string }[] = [
  { recipeId: 'foodProcessor' },
  { recipeId: 'clinic' },
  { recipeId: 'consumerGoodsFactory' },
  { recipeId: 'steelMill' },
  { recipeId: 'solarPlant' },
]

function districtRoom(world: World, recipeId: string): boolean {
  const d: DistrictType = districtOfRecipe(recipeId)
  const used = world.buildings.reduce((n, b) => n + (districtOfRecipe(b.recipeId) === d ? b.level : 0), 0) + world.constructionQueue.filter((o) => districtOfRecipe(o.recipeId) === d).length
  return used < world.districtCapacity[d]
}

// --- Governance manager: one government (state-funded) construction decision.
//     Priority 1 is keeping the bureaucracy solvent; priority 2 is growing the
//     economy where the state plausibly builds. ---
function governanceManager(country: Country, report: CountryFiscal, worlds: World[], tick: number): World[] {
  if (report.treasury < BUILD_TREASURY_BUFFER) return worlds
  const owned = worlds.filter((w) => w.ownerId === country.id)
  if (owned.length === 0) return worlds

  const alreadyQueuing = (recipeId: string) => owned.some((w) => w.constructionQueue.some((o) => o.recipeId === recipeId))
  const order = (recipeId: string): ConstructionOrder => ({
    id: `ai-${country.id}-${tick}-${recipeId}`,
    recipeId,
    cost: 6000,
    progress: 0,
    owner: { kind: 'state' },
  })
  const placeOn = (recipeId: string): World[] | null => {
    // Prefer the owned world with the most buildings that still has room.
    const candidate = [...owned].sort((a, b) => b.buildings.length - a.buildings.length).find((w) => districtRoom(w, recipeId))
    if (!candidate) return null
    return worlds.map((w) => (w.id === candidate.id ? { ...w, constructionQueue: [...w.constructionQueue, order(recipeId)] } : w))
  }

  // Priority 1: bureaucracy under strain → build administrative capacity. That
  // means either running the reserve DRY (consuming more than we produce, with
  // nothing stored), or riding near the storage ceiling.
  const runningDry = report.bureaucracy <= 0 && report.bureaucracyConsumed > report.bureaucracyProduced
  const nearCeiling = report.bureaucracyCapacity > 0 && report.bureaucracyConsumed >= BUREAUCRACY_STRAIN * report.bureaucracyCapacity
  const strained = runningDry || nearCeiling
  if (strained && !alreadyQueuing('ministry') && !alreadyQueuing('governmentOffice')) {
    const placed = placeOn('ministry') ?? placeOn('governmentOffice')
    if (placed) return placed
  }

  // Priority 2: growth — a command/interventionist state builds a needed plant
  // itself; a laissez-faire state leaves production to the market (corps). The
  // interferenceMalus is the cleanest proxy: command 1.0 and interventionism
  // 0.9 direct production; laissez-faire 0.7 does not.
  const buildsIndustry = economicSystemDef(country.economicSystem).interferenceMalus >= 0.9
  if (buildsIndustry) {
    // Pick the growth building whose output good is priciest across the nation
    // (a rough "most under-supplied" signal), that we're not already building.
    let best: { recipeId: string; price: number } | null = null
    for (const g of GROWTH_BUILDINGS) {
      if (alreadyQueuing(g.recipeId)) continue
      const recipe = RECIPES[g.recipeId]
      const outGood = recipe?.methods[0]?.outputs[0]?.good
      if (!outGood) continue
      const price = Math.max(...owned.map((w) => w.market.prices[outGood] ?? 0))
      if (!best || price > best.price) best = { recipeId: g.recipeId, price }
    }
    if (best) {
      const placed = placeOn(best.recipeId)
      if (placed) return placed
    }
  }

  return worlds
}

export interface CountryAIOptions {
  // The HUMAN-controlled nations — never AI-driven. This is a set, not a single
  // id, because the game is multiplayer: any number of nations may be run by
  // human players at once (and in a networked game the authoritative sim passes
  // every connected player's nation here, leaving only unclaimed nations to the
  // AI). When empty/absent, every nation is treated as AI (headless sim/tests).
  humanCountryIds?: readonly string[]
  // The current tick index, for review cadence. Managers only act on their
  // review ticks.
  tick?: number
  // Master switch. tickEconomy leaves this off by default so existing callers
  // (and every economy test) run with NO AI and unchanged behavior; the store
  // turns it on for live play.
  enableAI?: boolean
}

// Run the full country brain for ONE nation for this tick, returning the
// (possibly) updated country and worlds. Pure: no globals, no mutation of the
// inputs. tickEconomy calls this for each non-player country after the tick's
// production and reports are settled, so decisions land for next tick.
export function runCountryAI(
  country: Country,
  report: CountryFiscal,
  worlds: World[],
  _corporations: Corporation[],
  tick: number,
): { country: Country; worlds: World[] } {
  let next = country
  if (tick % FISCAL_REVIEW_PERIOD === phase(country.id, FISCAL_REVIEW_PERIOD)) next = fiscalManager(next, report)
  // Debt housekeeping runs on its review tick, but funding an overdraft is
  // urgent — do it whenever the treasury is meaningfully underwater.
  if (tick % DEBT_REVIEW_PERIOD === phase(country.id, DEBT_REVIEW_PERIOD) || report.treasury < -OVERDRAFT_FUND_BUFFER) next = debtManager(next, report)
  let nextWorlds = worlds
  if (tick % BUILD_REVIEW_PERIOD === phase(country.id, BUILD_REVIEW_PERIOD)) nextWorlds = governanceManager(next, report, worlds, tick)
  return { country: next, worlds: nextWorlds }
}
