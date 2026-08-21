import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { planMove, resolveArrivalLocation, warpCooldownAfterArrival } from '../scene/shipPhysics'

// Settles any ship whose order has completed (simDays past arrivalSimDays)
// into its resting location, and fires any queued "jump when ready"
// hyperdrive jump once its cooldown has passed. Previously only
// ShipMarker's own useFrame did the settling, which only runs while that
// ship's marker happens to be mounted in the currently active view — since
// only one view's <Canvas> is ever mounted at a time, an order finishing
// while the player is looking at a different view (or a view that doesn't
// render the travelling ship at all, like satellite view) would never
// settle until they happened to revisit a view that does. A real,
// easily-hit gap once players can issue orders from satellite view too (see
// SatelliteViewScene's onOrderTo). Runs independent of any Canvas, same
// reasoning as useGameClock — but driven by subscribing to simDays ticking
// rather than its own requestAnimationFrame loop, since it only needs to
// react to time actually advancing, not render anything.
export function useShipOrderSettler() {
  useEffect(() => {
    const settle = (simDays: number) => {
      const { ships, setShipLocation, setPendingHyperdriveJump } = useShipStore.getState()
      for (const ship of ships) {
        if (ship.order && simDays >= ship.order.arrivalSimDays) {
          const warpReadySimDays = warpCooldownAfterArrival(ship)
          setShipLocation(
            ship.id,
            resolveArrivalLocation(ship.order.destination, ship.id),
            warpReadySimDays !== undefined ? { warpReadySimDays } : undefined,
          )
        }

        // "Jump when ready" — a hyperdrive jump ordered while still on
        // cooldown queues here (see InterstellarScene's handleOrderToStar)
        // instead of being refused outright; fire it the instant the drive
        // is actually ready, regardless of which view is mounted.
        if (ship.pendingHyperdriveJump && simDays >= ship.hyperdriveReadySimDays) {
          const result = planMove(ship, { kind: 'star', starId: ship.pendingHyperdriveJump }, simDays)
          if (result.kind === 'instant') {
            setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays })
          } else {
            // Something changed between queuing and firing (ownership,
            // class) that makes the jump no longer plannable — drop the
            // queue rather than retry every tick forever.
            setPendingHyperdriveJump(ship.id, null)
          }
        }
      }
    }

    settle(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => settle(state.simDays))
  }, [])
}
