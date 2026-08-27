// Single unified scale: 1 AU = UNITS_PER_AU scene units, applied identically
// to orbital distances and body radii, so positions and sizes are all
// true-to-scale relative to each other (real solar system proportions).
export const AU_IN_KM = 149_597_870
export const UNITS_PER_AU = 20

const auRadius = (km: number) => (km / AU_IN_KM) * UNITS_PER_AU

export const SUN_RADIUS_KM = 696_000
export const SUN_RADIUS = auRadius(SUN_RADIUS_KM)

// Satellite view's close-up hologram of a body — see SatelliteViewScene —
// used to render EVERY inspected body (star or planet) at one flat radius
// regardless of which one it actually was, so Sol and Earth read as the same
// size purely because nothing ever compared them. Real radius ratios span
// too wide a range to draw literally in the same view either (Sol is ~109x
// Earth's radius — rendered true-to-scale, Earth's own satellite view would
// be an invisible speck), so this compresses with the same fourth-root curve
// combatArena.arenaBodyRadius already uses for the same reason, anchored so
// Earth keeps the visual radius (3) every camera-distance constant in
// SatelliteViewScene was originally tuned against.
const SATELLITE_VISUAL_RADIUS_AT_EARTH = 3
const SATELLITE_MIN_VISUAL_RADIUS = 1.4
const SATELLITE_MAX_VISUAL_RADIUS = 9
const EARTH_RADIUS_KM_FOR_SCALE = 6371

export function satelliteVisualRadius(radiusKm: number): number {
  const scaled = SATELLITE_VISUAL_RADIUS_AT_EARTH * Math.pow(radiusKm / EARTH_RADIUS_KM_FOR_SCALE, 0.25)
  return Math.max(SATELLITE_MIN_VISUAL_RADIUS, Math.min(SATELLITE_MAX_VISUAL_RADIUS, scaled))
}

export interface PlanetData {
  name: string
  radius: number
  radiusKm: number
  massKg: number
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
  massKg: number
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
  { name: 'Mercury', radiusKm: 2439.7, massKg: 3.3011e23, auDistance: 0.387, color: '#9c9c9c', periodYears: 0.241, inclinationDeg: 7.0, ascendingNodeDeg: 48.33, phaseDeg: 45 },
  { name: 'Venus', radiusKm: 6051.8, massKg: 4.8675e24, auDistance: 0.723, color: '#e0c078', periodYears: 0.615, inclinationDeg: 3.39, ascendingNodeDeg: 76.68, phaseDeg: 120 },
  { name: 'Earth', radiusKm: 6371, massKg: 5.972e24, auDistance: 1.0, color: '#4da6ff', periodYears: 1.0, inclinationDeg: 0.0, ascendingNodeDeg: 0.0, phaseDeg: 200 },
  { name: 'Mars', radiusKm: 3389.5, massKg: 6.4171e23, auDistance: 1.524, color: '#ff6b4a', periodYears: 1.881, inclinationDeg: 1.85, ascendingNodeDeg: 49.56, phaseDeg: 10 },
  { name: 'Jupiter', radiusKm: 69911, massKg: 1.8982e27, auDistance: 5.203, color: '#e0a96d', periodYears: 11.86, inclinationDeg: 1.31, ascendingNodeDeg: 100.46, phaseDeg: 300 },
  { name: 'Saturn', radiusKm: 58232, massKg: 5.6834e26, auDistance: 9.537, color: '#e8d7a7', periodYears: 29.45, inclinationDeg: 2.49, ascendingNodeDeg: 113.67, phaseDeg: 80 },
  { name: 'Uranus', radiusKm: 25362, massKg: 8.681e25, auDistance: 19.191, color: '#7de0e0', periodYears: 84.02, inclinationDeg: 0.77, ascendingNodeDeg: 74.02, phaseDeg: 160 },
  { name: 'Neptune', radiusKm: 24622, massKg: 1.02413e26, auDistance: 30.069, color: '#5a7de0', periodYears: 164.8, inclinationDeg: 1.77, ascendingNodeDeg: 131.78, phaseDeg: 260 },
]

export const PLANETS: PlanetData[] = RAW_PLANETS.map((p) => ({
  name: p.name,
  radius: auRadius(p.radiusKm),
  radiusKm: p.radiusKm,
  massKg: p.massKg,
  orbitRadius: p.auDistance * UNITS_PER_AU,
  color: p.color,
  orbitPeriodYears: p.periodYears,
  inclinationDeg: p.inclinationDeg,
  ascendingNodeDeg: p.ascendingNodeDeg,
  phaseDeg: p.phaseDeg,
}))
