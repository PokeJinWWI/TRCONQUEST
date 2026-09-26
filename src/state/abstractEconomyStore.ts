import { create } from 'zustand'
import {
  tickAbstractEconomy,
  abstractReport,
  normalizeAllocation,
  emptyStockpile,
  freeSlots,
  freeLand,
  districtsOf,
  type AbstractEconomyState,
  type AbstractReport,
  type Allocation,
  type EconomyType,
  type MonetaryStance,
  type Stockpile,
  type WorldState,
} from '../economy-abstract/abstractEconomy'
import {
  OUTPOST_SEED,
  DISTRICT_OF_BUILDING,
  SIMPLE_DISTRICT_DEFS,
  type SimpleDistrictId,
  SIMPLE_BUILDING_DEFS,
  SIMPLE_CURRENCIES,
  SIMPLE_GOODS,
  SIMPLE_STARTING_STOCK,
  SIMPLE_WORLD_SEEDS,
  type SimpleBuildingId,
  type SimpleGood,
} from '../data/simplisticEconomyData'
import { STARTING_STOCKPILE } from '../data/shipyardData'
import type { TechCategory } from '../data/techData'
import { controllerOf, seedBodyOwners, type OwnerMap } from '../scene/territory'
import { landForBody } from '../scene/bodyLand'
import { useTerritoryStore } from './territoryStore'
import { useResourceStore } from './resourceStore'
import { useTechStore } from './techStore'

// Simple mode's economy store: one macro state per nation, plus every
// world's population and buildings (keyed by body name — a world's economy
// belongs to whoever owns and controls the body, read live from territory).
// The goods stockpile IS the resourceStore stockpile (what ships and armies are
// paid from); each advance reads it, runs the months and writes it back.
// Complex mode never touches this store.

const MAX_CATCH_UP_TICKS = 40
const HISTORY_LENGTH = 37 // three years of months (+1 for the chart's left edge)

// Real GDP growth for display, from the monthly history: year on year once
// there's a year of it, annualized over the span once there are 6 months,
// undefined before that. Never a single month × 12 — one finished factory or
// one occupied world would read as ±25% or ±200%.
export const GROWTH_MIN_MONTHS = 6
export function smoothedRealGrowth(history: { realGdp: number }[]): number | undefined {
  const n = history.length
  if (n >= 13) {
    const a = history[n - 13].realGdp
    return a > 0 ? history[n - 1].realGdp / a - 1 : undefined
  }
  if (n >= GROWTH_MIN_MONTHS + 1) {
    const a = history[0].realGdp
    return a > 0 ? Math.pow(history[n - 1].realGdp / a, 12 / (n - 1)) - 1 : undefined
  }
  return undefined
}

export interface AbstractHistoryPoint {
  gdp: number
  realGdp: number
  inflation: number
  debtToGdp: number
  rate: number
}

// What the AI (or any steer) sees of a nation before a month runs.
export interface NationEnv {
  worlds: WorldState[]
  stock: Stockpile
  report: AbstractReport
}
export type Steer = (s: AbstractEconomyState, env: NationEnv) => AbstractEconomyState

// The worlds a nation's economy runs on: bodies it owns and actually holds.
export function worldsOf(countryId: string, worlds: Record<string, WorldState>, owners: OwnerMap, controllers: OwnerMap): WorldState[] {
  return Object.values(worlds).filter((w) => owners[w.bodyName] === countryId && controllerOf(w.bodyName, owners, controllers) === countryId)
}

export function stockOf(countryId: string): Stockpile {
  const amounts = useResourceStore.getState().stateFor(countryId).amounts
  const s = emptyStockpile()
  for (const g of SIMPLE_GOODS) s[g] = amounts[g] ?? 0
  return s
}

function startingStock(): Stockpile {
  const s = emptyStockpile()
  for (const g of SIMPLE_GOODS) s[g] = (STARTING_STOCKPILE[g] ?? 0) + (SIMPLE_STARTING_STOCK[g] ?? 0)
  return s
}

export { landForBody }

function seedWorlds(): Record<string, WorldState> {
  const worlds: Record<string, WorldState> = {}
  for (const bodyName of Object.keys(seedBodyOwners())) {
    const inhabited = !!SIMPLE_WORLD_SEEDS[bodyName]
    const seed = SIMPLE_WORLD_SEEDS[bodyName] ?? OUTPOST_SEED
    const base: WorldState = { bodyName, population: seed.population, buildings: { ...seed.buildings } }
    // Just enough district levels to house the seed buildings, plus a small
    // urban district on inhabited worlds (for embassies and foreign firms).
    const districts = { ...districtsOf(base), urban: inhabited ? 1 : 0 }
    worlds[bodyName] = { ...base, districts, land: landForBody(bodyName) }
  }
  return worlds
}

