// The ship builder's hull chassis catalog. A HullChassis is metadata only —
// a size class, a fixed component/speed baseline, and a slot budget — never
// a CombatProfile itself. That's the whole point of keeping this a separate
// array from SHIP_CLASSES/the five hand-authored *_PROFILE constants in
// combatData.ts: a chassis exists only to seed a NEW ShipDesign built from
// scratch out of shipModules.ts's catalog, so nothing here can ever change
// what an existing preset hull does.

import { hullMotion, type ComponentKind, type CombatProfile, type HullSizeClass, type WeaponMount } from './combatData'
import { HYPERDRIVE_BASE_COOLDOWN_DAYS, WARP_BASE_COOLDOWN_DAYS, type FtlDrive, type ShipClass } from './shipData'
import {
  ARMOR_MODULES,
  DEFENSE_MODULES,
  POWER_TIER_BUDGET,
  SHIELD_MODULES,
  SLOT_CATEGORIES,
  UPGRADE_MODULES,
  WEAPON_MODULES,
  findModule,
  type SlotCategory,
  type SlotSize,
} from './shipModules'

export interface HullChassis {
  id: string
  name: string
  sizeClass: HullSizeClass
  role: 'civilian' | 'warship'
  // Weapons/utility/core HP pools — NOT slotted (the player never asked to
  // customize these, only armor/shields/weapons/defense/upgrades), so they
  // stay a fixed chassis stat exactly like every preset hull's components.
  baseComponents: Record<ComponentKind, number>
  baseMotion: { maneuverUnitsPerSecond: number; accelerationUnitsPerSecondSq: number }
  ftlDrives: FtlDrive[]
  // The concrete slots this chassis offers, per category — e.g.
  // weapon: ['small','small','medium'] is three weapon slots, two small and
  // one medium. Length of each array is the slot COUNT for that category.
  slots: Record<SlotCategory, SlotSize[]>
}

// Six chassis mirroring the five warship presets' names/size feel (plus a
// civilian hull) — same identity, but these seed brand-new custom designs
// rather than being the presets themselves. Slot budgets below are a first
// pass, the most likely numbers to want tuning once a design is actually in
// hand.
export const HULL_CHASSES: HullChassis[] = [
  {
    id: 'civilian-hull',
    name: 'Civilian Hull',
    sizeClass: 'small',
    role: 'civilian',
    baseComponents: { weapons: 20, utility: 60, core: 80 },
    baseMotion: hullMotion(5, 4),
    ftlDrives: [{ kind: 'warp', speedC: 10, cooldownDays: WARP_BASE_COOLDOWN_DAYS }],
    // No weapon or defense (point-defense/flak) slots — matches
    // CIVILIAN_COMBAT_PROFILE's own "unarmed, fragile, exist to be chased,
    // not to fight" design (see combatData.ts). Armor/shield/upgrade stay
    // available so a custom civilian design can still be built tougher or
    // more evasive without ever becoming armed.
    slots: {
      weapon: [],
      armor: ['small'],
      shield: ['small'],
      defense: [],
      upgrade: ['small'],
    },
  },
  {
    id: 'corvette-hull',
    name: 'Corvette Hull',
    sizeClass: 'small',
    role: 'warship',
    baseComponents: { weapons: 40, utility: 60, core: 100 },
    baseMotion: hullMotion(4, 3),
    ftlDrives: [{ kind: 'warp', speedC: 10, cooldownDays: WARP_BASE_COOLDOWN_DAYS }],
    slots: {
      weapon: ['small', 'small', 'small'],
      armor: ['small', 'small'],
      shield: ['small', 'small'],
      defense: ['small'],
      upgrade: ['small'],
    },
  },
  {
    id: 'frigate-hull',
    name: 'Frigate Hull',
    sizeClass: 'medium',
    role: 'warship',
    baseComponents: { weapons: 60, utility: 70, core: 140 },
    baseMotion: hullMotion(6, 4),
    ftlDrives: [{ kind: 'warp', speedC: 10, cooldownDays: WARP_BASE_COOLDOWN_DAYS }],
    slots: {
      weapon: ['small', 'small', 'medium', 'medium'],
      armor: ['small', 'medium'],
      shield: ['small', 'medium'],
      defense: ['small', 'medium'],
      upgrade: ['small', 'medium'],
    },
  },
  {
    id: 'destroyer-hull',
    name: 'Destroyer Hull',
    sizeClass: 'medium',
    role: 'warship',
    baseComponents: { weapons: 90, utility: 90, core: 200 },
    baseMotion: hullMotion(8, 5),
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    slots: {
      weapon: ['small', 'medium', 'medium', 'medium'],
      armor: ['medium', 'medium'],
      shield: ['small', 'medium'],
      defense: ['medium', 'medium'],
      upgrade: ['small', 'medium'],
    },
  },
  {
    id: 'cruiser-hull',
    name: 'Cruiser Hull',
    sizeClass: 'large',
    role: 'warship',
    baseComponents: { weapons: 140, utility: 130, core: 320 },
    baseMotion: hullMotion(10, 7),
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    slots: {
      weapon: ['small', 'medium', 'medium', 'large', 'large'],
      armor: ['medium', 'medium', 'large'],
      shield: ['medium', 'large'],
      defense: ['medium', 'large'],
      upgrade: ['medium', 'large'],
    },
  },
  {
    id: 'battleship-hull',
    name: 'Battleship Hull',
    sizeClass: 'x',
    role: 'warship',
    baseComponents: { weapons: 220, utility: 190, core: 560 },
    baseMotion: hullMotion(13, 10),
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    slots: {
      weapon: ['medium', 'large', 'large', 'x', 'x'],
      armor: ['large', 'large', 'x'],
      shield: ['large', 'x'],
      defense: ['large', 'x'],
      upgrade: ['large', 'x'],
    },
  },
]

