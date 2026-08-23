// Combat data model — weapon/defense archetypes and the damage interaction
// matrix between them. Deliberately separate from shipData.ts (which is about
// hulls and drives) so the "what can this ship shoot with" vocabulary has one
// home; ShipClass just references a CombatProfile built out of these pieces.
//
// Every number here is a picked game-balance value, not derived from anything
// physical — unlike this project's travel/gravity math, there's no real-world
// constant for "how much damage a mass driver does." They're grouped as named
// exports specifically so a future tech tree has one obvious place to scale
// them from, same reasoning as shipData's HYPERDRIVE_BASE_LOSS_CHANCE.

// The four weapon families, following the Stellaris convention the design
// brief referenced: energy chews through armor but is soaked by shields,
// kinetic is the mirror, and missiles/torpedoes ignore shields entirely at
// the cost of being interceptable by point defense.
export type DamageType = 'energy' | 'kinetic' | 'missile' | 'torpedo'

// The three layers incoming damage eats through, in this order. Shields and
// armor are consumable pools that sit in front of the ship itself;
// 'components' is what's left once both are gone — the actual healthbars.
export type DefenseLayer = 'shields' | 'armor' | 'components'

// The three component healthbars every ship carries. Damage that reaches
// this layer lands on exactly one of them (see resolveDamage in
// combatResolution.ts) — which one is a real tactical choice, since they fail
// in very different ways:
//   weapons — firepower scales with remaining HP; at 0 the ship can't shoot.
//   utility — thrust and FTL charge rate scale with it; at 0 the ship can
//             neither maneuver on the lattice nor charge a drive to escape.
//   core    — the ship's life. At 0 the ship is destroyed outright.
// Disabling weapons or utility is therefore never lethal on its own but can
// completely decide a fight, which is the point of splitting them out.
export type ComponentKind = 'weapons' | 'utility' | 'core'

export const COMPONENT_KINDS: ComponentKind[] = ['weapons', 'utility', 'core']

export const COMPONENT_LABELS: Record<ComponentKind, string> = {
  weapons: 'Weapons',
  utility: 'Utility',
  core: 'Core Internal',
}

// How much each pool contributes to the single "overall" bar — the blend
// covers all five, not just the three components.
//
// An earlier cut weighted only the components, on the reasoning that shields
// and armor are consumable buffers rather than the ship itself. Verification
// showed why that reads wrong: a Battleship that won a fight having lost
// every point of shielding and half its armor still displayed 100% integrity,
// which is not a useful summary of a ship one good volley from being hulled.
// Core still dominates (it's the only pool that actually ends the ship), but
// stripped defenses now visibly move the needle.
//
// Weights are normalized at read time across whichever pools a hull actually
// has (see overallHealthFraction), so a shieldless design isn't permanently
// capped below 100%.
export const OVERALL_WEIGHTS = {
  core: 0.35,
  weapons: 0.15,
  utility: 0.15,
  armor: 0.2,
  shields: 0.15,
} as const

export interface DamageProfile {
  // Multiplier applied while chewing through each layer. A value below 1
  // means this weapon is soaked by that layer (it takes more shots to strip
  // it); above 1 means it tears through.
  shields: number
  armor: number
  components: number
  // Missiles and torpedoes are physical objects crossing real space rather
  // than a beam or a slug — they route around shields entirely (the shield
  // multiplier above is then never consulted) but can be shot down in
  // flight by point defense.
  bypassesShields: boolean
  interceptable: boolean
}

export const DAMAGE_PROFILES: Record<DamageType, DamageProfile> = {
  // Sustained beams: shields are exactly what they're designed to stop,
  // armor plating is exactly what they're designed to melt.
  energy: { shields: 0.5, armor: 1.5, components: 1.0, bypassesShields: false, interceptable: false },
  // Mass drivers: raw kinetic impact overwhelms a shield's energy budget,
  // but spreads harmlessly against thick plating.
  kinetic: { shields: 1.5, armor: 0.5, components: 1.0, bypassesShields: false, interceptable: false },
  // Missiles ignore shields and do solid work on everything behind them —
  // their weakness is entirely that they can be intercepted.
  missile: { shields: 0, armor: 1.0, components: 1.25, bypassesShields: true, interceptable: true },
  // Torpedoes are the extreme case: slow, heavily interceptable, but
  // devastating once they connect with the ship itself.
  torpedo: { shields: 0, armor: 0.75, components: 2.0, bypassesShields: true, interceptable: true },
}

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  energy: 'Energy',
  kinetic: 'Kinetic',
  missile: 'Missile',
  torpedo: 'Torpedo',
}

