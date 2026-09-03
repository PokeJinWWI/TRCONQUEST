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

export const SLOT_CATEGORIES: SlotCategory[] = ['weapon', 'armor', 'shield', 'defense', 'upgrade']

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
  // How much of the design's power budget (see POWER_TIER_BUDGET) this
  // module draws — see this file's own "Power Distribution" section for why
  // this exists and how it's set.
  powerCost: number
}

export interface ArmorModule {
  id: string
  name: string
  slotSize: SlotSize
  // Flat armor HP this plate adds to the hull's total.
  armorHp: number
  powerCost: number
}

export interface ShieldModule {
  id: string
  name: string
  slotSize: SlotSize
  shieldHp: number
  shieldRegenPerSecond: number
  requiresTechId?: string
  powerCost: number
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
  powerCost: number
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
  powerCost: number
}

// --- Power Distribution -----------------------------------------------
//
// Every module draws power from the design's own Power Distribution grid —
// a ship can't just fill every slot with the biggest, most power-hungry gear
// available; the grid has to be able to actually feed it. Ships default to
// Tier 1 (see shipDesignStore.createDesign); higher tiers are a real
// research investment (see POWER_TIER_TECH_ID and techData.ts's new Power
// Systems branch under Engineering) — the same "researched, then chosen"
// relationship every other tech-gated module already has, just applied to a
// hull-wide budget instead of one module's own eligibility.
//
// Cost scales with slot size (a bigger mount draws more current, full stop)
// PLUS a surcharge on energy weapons specifically — lasers/beams are
// sustained, focused emitters that need real, continuous power, unlike a
// mass driver's mechanical rail or a missile's self-contained motor. This is
// what actually produces "can't just spam the highest tier lasers": two
// heavy beams cost meaningfully more grid capacity than two mass drivers of
// the same slot size, even though both are "a large weapon."
export const SLOT_POWER_COST: Record<SlotSize, number> = { small: 10, medium: 20, large: 35, x: 55 }
// Energy weapons draw 50% more than their slot size alone would suggest.
const ENERGY_WEAPON_POWER_SURCHARGE = 1.5

function weaponPowerCost(slotSize: SlotSize, damageType: WeaponMount['damageType']): number {
  return Math.round(SLOT_POWER_COST[slotSize] * (damageType === 'energy' ? ENERGY_WEAPON_POWER_SURCHARGE : 1))
}

export const MAX_POWER_TIER = 4

export const POWER_TIER_LABELS: Record<number, string> = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3', 4: 'Tier 4' }

// Total power budget a design has to work with at each tier — see this
// section's own header comment. Tuned against the actual chassis slot
// budgets in hullChassis.ts: Tier 1 comfortably covers a Corvette-sized
// hull's own native (small-slot) loadout, but NOT a Frigate's; each
// successive tier opens up roughly the next hull size's worth of headroom,
// so bigger, more power-hungry designs are the ones that actually feel this
// — a Battleship stacked with Titan Beams still doesn't fully fit even at
// Tier 4, which is deliberate: the biggest guns in the game are supposed to
// be a real, binding choice against everything else a hull could carry, not
// something Tier 4 simply removes the tension from.
export const POWER_TIER_BUDGET: Record<number, number> = { 1: 100, 2: 200, 3: 380, 4: 620 }

// techData.ts node id required to select each tier ABOVE 1 — Tier 1 needs no
// research at all (every ship defaults to it). See techData.ts's Power
// Systems branch under Engineering (a linear chain: 2 requires nothing
// (a fresh root), 3 requires 2, 4 requires 3) for the actual nodes.
export const POWER_TIER_TECH_ID: Partial<Record<number, string>> = {
  2: 'power-distribution-2',
  3: 'power-distribution-3',
  4: 'power-distribution-4',
}

