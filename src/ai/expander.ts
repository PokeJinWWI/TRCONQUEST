// The Expander: how this empire grows beyond its home. In order:
//   - Research the road to Orbital Construction (Simple mode's research income).
//   - Keep a Science Ship, and (once it can) a Construction Ship and a Cargo
//     Ship, queued at its shipyard.
//   - The Science Ship works out from the capital: explore and survey the star
//     it is at, then fly to the nearest star it hasn't fully surveyed.
//   - Claim the nearest fully surveyed, unclaimed star with a Starbase: the
//     Construction Ship loads a kit at the capital (or a Cargo Ship brings it),
//     flies to the star and builds. The Construction Ship isn't consumed, so it
//     goes back for more, up to AI_MAX_STARBASES.
// It plays by the player's rules: the same commands (survey, load, transfer,
// build), the same holds, the same shipyard, reading what its own ships have
// actually found. It has no comms delay, like every AI empire. Pure: it only
// returns intents.
import {
  AI_CARGO_SHIPS,
  AI_CONSTRUCTION_SHIPS,
  AI_MAX_QUEUED_BUILDS,
  AI_MAX_STARBASES,
  AI_RESEARCH_PATH,
  AI_SCIENCE_SHIPS,
} from '../data/aiData'
import { STARBASE_COST } from '../data/starbaseData'
import { STARS, type StarData } from '../data/starData'
import { canResearch, findTech } from '../data/techData'
import { resolveShipClass } from '../state/shipClassResolver'
import type { ShipInstance } from '../state/shipStore'
import { orbitedBody } from '../scene/armyLogic'
import { cargoCovers, transferCheck } from '../scene/cargoLogic'
import { missingResources } from '../scene/shipyardLogic'
import { starbaseOwnersOf } from '../scene/starbaseLogic'
import { isExplored, isFullySurveyed, restingStarId, unsurveyedBodies } from '../scene/surveyLogic'
import { systemClaim } from '../scene/territory'
import type { ResourceCost } from '../data/shipyardData'
import { hasOrderInFlight, type AiSnapshot, type Blackboard } from './blackboard'
import { affordable } from './shipwright'
import type { AgentOutput, AiMemory, Intent } from './types'

const roleOf = (s: { classId: string }) => resolveShipClass(s.classId)?.role

// Free to be tasked: not under way, not waiting on an order, not in a fight.
function resting(s: ShipInstance, snap: AiSnapshot): boolean {
  return !s.order && !s.pendingHyperdriveJump && !hasOrderInFlight(s) && !snap.engagedShipIds.has(s.id)
}

function distanceLy(a: StarData, b: StarData): number {
  return Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2])
}

// The next tech on the road to Orbital Construction that it can afford now.
export function pickResearch(bb: Blackboard): string | null {
  for (const id of AI_RESEARCH_PATH) {
    if (bb.hasResearched(id)) continue
    const node = findTech(id)
    if (!node) return null
    // Always the first one it hasn't got: wait for the points rather than
    // skipping ahead (a later node needs the earlier one anyway). The path
    // contains every prerequisite of its nodes, so the researched part of it is
    // all canResearch needs to see.
    const have = new Set<string>(AI_RESEARCH_PATH.filter((p) => bb.hasResearched(p)))
    return canResearch(node, have, bb.researchPoints[node.category]) ? id : null
  }
  return null
}

// Stars this empire could still learn something at, nearest to its capital first.
function surveyTargets(bb: Blackboard, snap: AiSnapshot, here: string | null): StarData[] {
  const home = STARS.find((s) => s.id === bb.capital.capitalStarId)
  if (!home) return []
  return STARS.filter((s) => s.id !== here && s.hasSystemData && !isFullySurveyed(bb.intel, bb.countryId, s.id, snap.owners))
    .sort((a, b) => distanceLy(home, a) - distanceLy(home, b) || a.id.localeCompare(b.id))
}

// Where it would put its next Starbase: fully surveyed by it, and nobody's yet.
function starbaseTargetOk(bb: Blackboard, snap: AiSnapshot, starId: string): boolean {
  if (starId === bb.capital.capitalStarId) return false
  if (!isFullySurveyed(bb.intel, bb.countryId, starId, snap.owners)) return false
  // Any Starbase there, finished or still being built, is somebody's claim in
  // the making — don't pile a second nation's onto it.
  if (snap.starbases.some((sb) => sb.starId === starId)) return false
  return systemClaim(starId, snap.owners, starbaseOwnersOf(starId, snap.starbases, snap.simDays)).kind === 'unclaimed'
}

function pickStarbaseTarget(bb: Blackboard, snap: AiSnapshot, current: string | null | undefined): string | null {
  if (current && starbaseTargetOk(bb, snap, current)) return current
  const home = STARS.find((s) => s.id === bb.capital.capitalStarId)
  if (!home) return null
  const candidates = STARS.filter((s) => starbaseTargetOk(bb, snap, s.id)).sort((a, b) => distanceLy(home, a) - distanceLy(home, b) || a.id.localeCompare(b.id))
  return candidates[0]?.id ?? null
}

