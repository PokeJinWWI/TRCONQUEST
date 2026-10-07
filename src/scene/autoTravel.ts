// How an automated ship travels (scene/automation.ts, and an auto-survey's own
// flights in hooks/useSurveyResolver.ts): by the route of hyperdrive jumps that
// loses the fewest ships (scene/jumpRoute.ts), one jump at a time.
//  - "Make unsafe jumps" off (the default): it never takes a jump over the
//    warning line (jumpWarning.JUMP_WARN_LOSS) and says why it is stuck.
//  - On: a jump may risk up to the ship's own max-risk setting, with no
//    question asked; a route of safe jumps is still taken when there is one.
// Stateless: every jump is planned afresh from where the ship now is, so a lane
// charted on the way is used at once. Routes run between the stars of the ship's
// own cluster (scene/clusters.ts): a route never crosses between clusters.
import { AUTO_MAX_RISK_DEFAULT, AUTO_ROUTE_MAX_JUMPS } from '../data/shipData'
import { findStar } from '../data/starData'
import { starsOfShipCluster } from './clusters'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { useShipStore, type MoveDestination, type ShipInstance } from '../state/shipStore'
import { loseShipToJump } from './jumpLoss'
import { planJumpRoute } from './jumpRoute'
import { JUMP_WARN_LOSS, formatLossPercent } from './jumpWarning'
import { destinationSystemId, hyperdriveJumpChance, isGalacticDestination, planMoveUnchecked, starJumpChance } from './shipPhysics'
import { restingStarId, systemOfShip } from './surveyLogic'

type RiskSettings = Pick<ShipInstance, 'automationUnsafe' | 'automationMaxRisk'>

// The riskiest single jump this ship's automation may take.
export function autoJumpLimit(ship: RiskSettings): number {
  return ship.automationUnsafe ? Math.max(JUMP_WARN_LOSS, ship.automationMaxRisk ?? AUTO_MAX_RISK_DEFAULT) : JUMP_WARN_LOSS
}

// Why an automated ship will not go somewhere, in plain words.
export function routeRefusal(placeName: string, directLoss: number | null, ship: RiskSettings): string {
  const limit = formatLossPercent(autoJumpLimit(ship))
  const risk = directLoss === null ? 'There is no jump there' : `The direct jump risks ${formatLossPercent(directLoss)}`
  const fix = ship.automationUnsafe ? 'Raise the max risk to allow it.' : 'Tick "Make unsafe jumps" to allow it.'
  return `No route to ${placeName} within the ${limit} limit per jump: ${risk.charAt(0).toLowerCase()}${risk.slice(1)}, and no route of up to ${AUTO_ROUTE_MAX_JUMPS} jumps keeps under it. ${fix}`
}

export type AutoStep = { next: MoveDestination; last: boolean } | { refused: string }

function placeName(destination: MoveDestination): string {
  if (destination.kind === 'body') return destination.bodyName
  const systemId = destinationSystemId(destination)
  return (systemId ? findStar(systemId)?.name : undefined) ?? 'there'
}

// The next leg of the ship's trip to `destination`: the destination itself when it
// is a flight, a warp, or the last jump; else the star to stop over at.
export function nextAutoStep(ship: ShipInstance, destination: MoveDestination, simDays: number): AutoStep {
  const direct = hyperdriveJumpChance(ship, destination, simDays)
  if (direct === null) return { next: destination, last: true }
  const limit = autoJumpLimit(ship)
  const from = systemOfShip(ship) ?? restingStarId(ship)
  const to = isGalacticDestination(destination) ? null : destinationSystemId(destination)
  // From or to a bare point of space there is no star to route between: the one jump, or nothing.
  if (from === null || to === null) return direct <= limit ? { next: destination, last: true } : { refused: routeRefusal(placeName(destination), direct, ship) }
  const route = planJumpRoute({
    from,
    to,
    nodes: starsOfShipCluster(ship).map((s) => s.id),
    lossOf: (a, b) => starJumpChance(ship, a, b),
    maxJumps: AUTO_ROUTE_MAX_JUMPS,
    safeLoss: JUMP_WARN_LOSS,
    maxLoss: limit,
  })
  if (!route.ok) return { refused: routeRefusal(placeName(destination), route.directLoss, ship) }
  return route.hops.length <= 1 ? { next: destination, last: true } : { next: { kind: 'star', starId: route.hops[0] }, last: false }
}

// Whether the ship's automation may travel there at all.
export function autoReachable(ship: ShipInstance, destination: MoveDestination, simDays: number): boolean {
  return !('refused' in nextAutoStep(ship, destination, simDays))
}

// moved: it is on its way (or there). waiting: the drive is cooling down or the
// game is paused, try again later. refused: no route it may take (the reason is on
// the ship, automationNote). lost: the jump lost it. failed: anything else.
export type AutoMoveOutcome = 'moved' | 'waiting' | 'refused' | 'lost' | 'failed'

// One leg of the trip, now. The ship's own move, not an order from the capital:
// no comms delay, and it keeps what it is doing (keepFollowing). With `track`
// it remembers a trip of several jumps (ShipInstance.autoRoute), which
// resolveAutomation carries on; a caller that re-plans by itself passes false.
export function autoMove(ship: ShipInstance, destination: MoveDestination, simDays: number, track = true): AutoMoveOutcome {
  const store = useShipStore.getState()
  // A jump with the drive still cooling down: nothing to plan yet.
  if (simDays < ship.hyperdriveReadySimDays && hyperdriveJumpChance(ship, destination, simDays) !== null) return 'waiting'
  const step = nextAutoStep(ship, destination, simDays)
  if ('refused' in step) {
    store.setAutomationNote(ship.id, step.refused)
    return 'refused'
  }
  const result = planMoveUnchecked(ship, step.next, simDays)
  if (result.kind === 'order' || result.kind === 'instant') {
    if (result.kind === 'order') store.setShipOrder(ship.id, result.order, result.warpReadyOverride, true)
    else {
      store.setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays }, true)
      if (result.hyperlaneEstablished) useHyperlaneStore.getState().addHyperlane(ship.ownerId, ...result.hyperlaneEstablished)
    }
    store.setAutomationNote(ship.id, null)
    if (track) store.setAutoRoute(ship.id, step.last ? null : destination)
    return 'moved'
  }
  if (result.kind === 'lost-in-hyperspace') {
    loseShipToJump(ship, step.next)
    return 'lost'
  }
  return result.kind === 'on-cooldown' || result.kind === 'paused' || result.kind === 'engaged' ? 'waiting' : 'failed'
}