// Every tier <= the highest one the player has actually researched (or just
// Tier 1 alone if `researchedIds` is omitted) — the same "what does the
// picker offer" shape as modulesForSlot below, just over tiers instead of
// modules.
export function powerTiersAvailable(researchedIds?: ReadonlySet<string>): number[] {
  const tiers = [1]
  for (let tier = 2; tier <= MAX_POWER_TIER; tier++) {
    const techId = POWER_TIER_TECH_ID[tier]
    if (techId && researchedIds?.has(techId)) tiers.push(tier)
  }
  return tiers
}

// Six archetypes carried over unchanged from WEAPON_TYPES (see combatData.ts
// — every preset hull still references those constants directly), each
// tagged with the slot size it occupies in the builder, plus one new X-slot
// mount since nothing currently fills that tier. Small = fast/cheap/light;
// X = the biggest single gun in the game, only a Battleship-class chassis has
// the slot for it.
export const WEAPON_MODULES: WeaponModule[] = [
  { ...WEAPON_TYPES.autocannon, slotSize: 'small', powerCost: weaponPowerCost('small', WEAPON_TYPES.autocannon.damageType) },
  { ...WEAPON_TYPES.missileBattery, slotSize: 'small', powerCost: weaponPowerCost('small', WEAPON_TYPES.missileBattery.damageType) },
  { ...WEAPON_TYPES.massDriver, slotSize: 'medium', powerCost: weaponPowerCost('medium', WEAPON_TYPES.massDriver.damageType) },
  // Energy weapons are gated behind Electromagnetism's Directed Energy
  // Weapons node (see techData.ts) — kinetic/missile/torpedo mounts above
  // and below aren't electromagnetic technology, so they stay ungated. They
  // also draw the energy-weapon power surcharge (see weaponPowerCost) —
  // Directed Energy Weapons gates whether you can equip one at all, Power
  // Distribution gates how MANY you can actually afford to run at once.
  { ...WEAPON_TYPES.laser, slotSize: 'medium', requiresTechId: 'directed-energy-weapons', powerCost: weaponPowerCost('medium', WEAPON_TYPES.laser.damageType) },
  { ...WEAPON_TYPES.torpedoTube, slotSize: 'medium', powerCost: weaponPowerCost('medium', WEAPON_TYPES.torpedoTube.damageType) },
  { ...WEAPON_TYPES.heavyBeam, slotSize: 'large', requiresTechId: 'directed-energy-weapons', powerCost: weaponPowerCost('large', WEAPON_TYPES.heavyBeam.damageType) },
  {
    id: 'titan-beam',
    name: 'Titan Beam',
    damageType: 'energy',
    damage: 70,
    cooldownSeconds: 7,
    rangeUnits: 10,
    slotSize: 'x',
    requiresTechId: 'directed-energy-weapons',
    powerCost: weaponPowerCost('x', 'energy'),
  },
]

export const ARMOR_MODULES: ArmorModule[] = [
  { id: 'plate-light', name: 'Light Plating', slotSize: 'small', armorHp: 25, powerCost: SLOT_POWER_COST.small },
  { id: 'plate-standard', name: 'Standard Plating', slotSize: 'medium', armorHp: 55, powerCost: SLOT_POWER_COST.medium },
  { id: 'plate-heavy', name: 'Heavy Plating', slotSize: 'large', armorHp: 100, powerCost: SLOT_POWER_COST.large },
  { id: 'plate-capital', name: 'Capital Plating', slotSize: 'x', armorHp: 180, powerCost: SLOT_POWER_COST.x },
]

// Every tier gated behind Electromagnetism's Shielding node.
export const SHIELD_MODULES: ShieldModule[] = [
  { id: 'deflector', name: 'Deflector', slotSize: 'small', shieldHp: 40, shieldRegenPerSecond: 0.6, requiresTechId: 'shielding', powerCost: SLOT_POWER_COST.small },
  { id: 'shield-array', name: 'Shield Array', slotSize: 'medium', shieldHp: 90, shieldRegenPerSecond: 1.0, requiresTechId: 'shielding', powerCost: SLOT_POWER_COST.medium },
  { id: 'shield-heavy', name: 'Heavy Shield', slotSize: 'large', shieldHp: 180, shieldRegenPerSecond: 1.6, requiresTechId: 'shielding', powerCost: SLOT_POWER_COST.large },
  { id: 'shield-capital', name: 'Capital Shield', slotSize: 'x', shieldHp: 320, shieldRegenPerSecond: 2.2, requiresTechId: 'shielding', powerCost: SLOT_POWER_COST.x },
]

