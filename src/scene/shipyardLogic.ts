// Ship construction logic: affordability, the build-queue step, capital
// shipyard capacity, spawning a finished hull, and the placeholder resource
// supply. Pure where it can be (missingResources, stepShipyardQueue,
// shipyardSlotsForWorld) with thin store I/O at the edges (spend/refund/
// spawn/seed/income) — same split as combatResolution vs. useCombatResolver.
// Data and every tuning constant live in data/shipyardData.ts.
import { startingExoticMatter } from '../data/exoticMatter'
import { HYPERIUM_NEAR_SOL } from '../data/hyperium'
import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import { SIMPLE_STARTING_STOCK } from '../data/simplisticEconomyData'
import {
  RESOURCE_INCOME_PER_MONTH,
  SLOTS_PER_SPACEYARD_LEVEL,
  SHIPYARD_FREE_SLOTS,
  SPACEYARD_RECIPE_ID,
  STARTING_STOCKPILE,
  MILITARY_STOCKPILE_TARGET,
  type ResourceCost,
  type GoodCost,
} from '../data/shipyardData'
import type { ShipClass } from '../data/shipData'
import { findTech } from '../data/techData'
import { COUNTRIES, type Country } from '../data/countryData'
import { GOODS, type GoodId } from '../economy/goods'
import { economyModel } from '../state/playerStore'
import type { World } from '../economy/economyTypes'
import { resolveShipClass } from '../state/shipClassResolver'
import { useResourceStore } from '../state/resourceStore'
import { useTechStore } from '../state/techStore'
import { useShipStore, pristineCombatState } from '../state/shipStore'
import { useShipyardStore, type ShipBuildOrder } from '../state/shipyardStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { DEFAULT_SHIP_ORBIT_PERIOD_DAYS } from './shipPhysics'
import { embarkSettlers } from './colonies'
import { useStarbaseStore } from '../state/starbaseStore'
import { starbaseShipyardSlots } from './starbaseLogic'

const RESOURCE_NAMES = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>

// Display names of every resource `cost` needs more of than `amounts` holds —
// empty means affordable.
export function missingResources(cost: ResourceCost, amounts: Record<ResourceId, number>): string[] {
  return (Object.entries(cost) as [ResourceId, number][])
    .filter(([id, need]) => need > (amounts[id] ?? 0))
    .map(([id]) => RESOURCE_NAMES[id])
}

export function spendCost(countryId: string, cost: ResourceCost): void {
  const { addAmount } = useResourceStore.getState()
  for (const [id, amount] of Object.entries(cost) as [ResourceId, number][]) addAmount(countryId, id, -amount)
}

export function refundCost(countryId: string, cost: ResourceCost): void {
  const { addAmount } = useResourceStore.getState()
  for (const [id, amount] of Object.entries(cost) as [ResourceId, number][]) addAmount(countryId, id, amount)
}

// --- Complex mode: the capital's economy stockpile --------------------------
// In Complex mode the shipyard spends REAL economy goods from the nation's
// capital world stockpile (see data/shipyardData.complexShipBuildCost), instead
// of the abstract strategic pool above.
export function capitalWorldIdOf(countryId: string): string | null {
  const name = COUNTRIES.find((c) => c.id === countryId)?.capitalBodyName
  if (!name) return null
  return worldByName(useEconomyStore.getState().worlds, name)?.id ?? null
}

export function capitalStockpileOf(countryId: string): Partial<Record<GoodId, number>> {
  const name = COUNTRIES.find((c) => c.id === countryId)?.capitalBodyName
  if (!name) return {}
  return worldByName(useEconomyStore.getState().worlds, name)?.stockpiles ?? {}
}

// Labels of every good `cost` needs more of than the capital stockpile holds —
// empty means affordable.
export function missingEconomyGoods(cost: GoodCost, stockpiles: Partial<Record<GoodId, number>>): string[] {
  return (Object.entries(cost) as [GoodId, number][])
    .filter(([id, need]) => need > (stockpiles[id] ?? 0))
    .map(([id]) => GOODS[id].label)
}

export function spendEconomyCost(countryId: string, cost: GoodCost): void {
  const worldId = capitalWorldIdOf(countryId)
  if (worldId) useEconomyStore.getState().consumeStockpile(worldId, cost)
}

export function refundEconomyCost(countryId: string, cost: GoodCost): void {
  const worldId = capitalWorldIdOf(countryId)
  if (worldId) useEconomyStore.getState().consumeStockpile(worldId, cost, true)
}

