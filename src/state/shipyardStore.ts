import { create } from 'zustand'
import { resolveShipClass } from './shipClassResolver'
import { useResourceStore } from './resourceStore'
import { useTechStore } from './techStore'
import { isAbstractEconomy } from './playerStore'
import { useGameTimeStore } from './gameTimeStore'
import { useShipStore } from './shipStore'
import { atShipyard, isEngaged, upgradeBlock, upgradeCost, complexUpgradeCost, upgradeDays, upgradeTarget } from '../scene/shipUpgrade'
import { getCountry } from '../data/countryData'
import { MAX_QUEUED_BUILDS, shipBuildCost, complexShipBuildCost, shipBuildDays, type ResourceCost, type GoodCost } from '../data/shipyardData'
import { advanceShipyard, bestLevelClass, missingResources, spendCost, refundCost, techBlock, missingEconomyGoods, spendEconomyCost, refundEconomyCost, capitalStockpileOf, capitalWorldIdOf } from '../scene/shipyardLogic'

// One hull on order. Resources are paid up front when it's queued (see
// queueBuild) and refunded in full if it's cancelled before completion — a
// convenience rule, tuned later along with everything else in
// shipyardData.ts.
//
// `startedSimDays`/`finishSimDays` stay null while the order is only waiting
// for a free slot; the resolver (see hooks/useShipyardResolver) stamps both
// when a slot opens. Absolute simDays deadlines, never countdowns — same
// convention every other timer in this project follows.
export interface ShipBuildOrder {
  id: string
  classId: string
  className: string
  // The strategic-pool cost (Simple mode). In Complex mode this is empty and the
  // real cost is `goodCost`, paid from the capital's economy stockpile.
  cost: ResourceCost
  // Complex mode: the economy goods this order drew from the capital stockpile,
  // refunded there on cancel. Absent in Simple mode.
  goodCost?: GoodCost
  durationDays: number
  queuedSimDays: number
  startedSimDays: number | null
  finishSimDays: number | null
  // An UPGRADE order (state: queueUpgrade): the ship it turns into `classId` (the new level)
  // when it finishes, instead of a new hull being built. Same queue, slips and refund.
  upgradeShipId?: string
  upgradeShipName?: string
}

export type QueueBuildResult = { ok: true; orderId: string } | { ok: false; reason: string }

// A single stable empty list for a country with nothing on order — see
// ordersFor; same "don't hand selectors a fresh object every call" reasoning
// as techStore's UNTOUCHED_COUNTRY_STATE.
const NO_ORDERS: ShipBuildOrder[] = []

// Complex mode pays ship/upgrade costs in real goods from the capital's economy
// stockpile; Simple mode (and anything without an economy capital, e.g. the
// sandbox) uses the abstract strategic resourceStore pool.
function paysFromEconomy(countryId: string): boolean {
  return !isAbstractEconomy() && capitalWorldIdOf(countryId) !== null
}

// Every nation's own capital shipyard queue — the player's and every AI
// empire's, built and paid for under exactly the same rules (the AI's
// Shipwright calls this same queueBuild; see src/ai/).
interface ShipyardState {
  ordersByCountry: Record<string, ShipBuildOrder[]>
  ordersFor: (countryId: string) => ShipBuildOrder[]
  // Validates the class, the queue bound, and affordability against THIS
  // country's stockpile; on success deducts the cost and appends the order.
  // Returns why it refused rather than throwing so the UI can show the reason.
  queueBuild: (countryId: string, classId: string, simDays: number) => QueueBuildResult
  // Removes the order and refunds its full cost to its country. No-op for an
  // unknown id.
  cancelBuild: (countryId: string, orderId: string) => void
  // Queues an upgrade of one of this nation's ships to the next level of its class: pays
  // the cost difference up front and takes a slip like a build (scene/shipUpgrade.ts).
  queueUpgrade: (countryId: string, shipId: string, simDays: number) => QueueBuildResult
  // Wholesale replacement of one country's queue — used by the resolver to
  // apply one step's result (starts + completions) in a single write.
  setOrders: (countryId: string, orders: ShipBuildOrder[]) => void
}

// Lets the nation's yard step at once (a free slip starts the next order FIFO), instead
// of waiting for the next clock tick: a paused game would never start it.
function startFreeSlips(countryId: string, simDays: number): void {
  const country = getCountry(countryId)
  if (country) advanceShipyard(country, simDays)
}

function markUpgrading(shipId: string, on: boolean): void {
  useShipStore.setState((s) => ({ ships: s.ships.map((sh) => (sh.id === shipId ? { ...sh, upgrading: on || undefined } : sh)) }))
}

let orderCounter = 0

