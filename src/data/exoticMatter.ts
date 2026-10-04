// Starting exotic matter per nation: a decreasing function of distance from
// Sagittarius A* (the galactic centre, the origin of data/neighborhoodData's
// positions, in kly). The Sol neighbourhood (~27 kly) is at the extremely low
// end, so its humans cannot afford Warp Drive Mk I (data/warpData.ts); empires
// nearer the core can. There is no exotic matter production or mining.
import { getCountry } from './countryData'
import { NEIGHBORHOODS } from './neighborhoodData'

export const EXOTIC_AT_CORE = 360
export const EXOTIC_FALLOFF_KLY = 6
// The Republic of Venus starts slightly above the other Sol-neighbourhood nations.
export const VENUS_EXOTIC_BONUS = 1
export const VENUS_ID = 'republic-of-venus'
export const SOL_NEIGHBORHOOD_ID = 'solar-neighborhood'

export function exoticMatterAtDistance(coreDistanceKly: number): number {
  return EXOTIC_AT_CORE * Math.exp(-Math.max(0, coreDistanceKly) / EXOTIC_FALLOFF_KLY)
}

function distanceOfNeighborhood(id: string): number {
  const n = NEIGHBORHOODS.find((x) => x.id === id)
  return n ? Math.hypot(n.position[0], n.position[1]) : 0
}

// A nation or faction's starting exotic matter (whole units, at least 1). Every
// nation in the game lives in the Sol neighbourhood; a faction with no nation
// (the sandbox) gets the same.
export function startingExoticMatter(countryId: string): number {
  const base = Math.max(1, Math.round(exoticMatterAtDistance(distanceOfNeighborhood(SOL_NEIGHBORHOOD_ID))))
  return getCountry(countryId)?.id === VENUS_ID ? base + VENUS_EXOTIC_BONUS : base
}
