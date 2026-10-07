// The "Current Action" line for a ship resting in open space, pure (getShipStatusText
// in shipPhysics calls it). A ship at a point of a cluster's map used to read "In Deep
// Space" whichever cluster that was, and one waiting for its jump drive read the same.
import { SOLAR_NEIGHBORHOOD_ID } from '../data/galaxyGen'

export type OpenSpaceLocation =
  | { kind: 'interstellar-point'; position: readonly [number, number, number]; clusterId?: string }
  | { kind: 'galactic-point' }

// A cluster's entry point is the origin of its own interstellar map: where a ship
// lands on arriving there.
const ENTRY_RADIUS = 1e-6

export function isClusterEntryPoint(location: { position: readonly [number, number, number]; clusterId?: string }): boolean {
  return (location.clusterId ?? SOLAR_NEIGHBORHOOD_ID) !== SOLAR_NEIGHBORHOOD_ID && Math.hypot(location.position[0], location.position[1], location.position[2]) <= ENTRY_RADIUS
}

export function openSpaceStatus(location: OpenSpaceLocation, clusterNameOf: (clusterId: string) => string, driveWaitDays: number): string {
  const wait = driveWaitDays > 0 ? ` — waiting for the drive (${driveWaitDays.toFixed(1)}d)` : ''
  if (location.kind === 'galactic-point') return `Between clusters${wait}`
  const cluster = clusterNameOf(location.clusterId ?? SOLAR_NEIGHBORHOOD_ID)
  return isClusterEntryPoint(location) ? `At the entry point of ${cluster}${wait}` : `In ${cluster}, Deep Space${wait}`
}
