// How much land a body has for districts (both economy modes): district levels
// = its size's district count (bodyStats.estimateSize) × LAND_PER_SIZE_DISTRICT.
import { bodyGroundInfo } from './planetTerrain'
import { estimateSize } from './bodyStats'

export const LAND_PER_SIZE_DISTRICT = 3

export function landForBody(bodyName: string): number {
  const info = bodyGroundInfo(bodyName)
  return (info ? estimateSize(info.radiusKm).districts : 3) * LAND_PER_SIZE_DISTRICT
}