// Complex-mode game start: give a nation a standing war-materials stockpile
// target at its capital (the economy refills it off the market) and inject the
// starting reserve so its opening navy is buildable at once. Idempotent per
// nation — a re-setup won't double the reserve, since it only tops up to target.
export function seedMilitaryStockpile(countryId: string): void {
  const worldId = capitalWorldIdOf(countryId)
  if (!worldId) return
  const econ = useEconomyStore.getState()
  const have = capitalStockpileOf(countryId)
  const topUp: GoodCost = {}
  for (const [g, amt] of Object.entries(MILITARY_STOCKPILE_TARGET) as [GoodId, number][]) {
    econ.setStockpileTarget(worldId, g, amt)
    const missing = amt - (have[g] ?? 0)
    if (missing > 0) topUp[g] = missing
  }
  if (Object.keys(topUp).length > 0) econ.consumeStockpile(worldId, topUp, true)
}

// What the gate reads: a Set of researched ids, or anything that can say yes/no (the AI's blackboard).
export type ResearchedSet = { has: (techId: string) => boolean }

// The tech a nation still needs before it can build `shipClass` (its name), or null
// when it can. The one gate the shipyard panel, `queueBuild` and the AI all read.
export function techBlock(shipClass: ShipClass, researched: ResearchedSet): string | null {
  const need = shipClass.requiresTech
  if (!need || researched.has(need)) return null
  return findTech(need)?.name ?? need
}

// A level of an upgrade line the nation has already moved past: its successor is
// unlocked, so the shipyard offers only that one (scouts are one line).
export function lineSuperseded(shipClass: ShipClass, researched: ResearchedSet, classOf: (id: string) => ShipClass | null): boolean {
  const next = shipClass.upgradesTo ? classOf(shipClass.upgradesTo) : null
  return !!next && techBlock(next, researched) === null
}

// The level of a hull's upgrade line a NEW build comes out at: follows `upgradesTo` while
// the next level is researched, so asking for a Hyperspace Scout once Turing is unlocked
// builds the Turing Scout. A hull with no line is its own best level.
export function bestLevelClass(classId: string, researched: ResearchedSet, classOf: (id: string) => ShipClass | null): string {
  let current = classOf(classId)
  let id = classId
  for (let guard = 0; guard < 10 && current?.upgradesTo; guard++) {
    const next = classOf(current.upgradesTo)
    if (!next || techBlock(next, researched) !== null) break
    id = next.id
    current = next
  }
  return id
}

// The hulls a shipyard tab lists, in order: what the nation can build now first, then
// what it still needs a tech for (stable inside each group, so the list does not
// shuffle). Dev tools never appear, and a superseded level of a line is hidden.
// Grouping is by tech only: a resource shortfall is a note on the row, not a move,
// so the order does not change every month.
export function shipyardRows(classes: readonly ShipClass[], researched: ResearchedSet, classOf: (id: string) => ShipClass | null): ShipClass[] {
  const shown = classes.filter((c) => !c.devOnly && !lineSuperseded(c, researched, classOf))
  return [...shown.filter((c) => techBlock(c, researched) === null), ...shown.filter((c) => techBlock(c, researched) !== null)]
}

// How many hulls the capital can build at once: the free baseline plus
// SLOTS_PER_SPACEYARD_LEVEL per level of Spaceyard building on the world.
export function shipyardSlotsForWorld(world: World | undefined): number {
  const spaceyardLevels = (world?.buildings ?? [])
    .filter((b) => b.recipeId === SPACEYARD_RECIPE_ID)
    .reduce((sum, b) => sum + b.level, 0)
  return SHIPYARD_FREE_SLOTS + spaceyardLevels * SLOTS_PER_SPACEYARD_LEVEL
}

// Which waiting orders start now: the first ones in QUEUE ORDER (FIFO), as many as
// there are free slips (`slots` minus the orders already building). Empty when every
// slip is busy or nothing waits. The one selection rule for the player's yard and
// every AI's.
export function ordersToStart(orders: readonly ShipBuildOrder[], slots: number): string[] {
  const building = orders.filter((o) => o.startedSimDays !== null).length
  const free = Math.max(0, Math.floor(slots)) - building
  if (free <= 0) return []
  return orders.filter((o) => o.startedSimDays === null).slice(0, free).map((o) => o.id)
}

