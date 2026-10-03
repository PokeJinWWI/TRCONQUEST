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
// building, like a colony's).
export const STARBASE_INFLUENCE_COST = 50
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
  outpost: { label: 'Outpost', integrity: 30, armor: 1.2, moduleSlots: 1, firepower: 0, buildDays: 60, upgradeCost: {} },
  starbase: { label: 'Starbase', integrity: STARBASE_INTEGRITY, armor: STARBASE_ARMOR, moduleSlots: 3, firepower: 12, buildDays: STARBASE_BUILD_DAYS, upgradeCost: { alloys: 220 } },
  'orbital-ring': { label: 'Orbital Ring', integrity: 220, armor: 3, moduleSlots: 6, firepower: 70, buildDays: 180, upgradeCost: { alloys: 900 } },
}

export const STARBASE_TIER_ORDER: StarbaseTier[] = ['outpost', 'starbase', 'orbital-ring']

// --- Modules ------------------------------------------------------------------
// A tier's module slots hold these. One of each kind per base (no doubling up).
export type StarbaseModuleType = 'shipyard' | 'defense-battery' | 'trade-hub' | 'space-elevator-tether'

export interface StarbaseModuleDef {
  label: string
  description: string
  cost: ResourceCost
}

export const STARBASE_MODULES: Record<StarbaseModuleType, StarbaseModuleDef> = {
  shipyard: { label: 'Shipyard', description: 'Build and repair ships in this system; capacity scales with the base tier.', cost: { alloys: 180 } },
  'defense-battery': { label: 'Defense Battery', description: 'Guns that return fire on warships besieging the base, and extra armour.', cost: { alloys: 150 } },
  'trade-hub': { label: 'Trade Hub', description: 'A merchant-marine berth: adds to the nation’s interstellar freight capacity.', cost: { alloys: 120 } },
  'space-elevator-tether': { label: 'Space Elevator Tether', description: 'The orbital half of a space elevator — pairs with a ground anchor below for huge fuel-free launch.', cost: { alloys: 200 } },
}

export const STARBASE_MODULE_ORDER: StarbaseModuleType[] = ['shipyard', 'defense-battery', 'trade-hub', 'space-elevator-tether']

// Each defense-battery module's contribution.
export const DEFENSE_MODULE_FIREPOWER = 30
export const DEFENSE_MODULE_INTEGRITY = 40
export const DEFENSE_MODULE_ARMOR = 0.5
// Interstellar (merchant-marine) capacity each trade-hub module adds to its nation.
export const TRADE_HUB_INTERSTELLAR = 2500
// Build slips a shipyard module grants, by the base's tier (a ring is a real yard).
export const SHIPYARD_SLIPS_BY_TIER: Record<StarbaseTier, number> = { outpost: 1, starbase: 2, 'orbital-ring': 4 }
