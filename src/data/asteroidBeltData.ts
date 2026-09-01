// Asteroid/dust belts per system — a small, hand-authored dataset in the
// same spirit as planetData.ts: real bodies where real data exists (Sol's
// Main and Kuiper belts, Proxima Centauri's three hypothesized dust belts),
// physically-plausible invention filling the rest.
export interface AsteroidBeltData {
  name: string
  innerAU: number
  outerAU: number
  color: string
  // Which component star this belt encircles (see starData's StarComponent).
  // Omit in a single-star system, where the one star is at the barycenter;
  // required in a multi-star system so the belt draws around ITS star, not
  // the empty center between the stars.
  parentStar?: string
}

export const ASTEROID_BELTS_BY_STAR: Record<string, AsteroidBeltData[]> = {
  sol: [
    { name: 'Main Belt', innerAU: 2.2, outerAU: 3.2, color: '#8a8378' },
    { name: 'Kuiper Belt', innerAU: 30, outerAU: 50, color: '#6a7a8a' },
  ],
  'alpha-centauri': [
    // Real hypothesized dust belts around Proxima Centauri.
    { name: 'Proxima Warm Belt', innerAU: 0.35, outerAU: 0.45, color: '#9a8f7a', parentStar: 'Proxima Centauri' },
    { name: 'Proxima Cold Belt', innerAU: 1, outerAU: 4, color: '#8a8378', parentStar: 'Proxima Centauri' },
    { name: 'Proxima Outer Belt', innerAU: 8, outerAU: 10, color: '#6a7a8a', parentStar: 'Proxima Centauri' },
    { name: 'Rigil Kentaurus Belt', innerAU: 2.8, outerAU: 3.4, color: '#9a8f7a', parentStar: 'Rigil Kentaurus' },
  ],
  'barnards-star': [{ name: 'Barnard Belt', innerAU: 1, outerAU: 1.5, color: '#9a8f7a' }],
  'lalande-21185': [{ name: 'Lalande Belt', innerAU: 1.2, outerAU: 1.6, color: '#9a8f7a' }],
  'wolf-359': [{ name: 'Wolf Debris Ring', innerAU: 0.5, outerAU: 0.7, color: '#8a8378' }],
  sirius: [{ name: 'Sirius Wreckage Belt', innerAU: 8, outerAU: 12, color: '#7a7268', parentStar: 'Sirius A' }],
  'luyten-726-8': [{ name: 'Luyten Debris Belt', innerAU: 0.3, outerAU: 0.4, color: '#8a8378', parentStar: 'BL Ceti' }],
  'ross-154': [{ name: 'Ross Belt', innerAU: 0.9, outerAU: 1.2, color: '#9a8f7a' }],
}

export function getAsteroidBeltsForStar(starId: string): AsteroidBeltData[] {
  return ASTEROID_BELTS_BY_STAR[starId] ?? []
}
