// Starbases: a nation's claim on a whole star system, standing at the
// system's own primary star rather than any one world. Pure functions over
// plain starbase lists — see state/starbaseStore.ts for the live state, and
// data/starbaseData.ts for the tuning this builds on.
//
// A Starbase is destroyed the same way a ground defense battery is fought
// down: armed hostile warships grind its integrity to 0 over time (see
// hooks/useStarbaseResolver.ts for the daily step). It has no guns of its own
// — nothing here ever damages a ship.
import { STARBASE_ARMOR, STARBASE_DAMAGE_PER_DAY } from '../data/starbaseData'
import { getSystemStars } from '../data/starData'
import type { AtWarFn } from '../state/diplomacyStore'
import { hostileWarshipsAt, type ShipLike } from './armyLogic'

export interface Starbase {
  id: string
  starId: string
  ownerId: string
  integrity: number
  readySimDays: number
}

export function isStarbaseActive(sb: Starbase, simDays: number): boolean {
  return simDays >= sb.readySimDays && sb.integrity > 0
}

// The real, orbitable body a Starbase at this system stands at — the same
// primary component a ship resolves into when it orders itself to this star
// (see shipPhysics.resolveArrivalLocation). A system with no charted data has
// nothing to stand at, so no Starbase can exist there either.
export function starbaseAnchorBody(starId: string): string | null {
  return getSystemStars(starId)[0]?.name ?? null
}

export function starbasesAt(starId: string, starbases: Starbase[]): Starbase[] {
  return starbases.filter((sb) => sb.starId === starId)
}

// Every nation with a live Starbase in this system — folded into
// scene/territory.ts's systemClaim alongside body ownership.
export function starbaseOwnersOf(starId: string, starbases: Starbase[], simDays: number): string[] {
  return [...new Set(starbasesAt(starId, starbases).filter((sb) => isStarbaseActive(sb, simDays)).map((sb) => sb.ownerId))]
}

// Live Starbases at this system belonging to a nation at war with `countryId`.
export function hostileStarbasesAt(starId: string, countryId: string, starbases: Starbase[], atWarFn: AtWarFn, simDays: number): Starbase[] {
  return starbasesAt(starId, starbases).filter((sb) => isStarbaseActive(sb, simDays) && atWarFn(countryId, sb.ownerId))
}

// One day (or a chunk of days) of hostile warships grinding every Starbase in
// range down — mirrors defenseLogic.batteryFire's shape, direction reversed:
// ships damage the Starbase, it never fires back. Returns the updated
// integrity for every Starbase that took damage this step, the ids of any
// destroyed outright, and — for each of those — whose ships did it (for
// scene/peace.recordLoss, so the war score reflects the loss).
export function stepStarbaseSieges(
  days: number,
  starbases: Starbase[],
  ships: ShipLike[],
  atWarFn: AtWarFn,
  simDays: number,
): { damaged: Record<string, number>; destroyedIds: string[]; killersOf: Record<string, string[]> } {
  const damaged: Record<string, number> = {}
  const destroyedIds: string[] = []
  const killersOf: Record<string, string[]> = {}
  for (const sb of starbases) {
    if (!isStarbaseActive(sb, simDays)) continue
    const anchor = starbaseAnchorBody(sb.starId)
    if (!anchor) continue
    const hostiles = hostileWarshipsAt(sb.ownerId, anchor, ships, atWarFn)
    if (hostiles.length === 0) continue
    const integrity = Math.max(0, sb.integrity - (STARBASE_DAMAGE_PER_DAY * days) / STARBASE_ARMOR)
    damaged[sb.id] = integrity
    if (integrity <= 0) {
      destroyedIds.push(sb.id)
      killersOf[sb.id] = [...new Set(hostiles.map((h) => h.ownerId))]
    }
  }
  return { damaged, destroyedIds, killersOf }
}
