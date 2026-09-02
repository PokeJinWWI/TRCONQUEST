// The ship builder's module catalog — the equippable pieces a HullChassis's
// slots (see hullChassis.ts) get filled with. Kept separate from
// combatData.ts for the same reason WEAPON_TYPES lives there and hull
// profiles are built from it: "what can be fitted" is one vocabulary,
// independent of "what a specific hand-authored hull happens to carry."
//
// The five hand-authored preset hulls (Corvette/Frigate/Destroyer/Cruiser/
// Battleship) do NOT go through this catalog — they keep their own flat,
// tuned CombatProfile constants untouched. This catalog only ever feeds a
// player-built ShipDesign (see hullChassis.ts's buildCombatProfile), so
// nothing here can regress existing balance.

import { WEAPON_TYPES, type HullSizeClass, type WeaponMount } from './combatData'

export type SlotCategory = 'weapon' | 'armor' | 'shield' | 'defense' | 'upgrade'

// Reuses HullSizeClass's own small/medium/large/x vocabulary rather than a
// parallel scale — a slot's size and a hull's size class are the same idea.
export type SlotSize = HullSizeClass

export const SLOT_SIZE_LABELS: Record<SlotSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  x: 'X',
}

const SLOT_SIZE_ORDER: SlotSize[] = ['small', 'medium', 'large', 'x']

// A module fits a slot at least as big as it is — a Small weapon drops into
// a Large slot fine, but a Large module never fits a Small slot. Down-fit
// only, never up-fit.
export function moduleFitsSlot(moduleSize: SlotSize, slotSize: SlotSize): boolean {
  return SLOT_SIZE_ORDER.indexOf(moduleSize) <= SLOT_SIZE_ORDER.indexOf(slotSize)
}

export interface WeaponModule extends WeaponMount {
  slotSize: SlotSize
  // A techData.ts node id — module is excluded from modulesForSlot's result
  // unless it's in the researched set passed in there. Undefined means
  // always available (kinetic weapons and armor plating aren't
  // electromagnetic technology, so most of the catalog stays ungated).
  requiresTechId?: string
}

export interface ArmorModule {
  id: string
  name: string
  slotSize: SlotSize
  // Flat armor HP this plate adds to the hull's total.
  armorHp: number
}

export interface ShieldModule {
  id: string
  name: string
  slotSize: SlotSize
  shieldHp: number
  shieldRegenPerSecond: number
  requiresTechId?: string
}

export interface DefenseModule {
  id: string
  name: string
  slotSize: SlotSize
  // Chance (0..1) added to the hull's point-defense screen against any
  // interceptable shot (missiles and torpedoes both).
  pointDefenseRating: number
  // Extra chance added on top, but only against torpedoes specifically (see
  // combatData's DefenseProfile.flakRating and applyShot) — a Flak module
  // has a higher flakBonus than a pure Point Defense module of the same
  // size, at the cost of a lower base pointDefenseRating against missiles.
  flakBonus: number
  requiresTechId?: string
}

export interface UpgradeModule {
  id: string
  name: string
  slotSize: SlotSize
  // Multiplies the hull's base cruise speed AND acceleration (see
  // hullChassis.buildCombatProfile) — handling scales with speed, matching
  // how every hand-authored hull already ties the two together via
  // hullMotion(). 0 for a module that doesn't affect speed.
  speedBonusFraction: number
  // Added to the hull's DefenseProfile.evasion — reduces torpedo accuracy
  // only (see combatData's torpedoAccuracy); does nothing against a
  // missile's 100% tracking or a direct-fire weapon's aim.
  evasionBonus: number
}

// Six archetypes carried over unchanged from WEAPON_TYPES (see combatData.ts
// — every preset hull still references those constants directly), each
// tagged with the slot size it occupies in the builder, plus one new X-slot
// mount since nothing currently fills that tier. Small = fast/cheap/light;
// X = the biggest single gun in the game, only a Battleship-class chassis has
// the slot for it.
export const WEAPON_MODULES: WeaponModule[] = [
  { ...WEAPON_TYPES.autocannon, slotSize: 'small' },
  { ...WEAPON_TYPES.missileBattery, slotSize: 'small' },
  { ...WEAPON_TYPES.massDriver, slotSize: 'medium' },
  // Energy weapons are gated behind Electromagnetism's Directed Energy
  // Weapons node (see techData.ts) — kinetic/missile/torpedo mounts above
  // and below aren't electromagnetic technology, so they stay ungated.
  { ...WEAPON_TYPES.laser, slotSize: 'medium', requiresTechId: 'directed-energy-weapons' },
  { ...WEAPON_TYPES.torpedoTube, slotSize: 'medium' },
  { ...WEAPON_TYPES.heavyBeam, slotSize: 'large', requiresTechId: 'directed-energy-weapons' },
  {
    id: 'titan-beam',
    name: 'Titan Beam',
    damageType: 'energy',
    damage: 70,
    cooldownSeconds: 7,
    rangeUnits: 10,
    slotSize: 'x',
    requiresTechId: 'directed-energy-weapons',
  },
]