// A single weapon mount on a hull. `cooldownSeconds` and `rangeUnits` are
// both in *tactical* units — sim-seconds (see gameTimeStore's tactical mode)
// and combat-arena grid units respectively — because those are the only
// scales combat ever plays out in.
export interface WeaponMount {
  id: string
  name: string
  damageType: DamageType
  // Damage per shot, before the layer multipliers above and before the
  // firing ship's weapons-component degradation are applied.
  damage: number
  // Sim-seconds between shots. At tactical 1x this is also real seconds.
  cooldownSeconds: number
  // Reach in combat-arena grid units (see combatArena.ts). Short-ranged
  // weapons hit harder per second but force a ship to close, which is what
  // makes lattice positioning matter.
  rangeUnits: number
}

export interface DefenseProfile {
  // Regenerating front layer — comes back between engagements (and slowly
  // during one), unlike armor.
  shieldHp: number
  // Sim-seconds' worth of shield regeneration. Slow enough that it doesn't
  // decide a firefight, fast enough that a ship that disengages and waits
  // is meaningfully repaired.
  shieldRegenPerSecond: number
  // Static front layer — does not regenerate in the field. Armor damage
  // persists between battles.
  armorHp: number
  // Chance (0..1) to shoot down each incoming interceptable shot (missiles
  // and torpedoes). The counterplay that keeps torpedo boats from being
  // strictly dominant — a hull with no point defense is genuinely helpless
  // against them.
  pointDefenseRating: number
}

export interface CombatProfile {
  // Max HP for each of the three healthbars.
  components: Record<ComponentKind, number>
  defenses: DefenseProfile
  // Empty for civilian hulls — an unarmed ship is a fully valid combatant,
  // it just can't shoot back (and had better be able to run).
  weapons: WeaponMount[]
  // Sublight speed inside the combat arena, in grid units per sim-second,
  // at full utility health. This is what makes range a real trade rather
  // than a formality: a long-ranged Frigate that outruns a Battleship can
  // kite it indefinitely, while a Corvette has to survive the approach to
  // bring its short autocannons to bear. Unrelated to
  // REACTION_DRIVE_SPEED_KM_S — that governs interplanetary travel across
  // real AU, this governs a knife-fight across a few arena units.
  maneuverUnitsPerSecond: number
}

// Weapon archetypes the presets below are assembled from. Named separately
// (rather than inlined per hull) so the same "Mass Driver" means the same
// thing on every hull that carries one, and so a future refit/designer UI has
// a catalog to offer.
export const WEAPON_TYPES = {
  massDriver: {
    id: 'mass-driver',
    name: 'Mass Driver',
    damageType: 'kinetic',
    damage: 14,
    cooldownSeconds: 2,
    rangeUnits: 6,
  },
  autocannon: {
    id: 'autocannon',
    name: 'Autocannon',
    damageType: 'kinetic',
    damage: 6,
    cooldownSeconds: 0.8,
    rangeUnits: 3,
  },
  laser: {
    id: 'laser',
    name: 'Laser',
    damageType: 'energy',
    damage: 12,
    cooldownSeconds: 1.6,
    rangeUnits: 5,
  },
  heavyBeam: {
    id: 'heavy-beam',
    name: 'Heavy Beam',
    damageType: 'energy',
    damage: 38,
    cooldownSeconds: 5,
    rangeUnits: 9,
  },
  missileBattery: {
    id: 'missile-battery',
    name: 'Missile Battery',
    damageType: 'missile',
    damage: 20,
    cooldownSeconds: 4,
    rangeUnits: 11,
  },
  torpedoTube: {
    id: 'torpedo-tube',
    name: 'Torpedo Tube',
    damageType: 'torpedo',
    damage: 55,
    cooldownSeconds: 9,
    rangeUnits: 8,
  },
} as const satisfies Record<string, WeaponMount>

// Convenience for building a hull's mount list — the same archetype can be
// fitted more than once (a cruiser carrying three lasers), and each copy
// needs its own cooldown timer at runtime, which is keyed by mount index
// rather than mount id (see ShipCombatState.weaponReadySimDays).
function mounts(weapon: WeaponMount, count: number): WeaponMount[] {
  return Array.from({ length: count }, () => weapon)
}

