// The Shipwright: turns this empire's resources into the forces its posture
// calls for — warships in a mixed rotation, enough troop transports to carry
// its armies, and the assault armies themselves (at war, as many as the
// current invasion target needs). It queues through the same
// shipyard and recruitment rules as the player, so it can only build what it
// can pay for.
import {
  AI_ARMY_TARGET,
  AI_MAX_QUEUED_BUILDS,
  AI_WARSHIP_ROTATION,
  AI_WARSHIP_TARGET,
} from '../data/aiData'
import { ARMY_KINDS } from '../data/armyData'
import { shipBuildCost } from '../data/shipyardData'
import { resolveShipClass } from '../state/shipClassResolver'
import { missingResources, techBlock } from '../scene/shipyardLogic'
import { atShipyard, upgradeBlock, upgradeCost, upgradeTarget } from '../scene/shipUpgrade'
import type { ResourceId } from '../data/resourceData'
import type { AiSnapshot, Blackboard } from './blackboard'
import { armiesNeededToTake } from './marshal'
import type { AgentOutput, AiMemory, Intent } from './types'

const TRANSPORT_CLASS_ID = 'troop-transport'

// Whether it can build `classId` now: unlocked by its research (the same gate as
// the player's shipyard: queueBuild would refuse a locked hull) and paid for.
export function affordable(classId: string, amounts: Record<ResourceId, number>, researched: { has: (techId: string) => boolean }): boolean {
  const shipClass = resolveShipClass(classId)
  return !!shipClass && !shipClass.devOnly && techBlock(shipClass, researched) === null && missingResources(shipBuildCost(shipClass), amounts).length === 0
}

// An own ship it would upgrade now, by the same rules as the player's button
// (scene/shipUpgrade.upgradeBlock): it has the tech for the next level, the ship rests at
// its shipyard, and a slip is FREE (nothing at all in its yard queue). Null if none.
export function pickUpgrade(bb: Blackboard, snap: AiSnapshot, amounts: Record<ResourceId, number>): { shipId: string; cost: Partial<Record<ResourceId, number>> } | null {
  if (bb.buildQueueLength > 0) return null
  const researched = { has: bb.hasResearched }
  for (const ship of bb.mine) {
    if (ship.order || ship.upgrading || snap.engagedShipIds.has(ship.id)) continue
    const to = upgradeTarget(ship.classId, researched, resolveShipClass)
    const from = resolveShipClass(ship.classId)
    if (!to || !from) continue
    const block = upgradeBlock({ classId: ship.classId, researched, amounts, classOf: resolveShipClass, atYard: atShipyard(ship), engaged: false, alreadyQueued: false, queueFull: false })
    if (!block) return { shipId: ship.id, cost: upgradeCost(from, to) }
  }
  return null
}

export function shipwright(bb: Blackboard, snap: AiSnapshot, memory: AiMemory): AgentOutput {
  const intents: Intent[] = []
  const posture = memory.posture
  // At war with a target picked, it raises however many armies taking that
  // target actually needs (plus one in reserve), not just the posture default.
  const needed = memory.targetBody ? armiesNeededToTake(bb.countryId, memory.targetBody, snap, bb.atWar) : null
  const armyTarget = Math.max(AI_ARMY_TARGET[posture], needed !== null ? needed + 1 : 0)
  const transportTarget = Math.ceil(armyTarget / 2)
  // A running tally, so one pass doesn't plan to spend the same stockpile twice.
  const amounts = { ...bb.resources }
  const researched = { has: bb.hasResearched }
  const spend = (cost: Partial<Record<ResourceId, number>>) => {
    for (const [id, n] of Object.entries(cost) as [ResourceId, number][]) amounts[id] = (amounts[id] ?? 0) - n
  }

  // An upgrade takes the free slip before any new hull does (the same single queue place).
  const up = pickUpgrade(bb, snap, amounts)
  if (up) {
    intents.push({ kind: 'upgrade-ship', shipId: up.shipId })
    spend(up.cost)
  }

  if (!up && bb.buildQueueLength < AI_MAX_QUEUED_BUILDS) {
    let classId: string | null = null
    if (bb.myTransports.length < transportTarget && affordable(TRANSPORT_CLASS_ID, amounts, researched)) classId = TRANSPORT_CLASS_ID
    else if (bb.myWarships.length < AI_WARSHIP_TARGET[posture]) {
      // Next in the rotation after however many warships it has, falling back
      // through the rest if that one isn't affordable.
      const start = bb.myWarships.length % AI_WARSHIP_ROTATION.length
      for (let i = 0; i < AI_WARSHIP_ROTATION.length && !classId; i++) {
        const candidate = AI_WARSHIP_ROTATION[(start + i) % AI_WARSHIP_ROTATION.length]
        if (affordable(candidate, amounts, researched)) classId = candidate
      }
    }
    if (classId) {
      intents.push({ kind: 'build-ship', classId })
      spend(shipBuildCost(resolveShipClass(classId)!))
    }
  }

  const recruitCost = ARMY_KINDS.assault.recruitCost!
  if (bb.assaultArmyCount < armyTarget && missingResources(recruitCost, amounts).length === 0) {
    intents.push({ kind: 'recruit-army', bodyName: bb.capital.capitalBodyName })
  }

  return { intents }
}
