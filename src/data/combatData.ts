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

import { ARENA_LIGHT_SPEED_UNITS_PER_SECOND } from '../scene/combatArena'

// The four weapon families, following the Stellaris convention the design
// brief referenced: energy chews through armor but is soaked by shields,
// kinetic is the mirror, and missiles/torpedoes ignore shields entirely at
// the cost of being interceptable by point defense.
export type DamageType = 'energy' | 'kinetic' | 'missile' | 'torpedo'

// A hull's rough physical size, independent of its role/loadout. Drives two
// things: the ship-builder's slot budget (see hullChassis.ts — a bigger hull
// gets more/bigger slots) and torpedo accuracy (see torpedoAccuracy below —
// a slow torpedo is simply easier to land on a bigger cross-section).
// Deliberately reused as the same vocabulary as the builder's slot sizes
// ('small'|'medium'|'large'|'x') rather than inventing a parallel scale.
export type HullSizeClass = 'small' | 'medium' | 'large' | 'x'

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
  // The distance this weapon performs at its best, in the same units as
  // rangeUnits — always <= rangeUnits. Only consulted for missile/torpedo
  // damage types (see missileDamageMultiplier/torpedoAccuracy below);
  // defaults to rangeUnits itself when omitted, which makes every direct-fire
  // weapon (autocannon, laser, mass driver, heavy beam) behave exactly as
  // before — full effect anywhere inside range, no falloff.
  optimalRangeUnits?: number
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
  // Extra intercept chance added on TOP of pointDefenseRating, but only
  // against torpedoes specifically (see applyShot) — flak is a wide burst
  // that's disproportionately effective against a big, slow target, unlike
  // point defense proper which treats every interceptable round the same.
  // 0 on every hand-authored hull; only reachable via a Defense-slot Flak
  // module in the ship builder (see shipModules.ts).
  flakRating: number
  // Chance (0..1) subtracted from an attacking torpedo's accuracy roll (see
  // torpedoAccuracy) — a hull actively jinking is harder for a slow torpedo
  // to lead, though it does nothing against a missile's 100% tracking or a
  // direct-fire weapon's aim. 0 on every hand-authored hull; only reachable
  // via an Upgrade-slot Afterburner module.
  evasion: number
}

export interface CombatProfile {
  // This hull's rough physical size — see HullSizeClass's own comment. Used
  // by torpedoAccuracy (a bigger target is easier for a slow torpedo to hit)
  // and by the ship builder's slot budget.
  sizeClass: HullSizeClass
  // Max HP for each of the three healthbars.
  components: Record<ComponentKind, number>
  defenses: DefenseProfile
  // Empty for civilian hulls — an unarmed ship is a fully valid combatant,
  // it just can't shoot back (and had better be able to run).
  weapons: WeaponMount[]
  // Sublight cruise speed inside the combat arena, in arena units per
  // sim-second, at full utility health. This is what makes range a real
  // trade rather than a formality: a long-ranged Frigate that outruns a
  // Battleship can kite it indefinitely, while a Corvette has to survive the
  // approach to bring its short autocannons to bear.
  //
  // Always defined below as a fraction of ARENA_LIGHT_SPEED_UNITS_PER_SECOND
  // rather than as a bare number — these are reaction drives, and a reaction
  // drive that crosses a star faster than light does is a bug the code
  // should make hard to write. (It was previously easy to write, and got
  // written: the old fastest hull ran at 96% of light.)
  maneuverUnitsPerSecond: number
  // Arena units per sim-second squared. Governs starting, stopping, AND
  // turning — the movement integrator steers a velocity *vector* under this
  // single limit (see combatResolution.integrateMotion), so changing
  // direction costs exactly as much as changing speed, and a heavy hull
  // sweeps a wide arc where a corvette pivots. Expressed below as
  // "cruise speed reached in N seconds" so the handling characteristic is
  // the number being tuned, not an abstract rate.
  accelerationUnitsPerSecondSq: number
}

// How a ship behaves when the player isn't steering it directly — the
// auto-combat options surfaced in the Fleet Management > Strategizer tab.
// Each one is a genuinely different answer to "where should I be standing",
// resolved by combatResolution.stanceDestination. 'fleet' is a sentinel
// rather than a behavior of its own — it means "follow whatever strategy my
// Fleet (see fleetStore.ts) currently has active" (see combatResolution's
// effectiveStrategy), which is what makes an individual ship's own choice
// able to override fleet-wide coordination: setting a ship to anything ELSE
// just stops it deferring, no separate "detached" flag needed. Never a
// player's free choice on its own — only reachable by a fleet-wide strategy
// bulk-assigning it (see shipStore.setFleetStrategy), or by the player
// re-selecting it for one ship whose fleet already has an active strategy to
// rejoin (see COMBAT_STANCES vs the Strategizer's own gating).
export type CombatStance = 'balanced' | 'swarm' | 'kite' | 'stall' | 'flee' | 'fleet'

// The stances a player can freely pick for one ship at any time — 'fleet'
// deliberately excluded, since it's only ever offered conditionally (see
// this type's own comment).
export const COMBAT_STANCES: CombatStance[] = ['balanced', 'swarm', 'kite', 'stall', 'flee']

