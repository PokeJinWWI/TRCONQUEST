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
import type { ShipClass } from './shipData'

export type ResourceCost = Partial<Record<ResourceId, number>>

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
  const cost: ResourceCost = {
    alloys: Math.max(MIN_ALLOYS, Math.round(hitPointsOf(shipClass) * ALLOYS_PER_HIT_POINT)),
    energy: BASE_ENERGY + ENERGY_PER_WEAPON * shipClass.combat.weapons.length,
  }
  const warpDrives = shipClass.ftlDrives.filter((d) => d.kind === 'warp').length
  const hyperDrives = shipClass.ftlDrives.filter((d) => d.kind === 'hyperdrive')
  if (warpDrives > 0) cost.exoticMatter = EXOTIC_MATTER_PER_WARP_DRIVE * warpDrives
  if (hyperDrives.length > 0) cost.hyperium = HYPERIUM_PER_HYPERDRIVE * hyperDrives.length
  const aiNavigators = hyperDrives.filter((d) => d.kind === 'hyperdrive' && d.lossChanceOverride === 0).length
  if (aiNavigators > 0) cost.special = SPECIAL_PER_AI_NAVIGATOR * aiNavigators
  return cost
}

// --- How long it takes ----------------------------------------------------
export const BASE_BUILD_DAYS = 10
export const BUILD_DAYS_PER_ALLOY = 0.1

export function shipBuildDays(shipClass: ShipClass): number {
  const alloys = shipBuildCost(shipClass).alloys ?? MIN_ALLOYS
  return Math.round(BASE_BUILD_DAYS + alloys * BUILD_DAYS_PER_ALLOY)
}

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
  exoticMatter: 30,
  hyperium: 6,
  special: 2,
}

export const RESOURCE_INCOME_PER_MONTH: Partial<Record<ResourceId, number>> = {
  energy: 200,
  minerals: 150,
  alloys: 60,
  exoticMatter: 6,
  hyperium: 1,
}

// One income tick per in-game month — the same cadence the economy itself
// ticks at (see hooks/useEconomyTick), so the HUD's "/mo" reads honestly.
export const SIM_DAYS_PER_INCOME_TICK = 30
