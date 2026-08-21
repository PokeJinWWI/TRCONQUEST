// Single unified scale: 1 AU = UNITS_PER_AU scene units, applied identically
// to orbital distances and body radii, so positions and sizes are all
// true-to-scale relative to each other (real solar system proportions).
export const AU_IN_KM = 149_597_870
export const UNITS_PER_AU = 20

const auRadius = (km: number) => (km / AU_IN_KM) * UNITS_PER_AU

export const SUN_RADIUS_KM = 696_000
export const SUN_RADIUS = auRadius(SUN_RADIUS_KM)

export interface PlanetData {
  name: string
  radius: number
  radiusKm: number
  orbitRadius: number
  color: string
  orbitPeriodYears: number
  inclinationDeg: number
  ascendingNodeDeg: number
  phaseDeg: number
}

interface RawPlanet {
  name: string
  radiusKm: number
  auDistance: number
  color: string
  periodYears: number
  inclinationDeg: number
  ascendingNodeDeg: number
  phaseDeg: number
}

// Orbital elements (inclination + longitude of ascending node) are real J2000
// values relative to the ecliptic, so orbit tilts are physically accurate
// (small — a few degrees at most — which is realistic; real planetary orbits
// are nearly, but not exactly, coplanar). `phaseDeg` is an arbitrary but
// fixed starting position along the orbit — fixed (not random) so any code
// (camera fly-to, minimaps, etc) can independently compute a planet's exact
// position from `data` + the current sim time alone.
const RAW_PLANETS: RawPlanet[] = [
  { name: 'Mercury', radiusKm: 2439.7, auDistance: 0.387, color: '#9c9c9c', periodYears: 0.241, inclinationDeg: 7.0, ascendingNodeDeg: 48.33, phaseDeg: 45 },
  { name: 'Venus', radiusKm: 6051.8, auDistance: 0.723, color: '#e0c078', periodYears: 0.615, inclinationDeg: 3.39, ascendingNodeDeg: 76.68, phaseDeg: 120 },
  { name: 'Earth', radiusKm: 6371, auDistance: 1.0, color: '#4da6ff', periodYears: 1.0, inclinationDeg: 0.0, ascendingNodeDeg: 0.0, phaseDeg: 200 },
  { name: 'Mars', radiusKm: 3389.5, auDistance: 1.524, color: '#ff6b4a', periodYears: 1.881, inclinationDeg: 1.85, ascendingNodeDeg: 49.56, phaseDeg: 10 },
  { name: 'Jupiter', radiusKm: 69911, auDistance: 5.203, color: '#e0a96d', periodYears: 11.86, inclinationDeg: 1.31, ascendingNodeDeg: 100.46, phaseDeg: 300 },
  { name: 'Saturn', radiusKm: 58232, auDistance: 9.537, color: '#e8d7a7', periodYears: 29.45, inclinationDeg: 2.49, ascendingNodeDeg: 113.67, phaseDeg: 80 },
  { name: 'Uranus', radiusKm: 25362, auDistance: 19.191, color: '#7de0e0', periodYears: 84.02, inclinationDeg: 0.77, ascendingNodeDeg: 74.02, phaseDeg: 160 },
  { name: 'Neptune', radiusKm: 24622, auDistance: 30.069, color: '#5a7de0', periodYears: 164.8, inclinationDeg: 1.77, ascendingNodeDeg: 131.78, phaseDeg: 260 },
]

export const PLANETS: PlanetData[] = RAW_PLANETS.map((p) => ({
  name: p.name,
  radius: auRadius(p.radiusKm),
  radiusKm: p.radiusKm,
  orbitRadius: p.auDistance * UNITS_PER_AU,
  color: p.color,
  orbitPeriodYears: p.periodYears,
  inclinationDeg: p.inclinationDeg,
  ascendingNodeDeg: p.ascendingNodeDeg,
  phaseDeg: p.phaseDeg,
}))
