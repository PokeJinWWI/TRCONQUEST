import { MathUtils, Vector3 } from 'three'
import type { PlanetData } from './planetData'
import type { MoonData } from './moonData'

const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)

/**
 * Position on a circular orbit of the given radius/angle, tilted by orbital
 * inclination (about the line of nodes) and rotated by the longitude of the
 * ascending node (about the reference "up" axis) — a simplified but
 * physically-motivated construction of a real orbital plane.
 */
export function getOrbitPosition(
  orbitRadius: number,
  angle: number,
  inclinationDeg: number,
  ascendingNodeDeg: number,
  out = new Vector3(),
): Vector3 {
  out.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius)
  out.applyAxisAngle(X_AXIS, MathUtils.degToRad(inclinationDeg))
  out.applyAxisAngle(Y_AXIS, MathUtils.degToRad(ascendingNodeDeg))
  return out
}

export function angleForYear(simYears: number, periodYears: number, phase: number): number {
  return phase + (simYears / periodYears) * Math.PI * 2
}

/**
 * A planet's exact live position, derived purely from its data + the current
 * sim time — no per-component state needed, so anything (the orbiting mesh,
 * a camera fly-to rig, a minimap) can independently compute where a planet
 * actually is right now.
 */
export function getPlanetPosition(data: PlanetData, simYears: number, out = new Vector3()): Vector3 {
  const angle = angleForYear(simYears, data.orbitPeriodYears, MathUtils.degToRad(data.phaseDeg))
  getOrbitPosition(data.orbitRadius, angle, data.inclinationDeg, data.ascendingNodeDeg, out)
  // Shift the whole orbit onto the planet's parent star, which in a
  // multi-star system sits away from the barycenter (see PlanetData.
  // centerOffset). [0,0,0] for a single-star system, so this is a no-op there.
  out.x += data.centerOffset[0]
  out.y += data.centerOffset[1]
  out.z += data.centerOffset[2]
  return out
}

// Real moon orbital periods (hours to a couple weeks) are far too fast to
// animate at the same accelerated day-scale the rest of the sim uses — a
// full Phobos orbit would take a fraction of a second and look like a
// flicker. MOON_TIME_DILATION stretches moon orbits by a fixed factor so
// they stay tied to the game clock (pausing/speeding up still affects them,
// consistently with everything else) while remaining visually legible —
// relative speed differences between moons (closer = faster) are preserved.
export const MOON_TIME_DILATION = 60

export function getMoonPosition(moon: MoonData, simYears: number, out = new Vector3()): Vector3 {
  const effectivePeriodYears = (moon.periodDays * MOON_TIME_DILATION) / 365.25
  const direction = moon.retrograde ? -1 : 1
  const angle = angleForYear(simYears * direction, effectivePeriodYears, MathUtils.degToRad(moon.phaseDeg))
  return getOrbitPosition(moon.orbitRadius, angle, moon.inclinationDeg, 0, out)
}
