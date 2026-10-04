// Upgrading a ship at its shipyard, Stellaris-style: a slip order that turns the SAME ship
// into the next level of its class's line (ShipClass.upgradesTo: a Hyperspace Scout
// becomes a Turing Scout). It pays the build-cost DIFFERENCE up front, holds a slip for
// half the new level's build time (UPGRADE_DURATION_FACTOR), waits FIFO like any build
// (ordersToStart) and is refunded in full if cancelled. Classes opt in by setting
// `upgradesTo`; nothing else here is specific to scouts. The player's button and the AI
// share every rule. Pure checks here; the order itself is state/shipyardStore.queueUpgrade
// and the swap on completion is shipyardLogic.advanceShipyard.
import { UPGRADE_DURATION_FACTOR, shipBuildCost, shipBuildDays, type ResourceCost } from '../data/shipyardData'
import type { ResourceId } from '../data/resourceData'
import type { ShipClass } from '../data/shipData'
import { getCountry } from '../data/countryData'
import { useCombatStore } from '../state/combatStore'
import type { ShipInstance } from '../state/shipStore'
import { orbitedBody } from './armyLogic'
import { bestLevelClass, missingResources, techBlock, type ResearchedSet } from './shipyardLogic'

type ClassOf = (classId: string) => ShipClass | null

// The next level of a class's line, researched or not (what the button names).
export function nextLevel(classId: string, classOf: ClassOf): ShipClass | null {
  const next = classOf(classId)?.upgradesTo
  return next ? classOf(next) : null
}

// The best level the owner can upgrade this class to NOW, or null when it has none
// unlocked (or the class has no line).
export function upgradeTarget(classId: string, researched: ResearchedSet, classOf: ClassOf): ShipClass | null {
  const best = bestLevelClass(classId, researched, classOf)
  return best === classId ? null : classOf(best)
}

// What it costs: each resource the new level costs MORE of than the old one.
export function upgradeCost(from: ShipClass, to: ShipClass): ResourceCost {
  const before = shipBuildCost(from)
  const cost: ResourceCost = {}
  for (const [id, n] of Object.entries(shipBuildCost(to)) as [ResourceId, number][]) {
    const extra = n - (before[id] ?? 0)
    if (extra > 0) cost[id] = extra
  }
  return cost
}

// How long it holds a slip.
export function upgradeDays(to: ShipClass): number {
  return Math.max(1, Math.round(shipBuildDays(to) * UPGRADE_DURATION_FACTOR))
}

// Whether the ship rests in orbit of its nation's capital: where the shipyard is.
export function atShipyard(ship: Pick<ShipInstance, 'location' | 'ownerId'>): boolean {
  const capital = getCountry(ship.ownerId)?.capitalBodyName
  return !!capital && orbitedBody(ship) === capital
}

export function isEngaged(shipId: string): boolean {
  return useCombatStore.getState().engagements.some((e) => e.participants.some((p) => p.shipId === shipId))
}

export interface UpgradeContext {
  classId: string
  researched: ResearchedSet
  amounts: Record<ResourceId, number>
  classOf: ClassOf
  atYard: boolean
  engaged: boolean
  alreadyQueued: boolean
  queueFull: boolean
}

// Why the ship cannot be queued for an upgrade now (the first reason), or null.
export function upgradeBlock(c: UpgradeContext): string | null {
  const next = nextLevel(c.classId, c.classOf)
  if (!next) return 'Nothing to upgrade it to'
  if (c.alreadyQueued) return 'Already queued for an upgrade'
  const to = upgradeTarget(c.classId, c.researched, c.classOf)
  if (!to) return `Needs ${techBlock(next, c.researched) ?? next.name} researched`
  if (!c.atYard) return 'It must be in orbit of the shipyard world'
  if (c.engaged) return 'It is in a fight'
  if (c.queueFull) return 'The build queue is full'
  const from = c.classOf(c.classId)
  const short = from ? missingResources(upgradeCost(from, to), c.amounts) : []
  return short.length > 0 ? `Short of ${short.join(', ')}` : null
}
