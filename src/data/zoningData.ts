// Tuning for zones (scene/zoning.ts): the ground a district is allowed to grow into, drawn by the player, and the land-use law
// that decides whether it may grow into untouched (rural) land.

// 'free'        a zone may grow into rural land at once
// 'permit'      each growth into rural land is a request the government approves after a delay
// 'restricted'  no growth into rural land; zones can only be redrawn among the ground they hold
export type LandUsePolicy = 'free' | 'permit' | 'restricted'
export const LAND_USE_POLICIES: LandUsePolicy[] = ['free', 'permit', 'restricted']
export const DEFAULT_LAND_USE_POLICY: LandUsePolicy = 'free'

export const LAND_USE_LABEL: Record<LandUsePolicy, string> = { free: 'Free expansion', permit: 'Permit required', restricted: 'Restricted' }
export const LAND_USE_TEXT: Record<LandUsePolicy, string> = {
  free: 'Districts may expand into untouched rural land without asking.',
  permit: 'Each expansion into rural land is a request the government approves, and it takes time.',
  restricted: 'Districts may not expand into rural land at all; zones can only be redrawn on ground they already hold.',
}

// Days a permit request waits before it is decided.
export const PERMIT_DAYS = 45

// A zone never holds more cells than this (the ground map is not infinite), and the paint brush covers at most this radius in cells.
export const MAX_ZONE_CELLS = 400
export const MAX_BRUSH_CELLS = 6