// Advances the queue to `simDays`, as a pure function. Orders are FIFO; the
// first `slots` unfinished orders build in parallel. An order that finishes
// hands its slot straight to the next waiting one AT its finish time (not
// merely "whenever this step happened to run"), so a big clock jump can't
// under-count throughput. Returns the surviving orders plus those that
// completed, oldest first.
export function stepShipyardQueue(
  orders: ShipBuildOrder[],
  slots: number,
  simDays: number,
): { orders: ShipBuildOrder[]; completed: ShipBuildOrder[] } {
  const completed: ShipBuildOrder[] = []
  let queue = orders.map((o) => ({ ...o }))
  const capacity = Math.max(0, slots)

  // Each pass either completes one order or starts one, so it terminates.
  for (let guard = 0; guard < 1000; guard++) {
    // Complete the earliest-finishing order that's due.
    let dueIndex = -1
    for (let i = 0; i < queue.length; i++) {
      const finish = queue[i].finishSimDays
      if (finish !== null && finish <= simDays && (dueIndex === -1 || finish < queue[dueIndex].finishSimDays!)) dueIndex = i
    }
    let freedAt = simDays
    if (dueIndex !== -1) {
      freedAt = queue[dueIndex].finishSimDays!
      completed.push(queue[dueIndex])
      queue = queue.filter((_, i) => i !== dueIndex)
    }

    // Start waiting orders into free slots. A slot freed by a completion
    // starts its successor at that completion time; otherwise at `simDays`.
    const nextId = ordersToStart(queue, capacity)[0]
    const next = nextId === undefined ? undefined : queue.find((o) => o.id === nextId)
    if (next) {
      const start = dueIndex !== -1 ? freedAt : simDays
      next.startedSimDays = start
      next.finishSimDays = start + next.durationDays
      continue
    }
    if (dueIndex === -1) break
  }
  return { orders: queue, completed }
}

// One step of one nation's capital yard up to `simDays`: starts the waiting orders the
// free slips take, completes what is due and puts finished hulls into orbit. The
// per-tick resolver runs it for every nation, and the shipyard store runs it for one
// the moment its queue changes (an order queued into a free slip, a build cancelled),
// so a slip never sits free for want of a clock tick (a paused game included).
export function advanceShipyard(country: Pick<Country, 'id' | 'capitalStarId' | 'capitalBodyName'>, simDays: number): void {
  const { ordersFor, setOrders } = useShipyardStore.getState()
  let orders = ordersFor(country.id)
  // An upgrade whose ship is gone (destroyed, scrapped, lost to a jump) is dropped, refunded in full.
  const live = new Set(useShipStore.getState().ships.map((s) => s.id))
  const orphans = orders.filter((o) => o.upgradeShipId && !live.has(o.upgradeShipId))
  if (orphans.length > 0) {
    for (const o of orphans) {
      if (o.goodCost) refundEconomyCost(country.id, o.goodCost)
      else refundCost(country.id, o.cost)
    }
    orders = orders.filter((o) => !orphans.includes(o))
    setOrders(country.id, orders)
  }
  if (orders.length === 0) return
  const world = worldByName(useEconomyStore.getState().worlds, country.capitalBodyName)
  const step = stepShipyardQueue(orders, shipyardSlotsForWorld(world) + starbaseShipyardSlots(country.id, useStarbaseStore.getState().starbases, simDays), simDays)
  const changed = step.completed.length > 0 || step.orders.some((o, i) => o.startedSimDays !== orders[i]?.startedSimDays)
  if (!changed) return
  setOrders(country.id, step.orders)
  for (const done of step.completed) {
    if (done.upgradeShipId) finishUpgrade(done)
    else spawnBuiltShip(done, country)
  }
}

// A ship keeps its number but takes its new class's name when upgraded ("Hyperspace Scout 3"
// -> "Turing Scout 3"); a name the player chose (not "<old class> <number>") is left alone.
export function upgradedName(name: string, fromClassName: string, toClassName: string): string {
  const prefix = `${fromClassName} `
  return name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)) ? `${toClassName} ${name.slice(prefix.length)}` : name
}

// An upgrade finished: the same ship becomes the best level its owner has researched NOW
// (a tech that landed while it waited counts). Only its class changes.
function finishUpgrade(order: ShipBuildOrder): void {
  const ship = useShipStore.getState().ships.find((s) => s.id === order.upgradeShipId)
  if (!ship) return
  const classId = bestLevelClass(order.classId, useTechStore.getState().stateFor(ship.ownerId).researched, resolveShipClass)
  const name = upgradedName(ship.name, resolveShipClass(ship.classId)?.name ?? '', resolveShipClass(classId)?.name ?? '')
  useShipStore.setState((s) => ({ ships: s.ships.map((sh) => (sh.id === ship.id ? { ...sh, classId, name, upgrading: undefined } : sh)) }))
}