export const STANCE_LABELS: Record<CombatStance, string> = {
  balanced: 'Balanced',
  swarm: 'Swarm',
  kite: 'Kite',
  stall: 'Stall',
  flee: 'Flee',
  fleet: 'Fleet',
}

export const STANCE_DESCRIPTIONS: Record<CombatStance, string> = {
  balanced: 'Close to just inside your longest weapon range and hold there.',
  swarm: 'Drive straight at the enemy and stay on top of them, bringing every short-ranged mount to bear.',
  kite: 'Hover at the far edge of your longest weapon range, backing off the moment they close.',
  stall: 'Break line of fire behind the nearest body and stay hidden, avoiding engagement entirely.',
  // Distinct from Stall: Stall hides (breaks line of fire and stays put,
  // still an ambush option for an armed ship); Flee just runs, which is also
  // the automatic behaviour for any ship with no weapons or none currently
  // online — see stanceDestination's own fallback.
  flee: 'Run as far from every hostile fleet as possible. Automatic for an unarmed ship, or one whose weapons are offline.',
  fleet: "Follow this ship's fleet-wide strategy.",
}

// What a Fleet itself (as opposed to one ship) can be ordered to do — the
// five ordinary stances above, bulk-applied to every member, plus three that
// only make sense as coordinated, multi-ship behavior (see
// combatResolution's divideDestination/condenseDestination/screenAssignment).
// Deliberately NOT including 'fleet' itself — a fleet strategy can't defer to
// its own fleet.
export type FleetStrategy = Exclude<CombatStance, 'fleet'> | 'divide' | 'condense' | 'screen'

export const FLEET_STRATEGIES: FleetStrategy[] = [
  'balanced',
  'swarm',
  'kite',
  'stall',
  'flee',
  'divide',
  'condense',
  'screen',
]

export const FLEET_STRATEGY_LABELS: Record<FleetStrategy, string> = {
  balanced: 'Balanced',
  swarm: 'Swarm',
  kite: 'Kite',
  stall: 'Stall',
  flee: 'Flee',
  divide: 'Divide',
  condense: 'Condense',
  screen: 'Screen',
}

export const FLEET_STRATEGY_DESCRIPTIONS: Record<FleetStrategy, string> = {
  balanced: STANCE_DESCRIPTIONS.balanced,
  swarm: STANCE_DESCRIPTIONS.swarm,
  kite: STANCE_DESCRIPTIONS.kite,
  stall: STANCE_DESCRIPTIONS.stall,
  flee: STANCE_DESCRIPTIONS.flee,
  divide: 'Split up and each take a different enemy, instead of piling onto whoever is nearest.',
  condense: "Regroup on the fleet's own center — the follow-up to Divide once a fight is won, though it works any time.",
  screen: "The toughest hulls hold a line between the fleet and the enemy; the rest hold back behind it.",
}

// Kite holds this fraction of its longest weapon's range — just inside the
// edge, so a target drifting slightly doesn't drop out of reach entirely.
export const KITE_RANGE_FRACTION = 0.92
// ...and re-positions only once separation leaves this band around it, so a
// kiting ship isn't re-planning a new route every single step.
export const KITE_TOLERANCE = 0.08
// Swarm closes to inside the SHORTEST mount's range, which is the only
// distance at which a mixed loadout actually fires everything it has.
export const SWARM_RANGE_FRACTION = 0.8
// Chase (see CombatParticipant.chasing) closes far tighter than any stance
// ever holds for — the point is running a target down, not finding an ideal
// firing distance, so this is close to point-blank rather than any weapon's
// range. The ship-separation pass (SHIP_SEPARATION_UNITS) is what actually
// stops it landing exactly on top of the target once caught.
export const CHASE_STANDOFF_UNITS = 0.6

// --- Hull speed / handling, expressed against the speed of light ----------
//
// `lightFraction` is "this hull is N times slower than light across the same
// distance"; `secondsToCruise` is how long it takes to reach that speed from
// rest (and, equivalently, to stop from it, or to reverse a turn).
//
// The slowest divisor here (13) means a Battleship needs ~60 sim-seconds to
// cross Sol's rendered diameter, against light's ~4.6 — comfortably sub-light
// at every setting, which is the whole point. It also makes tactical combat
// genuinely slower-paced than it was: closing from the 12-unit opening
// separation now takes tens of seconds rather than a handful, which is the
// intended consequence of ships no longer moving at relativistic speed.
export function hullMotion(lightDivisor: number, secondsToCruise: number) {
  const maneuverUnitsPerSecond = ARENA_LIGHT_SPEED_UNITS_PER_SECOND / lightDivisor
  return {
    maneuverUnitsPerSecond,
    accelerationUnitsPerSecondSq: maneuverUnitsPerSecond / secondsToCruise,
  }
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
    // ~86% of max range, not a short-range peak — Kite already holds at 92%
    // of a hull's longest mount (see KITE_RANGE_FRACTION), so optimal has to
    // sit near where a kiting missile boat actually fights or the falloff
    // below would gut the exact positioning Phase 10's proven scenarios rely
    // on. See missileDamageMultiplier.
    optimalRangeUnits: 9.5,
  },
  torpedoTube: {
    id: 'torpedo-tube',
    name: 'Torpedo Tube',
    damageType: 'torpedo',
    damage: 55,
    cooldownSeconds: 9,
    rangeUnits: 8,
    // Same reasoning as missileBattery's optimalRangeUnits — see
    // torpedoAccuracy.
    optimalRangeUnits: 7,
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
  sizeClass: 'small',
  components: { weapons: 20, utility: 60, core: 80 },
  defenses: { shieldHp: 40, shieldRegenPerSecond: 0.6, armorHp: 20, pointDefenseRating: 0, flakRating: 0, evasion: 0 },
  weapons: [],
  ...hullMotion(5, 4),
}