function seedNations(worlds: Record<string, WorldState>): Record<string, AbstractEconomyState> {
  const owners = seedBodyOwners()
  const mk = (
    countryId: string,
    treasury: number,
    debt: number,
    taxRate: number,
    economyType: EconomyType,
    allocation: Allocation,
  ): AbstractEconomyState => {
    const cur = SIMPLE_CURRENCIES[countryId]
    const base: AbstractEconomyState = {
      countryId,
      population: 0,
      gdp: 0,
      realGdp: 0,
      priceLevel: 1,
      inflation: 0.02,
      stability: 0.5, // replaced by the approval it settles at, below
      treasury,
      reserves: 40,
      debt,
      taxRate,
      economyType,
      moneyCreation: 0,
      warTaxes: false,
      welfare: 0.3,
      allocation,
      researchFocus: 'physics',
      queue: [],
      nextOrderId: 1,
      currency: { code: cur.code, name: cur.name, rate: cur.rate, baseRate: cur.rate },
      trade: {},
    }
    // Open at rest: stability starts where the population's approval holds it
    // (so nothing slides on its own in the first year), and on the numbers the
    // economy actually produces at that stability.
    const mine = worldsOf(countryId, worlds, owners, {})
    const settled = { ...base, stability: abstractReport(base, mine, startingStock()).approval }
    const r = abstractReport(settled, mine, startingStock())
    return { ...settled, population: r.population, gdp: r.gdp, realGdp: r.realGdp }
  }
  const states: AbstractEconomyState[] = [
    mk('imperial-state-of-mars', 200, 2000, 0.1, 'corporatist', { civilian: 0.5, military: 0.2, consumer: 0.3 }),
    mk('republic-of-venus', 150, 1400, 0.12, 'market', { civilian: 0.5, military: 0.15, consumer: 0.35 }),
    mk('orion-republic', 90, 600, 0.09, 'market', { civilian: 0.55, military: 0.15, consumer: 0.3 }),
    mk('kingdom-of-lalande', 60, 1200, 0.1, 'planned', { civilian: 0.4, military: 0.35, consumer: 0.25 }),
  ]
  return Object.fromEntries(states.map((s) => [s.countryId, s]))
}

export type QueueResult = { ok: true } | { ok: false; reason: string }

interface AbstractEconomyStore {
  byCountry: Record<string, AbstractEconomyState>
  worlds: Record<string, WorldState>
  reports: Record<string, AbstractReport>
  history: Record<string, AbstractHistoryPoint[]>
  // Months run so far — the tick of the newest history point (charts date their
  // points from it).
  tick: number
  // Run `ticks` months. `steer` runs before each month for every nation and may
  // move its policy levers (the AI); return the state unchanged to leave a
  // nation alone (the player's). Territory defaults to the live store.
  advance: (ticks: number, steer?: Steer, territory?: { owners: OwnerMap; controllers: OwnerMap }) => void
  setTaxRate: (countryId: string, rate: number) => void
  setEconomyType: (countryId: string, type: EconomyType) => void
  setMoneyCreation: (countryId: string, rate: number) => void
  setWarTaxes: (countryId: string, on: boolean) => void
  setWelfare: (countryId: string, level: number) => void
  setMonetaryStance: (countryId: string, stance: MonetaryStance) => void
  setResearchFocus: (countryId: string, focus: TechCategory) => void
  // A standing monthly trade order: + import, − export, 0 clears it.
  setTrade: (countryId: string, good: SimpleGood, perMonth: number) => void
  invest: (countryId: string, amount: number) => void
  payDebt: (countryId: string, amount: number) => void
  setAllocation: (countryId: string, leg: keyof Allocation, value: number) => void
  queueBuilding: (countryId: string, bodyName: string, building: SimpleBuildingId) => QueueResult
  // Develop one more level of a district (uses a unit of the world's land).
  queueDistrict: (countryId: string, bodyName: string, district: SimpleDistrictId) => QueueResult
  cancelOrder: (countryId: string, orderId: number) => void
  // Orbital bombardment (scene/bombardment.ts): each world's devastation, and
  // population killed by full bombardment (share per body).
  setDevastation: (byBody: Record<string, number>) => void
  killPopulation: (shareByBody: Record<string, number>) => void
  // Foreign buildings (scene/holdings.ts): urban slots taken, per body, and
  // money in/out of a nation's treasury.
  setForeignSlots: (byBody: Record<string, number>) => void
  adjustTreasury: (countryId: string, amount: number) => void
  reset: () => void
}

function initial() {
  const worlds = seedWorlds()
  const byCountry = seedNations(worlds)
  const owners = seedBodyOwners()
  const reports = Object.fromEntries(
    Object.entries(byCountry).map(([id, s]) => [id, abstractReport(s, worldsOf(id, worlds, owners, {}), startingStock())]),
  )
  const history = Object.fromEntries(Object.keys(byCountry).map((id) => [id, [] as AbstractHistoryPoint[]]))
  return { byCountry, worlds, reports, history, tick: 0 }
}