let spawnCounter = 0

// Puts a fresh, undamaged hull of `classId` into orbit around `bodyName`,
// owned by `ownerId` — the one spawn path gameplay uses (a finished build,
// a nation's starting navy), with the same defaults as every other spawn.
// Returns the new ship's id, or null for an unknown class.
export function spawnOwnedShip(classId: string, ownerId: string, systemId: string, bodyName: string): string | null {
  const shipClass = resolveShipClass(classId)
  if (!shipClass) return null
  spawnCounter += 1
  const id = `ship-${Date.now()}-b${spawnCounter}`
  useShipStore.getState().spawnShip({
    id,
    classId: shipClass.id,
    name: `${shipClass.name} ${spawnCounter}`,
    ownerId,
    location: {
      kind: 'orbiting',
      systemId,
      bodyName,
      periodDays: DEFAULT_SHIP_ORBIT_PERIOD_DAYS,
      phaseDeg: (spawnCounter * 47) % 360,
      inclinationDeg: 0,
    },
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: true,
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(shipClass.combat),
    stance: 'balanced',
  })
  return id
}

// Puts a finished hull into orbit around its nation's capital, owned by that
// nation.
export function spawnBuiltShip(order: ShipBuildOrder, country: Pick<Country, 'id' | 'capitalStarId' | 'capitalBodyName'>): string | null {
  const id = spawnOwnedShip(order.classId, country.id, country.capitalStarId, country.capitalBodyName)
  if (id) embarkSettlers(id, country.id)
  return id
}

// --- Placeholder resource supply -------------------------------------------

// Gives a nation its starting reserve and points its monthly figures at the
// income table. Only fills a slot that's still empty, so re-seeding mid-session
// never wipes what's been earned/spent.
export function seedStrategicResources(countryId: string): void {
  const { stateFor, setAmount, setMonthlyDelta } = useResourceStore.getState()
  const { amounts } = stateFor(countryId)
  for (const [id, start] of Object.entries(STARTING_STOCKPILE) as [ResourceId, number][]) {
    if ((amounts[id] ?? 0) === 0) setAmount(countryId, id, start)
  }
  // The scarce ones depend on where the nation lives (data/exoticMatter.ts,
  // data/hyperium.ts). In Complex mode exotic matter and hyperium are real economy
  // goods (made by plants, drawn from the capital stockpile), NOT strategic-pool
  // resources — there is one count each, in the economy — so the strategic pool is
  // not seeded with them; this is Simple mode's deposit-fed stockpile only.
  if (economyModel() !== 'complex') {
    if ((amounts.exoticMatter ?? 0) === 0) setAmount(countryId, 'exoticMatter', startingExoticMatter(countryId))
    if ((amounts.hyperium ?? 0) === 0) setAmount(countryId, 'hyperium', HYPERIUM_NEAR_SOL)
  }
  for (const r of RESOURCE_TYPES) setMonthlyDelta(countryId, r.id, RESOURCE_INCOME_PER_MONTH[r.id] ?? 0)
}

// Simple mode's civilian goods on top of the strategic reserve — same
// only-fill-an-empty-slot rule. Zeroes the monthly figures: that economy sets
// them from real production on its first month.
export function seedSimplisticStock(countryId: string): void {
  const { stateFor, setAmount, setMonthlyDelta } = useResourceStore.getState()
  const { amounts } = stateFor(countryId)
  for (const [id, start] of Object.entries(SIMPLE_STARTING_STOCK) as [ResourceId, number][]) {
    if ((amounts[id] ?? 0) === 0) setAmount(countryId, id, start)
  }
  for (const r of RESOURCE_TYPES) setMonthlyDelta(countryId, r.id, 0)
}

// Credits `months` whole months of the flat income table to one nation.
export function applyStrategicIncome(countryId: string, months: number): void {
  if (months <= 0) return
  const { addAmount } = useResourceStore.getState()
  for (const [id, perMonth] of Object.entries(RESOURCE_INCOME_PER_MONTH) as [ResourceId, number][]) {
    addAmount(countryId, id, perMonth * months)
  }
}
