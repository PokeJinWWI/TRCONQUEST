// Starbases (both economy modes): a nation's claim on a whole star system,
// standing at the system's own primary star rather than any one world — the
// piece that lets a nation hold territory with no colonized planet in it.
// Gated behind Orbital Construction (data/techData.ts). Tuning here; rules in
// scene/starbaseLogic.ts, state in state/starbaseStore.ts.
//
// Deliberately unarmed and produces nothing of its own (see the design
// discussion this was scoped from) — it does exactly one thing, claim the
// system it stands in, and can be fought down like a ground defense
// installation (see data/defenseData.ts, the closest existing analog): armor
// divides incoming damage, integrity is its hit points, destroyed at 0.
import type { ResourceCost } from './shipyardData'

export const STARBASE_COST: ResourceCost = { alloys: 220 }
// Influence a nation pays to claim a system with a Starbase (paid when it starts
// building). Colonizing costs no influence. The player and the AI both read this.
export const STARBASE_INFLUENCE_COST = 30
// ...plus this much for every thousand light-years between the system's cluster and
// the nearest cluster the nation already stands in (its capital's, or one holding a
// Starbase of its own): nothing extra at home or where it already has a base
// (scene/starbaseLogic.starbaseInfluenceCost).
export const STARBASE_INFLUENCE_PER_KLY = 10
export const STARBASE_BUILD_DAYS = 90
export const STARBASE_INTEGRITY = 50
export const STARBASE_ARMOR = 1.5
// Hostile warships in the system grind a Starbase down at this rate, split
// over however many are present — the same shape BATTERY_DAMAGE_PER_DAY uses
// for a ground defense battery, just aimed the other way (nothing here fires
// back).
export const STARBASE_DAMAGE_PER_DAY = 25
// What losing one is worth toward war score/exhaustion (scene/peace.recordLoss)
// — a war fought entirely over empty expansion space still has to mean
// something. Roughly a well-armed warship's worth, the same "picked, not
// derived" spirit as every other number here.
export const STARBASE_LOSS_VALUE = 40

// --- Tiers (Milestone B): outpost → starbase → orbital ring ---------------------
// A Starbase grows in three tiers. A fresh build is a 'starbase' (so the numbers
// above stay its baseline and nothing already built changes); it can be upgraded
// up to an orbital ring, each tier tougher, with more module slots and — unlike
// the old unarmed Starbase — real firepower that returns fire on besiegers.
export type StarbaseTier = 'outpost' | 'starbase' | 'orbital-ring'

export interface StarbaseTierDef {
  label: string
  // A tech its owner needs to build or upgrade into this tier (the first two tiers need only Orbital Construction).
  requiresTech?: string
  // Energy the bare hull supplies (see STARBASE_MODULES energy): modules draw on it, and solar arrays and fusion reactors add to it.
  baseEnergy: number
  integrity: number
  armor: number
  moduleSlots: number
  // Damage the base returns to besieging warships per day, split over them
  // (0 for an outpost — too small to fight back).
  firepower: number
  buildDays: number
  // Cost to UPGRADE into this tier from the one below (outpost has none — it is
  // only reached by building cheap, which isn't offered yet; kept for completeness).
  upgradeCost: ResourceCost
}

export const STARBASE_TIERS: Record<StarbaseTier, StarbaseTierDef> = {
  outpost: { label: 'Outpost', baseEnergy: 2, integrity: 30, armor: 1.2, moduleSlots: 1, firepower: 0, buildDays: 60, upgradeCost: {} },
  starbase: { label: 'Starbase', baseEnergy: 4, integrity: STARBASE_INTEGRITY, armor: STARBASE_ARMOR, moduleSlots: 3, firepower: 12, buildDays: STARBASE_BUILD_DAYS, upgradeCost: { alloys: 220 } },
  'orbital-ring': { label: 'Orbital Ring', requiresTech: 'starbase-citadels', baseEnergy: 8, integrity: 220, armor: 3, moduleSlots: 12, firepower: 70, buildDays: 180, upgradeCost: { alloys: 900 } },
}

export const STARBASE_TIER_ORDER: StarbaseTier[] = ['outpost', 'starbase', 'orbital-ring']

// --- Modules ------------------------------------------------------------------
// A tier's module slots hold these. Power: every base has a small supply (the tier's `baseEnergy`); each module draws `-energy` or, for a
// generator, adds `energy`. Modules beyond the supply go OFFLINE (scene/stationPower.ts): no effect until the base is powered again.
// The numbers below are first-pass placeholders for the owner to tune.
export type StarbaseModuleType =
  | 'shipyard'
  | 'defense-battery'
  | 'missile-battery'
  | 'shield-generator'
  | 'trade-hub'
  | 'space-elevator-tether'
  | 'solar-array'
  | 'fusion-reactor'
  | 'habitat-ring'
  | 'research-lab'
  | 'refinery'

