// Queued strategic orders (Shift + right-click): what happens to a ship's
// `orderQueue` and to shift-orders still travelling as comms signals
// (`pendingQueueAdds`). Store I/O in the same style as commsVisual.ts; the two
// hooks that run these (useCommsResolver, useShipOrderSettler) just call them
// off the game clock, and the tests drive them headlessly.
import type { MoveDestination, ShipInstance } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { applyFleetMove } from './commsVisual'
import { planMoveUnchecked } from './shipPhysics'

// Shift-orders whose signal has arrived join their ship's queue, in the order
// they were sent.
export function resolveQueueAdds(simDays: number): void {
  const { ships, setOrderQueue, setPendingQueueAdds } = useShipStore.getState()
  for (const ship of ships) {
    const adds = ship.pendingQueueAdds
    if (!adds || adds.length === 0) continue
    const due = adds.filter((a) => simDays >= a.arrivesSimDays)
    if (due.length === 0) continue
    setPendingQueueAdds(ship.id, adds.filter((a) => simDays < a.arrivesSimDays))
    setOrderQueue(ship.id, [...(ship.orderQueue ?? []), ...due.map((a) => a.destination)])
  }
}

// A fleet that has finished (or has nothing) and has a queue moves on to the
// next queued destination, together. Fleets are checked whole: the next leg
// starts only once every member is idle, and is planned for all of them at the
// slowest pace, same as any fleet order.
export function dispatchQueuedLegs(simDays: number): void {
  const store = useShipStore.getState()
  const byFleet = new Map<string, ShipInstance[]>()
  for (const ship of store.ships) byFleet.set(ship.fleetId, [...(byFleet.get(ship.fleetId) ?? []), ship])
  for (const members of byFleet.values()) {
    if (members.some((s) => s.order || s.pendingHyperdriveJump || s.pendingMoveOrder)) continue
    const leader = members.find((s) => (s.orderQueue?.length ?? 0) > 0)
    if (!leader) continue
    const [next, ...rest] = leader.orderQueue as MoveDestination[]
    applyFleetMove(members, next, simDays, planMoveUnchecked)
    // Issuing an order clears the queue (a fresh order replaces it), so put
    // the rest back — this is the fleet carrying on with its own plan.
    for (const m of members) store.setOrderQueue(m.id, rest)
  }
}
