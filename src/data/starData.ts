export interface StarData {
  id: string
  name: string
  color: string
  distanceLy: number
  // Cartesian position in light-years, derived from real RA/Dec/distance
  // (equatorial coordinates), Sol at the origin.
  position: [number, number, number]
  hasSystemData: boolean
  // Real (approximate, for multi-star systems the dominant component's)
  // mass/radius — used by shipPhysics' gravity-well escape-time math, same
  // real-data-driven approach as planetData's massKg/radiusKm.
  massKg: number
  radiusKm: number
}

export const UNITS_PER_LY = 8

// A star's real (ly-scale) Cartesian position converted to interstellar-view
// scene units — shared by InterstellarScene's rendering and shipPhysics'
// travel-order math so both agree on where a star actually sits on screen.
export function starScenePosition(star: StarData): [number, number, number] {
  return [star.position[0] * UNITS_PER_LY, star.position[2] * UNITS_PER_LY, star.position[1] * UNITS_PER_LY]
}

// Real nearest-neighbor stars/systems to the Sun (within ~10 ly), positioned
// from their actual right ascension, declination, and distance.
export const STARS: StarData[] = [
  { id: 'sol', name: 'Sol', color: '#ffd27a', distanceLy: 0, position: [0, 0, 0], hasSystemData: true, massKg: 1.989e30, radiusKm: 696_000 },
  { id: 'alpha-centauri', name: 'Alpha Centauri', color: '#ffe1b0', distanceLy: 4.37, position: [-1.637, -1.362, -3.816], hasSystemData: false, massKg: 2.188e30, radiusKm: 848_000 },
  { id: 'barnards-star', name: "Barnard's Star", color: '#ff8c5a', distanceLy: 5.96, position: [-0.078, -5.94, 0.487], hasSystemData: false, massKg: 2.864e29, radiusKm: 136_000 },
  { id: 'wolf-359', name: 'Wolf 359', color: '#ff6b4a', distanceLy: 7.86, position: [-7.499, 2.15, 0.958], hasSystemData: false, massKg: 1.789e29, radiusKm: 111_000 },
  { id: 'lalande-21185', name: 'Lalande 21185', color: '#ffa15a', distanceLy: 8.31, position: [-6.519, 1.656, 4.881], hasSystemData: false, massKg: 9.146e29, radiusKm: 273_000 },
  { id: 'sirius', name: 'Sirius', color: '#bfe0ff', distanceLy: 8.66, position: [-1.618, 8.135, -2.491], hasSystemData: false, massKg: 4.017e30, radiusKm: 1_190_000 },
  { id: 'luyten-726-8', name: 'Luyten 726-8', color: '#ff7a5a', distanceLy: 8.73, position: [7.542, 3.477, -2.69], hasSystemData: false, massKg: 1.989e29, radiusKm: 97_000 },
  { id: 'ross-154', name: 'Ross 154', color: '#ff6b4a', distanceLy: 9.68, position: [1.879, -8.653, -3.911], hasSystemData: false, massKg: 5.967e29, radiusKm: 167_000 },
]