// Warship presets. Roles are differentiated by the damage-type matrix rather
// than by raw stat inflation — a Frigate loses to a Destroyer's point defense
// and beats a shield-heavy Corvette, so the counter triangle is playable
// before any tech or designer system exists to customize it. Every warship
// keeps a real FTL drive per the design brief, which also means every warship
// can attempt the charge-and-escape (see ShipCombatState.ftlCharge).
export const CORVETTE_PROFILE: CombatProfile = {
  sizeClass: 'small',
  components: { weapons: 40, utility: 60, core: 100 },
  defenses: { shieldHp: 90, shieldRegenPerSecond: 1.4, armorHp: 40, pointDefenseRating: 0.1, flakRating: 0, evasion: 0 },
  weapons: mounts(WEAPON_TYPES.autocannon, 3),
  ...hullMotion(4, 3),
}

export const FRIGATE_PROFILE: CombatProfile = {
  sizeClass: 'medium',
  components: { weapons: 60, utility: 70, core: 140 },
  defenses: { shieldHp: 60, shieldRegenPerSecond: 0.9, armorHp: 140, pointDefenseRating: 0, flakRating: 0, evasion: 0 },
  weapons: [...mounts(WEAPON_TYPES.missileBattery, 2), ...mounts(WEAPON_TYPES.autocannon, 1)],
  ...hullMotion(6, 4),
}

export const DESTROYER_PROFILE: CombatProfile = {
  sizeClass: 'medium',
  components: { weapons: 90, utility: 90, core: 200 },
  defenses: { shieldHp: 140, shieldRegenPerSecond: 1.2, armorHp: 120, pointDefenseRating: 0.55, flakRating: 0, evasion: 0 },
  weapons: [...mounts(WEAPON_TYPES.laser, 2), ...mounts(WEAPON_TYPES.massDriver, 2)],
  ...hullMotion(8, 5),
}

export const CRUISER_PROFILE: CombatProfile = {
  sizeClass: 'large',
  components: { weapons: 140, utility: 130, core: 320 },
  defenses: { shieldHp: 240, shieldRegenPerSecond: 1.8, armorHp: 260, pointDefenseRating: 0.3, flakRating: 0, evasion: 0 },
  weapons: [...mounts(WEAPON_TYPES.heavyBeam, 1), ...mounts(WEAPON_TYPES.laser, 2), ...mounts(WEAPON_TYPES.massDriver, 2)],
  ...hullMotion(10, 7),
}

// Multiple live-piloted and scripted-headless attempts at trimming these
// stats down for a fair 1v1 (first against a Destroyer, then a Cruiser — see
// the "David and Goliath" Hard scenario) all failed to find a window where
// skilled play wins reliably AND every automated stance still loses. A
// scripted "always hold point-blank range" pilot only crossed 50% wins
// against a Battleship cut by more than half — but at that same cut, the
// Swarm stance alone (zero player input) was already winning 50% of the
// time too, and needed an even deeper cut before Swarm stopped winning,
// deep enough that a "Battleship" would have less HP than a Cruiser. Swarm
// exploits a weakened Battleship harder than skilled positioning does, at
// every level tested — this is a structural property of this matchup and
// the game's weapon/damage model, not a threshold that was almost found.
// Reverted to the original values; a clean 1v1 win path against a
// full-strength Battleship needs a different fix than trimming its stats.
export const BATTLESHIP_PROFILE: CombatProfile = {
  sizeClass: 'x',
  components: { weapons: 220, utility: 190, core: 560 },
  defenses: { shieldHp: 380, shieldRegenPerSecond: 2.2, armorHp: 460, pointDefenseRating: 0.4, flakRating: 0, evasion: 0 },
  weapons: [...mounts(WEAPON_TYPES.torpedoTube, 2), ...mounts(WEAPON_TYPES.heavyBeam, 2), ...mounts(WEAPON_TYPES.massDriver, 2)],
  ...hullMotion(13, 10),
}

