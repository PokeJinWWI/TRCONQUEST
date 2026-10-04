// Starbases: a nation's claim on a whole star system, standing at the
// system's own primary star rather than any one world. Pure functions over
// plain starbase lists — see state/starbaseStore.ts for the live state, and
// data/starbaseData.ts for the tuning this builds on.
//
// A Starbase is destroyed the same way a ground defense battery is fought
// down: armed hostile warships grind its integrity to 0 over time (see
// hooks/useStarbaseResolver.ts for the daily step). It has no guns of its own
// — nothing here ever damages a ship.
import {
  STARBASE_DAMAGE_PER_DAY,
  STARBASE_TIERS,
  SHIPYARD_SLIPS_BY_TIER,
  DEFENSE_MODULE_FIREPOWER,
  DEFENSE_MODULE_INTEGRITY,
  DEFENSE_MODULE_ARMOR,
  type StarbaseTier,
  type StarbaseModuleType,
} from '../data/starbaseData'
import { getSystemStars } from '../data/starData'
import type { AtWarFn } from '../state/diplomacyStore'
import type { ShipCombatState } from '../state/shipStore'
import { applyHullDamage } from './defenseLogic'
import { hostileWarshipsAt, type ShipLike } from './armyLogic'

export interface Starbase {
  id: string
  starId: string
  ownerId: string
  integrity: number
  readySimDays: number
  // Tier (data/starbaseData.ts). Optional: absent = 'starbase' (the only tier
  // that existed before), so old literals and tests don't change.
  tier?: StarbaseTier
  // Built modules (shipyard, defense battery, trade hub, elevator tether).
  // Optional: absent = none.
  modules?: StarbaseModuleType[]
}

export function starbaseTierOf(sb: Starbase): StarbaseTier {
  return sb.tier ?? 'starbase'
}

// Extra ship-build slips a nation's active starbase shipyard modules grant
// (scaled by tier) — added to its capital's own capacity.
export function starbaseShipyardSlots(countryId: string, starbases: Starbase[], simDays: number): number {
  let slots = 0
  for (const sb of starbases) {
    if (sb.ownerId !== countryId || !isStarbaseActive(sb, simDays)) continue
    if (starbaseModulesOf(sb).includes('shipyard')) slots += SHIPYARD_SLIPS_BY_TIER[starbaseTierOf(sb)]
  }
  return slots
}

export function starbaseModulesOf(sb: Starbase): StarbaseModuleType[] {
  return sb.modules ?? []
}

// Free module slots left on a base.
export function freeModuleSlots(sb: Starbase): number {
  return STARBASE_TIERS[starbaseTierOf(sb)].moduleSlots - starbaseModulesOf(sb).length
}

// Max integrity this base can have, given its tier and defense modules.
export function starbaseMaxIntegrity(sb: Starbase): number {
  const batteries = starbaseModulesOf(sb).filter((m) => m === 'defense-battery').length
  return STARBASE_TIERS[starbaseTierOf(sb)].integrity + batteries * DEFENSE_MODULE_INTEGRITY
}

function effectiveArmor(sb: Starbase): number {
  const batteries = starbaseModulesOf(sb).filter((m) => m === 'defense-battery').length
  return STARBASE_TIERS[starbaseTierOf(sb)].armor + batteries * DEFENSE_MODULE_ARMOR
}

// Damage this base returns to besieging warships per day: its tier's firepower
// plus each defense-battery module. Zero for an undefended outpost.
export function starbaseFirepower(sb: Starbase): number {
  const batteries = starbaseModulesOf(sb).filter((m) => m === 'defense-battery').length
  return STARBASE_TIERS[starbaseTierOf(sb)].firepower + batteries * DEFENSE_MODULE_FIREPOWER
}

// Which Starbases are live right now, as a string ('1'/'0' each, in list order).
// The only thing a map needs the clock for where Starbases are concerned is
// WHEN one finishes building, so a view subscribes to this instead of the
// clock: it changes a handful of times a game, not every frame.
export function starbaseActivityKey(starbases: Starbase[], simDays: number): string {
  return starbases.map((sb) => (isStarbaseActive(sb, simDays) ? '1' : '0')).join('')
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

// A besieging warship, with the combat state a defended base can shoot at.
export type SiegeShip = ShipLike & { combat: ShipCombatState }

// One day (or a chunk of days) of hostile warships grinding every Starbase in
// range down — mirrors defenseLogic.batteryFire's shape. Unlike the old unarmed
// Starbase, a tier/module-defended base now RETURNS fire (starbaseFirepower),
// damaging the besiegers (defenseLogic.applyHullDamage). Returns the updated
// integrity for every Starbase that took damage, the ids of any destroyed, whose
// ships did it (scene/peace.recordLoss), and the besieging ships' new combat
// state / which of them were destroyed by the bases' guns.
export function stepStarbaseSieges(
  days: number,
  starbases: Starbase[],
  ships: SiegeShip[],
  atWarFn: AtWarFn,
  simDays: number,
): {
  damaged: Record<string, number>
  destroyedIds: string[]
  killersOf: Record<string, string[]>
  shipDamage: Record<string, ShipCombatState>
  shipDestroyedIds: string[]
} {
  const damaged: Record<string, number> = {}
  const destroyedIds: string[] = []
  const killersOf: Record<string, string[]> = {}
  const shipDamageAccum = new Map<string, number>()
  for (const sb of starbases) {
    if (!isStarbaseActive(sb, simDays)) continue
    const anchor = starbaseAnchorBody(sb.starId)
    if (!anchor) continue
    const hostiles = hostileWarshipsAt(sb.ownerId, anchor, ships, atWarFn) as SiegeShip[]
    if (hostiles.length === 0) continue
    const integrity = Math.max(0, sb.integrity - (STARBASE_DAMAGE_PER_DAY * days) / effectiveArmor(sb))
    damaged[sb.id] = integrity
    if (integrity <= 0) {
      destroyedIds.push(sb.id)
      killersOf[sb.id] = [...new Set(hostiles.map((h) => h.ownerId))]
    }
    // Return fire, split over the besiegers.
    const firepower = starbaseFirepower(sb)
    if (firepower > 0) {
      const each = (firepower * days) / hostiles.length
      for (const h of hostiles) shipDamageAccum.set(h.id, (shipDamageAccum.get(h.id) ?? 0) + each)
    }
  }
  const shipDamage: Record<string, ShipCombatState> = {}
  const shipDestroyedIds: string[] = []
  const byId = new Map(ships.map((s) => [s.id, s]))
  for (const [id, dmg] of shipDamageAccum) {
    const ship = byId.get(id)
    if (!ship || !ship.combat) continue // a ship with no combat state can't be shot (test literals)
    const res = applyHullDamage(ship.combat, dmg)
    shipDamage[id] = res.combat
    if (res.destroyed) shipDestroyedIds.push(id)
  }
  return { damaged, destroyedIds, killersOf, shipDamage, shipDestroyedIds }
}
