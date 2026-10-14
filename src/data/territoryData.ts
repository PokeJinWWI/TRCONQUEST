// Tuning for territorial claims (scene/claims.ts, scene/jurisdiction.ts).

// A settlement-based claim covers its anchor site and every development location of
// the same body within this many fine cells of it (see scene/surfaceMesh.fineSpacingRad).
// It never reaches past the body: a colony does not claim a system.
export const SETTLEMENT_CLAIM_RADIUS_CELLS = 12

// The Control tab's share of a world (scene/controlShare.ts): how much each kind of presence counts. Each is a nation's fraction of
// everything there of that kind; a kind nobody has on the world drops out and the rest are scaled up.
export const CONTROL_WEIGHTS = { population: 0.4, sites: 0.25, ground: 0.2, orbit: 0.15 } as const
// An orbital station counts as this many armed ships in orbit.
export const STATION_ORBIT_FORCE = 2
