// Planetary defense installations — the pure rules (both economy modes). An
// installation sits on a node of a world's ground map and belongs to whoever
// HOLDS that node (so an army that takes the ground captures it — its effect
// then works for the captor). Tuning: data/defenseData.ts. State:
// state/defenseStore.ts. The ground war (groundResolution) damages and destroys
// them; hooks/useDefenseResolver.ts runs batteries against ships in orbit.
import {
  BATTERY_DAMAGE_PER_DAY,
  DEFENSE_DEFS,
  FORTRESS_DEFENSE,
  FORTRESS_RADIUS_CELLS,
  INSTALLATION_SPACING_CELLS,
  SHIELD_RADIUS_CELLS,
  type DefenseKind,
} from '../data/defenseData'
import { TERRAIN } from '../data/groundData'
import type { AtWarFn } from '../state/diplomacyStore'
import type { ShipCombatState } from '../state/shipStore'
import { cellsToRad, holderOf, type NodeHolderMap } from './groundLogic'
import { terrainAt, type BodySurface, type KeySlot } from './planetTerrain'
import { arc, nodePoint, surfaceMesh, type SurfacePoint } from './surfaceMesh'
import type { OwnerMap } from './territory'

export interface Installation {
  id: string
  bodyName: string
  kind: DefenseKind
  node: number // fine node on the body's ground map
  integrity: number
  builtBy: string // the nation that built it (holding decides who it serves)
  readySimDays: number // absolute deadline: under construction until then
}

export function isActive(inst: Installation, simDays: number): boolean {
  return simDays >= inst.readySimDays && inst.integrity > 0
}

// Who an installation serves right now: whoever holds its node.
export function holderOfInstallation(inst: Installation, owners: OwnerMap, holders: NodeHolderMap): string | undefined {
  return holderOf(inst.bodyName, inst.node, owners, holders)
}

// Where a new installation goes: on walkable, paintable ground on the mainland,
// as close as possible to the key node it guards (fortress → capital/city,
// battery → spaceport/city, shield → capital), and not crowding another one.
export function placeInstallation(surface: BodySurface, existing: Installation[], kind: DefenseKind): number | null {
  if (surface.keySlots.length === 0) return null
  const prefer = kind === 'defenseBattery' ? ['spaceport', 'city', 'capital', 'outpost'] : ['capital', 'city', 'outpost', 'spaceport']
  const anchor = [...surface.keySlots].sort((a, b) => prefer.indexOf(a.kind) - prefer.indexOf(b.kind))[0]
  const here = existing.filter((i) => i.bodyName === surface.bodyName)
  const spacing = cellsToRad(INSTALLATION_SPACING_CELLS)
  const goal = nodePoint(anchor.node)
  const mesh = surfaceMesh()
  let best = -1
  let bestDist = Infinity
  for (let n = 0; n < mesh.count.fine; n++) {
    if (surface.landComponent[n] !== surface.mainland) continue
    if (!TERRAIN[terrainAt(surface, n)].paintable) continue
    const p = nodePoint(n)
    if (surface.keySlots.some((k) => k.node === n)) continue
    if (here.some((i) => arc(nodePoint(i.node), p) < spacing)) continue
    const d = arc(p, goal)
    if (d < bestDist) {
      bestDist = d
      best = n
    }
  }
  return best >= 0 ? best : null
}

// The surface with active fortresses as extra key nodes: an invader must hold
// them too, and the ground AI goes for them like any key node.
export function withFortressKeys(surface: BodySurface, installations: Installation[], simDays: number): BodySurface {
  const forts: KeySlot[] = installations
    .filter((i) => i.bodyName === surface.bodyName && i.kind === 'fortress' && isActive(i, simDays))
    .map((i) => ({ node: i.node, kind: 'fortress' }))
  return forts.length === 0 ? surface : { ...surface, keySlots: [...surface.keySlots, ...forts] }
}

// Defense multiplier a unit of `ownerId` at `point` gets from fortresses its
// nation holds nearby (1 = none).
export function fortressDefense(
  bodyName: string,
  point: SurfacePoint,
  ownerId: string,
  installations: Installation[],
  owners: OwnerMap,
  holders: NodeHolderMap,
  simDays: number,
): number {
  const r = cellsToRad(FORTRESS_RADIUS_CELLS)
  const covered = installations.some(
    (i) => i.bodyName === bodyName && i.kind === 'fortress' && isActive(i, simDays) && holderOfInstallation(i, owners, holders) === ownerId && arc(nodePoint(i.node), point) <= r,
  )
  return covered ? FORTRESS_DEFENSE : 1
}

