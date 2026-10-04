// The AI plays by the player's jump risk (scene/shipPhysics.hyperdriveJumpChance) and
// never attempts a jump riskier than a cap. Pure: the snapshot supplies the chance.
//  - Every ship: AI_JUMP_MAX_LOSS (5%, the same line the player's warning uses).
//  - A Science Ship: AI_SCOUT_JUMP_MAX_LOSS, because its job is to chart the lanes that
//    make everyone else's jumps safe (a charted lane cuts the risk to a fifth).
// A move that is not a jump at all (a flight, or a warp ship) has no chance and is
// always allowed.
import { AI_JUMP_MAX_LOSS, AI_SCOUT_JUMP_MAX_LOSS } from '../data/aiData'
import { hyperdriveJumpChance } from '../scene/shipPhysics'
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

export function aiJumpAllowed(snap: Pick<AiSnapshot, 'jumpChanceOf'>, ship: ShipInstance, destination: MoveDestination): boolean {
  const chance = snap.jumpChanceOf ? snap.jumpChanceOf(ship, destination) : null
  return aiMayJump(chance, resolveShipClass(ship.classId)?.role)
}