// A saved, player-built loadout on top of a chassis. `equipped[category][i]`
// lines up positionally with `chassis.slots[category][i]` — a module id, or
// null for an empty slot. Kept as bare ids (not embedded module objects) so
// a design stays a small, serializable record and always reflects the
// CURRENT catalog rather than a snapshot of it.
export interface ShipDesign {
  id: string
  name: string
  chassisId: string
  equipped: Record<SlotCategory, (string | null)[]>
  // Every ship's power grid defaults to Tier 1 (see shipDesignStore.
  // createDesign) — how much of it a design can actually equip is capped by
  // POWER_TIER_BUDGET, checked against designPowerUsed below. Raising this
  // is gated by research (see shipModules.POWER_TIER_TECH_ID), same as any
  // other tech-gated choice in the builder.
  powerTier: number
}

// A fresh design on `chassis` starts with every slot empty.
export function emptyLoadout(chassis: HullChassis): Record<SlotCategory, (string | null)[]> {
  return {
    weapon: chassis.slots.weapon.map(() => null),
    armor: chassis.slots.armor.map(() => null),
    shield: chassis.slots.shield.map(() => null),
    defense: chassis.slots.defense.map(() => null),
    upgrade: chassis.slots.upgrade.map(() => null),
  }
}

// Total power every currently-equipped module draws, across every slot in
// every category — see shipModules.ts's "Power Distribution" section for
// why this exists. `exclude` leaves one specific slot out of the sum: the
// builder UI calls this while deciding what to OFFER for a slot it's about
// to fill, and that slot's own current occupant (about to be replaced
// anyway) shouldn't count against itself.
export function designPowerUsed(design: ShipDesign, exclude?: { category: SlotCategory; index: number }): number {
  let total = 0
  for (const category of SLOT_CATEGORIES) {
    design.equipped[category].forEach((moduleId, index) => {
      if (exclude && exclude.category === category && exclude.index === index) return
      if (!moduleId) return
      const mod = findModule(category, moduleId)
      if (mod) total += mod.powerCost
    })
  }
  return total
}

// This design's total power budget, from its own powerTier — see
// POWER_TIER_BUDGET. Falls back to Tier 1's budget for a tier the table
// doesn't recognize (shouldn't happen in practice, but keeps this total
// rather than throwing on stale/out-of-range data).
export function designPowerBudget(design: ShipDesign): number {
  return POWER_TIER_BUDGET[design.powerTier] ?? POWER_TIER_BUDGET[1]
}