// Every tier gated behind Electromagnetism's Point Defense Systems node.
export const DEFENSE_MODULES: DefenseModule[] = [
  { id: 'pd-turret', name: 'Point Defense Turret', slotSize: 'small', pointDefenseRating: 0.15, flakBonus: 0, requiresTechId: 'point-defense-systems', powerCost: SLOT_POWER_COST.small },
  { id: 'flak-battery', name: 'Flak Battery', slotSize: 'medium', pointDefenseRating: 0.1, flakBonus: 0.25, requiresTechId: 'point-defense-systems', powerCost: SLOT_POWER_COST.medium },
  { id: 'pd-heavy', name: 'Heavy PD Array', slotSize: 'large', pointDefenseRating: 0.4, flakBonus: 0, requiresTechId: 'point-defense-systems', powerCost: SLOT_POWER_COST.large },
  { id: 'ciws-grid', name: 'CIWS Grid', slotSize: 'x', pointDefenseRating: 0.3, flakBonus: 0.35, requiresTechId: 'point-defense-systems', powerCost: SLOT_POWER_COST.x },
]

export const UPGRADE_MODULES: UpgradeModule[] = [
  { id: 'afterburner-mk1', name: 'Afterburner Mk1', slotSize: 'small', speedBonusFraction: 0.15, evasionBonus: 0.08, powerCost: SLOT_POWER_COST.small },
  { id: 'afterburner-mk2', name: 'Afterburner Mk2', slotSize: 'medium', speedBonusFraction: 0.25, evasionBonus: 0.14, powerCost: SLOT_POWER_COST.medium },
  { id: 'afterburner-mk3', name: 'Afterburner Mk3', slotSize: 'large', speedBonusFraction: 0.35, evasionBonus: 0.2, powerCost: SLOT_POWER_COST.large },
  { id: 'afterburner-x', name: 'Afterburner X', slotSize: 'x', speedBonusFraction: 0.45, evasionBonus: 0.26, powerCost: SLOT_POWER_COST.x },
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
// (see WeaponModule/ShieldModule/DefenseModule's own requiresTechId) AND, if
// `powerBudgetRemaining` is given, that the design can actually still AFFORD
// (see this file's own "Power Distribution" section) — what the builder
// UI's picker offers. Both gates are optional so callers that don't care
// (e.g. tests exercising the raw catalog) don't need to thread anything
// through. `powerBudgetRemaining` is the caller's job to compute per slot
// (see hullChassis.designPowerUsed) — this function only knows a flat
// number, not the whole design, so filling in ANY slot never sees its own
// currently-equipped module counted against itself. Generic over the
// category so the result stays the CONCRETE module type (WeaponModule,
// ArmorModule, ...) rather than collapsing to the shared `{ slotSize }`
// base every catalog entry has in common.
export function modulesForSlot<C extends SlotCategory>(
  category: C,
  slotSize: SlotSize,
  researchedIds?: ReadonlySet<string>,
  powerBudgetRemaining?: number,
): (typeof MODULE_CATALOG)[C][number][] {
  return (MODULE_CATALOG[category] as { slotSize: SlotSize; requiresTechId?: string; powerCost: number }[])
    .filter((m) => moduleFitsSlot(m.slotSize, slotSize))
    .filter((m) => !m.requiresTechId || !researchedIds || researchedIds.has(m.requiresTechId))
    .filter((m) => powerBudgetRemaining === undefined || m.powerCost <= powerBudgetRemaining) as (typeof MODULE_CATALOG)[C][number][]
}
