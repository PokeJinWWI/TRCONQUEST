// Ship construction: what a hull costs in strategic resources, how long it
// takes, and the PLACEHOLDER supply that feeds the player's stockpile.
// Data-only, no store access — same split as combatData.ts/commsData.ts. See
// scene/shipyardLogic.ts for the pure queue/affordability logic and
// state/shipyardStore.ts for the build queue itself.
//
// Everything numeric in this file is a CONVENIENCE PICK, not a balance
// decision: the goal for now is "a player with no console can get ships and
// the resource chain is visibly real," with rarity (especially hyperium and
// exotic matter) to be fine-tuned later. Change the constants, not the
// formulas, when tuning.
import type { ResourceId } from './resourceData'
import type { GoodId } from '../economy/goods'
import type { ShipClass } from './shipData'

export type ResourceCost = Partial<Record<ResourceId, number>>
// A hull's cost in Complex-economy goods (drawn from the nation's capital
// stockpile). See complexShipBuildCost.
export type GoodCost = Partial<Record<GoodId, number>>

// --- What a hull costs ----------------------------------------------------
//
// Derived from what a hull actually IS rather than hand-authored per class,
// so a player-designed hull (see shipDesignStore) gets a sensible price for
// free and a new preset never needs a cost table entry:
//   - alloys       structure — scales with total hit points ("the structural
//                  material every ship hull is actually built from")
//   - energy       weapons and powered systems — flat base + per weapon mount
//   - exoticMatter one charge per warp drive ("fuels warp drives")
//   - hyperium     one indivisible unit per hyperdrive ("can't be
//                  subdivided — makes every hyperdrive hull valuable")
//   - special      a hull whose drive never fails (an AI navigator — the
//                  Turing Scout) needs one rare one-off core
export const ALLOYS_PER_HIT_POINT = 0.1
export const MIN_ALLOYS = 10
export const BASE_ENERGY = 20
export const ENERGY_PER_WEAPON = 15
export const EXOTIC_MATTER_PER_WARP_DRIVE = 5
export const HYPERIUM_PER_HYPERDRIVE = 1
export const SPECIAL_PER_AI_NAVIGATOR = 1

function hitPointsOf(shipClass: ShipClass): number {
  const { components, defenses } = shipClass.combat
  return components.weapons + components.utility + components.core + defenses.shieldHp + defenses.armorHp
}

export function shipBuildCost(shipClass: ShipClass): ResourceCost {
  // A hull cheaper or dearer than its hit points imply (the scouts) scales alloys
  // and energy only: the drive's hyperium and special core are never discounted.
  const factor = shipClass.buildCostFactor ?? 1
  const cost: ResourceCost = {
    alloys: Math.max(MIN_ALLOYS, Math.round(hitPointsOf(shipClass) * ALLOYS_PER_HIT_POINT * factor)),
    energy: Math.round((BASE_ENERGY + ENERGY_PER_WEAPON * shipClass.combat.weapons.length) * factor),
  }
  const warpDrives = shipClass.ftlDrives.filter((d) => d.kind === 'warp').length
  const hyperDrives = shipClass.ftlDrives.filter((d) => d.kind === 'hyperdrive')
  if (warpDrives > 0) cost.exoticMatter = EXOTIC_MATTER_PER_WARP_DRIVE * warpDrives
  if (hyperDrives.length > 0) cost.hyperium = HYPERIUM_PER_HYPERDRIVE * hyperDrives.length
  const aiNavigators = hyperDrives.filter((d) => d.kind === 'hyperdrive' && d.lossChanceOverride === 0).length
  if (aiNavigators > 0) cost.special = SPECIAL_PER_AI_NAVIGATOR * aiNavigators
  return cost
}

// --- What a hull costs in Complex mode ------------------------------------
//
// In Complex mode the military shipyard draws REAL economy goods from the
// nation's capital WAR-MATERIALS stockpile instead of the abstract strategic
// pool. The cost is the same hull-derived quantities, re-expressed in storable
// economy goods (electricity is a flow good, not stockpiled — the shipyard's
// power is assumed from the grid):
//   alloys → alloys      exoticMatter → exoticMatter      hyperium → hyperium
//   special (AI-navigator core) → exoticMatter
// plus two goods the strategic pool never tracked but a real hull obviously
// needs: STEEL (structure alongside alloys) and ROCKET FUEL (propellant, scaled
// by the FTL drives aboard). Quantities are convenience picks, same as above.
export const STEEL_PER_ALLOY = 0.6
export const ROCKET_FUEL_BASE = 8
export const ROCKET_FUEL_PER_FTL_DRIVE = 6

