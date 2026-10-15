// Ordering a building or a district level at a chosen site, for the build lens and anything else that points at the map: ONE
// entry that checks the placement (the law and the ground, scene/placementOrders), queues the order in whichever economy is
// running, and reports back what happened (Complex's queue action returns nothing, so success is read from its queue).
import type { SimpleBuildingId, SimpleDistrictId } from '../data/simplisticEconomyData'
import { freeLandOfWorld } from '../economy/districts'
import type { DistrictType } from '../economy/recipes'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { isAbstractEconomy } from '../state/playerStore'
import { planDistrictLevel, planPlacement, refOf } from './placementOrders'

export type OrderResult = { ok: true } | { ok: false; reason: string }

const queueLength = (bodyName: string): number => worldByName(useEconomyStore.getState().worlds, bodyName)?.constructionQueue.length ?? 0

// One more `buildingId` on `siteId`, ordered by the player's nation `builderId`.
export function orderBuildingAt(builderId: string, bodyName: string, buildingId: string, siteId?: string): OrderResult {
  const plan = planPlacement(builderId, bodyName, refOf(buildingId), siteId)
  if (!plan.ok) return plan
  if (isAbstractEconomy()) {
    const r = useAbstractEconomyStore.getState().queueBuilding(builderId, bodyName, buildingId as SimpleBuildingId, siteId)
    return r.ok ? { ok: true } : { ok: false, reason: r.reason }
  }
  const before = queueLength(bodyName)
  // The government builds with the government's money: always a state order.
  useEconomyStore.getState().queueConstruction(bodyName, buildingId, { kind: 'state' }, siteId)
  return queueLength(bodyName) > before ? { ok: true } : { ok: false, reason: 'The order was refused: no room, no money, or the building is not available.' }
}

// One more level of `district` on `siteId`.
export function orderLevelAt(builderId: string, bodyName: string, district: string, siteId: string): OrderResult {
  const plan = planDistrictLevel(builderId, bodyName, district, siteId)
  if (!plan.ok) return plan
  if (isAbstractEconomy()) {
    const r = useAbstractEconomyStore.getState().queueDistrict(builderId, bodyName, district as SimpleDistrictId, siteId)
    return r.ok ? { ok: true } : { ok: false, reason: r.reason }
  }
  const world = worldByName(useEconomyStore.getState().worlds, bodyName)
  if (world && freeLandOfWorld(world) <= 0) return { ok: false, reason: `${bodyName} has no free land: every district level it can hold is developed or on order.` }
  const before = queueLength(bodyName)
  useEconomyStore.getState().queueDistrict(bodyName, district as DistrictType, siteId)
  return queueLength(bodyName) > before ? { ok: true } : { ok: false, reason: 'The order was refused.' }
}
