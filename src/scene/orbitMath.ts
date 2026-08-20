import { MathUtils, Vector3 } from 'three'
import type { PlanetData } from './planetData'

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
  return getOrbitPosition(data.orbitRadius, angle, data.inclinationDeg, data.ascendingNodeDeg, out)
}