// Caps on what stacking modules can add up to — matches the spirit of the
// existing CHAFF_MISS_CHANCE-style tuned constants: a design should never be
// able to buy its way to a sure thing by filling every slot with the same
// module.
const MAX_POINT_DEFENSE_RATING = 0.9
const MAX_FLAK_RATING = 0.6
const MAX_EVASION = 0.6

// The load-bearing function of the whole builder: turns a chassis + a
// design's equipped modules into a standard CombatProfile, by summing each
// slot category's contribution. Because every existing combat/UI function
// (stepEngagements, overallHealthFraction, the Strategizer's Screen ranking,
// ShipPanel, ...) already operates on the generic CombatProfile shape, a
// profile built here works everywhere those already do — nothing about
// combat resolution needs to know a ship came from the builder rather than a
// hand-authored preset.
export function buildCombatProfile(chassis: HullChassis, design: ShipDesign): CombatProfile {
  const weapons: WeaponMount[] = []
  for (const moduleId of design.equipped.weapon) {
    const mod = moduleId ? WEAPON_MODULES.find((m) => m.id === moduleId) : undefined
    if (!mod) continue
    const { slotSize: _slotSize, ...mount } = mod
    weapons.push(mount)
  }

  let armorHp = 0
  for (const moduleId of design.equipped.armor) {
    const mod = moduleId ? ARMOR_MODULES.find((m) => m.id === moduleId) : undefined
    if (mod) armorHp += mod.armorHp
  }

  let shieldHp = 0
  let shieldRegenPerSecond = 0
  for (const moduleId of design.equipped.shield) {
    const mod = moduleId ? SHIELD_MODULES.find((m) => m.id === moduleId) : undefined
    if (mod) {
      shieldHp += mod.shieldHp
      shieldRegenPerSecond += mod.shieldRegenPerSecond
    }
  }

  let pointDefenseRating = 0
  let flakRating = 0
  for (const moduleId of design.equipped.defense) {
    const mod = moduleId ? DEFENSE_MODULES.find((m) => m.id === moduleId) : undefined
    if (mod) {
      pointDefenseRating += mod.pointDefenseRating
      flakRating += mod.flakBonus
    }
  }

  let speedBonusFraction = 0
  let evasion = 0
  for (const moduleId of design.equipped.upgrade) {
    const mod = moduleId ? UPGRADE_MODULES.find((m) => m.id === moduleId) : undefined
    if (mod) {
      speedBonusFraction += mod.speedBonusFraction
      evasion += mod.evasionBonus
    }
  }

  return {
    sizeClass: chassis.sizeClass,
    components: { ...chassis.baseComponents },
    defenses: {
      shieldHp,
      shieldRegenPerSecond,
      armorHp,
      pointDefenseRating: Math.min(MAX_POINT_DEFENSE_RATING, pointDefenseRating),
      flakRating: Math.min(MAX_FLAK_RATING, flakRating),
      evasion: Math.min(MAX_EVASION, evasion),
    },
    weapons,
    maneuverUnitsPerSecond: chassis.baseMotion.maneuverUnitsPerSecond * (1 + speedBonusFraction),
    accelerationUnitsPerSecondSq: chassis.baseMotion.accelerationUnitsPerSecondSq * (1 + speedBonusFraction),
  }
}

// Wraps a design into the same ShipClass shape every preset already is, so
// every `SHIP_CLASSES.find(...)`-shaped lookup in the game can treat a
// custom design identically once it's resolved (see
// state/shipClassResolver.ts). classId is namespaced with a `design:` prefix
// so it can never collide with a preset's id.
export function designToShipClass(design: ShipDesign, chassis: HullChassis): ShipClass {
  return {
    id: `design:${design.id}`,
    name: design.name,
    reactionDrive: true,
    ftlDrives: chassis.ftlDrives,
    combat: buildCombatProfile(chassis, design),
    role: chassis.role,
  }
}
