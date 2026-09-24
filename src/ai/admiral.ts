// The Admiral: where this empire's navy goes. In order of priority:
//   1. Defend — a body it controls is under attack and it has the power to
//      contest it.
//   2. Attack — at war, it sends the navy to win orbital superiority over the
//      best enemy-held target in its theatre it can actually beat (the
//      target the Marshal then invades). Retaking its own occupied worlds
//      counts.
//   3. Otherwise, idle warships return home to the capital.
// It commits the whole idle navy at once (a split navy loses piecemeal), and
// only issues a move to a ship not already where it's being sent.
import { AI_ATTACK_POWER_RATIO, AI_DEFEND_POWER_RATIO } from '../data/aiData'
import type { ShipInstance } from '../state/shipStore'
import { armiesOnBody, armyStrength, orbitedBody } from '../scene/armyLogic'
import { bodyStarId, controllerOf } from '../scene/territory'
import type { AiSnapshot, Blackboard } from './blackboard'
import type { AgentOutput, AiMemory, Intent } from './types'

function sendTo(ships: ShipInstance[], bodyName: string): Intent[] {
  const systemId = bodyStarId(bodyName)
  if (!systemId) return []
  return ships.filter((s) => orbitedBody(s) !== bodyName).map((s) => ({ kind: 'move-ship', shipId: s.id, systemId, bodyName }))
}

// Enemy-held bodies in this empire's theatre worth attacking, best first:
// valuable, lightly defended in orbit and on the ground.
export function invasionTargets(bb: Blackboard, snap: AiSnapshot): string[] {
  const candidates = new Set<string>()
  for (const body of Object.keys({ ...snap.owners, ...snap.controllers })) {
    const holder = controllerOf(body, snap.owners, snap.controllers)
    if (!holder || !bb.enemies.includes(holder)) continue
    if (!bb.theatreStars.has(bodyStarId(body) ?? '')) continue
    candidates.add(body)
  }
  const defence = (body: string) => {
    const holder = controllerOf(body, snap.owners, snap.controllers)!
    const ground = armiesOnBody(snap.armies, body)
      .filter((a) => a.ownerId === holder)
      .reduce((s, a) => s + armyStrength(a).strength, 0)
    return bb.hostilePowerAt(body) / 1000 + ground / 100
  }
  const own = (body: string) => (snap.owners[body] === bb.countryId ? 2 : 1) // liberation first
  return [...candidates].sort(
    (a, b) => (own(b) * snap.valueOf(b)) / (1 + defence(b)) - (own(a) * snap.valueOf(a)) / (1 + defence(a)) || a.localeCompare(b),
  )
}

// Idle warship fleets resting at the same body gather into one fleet, so the
// navy moves (and fights) as a single force. Fleets holding transports are
// left alone — the Marshal keeps those separate.
function gatherFleets(bb: Blackboard, snap: AiSnapshot): Intent[] {
  const byBody = new Map<string, Set<string>>()
  for (const s of bb.idleWarships) {
    const body = orbitedBody(s)
    if (!body) continue
    const fleetHasTransport = snap.ships.some((o) => o.fleetId === s.fleetId && bb.myTransports.includes(o))
    if (fleetHasTransport) continue
    byBody.set(body, (byBody.get(body) ?? new Set()).add(s.fleetId))
  }
  const intents: Intent[] = []
  for (const fleets of byBody.values()) {
    const [into, ...rest] = [...fleets].sort()
    for (const from of rest) intents.push({ kind: 'merge-fleets', intoFleetId: into, fromFleetId: from })
  }
  return intents
}

export function admiral(bb: Blackboard, snap: AiSnapshot, memory: AiMemory): AgentOutput {
  const out = admiralMoves(bb, snap, memory)
  return { ...out, intents: [...gatherFleets(bb, snap), ...out.intents] }
}

function admiralMoves(bb: Blackboard, snap: AiSnapshot, memory: AiMemory): AgentOutput {
  const navy = bb.idleWarships
  // Power it can bring to bear: the whole navy, idle or already underway.
  const power = bb.power

  // 1. Defend.
  const defensible = bb.threats
    .filter((t) => t.hostilePower > 0 && power >= AI_DEFEND_POWER_RATIO * t.hostilePower)
    .sort((a, b) => snap.valueOf(b.bodyName) - snap.valueOf(a.bodyName) || a.bodyName.localeCompare(b.bodyName))
  if (defensible.length > 0) return { intents: sendTo(navy, defensible[0].bodyName) }

  // 2. Attack.
  if (bb.enemies.length > 0) {
    const still = (body: string | null): body is string => {
      if (!body) return false
      const holder = controllerOf(body, snap.owners, snap.controllers)
      return !!holder && bb.enemies.includes(holder)
    }
    const beatable = (body: string) => power >= AI_ATTACK_POWER_RATIO * bb.hostilePowerAt(body)
    const target = still(memory.targetBody) && beatable(memory.targetBody)
      ? memory.targetBody
      : invasionTargets(bb, snap).find(beatable) ?? null
    if (target) return { intents: sendTo(navy, target), memory: { targetBody: target } }
    return { intents: sendTo(navy, bb.capital.capitalBodyName), memory: { targetBody: null } }
  }

  // 3. Home.
  return { intents: sendTo(navy, bb.capital.capitalBodyName), memory: { targetBody: null } }
}