export const useShipyardStore = create<ShipyardState>((set, get) => ({
  ordersByCountry: {},

  ordersFor: (countryId) => get().ordersByCountry[countryId] ?? NO_ORDERS,

  queueBuild: (countryId, classId, simDays) => {
    // A hull in an upgrade line (the scouts) is built at the best level researched.
    const shipClass = resolveShipClass(bestLevelClass(classId, useTechStore.getState().stateFor(countryId).researched, resolveShipClass))
    if (!shipClass) return { ok: false, reason: 'Unknown ship class.' }
    // A dev tool is never built (the AI could not either, whatever it listed).
    if (shipClass.devOnly) return { ok: false, reason: `${shipClass.name} is a dev-only hull.` }
    const missingTech = techBlock(shipClass, useTechStore.getState().stateFor(countryId).researched)
    if (missingTech) return { ok: false, reason: `Needs ${missingTech} researched.` }
    if (shipClass.role === 'colony' && !isAbstractEconomy()) return { ok: false, reason: 'Colonies need Simple economy mode for now.' }
    if (get().ordersFor(countryId).length >= MAX_QUEUED_BUILDS) return { ok: false, reason: 'The build queue is full.' }

    let cost: ResourceCost = {}
    let goodCost: GoodCost | undefined
    if (paysFromEconomy(countryId)) {
      goodCost = complexShipBuildCost(shipClass)
      const missing = missingEconomyGoods(goodCost, capitalStockpileOf(countryId))
      if (missing.length > 0) return { ok: false, reason: `Not enough ${missing.join(', ')} in the capital stockpile.` }
      spendEconomyCost(countryId, goodCost)
    } else {
      cost = shipBuildCost(shipClass)
      const missing = missingResources(cost, useResourceStore.getState().stateFor(countryId).amounts)
      if (missing.length > 0) return { ok: false, reason: `Not enough ${missing.join(', ')}.` }
      spendCost(countryId, cost)
    }
    orderCounter += 1
    const order: ShipBuildOrder = {
      id: `build-${Date.now()}-${orderCounter}`,
      classId: shipClass.id,
      className: shipClass.name,
      cost,
      goodCost,
      durationDays: shipBuildDays(shipClass),
      queuedSimDays: simDays,
      startedSimDays: null,
      finishSimDays: null,
    }
    set((s) => ({ ordersByCountry: { ...s.ordersByCountry, [countryId]: [...(s.ordersByCountry[countryId] ?? []), order] } }))
    startFreeSlips(countryId, simDays)
    return { ok: true, orderId: order.id }
  },

  queueUpgrade: (countryId, shipId, simDays) => {
    const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
    if (!ship || ship.ownerId !== countryId) return { ok: false, reason: 'No such ship.' }
    const orders = get().ordersFor(countryId)
    const researched = useTechStore.getState().stateFor(countryId).researched
    const economy = paysFromEconomy(countryId)
    const block = upgradeBlock({
      classId: ship.classId,
      researched,
      amounts: useResourceStore.getState().stateFor(countryId).amounts,
      classOf: resolveShipClass,
      atYard: atShipyard(ship),
      engaged: isEngaged(ship.id),
      alreadyQueued: orders.some((o) => o.upgradeShipId === shipId),
      queueFull: orders.length >= MAX_QUEUED_BUILDS,
      skipResourceCheck: economy,
    })
    if (block) return { ok: false, reason: block }
    const from = resolveShipClass(ship.classId)!
    const to = upgradeTarget(ship.classId, researched, resolveShipClass)!
    let cost: ResourceCost = {}
    let goodCost: GoodCost | undefined
    if (economy) {
      goodCost = complexUpgradeCost(from, to)
      const missing = missingEconomyGoods(goodCost, capitalStockpileOf(countryId))
      if (missing.length > 0) return { ok: false, reason: `Not enough ${missing.join(', ')} in the capital stockpile.` }
      spendEconomyCost(countryId, goodCost)
    } else {
      cost = upgradeCost(from, to)
      spendCost(countryId, cost)
    }
    orderCounter += 1
    const order: ShipBuildOrder = {
      id: `upgrade-${Date.now()}-${orderCounter}`,
      classId: to.id,
      className: to.name,
      cost,
      goodCost,
      durationDays: upgradeDays(to),
      queuedSimDays: simDays,
      startedSimDays: null,
      finishSimDays: null,
      upgradeShipId: shipId,
      upgradeShipName: ship.name,
    }
    markUpgrading(shipId, true)
    set((s) => ({ ordersByCountry: { ...s.ordersByCountry, [countryId]: [...(s.ordersByCountry[countryId] ?? []), order] } }))
    startFreeSlips(countryId, simDays)
    return { ok: true, orderId: order.id }
  },

  cancelBuild: (countryId, orderId) => {
    const order = get().ordersFor(countryId).find((o) => o.id === orderId)
    if (!order) return
    if (order.goodCost) refundEconomyCost(countryId, order.goodCost)
    else refundCost(countryId, order.cost)
    if (order.upgradeShipId) markUpgrading(order.upgradeShipId, false)
    set((s) => ({ ordersByCountry: { ...s.ordersByCountry, [countryId]: (s.ordersByCountry[countryId] ?? []).filter((o) => o.id !== orderId) } }))
    // A cancelled build frees its slip: the next waiting order takes it now.
    startFreeSlips(countryId, useGameTimeStore.getState().simDays)
  },

  setOrders: (countryId, orders) => set((s) => ({ ordersByCountry: { ...s.ordersByCountry, [countryId]: orders } })),
}))