export function expander(bb: Blackboard, snap: AiSnapshot, memory: AiMemory): AgentOutput {
  const intents: Intent[] = []
  const mineOf = (role: string) => bb.mine.filter((s) => roleOf(s) === role)
  const queued = (role: string) => bb.queuedClassIds.filter((id) => resolveShipClass(id)?.role === role).length
  const canBuildStarbases = bb.hasResearched('orbital-construction')

  // --- Research ----------------------------------------------------------
  const tech = pickResearch(bb)
  if (tech) intents.push({ kind: 'research-tech', techId: tech })

  // --- Ships ---------------------------------------------------------------
  // One build a pass, science first, and only into an otherwise idle queue.
  if (bb.buildQueueLength < AI_MAX_QUEUED_BUILDS) {
    const wants: [string, string, number][] = [['science', 'science-ship', AI_SCIENCE_SHIPS]]
    if (canBuildStarbases) wants.push(['construction', 'construction-ship', AI_CONSTRUCTION_SHIPS], ['cargo', 'cargo-ship', AI_CARGO_SHIPS])
    for (const [role, classId, target] of wants) {
      if (mineOf(role).length + queued(role) >= target) continue
      if (affordable(classId, bb.resources)) {
        intents.push({ kind: 'build-ship', classId })
        break
      }
    }
  }

  // --- Keep the civilians out of the war fleet ---------------------------------
  // A fleet moves as one, so a science/construction/cargo ship sharing a fleet
  // with the navy would be dragged along on every attack. Give each its own.
  for (const s of bb.mine) {
    const role = roleOf(s)
    if (role !== 'science' && role !== 'construction' && role !== 'cargo') continue
    if (resting(s, snap) && snap.ships.some((o) => o.fleetId === s.fleetId && o.id !== s.id)) intents.push({ kind: 'split-fleet', shipIds: [s.id] })
  }

  // --- The Science Ship: explore and survey where it is, then the nearest unknown star ---
  // Exploring and surveying are separate orders and neither needs the other.
  const science = mineOf('science').find((s) => resting(s, snap))
  if (science && !science.surveyJob) {
    const here = restingStarId(science)
    const remaining = here ? unsurveyedBodies(bb.intel, bb.countryId, here, snap.owners) : []
    if (here && !isExplored(bb.intel, bb.countryId, here, snap.owners)) intents.push({ kind: 'explore-system', shipId: science.id })
    if (here && remaining.length > 0) {
      intents.push({ kind: 'survey-system', shipId: science.id })
    } else {
      const next = surveyTargets(bb, snap, here)[0]
      if (next) intents.push({ kind: 'move-ship', shipId: science.id, systemId: next.id, bodyName: null })
    }
  }

  // --- Claiming a star ---------------------------------------------------
  let target: string | null = null
  if (canBuildStarbases && bb.myStarbaseCount < AI_MAX_STARBASES) target = pickStarbaseTarget(bb, snap, memory.expansionTarget)
  const memoryUpdate = (memory.expansionTarget ?? null) !== target ? { expansionTarget: target } : undefined

  if (target) {
    const kit: ResourceCost = STARBASE_COST
    const capitalBody = bb.capital.capitalBodyName
    const atCapital = (s: ShipInstance) => orbitedBody(s) === capitalBody
    const stockCovers = (cost: ResourceCost) => missingResources(cost, bb.resources).length === 0
    const missingKit = (s: ShipInstance): ResourceCost => {
      const need: ResourceCost = {}
      for (const [id, n] of Object.entries(kit) as [keyof ResourceCost, number][]) need[id] = Math.max(0, n - (s.cargo?.[id] ?? 0))
      return need
    }
    const builder = mineOf('construction').find((s) => resting(s, snap))
    const hauler = mineOf('cargo').find((s) => resting(s, snap))
    const goTo = (ship: ShipInstance, starId: string) => intents.push({ kind: 'move-ship', shipId: ship.id, systemId: starId, bodyName: null })
    const goHome = (ship: ShipInstance) => intents.push({ kind: 'move-ship', shipId: ship.id, systemId: bb.capital.capitalStarId, bodyName: capitalBody })

    if (builder) {
      const at = restingStarId(builder)
      if (cargoCovers(builder.cargo, kit)) {
        if (at === target) intents.push({ kind: 'build-starbase', shipId: builder.id, starId: target })
        else goTo(builder, target)
      } else if (atCapital(builder)) {
        const need = missingKit(builder)
        if (stockCovers(need)) intents.push({ kind: 'load-cargo', shipId: builder.id, want: need })
      } else if (hauler && (at !== null || orbitedBody(builder) !== null)) {
        // Empty and away from home: the Cargo Ship brings the kit.
        if (cargoCovers(hauler.cargo, kit)) {
          if (transferCheck(hauler, builder).ok) intents.push({ kind: 'transfer-cargo', fromShipId: hauler.id, toShipId: builder.id, want: kit })
          else if (at) goTo(hauler, at)
        } else if (atCapital(hauler)) {
          const need = missingKit(hauler)
          if (stockCovers(need)) intents.push({ kind: 'load-cargo', shipId: hauler.id, want: need })
        } else goHome(hauler)
      } else {
        goHome(builder)
      }
    }
  }

  return { intents, memory: memoryUpdate }
}
