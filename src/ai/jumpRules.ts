// The AI plays by the player's jump risk (scene/shipPhysics.hyperdriveJumpChance) and
// never attempts a jump riskier than a cap. Pure: the snapshot supplies the chance.
//  - Every ship: AI_JUMP_MAX_LOSS (5%, the same line the player's warning uses).
//  - A Science Ship: AI_SCOUT_JUMP_MAX_LOSS, because its job is to chart the lanes that
//    make everyone else's jumps safe (a charted lane cuts the risk to a fifth).
// A move that is not a jump at all (a flight, or a warp ship) has no chance and is
// always allowed.
import { AI_JUMP_MAX_LOSS, AI_SCOUT_JUMP_MAX_LOSS } from '../data/aiData'
import { destinationSystemId, hyperdriveJumpChance, starJumpChance } from '../scene/shipPhysics'
import { planJumpRoute } from '../scene/jumpRoute'
import { AUTO_ROUTE_MAX_JUMPS } from '../data/shipData'
import { STARS } from '../data/starData'
import { restingStarId, systemOfShip } from '../scene/surveyLogic'
import { resolveShipClass } from '../state/shipClassResolver'
import type { MoveDestination, ShipInstance } from '../state/shipStore'
import type { AiSnapshot } from './blackboard'

export function aiJumpCap(role: string | undefined): number {
  return role === 'science' ? AI_SCOUT_JUMP_MAX_LOSS : AI_JUMP_MAX_LOSS
}

// Whether a jump with this loss chance (null = not a jump) is one the AI would take.
export function aiMayJump(chance: number | null, role: string | undefined): boolean {
  return chance === null || chance <= aiJumpCap(role)
}

// The executor's own check, against the live stores (the snapshot may be a moment old).
export function aiMayJumpNow(ship: ShipInstance, destination: MoveDestination, simDays: number): boolean {
  return aiMayJump(hyperdriveJumpChance(ship, destination, simDays), resolveShipClass(ship.classId)?.role)
}

// Whether the AI can get a ship to `destination` at all: a jump it would take, or (for a star or
// a world) a route of such jumps through lanes its nation has charted (aiNextStop).
export function aiJumpAllowed(snap: Pick<AiSnapshot, 'jumpChanceOf' | 'nextStopOf'>, ship: ShipInstance, destination: MoveDestination): boolean {
  const chance = snap.jumpChanceOf ? snap.jumpChanceOf(ship, destination) : null
  if (aiMayJump(chance, resolveShipClass(ship.classId)?.role)) return true
  return !!snap.nextStopOf?.(ship, destination)
}

// Where the AI sends a ship that is to reach `destination`: the destination itself when that
// is a jump (or flight) it would take; else the first stop of the safest route of such jumps
// through the stars of the neighbourhood (a lane its nation charted cuts a jump's risk to a
// fifth, so a far star is reached by hopping along charted lanes: scene/jumpRoute.ts, the same
// planner the player's automation uses). Null when there is no such route. Each jump of the
// route stays under the AI's own cap, so nothing it does breaks ai/jumpRules.
export function aiNextStop(ship: ShipInstance, destination: MoveDestination, simDays: number): MoveDestination | null {
  const role = resolveShipClass(ship.classId)?.role
  if (aiMayJump(hyperdriveJumpChance(ship, destination, simDays), role)) return destination
  const to = destinationSystemId(destination)
  const from = systemOfShip(ship) ?? restingStarId(ship)
  if (!to || !from || from === to) return null
  const cap = aiJumpCap(role)
  const route = planJumpRoute({
    from,
    to,
    nodes: STARS.map((s) => s.id),
    lossOf: (a, b) => starJumpChance(ship, a, b),
    maxJumps: AUTO_ROUTE_MAX_JUMPS,
    safeLoss: cap,
    maxLoss: cap,
  })
  if (!route.ok || route.hops.length < 2) return null
  return { kind: 'star', starId: route.hops[0] }
}