// --- Chaff ------------------------------------------------------------------
//
// A consumable countermeasure: a burst of decoys that makes the ship harder
// to hit for a short window. Deliberately a *miss chance applied to incoming
// fire*, not a damage reduction — the two are very different to play against.
// Damage reduction is a flat tax the attacker can out-scale; a miss chance
// makes each individual volley a coin-flip, which is what makes spending a
// charge at the right moment feel like a decision rather than a discount.
//
// Chaff is checked against the TARGET's state by the ATTACKER (see
// combatResolution's firing loop): it degrades everyone shooting at this
// hull, not this hull's own aim.
export const CHAFF_CHARGES = 2
// In SIM-seconds, which at tactical 1x is exactly 6 real seconds — the pace
// combat is authored at (see gameTimeStore's TACTICAL_DAYS_PER_SECOND).
// Stored in sim-seconds like every other combat deadline (weapon cooldowns,
// FTL charge) rather than wall-clock, so it behaves consistently if the
// player speeds tactical time up.
export const CHAFF_DURATION_SECONDS = 6
// Three shots in four simply do not connect, at any range. Deliberately
// severe: at a merely even coin-flip a countermeasure with two charges and a
// six-second life is a rounding error on a fight that runs for minutes, and
// spending one never felt like it changed anything.
//
// Flat rather than range-scaled, and that was a deliberate reversal. A
// version of this briefly fell off as the attacker closed, on the theory that
// "close the distance" made a nice counter to it — but chaff exists to help a
// ship that is LOSING, and a losing ship is very often one with enemies
// closing on it. A falloff therefore switched the tool off at exactly the
// moment it was most needed, which is precisely backwards for a comeback
// mechanic. Countermeasures are for bad odds; they don't need their own
// counter.
export const CHAFF_MISS_CHANCE = 0.75

export const CHAFF_AI_FIRST_THRESHOLD = 0.7
export const CHAFF_AI_SECOND_THRESHOLD = 0.4

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

// --- Missile / torpedo range-and-size effects -------------------------------
//
// Every direct-fire weapon (energy/kinetic) hits for full listed damage
// anywhere inside its range, exactly as before — no change there. Missiles
// and torpedoes are physical projectiles rather than a beam/slug, so it's
// physically sensible for their real-world performance to depend on distance
// too, and torpedoes specifically on how big a target they're trying to lead.
//
// Shared linear taper: full effectiveness (1.0) at or inside `optimal`,
// falling straight-line to `floor` by `maxRange`. Never below `optimal` in
// distance terms — a shot fired well inside optimal range is not further
// PENALIZED for being close (missiles/torpedoes don't need a "too close"
// mechanic nobody asked for), it's simply capped at full effect.
export function rangeEffectiveness(distance: number, optimal: number, maxRange: number, floor: number): number {
  if (distance <= optimal) return 1
  if (maxRange <= optimal) return 1
  const t = Math.min(1, (distance - optimal) / (maxRange - optimal))
  return 1 - t * (1 - floor)
}

// Missiles keep their 100% tracking (see the firing loop in
// combatResolution.ts — no accuracy roll at all for this damage type) but do
// less DAMAGE the further past their optimal range they're fired from.
export const MISSILE_FALLOFF_FLOOR = 0.6

export function missileDamageMultiplier(distance: number, weapon: WeaponMount): number {
  return rangeEffectiveness(distance, weapon.optimalRangeUnits ?? weapon.rangeUnits, weapon.rangeUnits, MISSILE_FALLOFF_FLOOR)
}

// Torpedoes are the opposite trade: fixed damage per hit, but the hit itself
// is a roll — slow projectiles that a target can out-maneuver, more easily
// the smaller and further away it is. TORPEDO_SIZE_ACCURACY keys off the
// TARGET's own HullSizeClass (see that type's own comment) rather than the
// firing ship's — a Corvette is a hard torpedo target regardless of what
// fired at it, a Battleship is an easy one.
export const TORPEDO_BASE_ACCURACY = 0.9
export const TORPEDO_RANGE_FLOOR = 0.5
export const TORPEDO_SIZE_ACCURACY: Record<HullSizeClass, number> = {
  small: 0.55,
  medium: 0.8,
  large: 1.0,
  x: 1.15,
}
// Never a certainty either way — even a dead-on shot at an X-class hull can
// whiff, and even the worst-odds shot at a jinking Corvette occasionally
// connects.
const TORPEDO_ACCURACY_MIN = 0.05
const TORPEDO_ACCURACY_MAX = 0.98

export function torpedoAccuracy(
  distance: number,
  weapon: WeaponMount,
  targetSizeClass: HullSizeClass,
  targetEvasion: number,
): number {
  const rangeFactor = rangeEffectiveness(distance, weapon.optimalRangeUnits ?? weapon.rangeUnits, weapon.rangeUnits, TORPEDO_RANGE_FLOOR)
  const raw = TORPEDO_BASE_ACCURACY * rangeFactor * TORPEDO_SIZE_ACCURACY[targetSizeClass] * (1 - Math.max(0, Math.min(1, targetEvasion)))
  return Math.max(TORPEDO_ACCURACY_MIN, Math.min(TORPEDO_ACCURACY_MAX, raw))
}

// --- Missile / torpedo travel time ------------------------------------------
//
// Energy and kinetic weapons stay pure hit-scan — a beam or a slug that's in
// range and has line of fire connects (or doesn't) the instant it fires.
// Missiles and torpedoes are physical rounds crossing real arena space, so
// they now do too: a shot fired at range takes real seconds to arrive rather
// than resolving in the same 0.1s step it launched in (see combatResolution's
// projectile-flight step). Everything ELSE about them is unchanged and still
// resolved at the moment of firing — point-defense interception, torpedo
// accuracy, chaff — only the DAMAGE is deferred until the round actually
// covers the distance, homing on wherever the target currently is each step.
// A target that dies, flees, or moves out of the fight before the round
// arrives simply isn't there to hit; nothing carries over.
//
// Torpedoes are the heavier, slower round — that's their whole design
// tension (see ramDamageAt's neighbor, torpedoAccuracy: brutal damage, hard
// to land, and now also slow to arrive once it IS launched) — missiles trade
// raw power for speed and perfect tracking.
export const MISSILE_SPEED_UNITS_PER_SECOND = 2.2
export const TORPEDO_SPEED_UNITS_PER_SECOND = 1.1