export const ARMOR_MODULES: ArmorModule[] = [
  { id: 'plate-light', name: 'Light Plating', slotSize: 'small', armorHp: 25 },
  { id: 'plate-standard', name: 'Standard Plating', slotSize: 'medium', armorHp: 55 },
  { id: 'plate-heavy', name: 'Heavy Plating', slotSize: 'large', armorHp: 100 },
  { id: 'plate-capital', name: 'Capital Plating', slotSize: 'x', armorHp: 180 },
]

// Every tier gated behind Electromagnetism's Shielding node.
export const SHIELD_MODULES: ShieldModule[] = [
  { id: 'deflector', name: 'Deflector', slotSize: 'small', shieldHp: 40, shieldRegenPerSecond: 0.6, requiresTechId: 'shielding' },
  { id: 'shield-array', name: 'Shield Array', slotSize: 'medium', shieldHp: 90, shieldRegenPerSecond: 1.0, requiresTechId: 'shielding' },
  { id: 'shield-heavy', name: 'Heavy Shield', slotSize: 'large', shieldHp: 180, shieldRegenPerSecond: 1.6, requiresTechId: 'shielding' },
  { id: 'shield-capital', name: 'Capital Shield', slotSize: 'x', shieldHp: 320, shieldRegenPerSecond: 2.2, requiresTechId: 'shielding' },
]

// Every tier gated behind Electromagnetism's Point Defense Systems node.
export const DEFENSE_MODULES: DefenseModule[] = [
  { id: 'pd-turret', name: 'Point Defense Turret', slotSize: 'small', pointDefenseRating: 0.15, flakBonus: 0, requiresTechId: 'point-defense-systems' },
  { id: 'flak-battery', name: 'Flak Battery', slotSize: 'medium', pointDefenseRating: 0.1, flakBonus: 0.25, requiresTechId: 'point-defense-systems' },
  { id: 'pd-heavy', name: 'Heavy PD Array', slotSize: 'large', pointDefenseRating: 0.4, flakBonus: 0, requiresTechId: 'point-defense-systems' },
  { id: 'ciws-grid', name: 'CIWS Grid', slotSize: 'x', pointDefenseRating: 0.3, flakBonus: 0.35, requiresTechId: 'point-defense-systems' },
]

export const UPGRADE_MODULES: UpgradeModule[] = [
  { id: 'afterburner-mk1', name: 'Afterburner Mk1', slotSize: 'small', speedBonusFraction: 0.15, evasionBonus: 0.08 },
  { id: 'afterburner-mk2', name: 'Afterburner Mk2', slotSize: 'medium', speedBonusFraction: 0.25, evasionBonus: 0.14 },
  { id: 'afterburner-mk3', name: 'Afterburner Mk3', slotSize: 'large', speedBonusFraction: 0.35, evasionBonus: 0.2 },
  { id: 'afterburner-x', name: 'Afterburner X', slotSize: 'x', speedBonusFraction: 0.45, evasionBonus: 0.26 },
]

// One place to look a module up by category — the design store's editing
// actions and the builder UI's slot picker both need "given a category and
// an id, what module is that" without a five-way switch at every call site.
export const MODULE_CATALOG = {
  weapon: WEAPON_MODULES,
  armor: ARMOR_MODULES,
  shield: SHIELD_MODULES,
  defense: DEFENSE_MODULES,
  upgrade: UPGRADE_MODULES,
} as const satisfies Record<SlotCategory, { id: string; slotSize: SlotSize }[]>

export function findModule<C extends SlotCategory>(category: C, moduleId: string): (typeof MODULE_CATALOG)[C][number] | undefined {
  return (MODULE_CATALOG[category] as { id: string }[]).find((m) => m.id === moduleId) as (typeof MODULE_CATALOG)[C][number] | undefined
}

// Every module in `category` that could legally go into a slot of this size
// AND, if `researchedIds` is given, that the player has actually unlocked
// (see WeaponModule/ShieldModule/DefenseModule's own requiresTechId) — what
// the builder UI's picker offers. `researchedIds` is optional so callers that
// don't care about tech gating (e.g. tests exercising the catalog itself)
// don't need to thread a set through. Generic over the category so the
// result stays the CONCRETE module type (WeaponModule, ArmorModule, ...)
// rather than collapsing to the shared `{ slotSize }` base every catalog
// entry has in common.
export function modulesForSlot<C extends SlotCategory>(
  category: C,
  slotSize: SlotSize,
  researchedIds?: ReadonlySet<string>,
): (typeof MODULE_CATALOG)[C][number][] {
  return (MODULE_CATALOG[category] as { slotSize: SlotSize; requiresTechId?: string }[])
    .filter((m) => moduleFitsSlot(m.slotSize, slotSize))
    .filter((m) => !m.requiresTechId || !researchedIds || researchedIds.has(m.requiresTechId)) as (typeof MODULE_CATALOG)[C][number][]
}
