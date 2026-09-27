// Sidereal rotation periods, in hours (negative = retrograde), for placing
// spaceports: a fast-spinning world gives launches from near its equator a
// real boost, a slow or tidally locked one gives none (scene/spaceportSites.ts).
// Solar-system values from NASA's planetary fact sheets. The star systems'
// worlds are ASSUMED (no measurements exist): Proxima b and the other close-in
// red-dwarf planets are taken as tidally locked, the rest as Earth-like days.

export const ROTATION_HOURS: Record<string, number> = {
  Mercury: 1407.6,
  Venus: -5832.5,
  Earth: 23.93,
  Luna: 655.7, // tidally locked to Earth
  Mars: 24.62,
  Phobos: 7.65, // locked to Mars, but a fast day
  Deimos: 30.3,
  Ceres: 9.07,
  Jupiter: 9.93,
  Io: 42.46,
  Europa: 85.23,
  Ganymede: 171.7,
  Callisto: 400.5,
  Saturn: 10.66,
  Titan: 382.7,
  Rhea: 108.4,
  Dione: 65.7,
  Iapetus: 1903.9,
  Uranus: -17.24,
  Neptune: 16.11,
  Triton: -141.0,
  Pluto: -153.3,
  // Assumed (see above).
  Arcadia: 26,
  'Proxima b': 268.8, // locked: one day per 11.2-day orbit
  'Proxima c': 22,
  'Proxima d': 123.6, // locked
  'Lalande 21185 d': 31,
}

const DEFAULT_ROTATION_HOURS = 24

export function rotationHours(bodyName: string): number {
  return ROTATION_HOURS[bodyName] ?? DEFAULT_ROTATION_HOURS
}

// How much an equatorial launch site is worth, 0–1: full for a day of up to
// ~30 hours, none by ~100 hours (slow or locked worlds).
export function equatorialPull(bodyName: string): number {
  const h = Math.abs(rotationHours(bodyName))
  return h <= 30 ? 1 : h >= 100 ? 0 : (100 - h) / 70
}
