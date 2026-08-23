import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { planMove, resolveArrivalLocation, restingDestinationOf, destinationsEqual, warpCooldownAfterArrival } from '../scene/shipPhysics'

// Settles any ship whose order has completed (simDays past arrivalSimDays)
// into its resting location, fires any queued "jump when ready" hyperdrive
// jump once its cooldown has passed *and* the game is unpaused, and keeps
// any "follow" directives
// (ShipInstance.followingShipId) re-targeted. Previously only ShipMarker's
// own useFrame did the settling, which only runs while that ship's marker
// happens to be mounted in the currently active view — since only one
// view's <Canvas> is ever mounted at a time, an order finishing while the
// player is looking at a different view (or a view that doesn't render the
// travelling ship at all, like satellite view) would never settle until
// they happened to revisit a view that does. A real, easily-hit gap once
// players can issue orders from satellite view too (see
// SatelliteViewScene's onOrderTo). Runs independent of any Canvas, same
// reasoning as useGameClock — but driven by subscribing to simDays ticking
// rather than its own requestAnimationFrame loop, since it only needs to
// react to time actually advancing, not render anything.
//
// Every setShipOrder/setShipLocation call in here passes keepFollowing=true
// — none of what happens in this hook (an order arriving, a queued jump
// firing, a follow directive re-targeting) is a *manual* player override,
// so none of it should cancel a standing follow directive the way an actual
// right-click order does.
export function useShipOrderSettler() {
  useEffect(() => {
    const settle = (simDays: number) => {
      const { ships, setShipOrder, setShipLocation, setPendingHyperdriveJump, setFollowing, removeShip } =
        useShipStore.getState()
      const { addHyperlane } = useHyperlaneStore.getState()
      // A queued jump can only actually fire once the drive's cooldown has
      // cleared *and* time isn't paused (see planMove's 'paused' result) —
      // this can't happen from a real simDays tick (ticking itself requires
      // !paused), but this hook's own mount-time settle() call below runs
      // regardless of pause state, so it's checked explicitly rather than
      // assumed.
      const paused = useGameTimeStore.getState().paused

      for (const ship of ships) {
        if (ship.order && simDays >= ship.order.arrivalSimDays) {
          const warpReadySimDays = warpCooldownAfterArrival(ship)
          setShipLocation(
            ship.id,
            resolveArrivalLocation(ship.order.destination, ship.id),
            warpReadySimDays !== undefined ? { warpReadySimDays } : undefined,
            true,
          )
        }

        // "Jump when ready" — a hyperdrive jump ordered while still on
        // cooldown, or while paused, queues here (see InterstellarScene's
        // handleOrderToStar) instead of being refused outright; fire it the
        // instant both conditions clear, regardless of which view is
        // mounted.
        if (ship.pendingHyperdriveJump && simDays >= ship.hyperdriveReadySimDays && !paused) {
          const result = planMove(ship, { kind: 'star', starId: ship.pendingHyperdriveJump }, simDays)
          if (result.kind === 'instant') {
            setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays }, true)
            if (result.hyperlaneEstablished) addHyperlane(...result.hyperlaneEstablished)
          } else if (result.kind === 'lost-in-hyperspace') {
            removeShip(ship.id)
          } else {
            // Something changed between queuing and firing (ownership,
            // class) that makes the jump no longer plannable — drop the
            // queue rather than retry every tick forever.
            setPendingHyperdriveJump(ship.id, null)
          }
        }

        // "Follow" — re-target this ship at whatever its leader is currently
        // ordered to (or, if the leader itself is at rest, wherever it's
        // currently resting), whenever that destination changes. Not a
        // continuous position-chase (see ShipInstance.followingShipId's own
        // comment for why) — just re-issuing a fresh order when the
        // *intended* destination actually changes, so a leader sitting
        // still doesn't cause a follower to endlessly re-order itself to
        // the same spot every tick.
        if (ship.followingShipId) {
          const leader = ships.find((s) => s.id === ship.followingShipId)
          if (!leader) {
            setFollowing(ship.id, null)
          } else {
            const targetDestination = leader.order ? leader.order.destination : restingDestinationOf(leader.location)
            const alreadyChasing = ship.order && destinationsEqual(ship.order.destination, targetDestination)
            const alreadyThere = !ship.order && destinationsEqual(restingDestinationOf(ship.location), targetDestination)
            if (!alreadyChasing && !alreadyThere) {
              const result = planMove(ship, targetDestination, simDays)
              if (result.kind === 'order') {
                setShipOrder(ship.id, result.order, result.warpReadyOverride, true)
              } else if (result.kind === 'instant') {
                setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays }, true)
                if (result.hyperlaneEstablished) addHyperlane(...result.hyperlaneEstablished)
              } else if ((result.kind === 'on-cooldown' || result.kind === 'paused') && targetDestination.kind === 'star') {
                setPendingHyperdriveJump(ship.id, targetDestination.starId)
              } else if (result.kind === 'lost-in-hyperspace') {
                removeShip(ship.id)
              }
              // 'not-owned'/'unknown-class': shouldn't realistically happen
              // for a player-owned follower — silently ignored, same as
              // every other caller of planMove already does.
            }
          }
        }
      }
    }

    settle(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => settle(state.simDays))
  }, [])
}
