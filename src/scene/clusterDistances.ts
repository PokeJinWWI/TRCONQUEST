// The distance rows of a cluster's window in the galactic view, pure: how far the
// cluster is from the core, from the selected ship and from home.
import { NEIGHBORHOODS, UNITS_PER_KLY, neighborhoodScenePosition } from '../data/neighborhoodData'

export interface DistanceRow {
  label: string
  // Thousands of light-years, or null when the ship is already inside the cluster.
  kly: number | null
}

// Where the selected ship is, for measuring: the cluster it is inside, or a point of
// galactic space (scene units) while it is out between clusters.
export type ShipPlace = { cluster: string } | { point: readonly [number, number, number] }

export function clusterCoreDistanceKly(clusterId: string): number {
  const n = NEIGHBORHOODS.find((x) => x.id === clusterId)
  return n ? Math.hypot(n.position[0], n.position[1]) : 0
}

function klyFromPoint(point: readonly [number, number, number], clusterId: string): number {
  const n = NEIGHBORHOODS.find((x) => x.id === clusterId)
  if (!n) return 0
  const at = neighborhoodScenePosition(n)
  return Math.hypot(at[0] - point[0], at[1] - point[1], at[2] - point[2]) / UNITS_PER_KLY
}

export function klyFromHome(homeClusterId: string, clusterId: string): number {
  const n = NEIGHBORHOODS.find((x) => x.id === homeClusterId)
  return n ? klyFromPoint(neighborhoodScenePosition(n), clusterId) : 0
}

// "From <ship>" and "From home" (the window is narrow: short labels), each only when it says something:
// no row for a ship that is not selected, none for home measured from home itself.
export function clusterDistanceRows(opts: { clusterId: string; homeClusterId: string | null; ship: { name: string; place: ShipPlace } | null }): DistanceRow[] {
  const rows: DistanceRow[] = []
  const { clusterId, homeClusterId, ship } = opts
  if (ship) {
    const label = `From ${ship.name}`
    if ('cluster' in ship.place) rows.push({ label, kly: ship.place.cluster === clusterId ? null : klyFromHome(ship.place.cluster, clusterId) })
    else rows.push({ label, kly: klyFromPoint(ship.place.point, clusterId) })
  }
  if (homeClusterId && homeClusterId !== clusterId) rows.push({ label: 'From home', kly: klyFromHome(homeClusterId, clusterId) })
  return rows
}

export function formatKly(kly: number | null): string {
  if (kly === null) return 'inside this cluster'
  if (kly < 0.05) return '< 0.1 kly'
  return `${kly.toFixed(1)} kly`
}
