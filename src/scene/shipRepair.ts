// Repairing a damaged ship at a shipyard: a slip order like an upgrade (same queue,
// FIFO, refunded in full if cancelled) that restores the SAME ship to a pristine
// hull when it finishes. Cost and time scale with the damage. Pure checks here; the
// order is state/shipyardStore.queueRepair, the completion is shipyardLogic.advanceShipyard,
// and scene/yardOrders.ts sends a ship to the nearest yard first.
import { REPAIR_COST_FACTOR, REPAIR_DAYS_FACTOR, shipBuildCost, shipBuildDays, type ResourceCost } from '../data/shipyardData'
import type { ResourceId } from '../data/resourceData'
import type { ShipClass } from '../data/shipData'
import type { ShipInstance } from '../state/shipStore'
import { overallHealthFraction, shipCombatProfile } from './combatResolution'
import { missingResources } from './shipyardLogic'

// 0 = pristine, 1 = wrecked.
export function damageFraction(ship: Pick<ShipInstance, 'combat' | 'classId'>): number {
  const profile = shipCombatProfile(ship)
  if (!profile) return 0
  return Math.min(1, Math.max(0, 1 - overallHealthFraction(ship.combat, profile)))
}

export const REPAIR_MIN_DAMAGE = 0.005

// Alloys and energy only, in proportion to the damage; never free for a damaged hull.
export function repairCost(shipClass: ShipClass, damage: number): ResourceCost {
  const full = shipBuildCost(shipClass)
  const cost: ResourceCost = {}
  for (const id of ['alloys', 'energy'] as ResourceId[]) {
    const n = Math.max(1, Math.round((full[id] ?? 0) * REPAIR_COST_FACTOR * damage))
    if ((full[id] ?? 0) > 0) cost[id] = n
  }
  return cost
}

export function repairDays(shipClass: ShipClass, damage: number): number {
  return Math.max(1, Math.round(shipBuildDays(shipClass) * REPAIR_DAYS_FACTOR * damage))
}

export interface RepairContext {
  damage: number
  amounts: Record<ResourceId, number>
  shipClass: ShipClass | null
  engaged: boolean
  alreadyQueued: boolean
  queueFull: boolean
  atYard: boolean
}

// Why the ship cannot be queued for repair now (the first reason), or null.
export function repairBlock(c: RepairContext): string | null {
  if (!c.shipClass) return 'Unknown ship class'
  if (c.damage < REPAIR_MIN_DAMAGE) return 'Nothing to repair'
  if (c.alreadyQueued) return 'Already queued at the shipyard'
  if (!c.atYard) return 'It must be at a shipyard'
  if (c.engaged) return 'It is in a fight'
  if (c.queueFull) return 'The build queue is full'
  const short = missingResources(repairCost(c.shipClass, c.damage), c.amounts)
  return short.length > 0 ? `Short of ${short.join(', ')}` : null
}
