// FTL Communications — tiers and pure delay math. Data-only, no store access,
// same "what can be researched/computed" vs. "who's actually doing it right
// now" split as combatData.ts. See src/scene/commsVisual.ts for the layer
// that actually resolves a real ship/location/tech-state into a delay, and
// techData.ts for the two tech nodes that gate the tiers below.
//
// Three tiers, cheapest (default) first:
//   - 'light': no comms tech researched yet. Signals travel at c, same as
//     every other unmodified EM transmission — a command to a fleet a few
//     light-years out takes years to arrive, and years more for word to get
//     back. This is the tier that makes the whole feature felt.
//   - 'warp': Warp Comms researched — FTL relays riding the same exotic-
//     matter field a warp drive does. Meaningfully faster, still not free.
//   - 'hyper': Hyper Comms researched — instantaneous, any distance. The
//     tier that finally removes the lag entirely.
export type CommsTier = 'light' | 'warp' | 'hyper'

export const WARP_COMMS_TECH_ID = 'warp-comms'
export const HYPER_COMMS_TECH_ID = 'hyper-comms'

// How much faster than light a Warp Comms signal travels — a balance
// judgment call, not a derived value (there's no in-fiction basis to derive
// it from). Picked so it turns a real multi-year light-speed wait into
// something on the order of days: Alpha Centauri's 4.37 ly is a 4.4-YEAR
// wait at light speed, and a ~3.2-DAY one at this multiplier.
export const WARP_COMMS_SPEED_C = 500

const SPEED_OF_LIGHT_KM_S = 299_792.458

export function commsTierFor(researched: Set<string>): CommsTier {
  if (researched.has(HYPER_COMMS_TECH_ID)) return 'hyper'
  if (researched.has(WARP_COMMS_TECH_ID)) return 'warp'
  return 'light'
}

// One-way transit time, in simDays, for a signal covering `distanceKm` at
// the given tier. Pure arithmetic — real distance in, real (if fictional-FTL)
// travel time out, no knowledge of who's sending or receiving.
export function commsDelayDaysForDistanceKm(distanceKm: number, tier: CommsTier): number {
  if (tier === 'hyper') return 0
  const effectiveSpeedKmS = tier === 'warp' ? SPEED_OF_LIGHT_KM_S * WARP_COMMS_SPEED_C : SPEED_OF_LIGHT_KM_S
  const seconds = Math.max(0, distanceKm) / effectiveSpeedKmS
  return seconds / 86_400
}
