import { create } from 'zustand'
import {
  tickAbstractEconomy,
  abstractReport,
  emptyStockpile,
  freeSlots,
  freeLand,
  districtsOf,
  buildingsInDistrict,
  teardownCost,
  importUnitCost,
  type AbstractEconomyState,
  type AbstractReport,
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
  takesSlot,
  SLOTS_PER_DISTRICT,
} from '../data/simplisticEconomyData'
import { STARTING_STOCKPILE } from '../data/shipyardData'
import type { TechCategory } from '../data/techData'
import { controllerOf, seedBodyOwners, type OwnerMap } from '../scene/territory'
import { landForBody } from '../scene/bodyLand'
import { COUNTRIES } from '../data/countryData'
import { useTerritoryStore } from './territoryStore'
import { useResourceStore } from './resourceStore'
import { useTechStore } from './techStore'
import { atWar } from './diplomacyStore'
import { matchTrade } from '../economy-abstract/tradeMatching'

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
    // A capital also starts with one military level (its starting fortress and battery).
    const capital = COUNTRIES.some((c) => c.capitalBodyName === bodyName)
    const districts = { ...districtsOf(base), urban: inhabited ? 1 : 0, military: capital ? 1 : 0 }
    const levels = Object.values(districts).reduce((n, v) => n + v, 0)
    worlds[bodyName] = { ...base, districts, land: Math.max(landForBody(bodyName), levels) }
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
    mk('imperial-state-of-mars', 200, 2000, 0.1, 'corporatist'),
    mk('republic-of-venus', 150, 1400, 0.12, 'market'),
    mk('orion-republic', 90, 600, 0.09, 'market'),
    mk('kingdom-of-lalande', 60, 1200, 0.1, 'planned'),
  ]
  return Object.fromEntries(states.map((s) => [s.countryId, s]))
}