export function projectileSpeedUnitsPerSecond(damageType: 'missile' | 'torpedo'): number {
  return damageType === 'missile' ? MISSILE_SPEED_UNITS_PER_SECOND : TORPEDO_SPEED_UNITS_PER_SECOND
}

// A round counts as "arrived" once it's within this of its target's real
// position — small enough that it reads as a real impact, big enough that a
// homing round doesn't need to land on an exact float coordinate.
export const PROJECTILE_IMPACT_RADIUS_UNITS = 0.15

// --- Scuttle (the doomed-ship trade) ---------------------------------------
//
// Deliberately detonate a ship that is going to die anyway, damaging
// everything nearby — friend and foe alike, since a reactor breach has no IFF
// to check. The point is to convert a total loss into a partial trade: a hull
// about to be destroyed is worth nothing, so spending it to strip an enemy's
// armor is strictly better than letting it pop. Blowing it in the middle of
// your own formation is exactly as dangerous as doing it anywhere else — this
// is a last resort, not a free area-denial tool.
//
// Scaled by REMAINING CORE, which is the whole design tension. A healthy ship
// makes a far bigger bang (its reactor is intact), but a healthy ship is also
// one you'd rather keep — so the moment with the best payoff is never the
// moment you most want to spend it. A nearly-dead hull detonates for very
// little, which stops this from being a free "finisher" bolted onto every
// losing fight.
export const SCUTTLE_MAX_DAMAGE = 260
// Full damage at the centre, falling linearly to nothing at the edge. Sized
// against the arena's short weapon ranges (autocannon reaches 3) so a scuttle
// is a knife-range play — you have to be among them, which usually means the
// ship really was cornered.
export const SCUTTLE_BLAST_RADIUS_UNITS = 3

// Damage one scuttling hull deals to something `distanceUnits` away.
// `coreFraction` is the detonating ship's remaining core as a fraction of its
// max (see coreHealthFraction). Pure so the falloff is testable on its own.
export function scuttleDamageAt(distanceUnits: number, coreFraction: number): number {
  if (distanceUnits >= SCUTTLE_BLAST_RADIUS_UNITS) return 0
  const falloff = 1 - distanceUnits / SCUTTLE_BLAST_RADIUS_UNITS
  return SCUTTLE_MAX_DAMAGE * falloff * Math.max(0, Math.min(1, coreFraction))
}

// --- Ramming (a committed, high-speed collision) ----------------------------
//
// Unlike Scuttle (a doomed hull's guaranteed last resort), any ship — armed
// or not — can be ordered to ram: it charges straight at its target instead
// of holding its stance's usual range, and colliding deals damage to BOTH
// hulls. Lands as raw component damage (see applyRawBlast), same reasoning as
// Scuttle: a hull impact isn't a weapon, so there's no damage type for the
// matrix and nothing for point defense to intercept.
//
// Scaled by the RAMMER'S OWN CLOSING SPEED at the moment of impact, not a
// flat number — a slow bump barely scratches either hull, while a
// full-throttle charge is a real, costly commitment. This is what makes
// "build up speed, then ram" a meaningful choice rather than a button that
// always does the same thing regardless of how it was set up.
export const RAM_MAX_TARGET_DAMAGE = 240
// The rammer takes this fraction of whatever it just dealt the target — real,
// but survivable more often than not, since the target's own hull absorbs
// most of a deliberate charge. Ramming a much tougher target is still a bad
// trade: the damage dealt (and so the rammer's own share of it) depends only
// on closing speed, not on what's hit, so a Corvette ramming a Battleship
// takes the same self-damage for a proportionally much smaller dent in
// return.
export const RAM_SELF_DAMAGE_FRACTION = 0.5

// Damage dealt to the RAMMED ship, given the rammer's closing speed as a
// fraction of its own top cruise speed (0..1 — see participantSpeed and
// CombatProfile.maneuverUnitsPerSecond). Pure so the scaling is testable on
// its own, same as scuttleDamageAt.
export function ramDamageAt(closingSpeedFraction: number): number {
  return RAM_MAX_TARGET_DAMAGE * Math.max(0, Math.min(1, closingSpeedFraction))
}

// --- Tactics (short-term maneuvers, distinct from a standing CombatStance) --
//
// A CombatStance (see above) is standing doctrine — where a ship wants to be
// relative to the enemy, set before a fight and unchanged for its duration.
// A Tactic is the opposite axis: a short-term maneuver layered on top of
// whatever stance/order the ship is already running, activated (or left to
// run automatically) mid-fight for a specific moment. Every one of them can
// be set to run automatically (see ShipInstance's *Auto flags) or worked by
// hand from CombatPanel — same "auto with a manual override" relationship
// chaff countermeasures already have.
export type TacticId = 'thruster-boost' | 'shield-boost' | 'weapons-boost' | 'spin-thrust' | 'ramming'