export function complexShipBuildCost(shipClass: ShipClass): GoodCost {
  const strategic = shipBuildCost(shipClass)
  const alloys = strategic.alloys ?? 0
  const ftlDrives = shipClass.ftlDrives.length
  const cost: GoodCost = {
    alloys,
    steel: Math.round(alloys * STEEL_PER_ALLOY),
    rocketFuel: ROCKET_FUEL_BASE + ROCKET_FUEL_PER_FTL_DRIVE * ftlDrives,
  }
  // Warp → exotic matter; the rare AI-navigator core folds into exotic matter too.
  const exotic = (strategic.exoticMatter ?? 0) + (strategic.special ?? 0)
  if (exotic > 0) cost.exoticMatter = exotic
  if (strategic.hyperium) cost.hyperium = strategic.hyperium
  return cost
}

// Complex mode: the standing war-materials stockpile each nation keeps at its
// capital. The economy buys these off its own market toward the target (so a
// nation that can't make alloys/steel can't sustain a navy); the shipyard draws
// them down. Also injected at game start so a starting navy is buildable from
// turn one. Includes a little hyperium — every hyperdrive hull needs one, and the
// near-Sol nations have the Hyperium Synthesis Plant by default to make more.
// Exotic matter is NOT kept by default (only player-designed warp hulls need it,
// a midgame choice): a nation raises its target once it builds the plant.
export const MILITARY_STOCKPILE_TARGET: GoodCost = { alloys: 600, steel: 360, rocketFuel: 300, hyperium: 12 }

// --- How long it takes ----------------------------------------------------
export const BASE_BUILD_DAYS = 10
export const BUILD_DAYS_PER_ALLOY = 0.1

export function shipBuildDays(shipClass: ShipClass): number {
  const alloys = shipBuildCost(shipClass).alloys ?? MIN_ALLOYS
  return Math.round(BASE_BUILD_DAYS + alloys * BUILD_DAYS_PER_ALLOY)
}

// An upgrade (scene/shipUpgrade.ts) holds a slip for this share of the NEW level's build
// time. Its cost is the build-cost difference between the two levels (no number of its own).
export const UPGRADE_DURATION_FACTOR = 0.5

// Repairing a damaged ship at a shipyard (scene/shipRepair.ts): it holds a slip for
// REPAIR_DAYS_FACTOR of its build time scaled by how damaged it is, and costs that
// share of REPAIR_COST_FACTOR x its build cost (energy and alloys only).
export const REPAIR_DAYS_FACTOR = 0.5
export const REPAIR_COST_FACTOR = 0.25

// --- The shipyard itself --------------------------------------------------
//
// Ships are built at the player's capital. Capacity is how many hulls can be
// under construction at once: a free baseline (the capital's own drydock, so
// no nation is locked out of ships by the state of its economy sim) plus
// one slot per level of Spaceyard building on the capital world (see
// economy recipes.ts — Mars starts with one). Build more Spaceyards in
// Economy > Construction to raise it.
export const SHIPYARD_FREE_SLOTS = 1
export const SLOTS_PER_SPACEYARD_LEVEL = 1
export const SPACEYARD_RECIPE_ID = 'spaceyard'
// Bound on waiting orders so the queue stays a legible list, not a dump.
export const MAX_QUEUED_BUILDS = 12

// --- Placeholder supply ---------------------------------------------------
//
// No production chain feeds the strategic stockpile yet (see resourceStore —
// it started life all-zero for exactly that reason), so until one does, the
// player gets a flat starting reserve and a flat monthly trickle. Rarity is
// deliberately tiered the way resourceData describes it: alloys/energy are
// plentiful, exotic matter is scarce, hyperium is a rare handful, and
// special is a one-off. Fine-tune these later.
export const STARTING_STOCKPILE: Partial<Record<ResourceId, number>> = {
  energy: 600,
  minerals: 300,
  alloys: 400,
  // Exotic matter is per nation and falls with distance from the galactic core
  // (data/exoticMatter.startingExoticMatter), and hyperium is scarce and only near
  // Sol (data/hyperium.ts): both are set in seedStrategicResources, not here.
  special: 2,
}

export const RESOURCE_INCOME_PER_MONTH: Partial<Record<ResourceId, number>> = {
  energy: 200,
  minerals: 150,
  alloys: 60,
  // No flat income of either: hyperium and exotic matter come only from the natural
  // deposits a nation owns and draws (scene/extraction.ts) and, for hyperium, from
  // refining exotic matter (Hyperium Synthesis).
  exoticMatter: 0,
  hyperium: 0,
}

// One income tick per in-game month — the same cadence the economy itself
// ticks at (see hooks/useEconomyTick), so the HUD's "/mo" reads honestly.
export const SIM_DAYS_PER_INCOME_TICK = 30