// The civilian profile shared by every pre-combat hull (the four scouts and
// couriers that existed before this system). Thin, unarmed, and fragile —
// they exist to be chased, not to fight. Giving them a real profile rather
// than making `combat` optional on ShipClass keeps every damage path total:
// anything in the game can be shot at, and nothing needs a null check.
export const CIVILIAN_COMBAT_PROFILE: CombatProfile = {
  components: { weapons: 20, utility: 60, core: 80 },
  defenses: { shieldHp: 40, shieldRegenPerSecond: 0.6, armorHp: 20, pointDefenseRating: 0 },
  weapons: [],
  maneuverUnitsPerSecond: 1.1,
}

// Warship presets. Roles are differentiated by the damage-type matrix rather
// than by raw stat inflation — a Frigate loses to a Destroyer's point defense
// and beats a shield-heavy Corvette, so the counter triangle is playable
// before any tech or designer system exists to customize it. Every warship
// keeps a real FTL drive per the design brief, which also means every warship
// can attempt the charge-and-escape (see ShipCombatState.ftlCharge).
export const CORVETTE_PROFILE: CombatProfile = {
  components: { weapons: 40, utility: 60, core: 100 },
  defenses: { shieldHp: 90, shieldRegenPerSecond: 1.4, armorHp: 40, pointDefenseRating: 0.1 },
  weapons: mounts(WEAPON_TYPES.autocannon, 3),
  maneuverUnitsPerSecond: 1.6,
}

export const FRIGATE_PROFILE: CombatProfile = {
  components: { weapons: 60, utility: 70, core: 140 },
  defenses: { shieldHp: 60, shieldRegenPerSecond: 0.9, armorHp: 140, pointDefenseRating: 0 },
  weapons: [...mounts(WEAPON_TYPES.missileBattery, 2), ...mounts(WEAPON_TYPES.autocannon, 1)],
  maneuverUnitsPerSecond: 1.2,
}

export const DESTROYER_PROFILE: CombatProfile = {
  components: { weapons: 90, utility: 90, core: 200 },
  defenses: { shieldHp: 140, shieldRegenPerSecond: 1.2, armorHp: 120, pointDefenseRating: 0.55 },
  weapons: [...mounts(WEAPON_TYPES.laser, 2), ...mounts(WEAPON_TYPES.massDriver, 2)],
  maneuverUnitsPerSecond: 1.0,
}

export const CRUISER_PROFILE: CombatProfile = {
  components: { weapons: 140, utility: 130, core: 320 },
  defenses: { shieldHp: 240, shieldRegenPerSecond: 1.8, armorHp: 260, pointDefenseRating: 0.3 },
  weapons: [...mounts(WEAPON_TYPES.heavyBeam, 1), ...mounts(WEAPON_TYPES.laser, 2), ...mounts(WEAPON_TYPES.massDriver, 2)],
  maneuverUnitsPerSecond: 0.75,
}

export const BATTLESHIP_PROFILE: CombatProfile = {
  components: { weapons: 220, utility: 190, core: 560 },
  defenses: { shieldHp: 380, shieldRegenPerSecond: 2.2, armorHp: 460, pointDefenseRating: 0.4 },
  weapons: [...mounts(WEAPON_TYPES.torpedoTube, 2), ...mounts(WEAPON_TYPES.heavyBeam, 2), ...mounts(WEAPON_TYPES.massDriver, 2)],
  maneuverUnitsPerSecond: 0.5,
}

// How long a drive takes to spool up before it fires, in sim-seconds. This is
// the whole reason FTL matters in combat: a ship announcing an escape is
// committed and defenseless for this long (see ShipCombatState.ftlCharge —
// charging ships can't fire), so the attacker gets a real window to stop it.
// Hyperdrive is the faster of the two per the design brief.
export const HYPERDRIVE_CHARGE_SECONDS = 5
export const WARP_CHARGE_SECONDS = 10

// Total damage a ship's own weapons output scales linearly with its remaining
// weapons-component HP, floored at zero — a half-wrecked weapons array fires
// at half strength rather than failing all at once.
export function weaponsEffectiveness(weaponsHp: number, weaponsMaxHp: number): number {
  if (weaponsMaxHp <= 0) return 0
  return Math.max(0, Math.min(1, weaponsHp / weaponsMaxHp))
}

// Same idea for thrust and FTL charge rate against the utility component. A
// ship with dead utility is stranded in the arena and cannot charge out.
export function utilityEffectiveness(utilityHp: number, utilityMaxHp: number): number {
  if (utilityMaxHp <= 0) return 0
  return Math.max(0, Math.min(1, utilityHp / utilityMaxHp))
}