// Is this node under an active shield held by someone at war with `landerId`?
export function shieldBlocksLanding(
  bodyName: string,
  node: number,
  landerId: string,
  installations: Installation[],
  owners: OwnerMap,
  holders: NodeHolderMap,
  atWar: AtWarFn,
  simDays: number,
): boolean {
  const r = cellsToRad(SHIELD_RADIUS_CELLS)
  const p = nodePoint(node)
  return installations.some((i) => {
    if (i.bodyName !== bodyName || i.kind !== 'shieldGenerator' || !isActive(i, simDays)) return false
    const h = holderOfInstallation(i, owners, holders)
    return !!h && atWar(h, landerId) && arc(nodePoint(i.node), p) <= r
  })
}

// Does an active shield held by the world's defender stand? (Bombardment.)
export function shieldedAgainst(bodyName: string, attackerId: string, installations: Installation[], owners: OwnerMap, holders: NodeHolderMap, atWar: AtWarFn, simDays: number): boolean {
  return installations.some((i) => {
    if (i.bodyName !== bodyName || i.kind !== 'shieldGenerator' || !isActive(i, simDays)) return false
    const h = holderOfInstallation(i, owners, holders)
    return !!h && atWar(h, attackerId)
  })
}

// Active batteries on this body held by someone at war with `countryId`: while
// any stands, `countryId` lacks orbital superiority there.
export function hostileBatteries(bodyName: string, countryId: string, installations: Installation[], owners: OwnerMap, holders: NodeHolderMap, atWar: AtWarFn, simDays: number): Installation[] {
  return installations.filter((i) => {
    if (i.bodyName !== bodyName || i.kind !== 'defenseBattery' || !isActive(i, simDays)) return false
    const h = holderOfInstallation(i, owners, holders)
    return !!h && atWar(h, countryId)
  })
}

// Hull damage in order: shields soak first, then armor, then the core.
export function applyHullDamage(combat: ShipCombatState, damage: number): { combat: ShipCombatState; destroyed: boolean } {
  let left = damage
  const shield = Math.min(combat.shieldHp, left)
  left -= shield
  const armor = Math.min(combat.armorHp, left)
  left -= armor
  const core = Math.max(0, (combat.componentHp.core ?? 0) - left)
  const next = { ...combat, shieldHp: combat.shieldHp - shield, armorHp: combat.armorHp - armor, componentHp: { ...combat.componentHp, core } }
  return { combat: next, destroyed: core <= 0 }
}

export interface OrbitingShip {
  id: string
  ownerId: string
  bodyName: string | null // orbited body
  armed: boolean
  combat: ShipCombatState
}

// One stretch of `days` of battery fire: every active battery splits its
// damage over the hostile armed ships orbiting its world. Pure.
export function batteryFire(
  days: number,
  installations: Installation[],
  ships: OrbitingShip[],
  owners: OwnerMap,
  holders: NodeHolderMap,
  atWar: AtWarFn,
  simDays: number,
): { damaged: Record<string, ShipCombatState>; destroyedIds: string[] } {
  const damage = new Map<string, number>()
  for (const b of installations) {
    if (b.kind !== 'defenseBattery' || !isActive(b, simDays)) continue
    const h = holderOfInstallation(b, owners, holders)
    if (!h) continue
    const targets = ships.filter((s) => s.bodyName === b.bodyName && s.armed && atWar(h, s.ownerId))
    if (targets.length === 0) continue
    const each = (BATTERY_DAMAGE_PER_DAY * days) / targets.length
    for (const t of targets) damage.set(t.id, (damage.get(t.id) ?? 0) + each)
  }
  const damaged: Record<string, ShipCombatState> = {}
  const destroyedIds: string[] = []
  for (const s of ships) {
    const d = damage.get(s.id)
    if (!d) continue
    const res = applyHullDamage(s.combat, d)
    damaged[s.id] = res.combat
    if (res.destroyed) destroyedIds.push(s.id)
  }
  return { damaged, destroyedIds }
}

export function installationMax(kind: DefenseKind): number {
  return DEFENSE_DEFS[kind].integrity
}
