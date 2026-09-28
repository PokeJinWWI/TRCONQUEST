// "Warp When Ready" switched on (or "Use Warp Drive" switched back on) while a
// ship is already underway on reaction drive: re-plan the rest of the trip
// from where the ship is now, so it engages warp the moment the drive is
// ready — without this the flag only ever mattered for an order issued after
// it was set, because planMove decides the drive at order time.
//
// Kept out of shipStore (which stays free of the physics layer) and out of
// planMove (which only plans; it never writes).
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { planMove } from './shipPhysics'

// Returns true when the ship's order was replaced by one that uses warp.
// Never touches an order that is already warping (or waiting to), and leaves
// the existing order alone if warp still wouldn't engage before arrival
// (the ship simply gets there first) — so switching the flag on can only ever
// make a trip use warp, never disturb one.
export function replanForWarpWhenReady(shipId: string, simDays = useGameTimeStore.getState().simDays): boolean {
  const store = useShipStore.getState()
  const ship = store.ships.find((s) => s.id === shipId)
  if (!ship || !ship.order || !ship.warpEnabled || !ship.warpWhenReady) return false
  if (ship.order.usedWarp || simDays >= ship.order.arrivalSimDays) return false
  const result = planMove(ship, ship.order.destination, simDays)
  if (result.kind !== 'order' || !result.order.usedWarp) return false
  // keepFollowing: this is the ship carrying on with its own plan, not a fresh
  // manual order, so a standing follow directive and the queued legs stay.
  store.setShipOrder(shipId, result.order, result.warpReadyOverride, true)
  return true
}
