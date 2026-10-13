// Rules for ORBITAL stations (a Starbase with a `zone`, scene/starbaseLogic.ts): where one may be founded and which tiers a body can hold.
// A ring circles a world over its equator, so it needs a real body with ground and enough gravity to hold one.
import { useTechStore } from '../state/techStore'
import { bodyGroundInfoAny } from './planetTerrain'
import { zoneById } from './orbits'
import { decideConstructionNow } from './sovereignty'
import { bodyStarId } from './territory'
import type { Starbase } from './starbaseLogic'

export { bodyStarId }

// Smallest body a ring can circle: its gravity must be significant (Luna and Pluto, not Phobos), judged by radius.
export const RING_MIN_RADIUS_KM = 1000

export const zoneBody = (zone: string): string => zone.slice(0, zone.lastIndexOf('~'))

// Why this station cannot be a ring, or null. A system station (no zone) has no equator to circle.
export function ringBlock(zone: string | undefined): string | null {
  if (!zone) return 'An orbital ring circles a world: only a station in orbit around one can be upgraded to it'
  const info = bodyGroundInfoAny(zoneBody(zone))
  if (!info) return 'There is no body below to circle'
  if (info.radiusKm < RING_MIN_RADIUS_KM) return 'This body is too small to hold a ring'
  return null
}

// Why `countryId` cannot found a station in `zone` now, or null.
export function stationBuildBlock(countryId: string, zone: string, starbases: readonly Starbase[]): string | null {
  if (!zoneById(zone)) return 'There is no such orbit'
  if (!useTechStore.getState().stateFor(countryId).researched.has('orbital-construction')) return 'Needs Orbital Construction researched'
  if (starbases.some((sb) => sb.zone === zone)) return 'This orbit already has a station'
  if (!bodyStarId(zoneBody(zone))) return 'That body is not charted'
  const d = decideConstructionNow(countryId, { kind: 'orbit', id: zone }, 'orbital')
  if (!d.allowed) return d.reason
  return null
}
