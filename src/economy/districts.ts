// Complex mode's districts (Stellaris-style), layered on the existing district
// types (core / urban / industrial / resource — recipes.ts). A world has LAND
// (district levels, from the body's size); each district LEVEL houses
// SLOTS_PER_DISTRICT_LEVEL building levels of its type, and developing one more
// level is a state construction project. Buildings of the same district feed
// each other (a cluster bonus), and services (urban) lift industry — the
// "ecosystem". Pure; economyTick applies the bonus and lands district orders,
// economyStore/countryAI queue them.
//
// Additive to the deep sim: a world without `districts` is read as having just
// enough levels to cover its old `districtCapacity`, so nothing changes shape.

import { DISTRICT_TYPES, districtOfRecipe, type DistrictType } from './recipes'
import type { ConstructionOrder, World } from './economyTypes'

export const SLOTS_PER_DISTRICT_LEVEL = 8 // building levels one district level houses
export const DISTRICT_CONSTRUCTION_WORK = 1200 // construction points to develop one district level
// The ecosystem bonus (output multiplier on every building in the district).
export const CLUSTER_PER_LEVEL = 0.001 // per building level in the same district beyond the first…
export const CLUSTER_MAX = 0.05 // …capped
export const URBAN_TO_INDUSTRIAL = 0.005 // industrial output per urban (services) district level…
export const LINK_MAX = 0.03 // …capped

export const DISTRICT_DESCRIPTIONS: Record<DistrictType, string> = {
  core: 'Government and corporate headquarters — ministries, offices, the state apparatus.',
  urban: 'Services and city life — clinics, schools, shops. A lively urban core also lifts the industry around it.',
  industrial: 'Factories, refineries, power and shipyards. Industry clusters: every plant here makes the others more productive.',
  resource: 'Mines, wells, farms and forestry. Extraction sites here share rail, storage and processing.',
}

// District levels built — or, for a world that predates districts, enough to
// cover its old capacity.
export function districtLevels(world: Pick<World, 'districtCapacity' | 'districts'>): Record<DistrictType, number> {
  const out = {} as Record<DistrictType, number>
  for (const d of DISTRICT_TYPES) out[d] = world.districts?.[d] ?? Math.ceil((world.districtCapacity[d] ?? 0) / SLOTS_PER_DISTRICT_LEVEL)
  return out
}

export function districtLevelsTotal(world: Pick<World, 'districtCapacity' | 'districts'>): number {
  const lv = districtLevels(world)
  return DISTRICT_TYPES.reduce((n, d) => n + lv[d], 0)
}

// District levels the world's land holds.
export function landOfWorld(world: Pick<World, 'districtCapacity' | 'districts' | 'land'>): number {
  return world.land ?? districtLevelsTotal(world) + 4
}

// Free land, counting district levels already queued.
export function freeLandOfWorld(world: Pick<World, 'districtCapacity' | 'districts' | 'land' | 'constructionQueue'>): number {
  const queued = world.constructionQueue.filter((o) => o.district).length
  return landOfWorld(world) - districtLevelsTotal(world) - queued
}

// Building levels in each district (built buildings only).
export function buildingLevelsByDistrict(world: Pick<World, 'buildings'>): Record<DistrictType, number> {
  const out = { core: 0, urban: 0, industrial: 0, resource: 0 } as Record<DistrictType, number>
  for (const b of world.buildings) out[districtOfRecipe(b.recipeId)] += b.level
  return out
}

// The ecosystem bonus for one district of a world.
export function districtBonus(world: Pick<World, 'buildings' | 'districtCapacity' | 'districts'>, d: DistrictType, levels = buildingLevelsByDistrict(world)): { cluster: number; link: number; total: number } {
  const cluster = Math.min(CLUSTER_MAX, CLUSTER_PER_LEVEL * Math.max(0, levels[d] - 1))
  const link = d === 'industrial' ? Math.min(LINK_MAX, URBAN_TO_INDUSTRIAL * districtLevels(world).urban) : 0
  return { cluster, link, total: cluster + link }
}

// A state construction order developing one more level of a district.
export function districtOrder(id: string, d: DistrictType): ConstructionOrder {
  return { id, recipeId: '', district: d, cost: DISTRICT_CONSTRUCTION_WORK, progress: 0, owner: { kind: 'state' } }
}

// A world with one more level of `d`: the level, and its slots in the capacity.
export function withDistrictLevel(world: World, d: DistrictType): World {
  const lv = districtLevels(world)
  return {
    ...world,
    districts: { ...lv, [d]: lv[d] + 1 },
    districtCapacity: { ...world.districtCapacity, [d]: (world.districtCapacity[d] ?? 0) + SLOTS_PER_DISTRICT_LEVEL },
  }
}
