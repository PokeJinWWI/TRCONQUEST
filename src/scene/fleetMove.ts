// A fleet moves as one: every ship leaves together and arrives together, at
// the pace of the slowest. Pure planning over the existing per-ship planner
// (shipPhysics.planMove / planMoveUnchecked) — commsVisual.applyFleetMove
// applies the result to the store.
//
// How each member is handled:
//   - Ships that travel over time (reaction drive, warp) are planned
//     individually, then all given the SLOWEST one's timing — its depart and
//     arrival, and its warp-engage point for a two-phase trip — while keeping
//     their own start and end points. Positions interpolate from timing alone
//     (shipPhysics.getShipRenderPosition), so they move in lockstep.
//   - Hyperdrive hulls jump instantly. Alone (an all-hyperdrive fleet) they
//     jump now, each rolling its own risk, as a single ship always has. In a
//     fleet with slower ships they hold the jump until the rest arrives, via
//     the existing queued-jump fields (ShipInstance.pendingHyperdriveJump,
//     fired by useShipOrderSettler), so the fleet still arrives together.
//   - An all-hyperdrive fleet whose drives aren't all ready waits for the
//     slowest drive, then jumps together.
//   - A ship in a battle can't just leave; it charges out on its own (see
//     planMove's 'engaged' result), exactly as before.
import type { MoveDestination, MoveOrder, ShipInstance } from '../state/shipStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { wouldHyperjump, type MoveResult } from './shipPhysics'

export type Planner = (ship: ShipInstance, destination: MoveDestination, simDays: number) => MoveResult

export interface FleetMovePlan {
  // Timed orders, already synchronised to the slowest member.
  orders: { shipId: string; order: MoveOrder; warpReadyOverride?: number }[]
  // Every other planner result applied to one ship as-is (instant jumps,
  // losses, battle charges, refusals) — the same handling a lone ship gets.
  individual: { ship: ShipInstance; result: MoveResult }[]
  // Hyperdrive jumps held until `atSimDays`.
  deferredJumps: { shipId: string; starId: string; atSimDays: number }[]
}

function hasWarp(ship: ShipInstance): boolean {
  return resolveShipClass(ship.classId)?.ftlDrives.some((d) => d.kind === 'warp') ?? false
}

// Gives every order the slowest one's timing (see this file's header).
export function synchroniseOrders(
  planned: { ship: ShipInstance; order: MoveOrder; warpReadyOverride?: number }[],
): FleetMovePlan['orders'] {
  if (planned.length === 0) return []
  const template = planned.reduce((slow, p) => (p.order.arrivalSimDays > slow.order.arrivalSimDays ? p : slow)).order
  return planned.map(({ ship, order, warpReadyOverride }) => ({
    shipId: ship.id,
    warpReadyOverride,
    order: {
      ...order,
      departSimDays: template.departSimDays,
      arrivalSimDays: template.arrivalSimDays,
      warpEngageSimDays: template.warpEngageSimDays,
      warpEngageFraction: template.warpEngageFraction,
      gravityWellClearSimDays: template.gravityWellClearSimDays,
      // Only a hull that actually has a warp drive pays its cooldown.
      usedWarp: template.usedWarp && hasWarp(ship),
    },
  }))
}

export function planFleetMove(
  ships: ShipInstance[],
  destination: MoveDestination,
  simDays: number,
  planner: Planner,
  // The ships currently in a battle (they charge out on their own).
  isEngaged: (ship: ShipInstance) => boolean = () => false,
): FleetMovePlan {
  const plan: FleetMovePlan = { orders: [], individual: [], deferredJumps: [] }
  const engaged = ships.filter(isEngaged)
  const free = ships.filter((s) => !isEngaged(s))
  for (const ship of engaged) plan.individual.push({ ship, result: planner(ship, destination, simDays) })

  const jumpers = free.filter((s) => wouldHyperjump(s, destination))
  const travellers = free.filter((s) => !wouldHyperjump(s, destination))

  const timed: { ship: ShipInstance; order: MoveOrder; warpReadyOverride?: number }[] = []
  for (const ship of travellers) {
    const result = planner(ship, destination, simDays)
    if (result.kind === 'order') timed.push({ ship, order: result.order, warpReadyOverride: result.warpReadyOverride })
    else plan.individual.push({ ship, result })
  }
  plan.orders = synchroniseOrders(timed)

  if (jumpers.length > 0 && destination.kind === 'star') {
    if (plan.orders.length > 0) {
      // Mixed fleet: jump in as the rest arrives.
      const arrival = plan.orders[0].order.arrivalSimDays
      for (const ship of jumpers) plan.deferredJumps.push({ shipId: ship.id, starId: destination.starId, atSimDays: arrival })
    } else {
      const readyAt = Math.max(...jumpers.map((s) => s.hyperdriveReadySimDays))
      if (readyAt > simDays) {
        // Not every drive is ready: the whole fleet waits for the last one.
        for (const ship of jumpers) plan.deferredJumps.push({ shipId: ship.id, starId: destination.starId, atSimDays: readyAt })
      } else {
        for (const ship of jumpers) plan.individual.push({ ship, result: planner(ship, destination, simDays) })
      }
    }
  }
  return plan
}