export const TACTIC_IDS: TacticId[] = ['thruster-boost', 'shield-boost', 'weapons-boost', 'spin-thrust', 'ramming']

// Thruster Boost, Shield Boost, and Weapons Boost are the same underlying
// move — divert the grid's power toward one system at the expense of the
// others — just aimed at three different destinations (drive/shields/guns).
// Only one can ever be running at a time (see combatStore.BOOST_TACTIC_IDS
// and its own comment) for exactly that reason: there's one grid, and it can
// only be diverted one way at once. Spin Thrust and Ramming aren't part of
// this group — neither is a power-diversion trade, so both can run alongside
// whichever boost (if any) is also active.
export const BOOST_TACTIC_IDS: TacticId[] = ['thruster-boost', 'shield-boost', 'weapons-boost']

export const TACTIC_LABELS: Record<TacticId, string> = {
  'thruster-boost': 'Thruster Boost',
  'shield-boost': 'Shield Boost',
  'weapons-boost': 'Weapons Boost',
  'spin-thrust': 'Spin Thrust',
  ramming: 'Ramming',
}

// Short, fixed-width tags for the arena marker and roster row badges (see
// CombatShipMarker.tsx and CombatPanel.tsx's roster rows) — the same visual
// slot chaff's own "CHAFF" badge already occupies. Deliberately a SEPARATE
// map from TACTIC_LABELS (which is prose-length, for the builder/panel
// dropdowns) rather than truncating that on the fly. Exhaustive over every
// tactic id that exists TODAY — but both this and TACTIC_DESCRIPTIONS are
// looked up defensively (a plain `[id] ?? '???'`, never a direct index) by
// whatever renders a badge (see combatStore.activeTacticIds, which derives
// ids straight off whatever boolean fields a participant actually has): a
// future tactic added there before its entry lands here should show an
// honest "unknown" badge with no tooltip, not crash or print "undefined".
export const TACTIC_BADGE_LABELS: Record<TacticId, string> = {
  'thruster-boost': 'THRUST',
  'shield-boost': 'SHIELD',
  'weapons-boost': 'WEAPONS',
  'spin-thrust': 'SPIN',
  ramming: 'RAM',
}

export const TACTIC_DESCRIPTIONS: Record<TacticId, string> = {
  'thruster-boost':
    'Diverts power to the drive — real speed and evasion, at the cost of laser output (severely) and cannon/gun output (moderately). Stays on until cancelled.',
  'shield-boost':
    'Diverts power to the shield array — faster regeneration, at the cost of weapon output, evasion, and speed. A defensive last resort, not a free upgrade: stays on until cancelled.',
  'weapons-boost':
    'Diverts power to the weapon systems — real bonus damage across every mount, missiles and torpedoes included, at the cost of shield regeneration and speed. An offensive commitment, not a free upgrade: stays on until cancelled.',
  'spin-thrust':
    "Cuts the ship loose to tumble and jink unpredictably — harder to hit, harder to land a called shot on, but genuinely uncontrollable while it's active: no order, stance, or manual move steers it. Automatically cancels itself if it's about to drift into a body. Stays on until cancelled.",
  ramming: 'Charges straight at the target and collides with it, damaging both hulls. See CombatParticipant.ramming — unchanged, just grouped here as a tactic.',
}

// Resolves one active tactic id (see combatStore.activeTacticIds — a plain
// `string`, not the narrower TacticId, since it comes off whatever a
// participant's own boolean fields say is active) into what a badge should
// actually show — see CombatShipMarker.tsx's arena marker and CombatPanel.
// tsx's roster rows, the only two callers. A recognized id gets its real
// short tag plus a hover tooltip built from TACTIC_LABELS/TACTIC_
// DESCRIPTIONS; anything else — a future tactic added to a participant
// before this file catches up — gets an honest "???" with no tooltip rather
// than crashing or printing "undefined".
export function tacticBadge(id: string): { label: string; title?: string } {
  const known = (TACTIC_LABELS as Record<string, string | undefined>)[id]
  if (!known) return { label: '???' }
  return { label: TACTIC_BADGE_LABELS[id as TacticId], title: `${known}: ${TACTIC_DESCRIPTIONS[id as TacticId]}` }
}

// --- Thruster Boost: a toggle, until cancelled ------------------------------
//
// The inverse trade of Shield Boost: power leaves the guns for the drive
// instead of the shield array. Real, sustained speed/evasion, but a laser
// array (power-hungry, precision-focused) suffers far more than a mass
// driver or autocannon (mechanically simple, barely needs the grid at all).
export const THRUSTER_BOOST_SPEED_BONUS_FRACTION = 0.5
// Additive bonus to evasion (see DefenseProfile.evasion) while active — like
// every other evasion source, this only ever matters against a torpedo's
// accuracy roll; missiles track perfectly regardless (see torpedoAccuracy's
// own comment).
export const THRUSTER_BOOST_EVASION_BONUS = 0.2
// "Greatly" — energy weapons (lasers, heavy beams) are gutted.
export const THRUSTER_BOOST_LASER_DAMAGE_MULTIPLIER = 0.35
// "Moderately" — kinetic weapons (mass drivers, autocannons) barely need the
// power grid to begin with, so they're docked, not gutted.
export const THRUSTER_BOOST_CANNON_DAMAGE_MULTIPLIER = 0.75
// Auto Thruster Boost (see combatResolution's auto-tactics pass) engages
// whenever this ship ISN'T actively trading fire (see activeEnemyContacts) —
// closing distance, repositioning, or simply nothing in range yet, all
// moments where the weapon penalty costs nothing because there's no shot to
// take anyway — and disengages the instant it re-enters an active exchange,
// where the lost damage output would actually be missed. No threshold
// constant needed for this one: the gate is binary (engaged or not).