const TECH_TREES: TechCategory[] = ['physics', 'society', 'engineering']

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
  // A standing monthly trade order: + import, − export, 0 clears it.
  setTrade: (countryId: string, good: SimpleGood, perMonth: number) => void
  invest: (countryId: string, amount: number) => void
  payDebt: (countryId: string, amount: number) => void
  queueBuilding: (countryId: string, bodyName: string, building: SimpleBuildingId) => QueueResult
  // Develop one more level of a district (uses a unit of the world's land).
  queueDistrict: (countryId: string, bodyName: string, district: SimpleDistrictId) => QueueResult
  cancelOrder: (countryId: string, orderId: number) => void
  // Tear down one level of a building (no refund; frees its slot at once).
  demolish: (countryId: string, bodyName: string, building: SimpleBuildingId) => QueueResult
  // Deconstruction: its own reverse-progress bar (no queue place, no slot, no construction points); the building works until it runs out.
  queueDemolish: (countryId: string, bodyName: string, building: SimpleBuildingId) => QueueResult
  queueDemolishDistrict: (countryId: string, bodyName: string, district: SimpleDistrictId) => QueueResult
  // Orbital bombardment (scene/bombardment.ts): each world's devastation, and
  // population killed by full bombardment (share per body).
  setDevastation: (byBody: Record<string, number>) => void
  killPopulation: (shareByBody: Record<string, number>) => void
  // Colonies (scene/colonies.ts): a newly founded world with its settlers and
  // a land limit; people leaving on (or arriving by) a Colony Ship; a colony's
  // land limit changing with its stage.
  addColonyWorld: (bodyName: string, population: number, land: number) => void
  adjustPopulation: (bodyName: string, delta: number) => void
  setLand: (bodyName: string, land: number) => void
  // Foreign buildings (scene/holdings.ts): urban slots taken, per body, and
  // money in/out of a nation's treasury.
  setForeignSlots: (byBody: Record<string, number>) => void
  setMilitarySlots: (byBody: Record<string, number>) => void
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
    const research: Record<string, Record<TechCategory, number>> = {}
    const stocks: Record<string, Stockpile> = {}
    const ids = Object.keys(byCountry)
    const series: Record<string, { gdp: number; realGdp: number; inflation: number; debtToGdp: number; rate: number }[]> = {}
    for (const id of ids) {
      // A body that changed hands takes its unfinished projects with it.
      const s = byCountry[id]
      if (s.queue.some((o) => owners[o.bodyName] !== id)) byCountry[id] = { ...s, queue: s.queue.filter((o) => owners[o.bodyName] === id) }
      stocks[id] = stockOf(id)
      series[id] = history[id] ? [...history[id]] : []
      research[id] = { physics: 0, society: 0, engineering: 0 }
    }
    for (let i = 0; i < steps; i++) {
      // The AI sets its policies and orders first…
      if (steer) {
        for (const id of ids) {
          const mine = worldsOf(id, worlds, owners, controllers)
          byCountry[id] = steer(byCountry[id], { worlds: mine, stock: stocks[id], report: abstractReport(byCountry[id], mine, stocks[id]) })
        }
      }
      // …then trade between nations (economy-abstract/tradeMatching.ts): the
      // standing orders fill from real partners at peace, matched each month
      // on what every nation holds and can pay now, through its spaceports.
      const filled = matchTrade(
        ids.map((id) => {
          const tradeCapacity = abstractReport(byCountry[id], worldsOf(id, worlds, owners, controllers), stocks[id]).tradeCapacity
          const r = reports[id]
          const monthlyUse = r ? Object.fromEntries(SIMPLE_GOODS.map((g) => [g, r.used[g] + r.consumed[g]])) : {}
          const monthlyNet = r ? Object.fromEntries(SIMPLE_GOODS.map((g) => [g, r.produced[g] - r.used[g] - r.consumed[g]])) : {}
          return { id, orders: byCountry[id].trade, stock: stocks[id], monthlyUse, monthlyNet, cash: byCountry[id].treasury, unitCost: (g: SimpleGood) => importUnitCost(byCountry[id], g), tradeCapacity }
        }),
        atWar,
      )
      for (const id of ids) {
        const s = byCountry[id]
        const mine = worldsOf(id, worlds, owners, controllers)
        // Tick with the orders as filled; the nation's standing orders stay as set.
        const res = tickAbstractEconomy({ ...s, trade: filled[id] ?? {} }, mine, stocks[id])
        byCountry[id] = { ...res.state, trade: s.trade }
        stocks[id] = res.stock
        const r = res.report
        reports[id] = r
        for (const w of res.worlds) worlds[w.bodyName] = w
        for (const t of TECH_TREES) research[id][t] += r.researchByTree[t]
        series[id].push({ gdp: res.state.gdp, realGdp: res.state.realGdp, inflation: res.state.inflation, debtToGdp: r.debtToGdp, rate: res.state.currency.rate })
      }
    }
    for (const id of ids) {
      if (series[id].length > HISTORY_LENGTH) series[id].splice(0, series[id].length - HISTORY_LENGTH)
      history[id] = series[id]
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
      // Each lab feeds its own tree.
      for (const t of TECH_TREES) if (research[id][t] > 0) tech.grantResearch(id, t, research[id][t])
      // Whatever the nation queued and can now afford gets researched.
      useTechStore.getState().processQueue(id)
    }
  },

  setTaxRate: (countryId, rate) => set((s) => patch(s, countryId, (c) => ({ ...c, taxRate: Math.max(0, Math.min(0.6, rate)) }))),
  setEconomyType: (countryId, type) => set((s) => patch(s, countryId, (c) => ({ ...c, economyType: type }))),
  setMoneyCreation: (countryId, rate) => set((s) => patch(s, countryId, (c) => ({ ...c, moneyCreation: Math.max(0, Math.min(1, rate)) }))),
  setWarTaxes: (countryId, on) => set((s) => patch(s, countryId, (c) => ({ ...c, warTaxes: on }))),
  setWelfare: (countryId, level) => set((s) => patch(s, countryId, (c) => ({ ...c, welfare: Math.max(0, Math.min(1, level)) }))),
  setMonetaryStance: (countryId, stance) => set((s) => patch(s, countryId, (c) => ({ ...c, monetaryStance: stance }))),
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
    if (takesSlot(building) && freeSlots(w, c.queue, d) <= 0) return { ok: false, reason: `No free slot in ${bodyName}'s ${SIMPLE_DISTRICT_DEFS[d].name}, now or once its queued levels are built. Develop the district (queue a level) first.` }
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
  setMilitarySlots: (byBody) =>
    set((s) => {
      let changed = false
      const worlds = { ...s.worlds }
      for (const [body, w] of Object.entries(s.worlds)) {
        const n = byBody[body] ?? 0
        if ((w.militarySlots ?? 0) === n) continue
        worlds[body] = { ...w, militarySlots: n > 0 ? n : undefined }
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
  addColonyWorld: (bodyName, population, land) =>
    set((s) => (s.worlds[bodyName] ? s : { worlds: { ...s.worlds, [bodyName]: { bodyName, population, buildings: {}, districts: {}, land } } })),
  adjustPopulation: (bodyName, delta) =>
    set((s) => {
      const w = s.worlds[bodyName]
      return w ? { worlds: { ...s.worlds, [bodyName]: { ...w, population: Math.max(0, w.population + delta) } } } : s
    }),
  setLand: (bodyName, land) =>
    set((s) => {
      const w = s.worlds[bodyName]
      return w ? { worlds: { ...s.worlds, [bodyName]: { ...w, land } } } : s
    }),
  // Stops a construction order or a deconstruction (the building stays, progress is lost).
  cancelOrder: (countryId, orderId) =>
    set((s) => patch(s, countryId, (c) => ({ ...c, queue: c.queue.filter((o) => o.id !== orderId), teardowns: (c.teardowns ?? []).filter((t) => t.id !== orderId) }))),
  queueDemolish: (countryId, bodyName, building) => {
    const store = get()
    const c = store.byCountry[countryId]
    const w = store.worlds[bodyName]
    if (!c || !w || (w.buildings[building] ?? 0) <= 0) return { ok: false, reason: 'Nothing to deconstruct.' }
    const { bodyOwner, bodyController } = useTerritoryStore.getState()
    if (bodyOwner[bodyName] !== countryId || controllerOf(bodyName, bodyOwner, bodyController) !== countryId) return { ok: false, reason: `You don't hold ${bodyName}.` }
    // No more deconstructions than there are buildings standing.
    const pending = (c.teardowns ?? []).filter((t) => t.bodyName === bodyName && t.building === building).length
    if (pending >= (w.buildings[building] ?? 0)) return { ok: false, reason: `Every ${SIMPLE_BUILDING_DEFS[building].name} here is already being deconstructed.` }
    set((s) => patch(s, countryId, (cur) => ({ ...cur, teardowns: [...(cur.teardowns ?? []), { id: cur.nextOrderId, bodyName, building, progress: teardownCost({ building }) }], nextOrderId: cur.nextOrderId + 1 })))
    return { ok: true }
  },
  queueDemolishDistrict: (countryId, bodyName, district) => {
    const store = get()
    const c = store.byCountry[countryId]
    const w = store.worlds[bodyName]
    if (!c || !w || districtsOf(w)[district] <= 0) return { ok: false, reason: 'No such district level.' }
    const { bodyOwner, bodyController } = useTerritoryStore.getState()
    if (bodyOwner[bodyName] !== countryId || controllerOf(bodyName, bodyOwner, bodyController) !== countryId) return { ok: false, reason: `You don't hold ${bodyName}.` }
    const pending = (c.teardowns ?? []).filter((t) => t.bodyName === bodyName && t.district === district).length
    const levelsAfter = districtsOf(w)[district] - pending - 1
    if (levelsAfter < 0) return { ok: false, reason: `Every ${SIMPLE_DISTRICT_DEFS[district].name} level here is already being deconstructed.` }
    // What stands (and is queued) in the district must still fit.
    const queuedHere = c.queue.filter((o) => o.bodyName === bodyName && o.building && takesSlot(o.building) && DISTRICT_OF_BUILDING[o.building] === district).length
    if (buildingsInDistrict(w, district) + queuedHere > levelsAfter * SLOTS_PER_DISTRICT) return { ok: false, reason: `Its buildings would no longer fit: deconstruct or move some first (${SIMPLE_DISTRICT_DEFS[district].name}).` }
    set((s) => patch(s, countryId, (cur) => ({ ...cur, teardowns: [...(cur.teardowns ?? []), { id: cur.nextOrderId, bodyName, district, progress: teardownCost({ district }) }], nextOrderId: cur.nextOrderId + 1 })))
    return { ok: true }
  },
  demolish: (countryId, bodyName, building) => {
    const w = get().worlds[bodyName]
    if (!w || (w.buildings[building] ?? 0) <= 0) return { ok: false, reason: 'Nothing to demolish.' }
    const { bodyOwner, bodyController } = useTerritoryStore.getState()
    if (bodyOwner[bodyName] !== countryId || controllerOf(bodyName, bodyOwner, bodyController) !== countryId) return { ok: false, reason: `You don't hold ${bodyName}.` }
    set((s) => ({ worlds: { ...s.worlds, [bodyName]: { ...w, buildings: { ...w.buildings, [building]: (w.buildings[building] ?? 0) - 1 } } } }))
    return { ok: true }
  },

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
