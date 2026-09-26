// Ship construction logic: affordability, the build-queue step, capital
// shipyard capacity, spawning a finished hull, and the placeholder resource
// supply. Pure where it can be (missingResources, stepShipyardQueue,
// shipyardSlotsForWorld) with thin store I/O at the edges (spend/refund/
// spawn/seed/income) — same split as combatResolution vs. useCombatResolver.
// Data and every tuning constant live in data/shipyardData.ts.
import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import { SIMPLE_STARTING_STOCK } from '../data/simplisticEconomyData'
import {
  RESOURCE_INCOME_PER_MONTH,
  SLOTS_PER_SPACEYARD_LEVEL,
  SHIPYARD_FREE_SLOTS,
  SPACEYARD_RECIPE_ID,
  STARTING_STOCKPILE,
  type ResourceCost,
} from '../data/shipyardData'
import type { Country } from '../data/countryData'
import type { World } from '../economy/economyTypes'
import { resolveShipClass } from '../state/shipClassResolver'
import { useResourceStore } from '../state/resourceStore'
import { useShipStore, pristineCombatState } from '../state/shipStore'
import type { ShipBuildOrder } from '../state/shipyardStore'
import { DEFAULT_SHIP_ORBIT_PERIOD_DAYS } from './shipPhysics'

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

// How many hulls the capital can build at once: the free baseline plus
// SLOTS_PER_SPACEYARD_LEVEL per level of Spaceyard building on the world.
export function shipyardSlotsForWorld(world: World | undefined): number {
  const spaceyardLevels = (world?.buildings ?? [])
    .filter((b) => b.recipeId === SPACEYARD_RECIPE_ID)
    .reduce((sum, b) => sum + b.level, 0)
  return SHIPYARD_FREE_SLOTS + spaceyardLevels * SLOTS_PER_SPACEYARD_LEVEL
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
    const building = queue.filter((o) => o.startedSimDays !== null).length
    if (building < capacity) {
      const next = queue.find((o) => o.startedSimDays === null)
      if (next) {
        const start = dueIndex !== -1 ? freedAt : simDays
        next.startedSimDays = start
        next.finishSimDays = start + next.durationDays
        continue
      }
    }
    if (dueIndex === -1) break
  }
  return { orders: queue, completed }
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
    warpWhenReady: false,
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
  return spawnOwnedShip(order.classId, country.id, country.capitalStarId, country.capitalBodyName)
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