// --- Shield Boost: a toggle, until cancelled --------------------------------
//
// The trade is explicit in the name: everything that isn't the shield array
// gets starved to feed it — including, now, weapon output across the board
// (energy far more than kinetic, but never zero) rather than just energy
// weapons alone. That broader cut is deliberate and load-bearing: this
// engine's kinetic weapons never roll to-hit at all (see applyShot), so two
// otherwise-identical kinetic-only hulls (autocannon corvettes, say) would
// never feel an energy-only penalty — the extra regen would be a strictly
// free win for whichever one had Shield Boost on. A permanently-boosted
// hull is supposed to LOSE a straight fight against an identical
// unboosted one (verified — see combat.test.ts's "Shield Boost is a
// defensive trade, not a free upgrade" section): it's a tool for stalling,
// holding out while critically damaged, or covering a retreat, never a
// standing damage-race upgrade.
export const SHIELD_BOOST_REGEN_MULTIPLIER = 2.5
export const SHIELD_BOOST_ENERGY_DAMAGE_MULTIPLIER = 0.5
export const SHIELD_BOOST_KINETIC_DAMAGE_MULTIPLIER = 0.75
export const SHIELD_BOOST_EVASION_PENALTY = 0.2
export const SHIELD_BOOST_SPEED_PENALTY_FRACTION = 0.4
// Auto Shield Boost (see combatResolution's auto-tactics pass) is deliberately
// NOT "shields took a scratch" — per this tactic's own design (a last resort,
// not a routine buff), the AI only reaches for it in genuine trouble: this
// ship's own overall health has fallen critically low (stalling/holding out),
// or it's actively trying to leave the fight (fleeing — a standing Flee
// stance, or an FTL escape charge already spooling). Health-based engagement
// holds until recovering past the higher threshold; the fleeing trigger drops
// the instant the ship is no longer fleeing AND health is back above the
// disengage line, so a Shield-Boosted retreat doesn't snap off mid-charge.
export const SHIELD_BOOST_AI_HEALTH_ENGAGE_THRESHOLD = 0.35
export const SHIELD_BOOST_AI_HEALTH_DISENGAGE_THRESHOLD = 0.65

// --- Weapons Boost: a toggle, until cancelled -------------------------------
//
// The third destination for the same power grid Thruster Boost and Shield
// Boost divert (see BOOST_TACTIC_IDS — only one of the three can ever be
// running at once): everything goes to the guns instead. Unlike the other
// two, the bonus applies to EVERY weapon family uniformly, missiles and
// torpedoes included — those don't dodge Thruster/Shield Boost's own
// penalties because they're not power-hungry systems, but "more power to the
// guns" plausibly covers better targeting solves and faster reloads on a
// missile rack too, not just beam/rail output. The trade is real offense —
// this is meant to be a genuine damage-race upgrade for a ship that's
// winning and wants to close it out faster, unlike Shield Boost's "must
// still lose a straight fight" defensive-only design.
export const WEAPONS_BOOST_DAMAGE_MULTIPLIER = 1.4
// Multiplies shieldRegenPerSecond exactly like SHIELD_BOOST_REGEN_MULTIPLIER
// does, just in the other direction (a fraction below 1, not a multiple
// above it) — shields still regenerate while Weapons Boost is up, just
// slowly.
export const WEAPONS_BOOST_SHIELD_REGEN_MULTIPLIER = 0.4
export const WEAPONS_BOOST_SPEED_PENALTY_FRACTION = 0.3
// Auto Weapons Boost (see combatResolution's auto-tactics pass) is the
// inverse gate from Shield Boost's: it engages when this ship is HEALTHY and
// actively trading fire — a confident push to close out a fight faster —
// and backs off the instant health drops into real danger, handing the
// grid back for Shield Boost's own auto-logic to reach for instead (the
// mutual exclusion in setShieldBoost/setWeaponsBoost is what actually
// enforces only one of them winning that handoff).
export const WEAPONS_BOOST_AI_HEALTH_ENGAGE_THRESHOLD = 0.6
export const WEAPONS_BOOST_AI_HEALTH_DISENGAGE_THRESHOLD = 0.3

