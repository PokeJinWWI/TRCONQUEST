// The strategic AI, Stellaris-style: instead of one monolithic brain, each
// AI empire is run by five specialist agents that read a shared blackboard
// and post intents.
//
//   Diplomat    opinion of neighbours; seeking peace (diplomat.ts)
//   Strategist  posture; declaring war (strategist.ts)
//   Shipwright  ships, transports and armies to build (shipwright.ts)
//   Admiral     where the navy goes: defend, attack, return home (admiral.ts)
//   Marshal     loading transports and invading (marshal.ts)
//
// They run in that order each planning pass, so later agents see the earlier
// ones' decisions through the empire's memory. The Strategist's posture
// steers the Shipwright's build targets, and the Admiral's target is the
// Marshal's invasion target. Every agent is a pure function of (blackboard,
// snapshot, memory), and only the executor (executor.ts) touches the stores.
// That keeps the AI testable headless, and bound by exactly the rules the
// player plays by.
import { buildBlackboard, type AiSnapshot } from './blackboard'
import { diplomat } from './diplomat'
import { strategist } from './strategist'
import { shipwright } from './shipwright'
import { admiral } from './admiral'
import { marshal } from './marshal'
import type { AgentOutput, AiMemory, Intent } from './types'

export interface PlanResult {
  intents: Intent[]
  memory: AiMemory
}

export function planEmpire(countryId: string, snap: AiSnapshot, initialMemory: AiMemory): PlanResult {
  const bb = buildBlackboard(countryId, snap)
  let memory = initialMemory
  const intents: Intent[] = []
  const absorb = (out: AgentOutput) => {
    intents.push(...out.intents)
    if (out.memory) memory = { ...memory, ...out.memory }
  }

  absorb(diplomat(bb, snap, memory))
  absorb(strategist(bb, snap))
  absorb(shipwright(bb, snap, memory))
  absorb(admiral(bb, snap, memory))
  absorb(marshal(bb, snap, memory))

  // One order per ship per pass: the Marshal's orders for its transports
  // stand over anything else touching the same hull.
  const lastMove = new Map<string, number>()
  intents.forEach((i, idx) => {
    if (i.kind === 'move-ship') lastMove.set(i.shipId, idx)
  })
  return { intents: intents.filter((i, idx) => i.kind !== 'move-ship' || lastMove.get(i.shipId) === idx), memory }
}
