// Tuning for territorial claims (scene/claims.ts, scene/jurisdiction.ts).

// A settlement-based claim covers its anchor site and every development location of
// the same body within this many fine cells of it (see scene/surfaceMesh.fineSpacingRad).
// It never reaches past the body: a colony does not claim a system.
export const SETTLEMENT_CLAIM_RADIUS_CELLS = 12