// --- Spin Thrust: a toggle, until cancelled ---------------------------------
//
// Genuinely uncontrollable while active — see combatResolution's movement
// step: a spin-thrusting ship's velocity is a random walk, full stop,
// overriding its stance destination, any Chase/Ram order, and even a
// player's manual holdPosition. That's the whole trade: real, unpredictable
// evasion, in exchange for giving up steering entirely. The one safety valve
// is collision — see SPIN_THRUST_COLLISION_LOOKAHEAD_SECONDS below — an
// uncontrolled ship that's about to tumble into a planet or moon has this
// switched off FOR it rather than being allowed to drift in and die, which
// wouldn't be a meaningful tactical cost, just a bug players would hate.
export const SPIN_THRUST_EVASION_BONUS = 0.3
// Chance that a shot which would have landed on the defender's explicitly
// targeted component (see CombatParticipant.targetComponent) gets diverted to
// a DIFFERENT alive component instead — "some of the damage lands elsewhere,"
// not all of it, so called shots are blunted rather than made pointless.
export const SPIN_THRUST_REDIRECT_CHANCE = 0.5
// A ship's own bulk works against how effectively it can actually "spin" —
// a Battleship corkscrewing is a much smaller, slower wobble relative to its
// own mass and turning radius than a Corvette snap-rolling, so both the
// evasion this buys (SPIN_THRUST_EVASION_BONUS) and how often a called shot
// actually gets thrown off (SPIN_THRUST_REDIRECT_CHANCE) scale down for a
// bigger hull. Reuses the same small/medium/large/x scale every slot
// size/hull size class already shares — see tacticEvasionBonus and the
// firing loop's own redirect roll for where this is actually applied.
export const SPIN_THRUST_SIZE_EFFECTIVENESS: Record<HullSizeClass, number> = {
  small: 1,
  medium: 0.75,
  large: 0.5,
  x: 0.3,
}
// Auto Spin Thrust (see combatResolution's auto-tactics pass) is gated just
// as tightly as Shield Boost's, and for the same reason: giving up steering
// is a real cost to an AI ship's own effectiveness (it can't hold range,
// chase, or disengage on purpose while spinning), so this is a desperate,
// cornered-and-taking-fire response — not a routine evasion habit. Deliberately
// NOT triggered by fleeing the way Shield Boost's is: going uncontrollable is
// actively counterproductive to a ship trying to run in a chosen direction.
export const SPIN_THRUST_AI_HEALTH_ENGAGE_THRESHOLD = 0.35
export const SPIN_THRUST_AI_HEALTH_DISENGAGE_THRESHOLD = 0.65
// How sharply the random walk can turn per combat step, in radians — bounds
// the tumble to a believable corkscrew rather than the velocity vector
// teleporting to a fresh random direction every 0.1s.
export const SPIN_THRUST_TURN_RADIANS_PER_STEP = 0.35
// How far ahead (in real seconds, at the ship's current velocity) the
// collision safety check looks before deciding a body is in the way. Short
// enough that it only trips when a collision is genuinely imminent, long
// enough that the resolver has more than one 0.1s step to actually react
// once Spin Thrust switches itself off and normal steering resumes.
export const SPIN_THRUST_COLLISION_LOOKAHEAD_SECONDS = 2
// Extra clearance added on top of a body's own collision radius for that
// same check — trips a little BEFORE the hull would actually be touching the
// body, not at the exact instant of contact.
export const SPIN_THRUST_COLLISION_CLEARANCE_UNITS = 0.5

// --- FTL transit risk modifiers ---------------------------------------------
//
// Two independent effects layer on top of a drive's own baseline risk (see
// shipData's HYPERDRIVE_BASE_LOSS_CHANCE and shipPhysics's
// hyperdriveLossChance/warpEscapeLossChance, which combine these):
//
//   - A battered core doesn't just mean the ship is close to destroyed — a
//     damaged core also complicates every FTL transit that hull attempts,
//     win or lose, in or out of combat. This applies UNIVERSALLY, to every
//     jump a damaged ship ever makes, not just ones taken under fire.
//   - Being present in a fight (an Engagement) does NOT by itself raise risk
//     — plenty of ships in a battle are outside anyone's effective range and
//     never take a shot. What matters is being ACTIVELY engaged: within
//     weapon range and line of fire of a live hostile right now (see
//     combatResolution.activeEnemyContacts) — that's the moment a drive
//     spooling up is genuinely under fire, and it's what earns the
//     (structurally larger) engagement bonus below.
//
// "Slightly" (core damage) vs. "moderately" (active engagement) per the
// design brief — the engagement bonus is intentionally the bigger of the two.

// Capped well below the engagement bonus — core damage alone should never
// make a routine jump feel as risky as fleeing a live firefight.
export const CORE_DAMAGE_MAX_RISK_BONUS = 0.15

export function coreDamageRiskBonus(coreFraction: number): number {
  return CORE_DAMAGE_MAX_RISK_BONUS * (1 - Math.max(0, Math.min(1, coreFraction)))
}

export const ACTIVE_ENGAGEMENT_RISK_BONUS = 0.2

// Warp has never carried transit risk for an ordinary, peacetime trip, and
// nothing here changes that — this baseline stays 0, and shipPhysics only
// ever consults it (via warpEscapeLossChance) at the one moment that's new:
// an FTL charge completing while the ship is fleeing combat. An ordinary
// warp order issued from the strategic map never rolls against this at all.
export const WARP_BASE_ESCAPE_LOSS_CHANCE = 0