export const useAbstractEconomyStore = create<AbstractEconomyStore>((set, get) => ({
  ...initial(),

  advance: (ticks, steer, territory) => {
    const steps = Math.max(0, Math.min(MAX_CATCH_UP_TICKS, Math.floor(ticks)))
    if (steps === 0) return
    const { owners, controllers } = territory ?? { owners: useTerritoryStore.getState().bodyOwner, controllers: useTerritoryStore.getState().bodyController }
    const store = get()
    const byCountry = { ...store.byCountry }
    const reports = { ...store.reports }
    const history = { ...store.history }
    const worlds = { ...store.worlds }
    const research: Record<string, number> = {}
    const stocks: Record<string, Stockpile> = {}

    for (const id of Object.keys(byCountry)) {
      // A body that changed hands takes its unfinished projects with it.
      let s = byCountry[id]
      if (s.queue.some((o) => owners[o.bodyName] !== id)) s = { ...s, queue: s.queue.filter((o) => owners[o.bodyName] === id) }
      let stock = stockOf(id)
      let r = reports[id]
      const series = history[id] ? [...history[id]] : []
      research[id] = 0
      for (let i = 0; i < steps; i++) {
        const mine = worldsOf(id, worlds, owners, controllers)
        if (steer) s = steer(s, { worlds: mine, stock, report: abstractReport(s, mine, stock) })
        const res = tickAbstractEconomy(s, mine, stock)
        s = res.state
        stock = res.stock
        r = res.report
        for (const w of res.worlds) worlds[w.bodyName] = w
        research[id] += r.research
        series.push({ gdp: s.gdp, realGdp: s.realGdp, inflation: s.inflation, debtToGdp: r.debtToGdp, rate: s.currency.rate })
      }
      if (series.length > HISTORY_LENGTH) series.splice(0, series.length - HISTORY_LENGTH)
      byCountry[id] = s
      reports[id] = r
      history[id] = series
      stocks[id] = stock
    }
    set({ byCountry, reports, history, worlds, tick: store.tick + steps })

    // Write the stockpiles back and hand research to the tech trees.
    const res = useResourceStore.getState()
    const tech = useTechStore.getState()
    for (const id of Object.keys(byCountry)) {
      for (const g of SIMPLE_GOODS) {
        res.setAmount(id, g, stocks[id][g])
        res.setMonthlyDelta(id, g, Math.round(reports[id].net[g] * 10) / 10)
      }
      if (research[id] > 0) tech.grantResearch(id, byCountry[id].researchFocus, research[id])
    }
  },

  setTaxRate: (countryId, rate) => set((s) => patch(s, countryId, (c) => ({ ...c, taxRate: Math.max(0, Math.min(0.6, rate)) }))),
  setEconomyType: (countryId, type) => set((s) => patch(s, countryId, (c) => ({ ...c, economyType: type }))),
  setMoneyCreation: (countryId, rate) => set((s) => patch(s, countryId, (c) => ({ ...c, moneyCreation: Math.max(0, Math.min(1, rate)) }))),
  setWarTaxes: (countryId, on) => set((s) => patch(s, countryId, (c) => ({ ...c, warTaxes: on }))),
  setWelfare: (countryId, level) => set((s) => patch(s, countryId, (c) => ({ ...c, welfare: Math.max(0, Math.min(1, level)) }))),
  setMonetaryStance: (countryId, stance) => set((s) => patch(s, countryId, (c) => ({ ...c, monetaryStance: stance }))),
  setResearchFocus: (countryId, focus) => set((s) => patch(s, countryId, (c) => ({ ...c, researchFocus: focus }))),
  setTrade: (countryId, good, perMonth) =>
    set((s) =>
      patch(s, countryId, (c) => {
        const trade = { ...c.trade }
        if (!Number.isFinite(perMonth) || perMonth === 0) delete trade[good]
        else trade[good] = perMonth
        return { ...c, trade }
      }),
    ),
  invest: (countryId, amount) =>
    set((s) =>
      patch(s, countryId, (c) => {
        const move = Math.max(-c.reserves, Math.min(c.treasury, amount)) // + treasury→reserves, − back
        return { ...c, treasury: c.treasury - move, reserves: c.reserves + move }
      }),
    ),
  payDebt: (countryId, amount) =>
    set((s) =>
      patch(s, countryId, (c) => {
        let pay = Math.max(0, Math.min(c.debt, amount))
        const fromReserves = Math.min(c.reserves, pay)
        pay -= fromReserves
        const fromTreasury = Math.min(c.treasury, pay)
        return { ...c, reserves: c.reserves - fromReserves, treasury: c.treasury - fromTreasury, debt: c.debt - fromReserves - fromTreasury }
      }),
    ),
  setAllocation: (countryId, leg, value) =>
    set((s) => patch(s, countryId, (c) => ({ ...c, allocation: normalizeAllocation({ ...c.allocation, [leg]: Math.max(0, value) }) }))),

  queueBuilding: (countryId, bodyName, building) => {
    const store = get()
    const c = store.byCountry[countryId]
    const w = store.worlds[bodyName]
    if (!c || !w) return { ok: false, reason: 'No such world.' }
    const { bodyOwner, bodyController } = useTerritoryStore.getState()
    if (bodyOwner[bodyName] !== countryId) return { ok: false, reason: `You don't own ${bodyName}.` }
    if (controllerOf(bodyName, bodyOwner, bodyController) !== countryId) return { ok: false, reason: `${bodyName} is occupied.` }
    if (!SIMPLE_BUILDING_DEFS[building]) return { ok: false, reason: 'Unknown building.' }
    const d = DISTRICT_OF_BUILDING[building]
    if (freeSlots(w, c.queue, d) <= 0) return { ok: false, reason: `No free slot in ${bodyName}'s ${SIMPLE_DISTRICT_DEFS[d].name} — develop the district first.` }
    set((s) => patch(s, countryId, (cur) => ({ ...cur, queue: [...cur.queue, { id: cur.nextOrderId, bodyName, building, progress: 0 }], nextOrderId: cur.nextOrderId + 1 })))
    return { ok: true }
  },
  queueDistrict: (countryId, bodyName, district) => {
    const store = get()
    const c = store.byCountry[countryId]
    const w = store.worlds[bodyName]
    if (!c || !w) return { ok: false, reason: 'No such world.' }
    const { bodyOwner, bodyController } = useTerritoryStore.getState()
    if (bodyOwner[bodyName] !== countryId) return { ok: false, reason: `You don't own ${bodyName}.` }
    if (controllerOf(bodyName, bodyOwner, bodyController) !== countryId) return { ok: false, reason: `${bodyName} is occupied.` }
    if (!SIMPLE_DISTRICT_DEFS[district]) return { ok: false, reason: 'Unknown district.' }
    if (freeLand(w, c.queue) <= 0) return { ok: false, reason: `${bodyName} has no land left for another district level.` }
    set((s) => patch(s, countryId, (cur) => ({ ...cur, queue: [...cur.queue, { id: cur.nextOrderId, bodyName, district, progress: 0 }], nextOrderId: cur.nextOrderId + 1 })))
    return { ok: true }
  },
  setDevastation: (byBody) =>
    set((s) => {
      let changed = false
      const worlds = { ...s.worlds }
      for (const [body, w] of Object.entries(s.worlds)) {
        const dev = byBody[body] ?? 0
        if ((w.devastation ?? 0) === dev) continue
        worlds[body] = { ...w, devastation: dev > 0 ? dev : undefined }
        changed = true
      }
      return changed ? { worlds } : s
    }),
  setForeignSlots: (byBody) =>
    set((s) => {
      let changed = false
      const worlds = { ...s.worlds }
      for (const [body, w] of Object.entries(s.worlds)) {
        const n = byBody[body] ?? 0
        if ((w.foreignSlots ?? 0) === n) continue
        worlds[body] = { ...w, foreignSlots: n > 0 ? n : undefined }
        changed = true
      }
      return changed ? { worlds } : s
    }),
  adjustTreasury: (countryId, amount) => set((s) => patch(s, countryId, (c) => ({ ...c, treasury: c.treasury + amount }))),
  killPopulation: (shareByBody) =>
    set((s) => {
      const worlds = { ...s.worlds }
      for (const [body, share] of Object.entries(shareByBody)) {
        const w = worlds[body]
        if (w && share > 0) worlds[body] = { ...w, population: w.population * (1 - share) }
      }
      return { worlds }
    }),
  cancelOrder: (countryId, orderId) => set((s) => patch(s, countryId, (c) => ({ ...c, queue: c.queue.filter((o) => o.id !== orderId) }))),

  reset: () => set(initial()),
}))

// Apply `fn` to one country's state and refresh its report.
function patch(store: AbstractEconomyStore, countryId: string, fn: (c: AbstractEconomyState) => AbstractEconomyState): Partial<AbstractEconomyStore> {
  const cur = store.byCountry[countryId]
  if (!cur) return {}
  const next = fn(cur)
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  const report = abstractReport(next, worldsOf(countryId, store.worlds, bodyOwner, bodyController), stockOf(countryId))
  return { byCountry: { ...store.byCountry, [countryId]: next }, reports: { ...store.reports, [countryId]: report } }
}
