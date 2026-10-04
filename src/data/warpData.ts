// Warp drives and hyperdrives as tiers (Mk) a nation researches: a ship's drive
// is just a slot, and what it does comes from its OWNER's best Mk (fleet-wide, no
// refits). Data-only; every balance number is a named constant so it is easy to
// tune. See shipPhysics.planMove for how a ship uses them.
//
// Lore: the Sol neighbourhood's humans fly hyperdrives (hyperium); warp needs
// exotic matter, which is rarer the further from the galactic core (see
// data/exoticMatter.ts), so the humans cannot research warp at the start.

// --- Warp drive Mk I-VII ---------------------------------------------------
export const WARP_DRIVE_TECH_IDS = ['warp-drive-mk1', 'warp-drive-mk2', 'warp-drive-mk3', 'warp-drive-mk4', 'warp-drive-mk5', 'warp-drive-mk6', 'warp-drive-mk7'] as const
// Warp speed in multiples of c, per Mk.
export const WARP_SPEED_TIERS_C = [10, 20, 50, 75, 150, 271, 314] as const
// Research points (Engineering) and exotic matter (consumed) per Mk. Mk I's
// exotic cost must stay above every Sol-neighbourhood nation's starting pool.
// The research is made very expensive (WARP_MK_RP_SCALE times the base table) so
// the humans do not get warp drives for the first few decades: Mk I is ~35 years
// at the engineering research Mars starts with (labs speed it up).
export const WARP_MK_RP_BASE = [90, 140, 210, 300, 420, 580, 780] as const
export const WARP_MK_RP_SCALE = 12
export const WARP_MK_RP_COST: readonly number[] = WARP_MK_RP_BASE.map((n) => n * WARP_MK_RP_SCALE)
export const WARP_MK_EXOTIC_COST = [15, 25, 40, 65, 100, 150, 220] as const
// Generated empires this close to the galactic core (kly) start with Warp Drive Mk I.
export const WARP_MK1_RADIUS_KLY = 18
// Dual-Drive Systems: a drive module carrying both drives (Engineering).
export const DUAL_DRIVE_TECH_ID = 'dual-drive-systems'
export const DUAL_DRIVE_RP_COST = 150

// --- Hyperdrive Mk I-V -----------------------------------------------------
export const HYPERDRIVE_TECH_IDS = ['hyperdrive-mk1', 'hyperdrive-mk2', 'hyperdrive-mk3', 'hyperdrive-mk4', 'hyperdrive-mk5'] as const
// How dangerous a hyperdrive jump is: the chance of losing the ship is
//   loss = 1 - exp(-(distance / d0)^2)
// a smooth curve that is ~0 for a short hop and tends to certain loss for a long one.
// There is no range cap: a far jump is simply almost certainly fatal. d0 is the
// distance at which a jump loses 63% of ships, and it grows with the owner's
// Hyperdrive Mk.
//  - Mk I: d0 = HYPERDRIVE_D0_MK1_LY, calibrated so the Solar Neighbourhood's own
//    typical hop (its geometric-mean star-to-star distance, 9.67 ly, the reference
//    scene/jumpRisk.ts already uses) loses 50%, today's HYPERDRIVE_BASE_LOSS_CHANCE.
//  - Each Mk multiplies d0 by the same ratio, chosen so Mk V loses exactly
//    HYPERDRIVE_MK5_ANCHOR_LOSS at HYPERDRIVE_MK5_ANCHOR_LY (30% at 10,000 ly).
export const HYPERDRIVE_REFERENCE_HOP_LY = 9.67
export const HYPERDRIVE_D0_MK1_LY = HYPERDRIVE_REFERENCE_HOP_LY / Math.sqrt(Math.LN2)
export const HYPERDRIVE_MK5_ANCHOR_LY = 10000
export const HYPERDRIVE_MK5_ANCHOR_LOSS = 0.3
export const HYPERDRIVE_D0_PER_MK = Math.pow(HYPERDRIVE_MK5_ANCHOR_LY / Math.sqrt(-Math.log(1 - HYPERDRIVE_MK5_ANCHOR_LOSS)) / HYPERDRIVE_D0_MK1_LY, 1 / 4)
// Research points (Engineering) per Mk, x2.5 each; Mk I is already known at the start.
export const HYPERDRIVE_MK_RP_COST = [60, 150, 375, 940, 2350] as const
// Hyperium consumed researching each Mk (Mk I free). Building a hull still costs a flat 1.
export const HYPERDRIVE_MK_HYPERIUM_COST = [0, 3, 8, 20, 50] as const

// The highest consecutive Mk among `ids` that `researched` holds (0 = none).
function mkOf(ids: readonly string[], researched: ReadonlySet<string>): number {
  let mk = 0
  while (mk < ids.length && researched.has(ids[mk])) mk++
  return mk
}

export function warpMkOf(researched: ReadonlySet<string>): number {
  return mkOf(WARP_DRIVE_TECH_IDS, researched)
}
export function hyperdriveMkOf(researched: ReadonlySet<string>): number {
  return mkOf(HYPERDRIVE_TECH_IDS, researched)
}
// Warp speed (c) at a Mk, 0 for no warp.
export function warpSpeedCOfMk(mk: number): number {
  return mk >= 1 ? WARP_SPEED_TIERS_C[Math.min(mk, WARP_SPEED_TIERS_C.length) - 1] : 0
}
// The distance (ly) at which a jump at hyperdrive Mk `mk` loses 63% of ships.
export function hyperdriveD0Ly(mk: number): number {
  return HYPERDRIVE_D0_MK1_LY * Math.pow(HYPERDRIVE_D0_PER_MK, Math.max(1, mk) - 1)
}

// The loss chance (0..1) of an UNCHARTED jump of `distanceLy` at hyperdrive Mk
// `mk` (see the curve above); 1 with no hyperdrive at all. Rises with distance and
// falls with the Mk, for every distance.
export function hyperdriveMkLoss(mk: number, distanceLy: number): number {
  if (mk < 1) return 1
  const x = Math.max(0, distanceLy) / hyperdriveD0Ly(mk)
  return 1 - Math.exp(-x * x)
}

// Which of a hull's drives its owner can actually use: a drive only works once the
// owner has researched its Mk I. The one rule planMove, the combat escape charge
// and the automatic retreat all share.
export function usableDrives(drives: readonly { kind: 'warp' | 'hyperdrive' }[], researched: ReadonlySet<string>): { warp: boolean; hyperdrive: boolean } {
  return {
    warp: warpMkOf(researched) >= 1 && drives.some((d) => d.kind === 'warp'),
    hyperdrive: hyperdriveMkOf(researched) >= 1 && drives.some((d) => d.kind === 'hyperdrive'),
  }
}