export interface StarbaseModuleDef {
  label: string
  description: string
  cost: ResourceCost
  // Energy supplied (positive, a generator) or drawn (negative).
  energy: number
  // How many one base can hold (default 1).
  max?: number
  // A tech the owner needs.
  requiresTech?: string
}

export const STARBASE_MODULES: Record<StarbaseModuleType, StarbaseModuleDef> = {
  shipyard: { label: 'Shipyard', description: 'Build and repair ships in this system; capacity scales with the base tier.', cost: { alloys: 180 }, energy: -2 },
  'defense-battery': { label: 'Gun Battery', description: 'Guns that return fire on warships besieging the base, and extra armour.', cost: { alloys: 150 }, energy: -1 },
  'missile-battery': { label: 'Missile Battery', description: 'Long-range missiles: heavier return fire on besiegers than a gun battery.', cost: { alloys: 220 }, energy: -2, requiresTech: 'missile-platforms' },
  'shield-generator': { label: 'Shield Generator', description: 'A field that soaks up siege damage: more hit points and armour.', cost: { alloys: 200 }, energy: -2, requiresTech: 'station-power-systems' },
  'trade-hub': { label: 'Trade Hub', description: 'A merchant-marine berth: adds to the nation’s interstellar freight capacity.', cost: { alloys: 120 }, energy: -1 },
  'space-elevator-tether': { label: 'Space Elevator Tether', description: 'The orbital half of a space elevator — pairs with a ground anchor below for huge fuel-free launch.', cost: { alloys: 200 }, energy: -2, max: 4, requiresTech: 'orbital-tethers' },
  'solar-array': { label: 'Solar Array', description: 'Panels that power the base.', cost: { alloys: 90 }, energy: 4, max: 4 },
  'fusion-reactor': { label: 'Fusion Reactor', description: 'A compact reactor: a great deal of power.', cost: { alloys: 260 }, energy: 10, max: 2, requiresTech: 'station-power-systems' },
  'habitat-ring': { label: 'Habitat Ring', description: 'Living quarters on the base: housing for the world below, and a steadier crew.', cost: { alloys: 240 }, energy: -3, requiresTech: 'starbase-citadels' },
  'research-lab': { label: 'Research Lab', description: 'A microgravity laboratory: research points each month (Simple mode).', cost: { alloys: 200 }, energy: -2 },
  refinery: { label: 'Refinery', description: 'A hyperium-synthesis site: where Hyperium Synthesis turns exotic matter into hyperium, in orbit.', cost: { alloys: 230 }, energy: -2, requiresTech: 'hyperium-synthesis' },
}

export const STARBASE_MODULE_ORDER: StarbaseModuleType[] = [
  'solar-array',
  'fusion-reactor',
  'shipyard',
  'defense-battery',
  'missile-battery',
  'shield-generator',
  'trade-hub',
  'space-elevator-tether',
  'habitat-ring',
  'research-lab',
  'refinery',
]

// Each defense-battery module's contribution.
export const DEFENSE_MODULE_FIREPOWER = 30
export const DEFENSE_MODULE_INTEGRITY = 40
export const DEFENSE_MODULE_ARMOR = 0.5
// A missile battery hits harder; a shield generator toughens the base.
export const MISSILE_MODULE_FIREPOWER = 55
export const SHIELD_MODULE_INTEGRITY = 70
export const SHIELD_MODULE_ARMOR = 0.8
// Interstellar (merchant-marine) capacity each trade-hub module adds to its nation.
export const TRADE_HUB_INTERSTELLAR = 2500
// Housing (millions of people) a habitat ring adds to the world beneath an orbital station, and research points a lab yields a month.
export const HABITAT_RING_HOUSING = 20
export const RESEARCH_LAB_POINTS = 5
// Build slips a shipyard module grants, by the base's tier (a ring is a real yard).
export const SHIPYARD_SLIPS_BY_TIER: Record<StarbaseTier, number> = { outpost: 1, starbase: 2, 'orbital-ring': 4 }

// A station's firepower counts toward the armed strength that holds an orbit (scene/orbitalState): one point per this much firepower
// (a ship adds one per weapon; a Defense Platform facility adds 3).
export const STATION_FIREPOWER_PER_STRENGTH = 12

// What Earth's Ring of Heaven carries when the game opens (scene/gameSetup.seedRingOfHeaven; an older save's ring is upgraded to it).
export const RING_OF_HEAVEN_MODULES: StarbaseModuleType[] = ['solar-array', 'solar-array', 'shipyard', 'defense-battery', 'missile-battery', 'trade-hub', 'space-elevator-tether', 'space-elevator-tether', 'space-elevator-tether']
