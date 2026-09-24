import { create } from 'zustand'
import { resolveShipClass } from './shipClassResolver'
import { useResourceStore } from './resourceStore'
import { MAX_QUEUED_BUILDS, shipBuildCost, shipBuildDays, type ResourceCost } from '../data/shipyardData'
import { missingResources, spendCost, refundCost } from '../scene/shipyardLogic'

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
  cost: ResourceCost
  durationDays: number
  queuedSimDays: number
  startedSimDays: number | null
  finishSimDays: number | null
}

export type QueueBuildResult = { ok: true; orderId: string } | { ok: false; reason: string }

// A single stable empty list for a country with nothing on order — see
// ordersFor; same "don't hand selectors a fresh object every call" reasoning
// as techStore's UNTOUCHED_COUNTRY_STATE.
const NO_ORDERS: ShipBuildOrder[] = []

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
  // Wholesale replacement of one country's queue — used by the resolver to
  // apply one step's result (starts + completions) in a single write.
  setOrders: (countryId: string, orders: ShipBuildOrder[]) => void
}

let orderCounter = 0

export const useShipyardStore = create<ShipyardState>((set, get) => ({
  ordersByCountry: {},

  ordersFor: (countryId) => get().ordersByCountry[countryId] ?? NO_ORDERS,

  queueBuild: (countryId, classId, simDays) => {
    const shipClass = resolveShipClass(classId)
    if (!shipClass) return { ok: false, reason: 'Unknown ship class.' }
    if (get().ordersFor(countryId).length >= MAX_QUEUED_BUILDS) return { ok: false, reason: 'The build queue is full.' }

    const cost = shipBuildCost(shipClass)
    const missing = missingResources(cost, useResourceStore.getState().stateFor(countryId).amounts)
    if (missing.length > 0) return { ok: false, reason: `Not enough ${missing.join(', ')}.` }

    spendCost(countryId, cost)
    orderCounter += 1
    const order: ShipBuildOrder = {
      id: `build-${Date.now()}-${orderCounter}`,
      classId,
      className: shipClass.name,
      cost,
      durationDays: shipBuildDays(shipClass),
      queuedSimDays: simDays,
      startedSimDays: null,
      finishSimDays: null,
    }
    set((s) => ({ ordersByCountry: { ...s.ordersByCountry, [countryId]: [...(s.ordersByCountry[countryId] ?? []), order] } }))
    return { ok: true, orderId: order.id }
  },

  cancelBuild: (countryId, orderId) => {
    const order = get().ordersFor(countryId).find((o) => o.id === orderId)
    if (!order) return
    refundCost(countryId, order.cost)
    set((s) => ({ ordersByCountry: { ...s.ordersByCountry, [countryId]: (s.ordersByCountry[countryId] ?? []).filter((o) => o.id !== orderId) } }))
  },

  setOrders: (countryId, orders) => set((s) => ({ ordersByCountry: { ...s.ordersByCountry, [countryId]: orders } })),
}))
