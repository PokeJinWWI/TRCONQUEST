import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { applyFleetMove } from '../scene/commsVisual'
import { resolveQueueAdds } from '../scene/orderQueue'

// Fires every strategic order queued behind FTL comms delay (see
// commsVisual.ts's queueMoveOrder/queueStance, and ShipInstance.
// pendingMoveOrder/pendingStance) once simDays reaches its own
// arrivesSimDays deadline — same "subscribe to the clock, not a rAF loop"
// shape useShipOrderSettler already uses, for the same reason: this has to
// keep resolving regardless of which view (if any) is currently mounted. A
// queued hyperdrive jump's own comms gate lives directly in
// useShipOrderSettler instead (see ShipInstance.
// pendingHyperdriveJumpArrivesSimDays) — it already owns
// pendingHyperdriveJump's firing condition, so the comms deadline is just
// one more clause on that existing check rather than a second place racing
// to fire the same field.
export function useCommsResolver() {
  useEffect(() => {
    const resolve = (simDays: number) => {
      const { ships, setPendingMoveOrder, setStance } = useShipStore.getState()

      // Due move orders fire per fleet, so a fleet that got its order
      // together (queueFleetMoveOrder) still moves together.
      const dueByFleet = new Map<string, ShipInstance[]>()
      for (const ship of ships) {
        if (ship.pendingMoveOrder && simDays >= ship.pendingMoveOrder.arrivesSimDays) {
          const key = `${ship.fleetId}|${JSON.stringify(ship.pendingMoveOrder.destination)}`
          dueByFleet.set(key, [...(dueByFleet.get(key) ?? []), ship])
        }
      }
      for (const group of dueByFleet.values()) {
        const destination = group[0].pendingMoveOrder!.destination
        for (const ship of group) setPendingMoveOrder(ship.id, null)
        applyFleetMove(group, destination, simDays)
      }

      for (const ship of ships) {
        if (ship.pendingBombard && simDays >= ship.pendingBombard.arrivesSimDays) useShipStore.getState().setBombardStance(ship.id, ship.pendingBombard.stance)
        if (ship.pendingStance && simDays >= ship.pendingStance.arrivesSimDays) {
          setStance(ship.id, ship.pendingStance.stance)
        }
      }

      // Shift-orders whose signal has arrived join their ship's queue.
      resolveQueueAdds(simDays)
    }

    resolve(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolve(state.simDays))
  }, [])
}
