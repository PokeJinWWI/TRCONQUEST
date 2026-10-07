// Which cluster (neighbourhood) a star, a destination or a ship is in. Pure.
// The Solar Neighbourhood's stars are hand-authored and every other cluster's are
// generated (data/galaxyGen.ts); each cluster has its OWN interstellar map, its
// stars positioned in light-years from the cluster's centre, so an interstellar
// position only means something together with its cluster. Absent = ours.
import { SOLAR_NEIGHBORHOOD_ID, clusterOfGeneratedStar } from '../data/galaxyGen'
import { NEIGHBORHOODS } from '../data/neighborhoodData'
import { getStarsForNeighborhood, type StarData } from '../data/starData'
import type { MoveDestination, ShipInstance } from '../state/shipStore'

export function clusterOfStar(starId: string): string {
  return clusterOfGeneratedStar(starId) ?? SOLAR_NEIGHBORHOOD_ID
}

export function clusterName(clusterId: string): string {
  return NEIGHBORHOODS.find((n) => n.id === clusterId)?.name ?? clusterId
}

export function isHomeCluster(clusterId: string | null | undefined): boolean {
  return (clusterId ?? SOLAR_NEIGHBORHOOD_ID) === SOLAR_NEIGHBORHOOD_ID
}

// The cluster a destination lies in, or null for one out between clusters (a
// cluster itself, or a point of galactic space).
export function clusterOfDestination(destination: MoveDestination): string | null {
  switch (destination.kind) {
    case 'body':
    case 'point':
      return clusterOfStar(destination.systemId)
    case 'star':
      return clusterOfStar(destination.starId)
    case 'interstellar-point':
      return destination.clusterId ?? SOLAR_NEIGHBORHOOD_ID
    case 'cluster':
    case 'galactic-point':
      return null
  }
}

// The cluster a ship is inside right now, or null while it is out between
// clusters (flying a galactic leg, or resting at a bare point of galactic space).
// From its order and location alone, not the clock, so callers can memoize on
// `ships`.
export function shipClusterId(ship: Pick<ShipInstance, 'order' | 'location'>): string | null {
  const order = ship.order
  if (order) {
    if (order.space === 'galactic') return null
    if (order.space === 'system') return clusterOfStar(order.systemId ?? '')
    return order.clusterId ?? SOLAR_NEIGHBORHOOD_ID
  }
  const l = ship.location
  switch (l.kind) {
    case 'orbiting':
    case 'system-point':
      return clusterOfStar(l.systemId)
    case 'star':
      return clusterOfStar(l.starId)
    case 'interstellar-point':
      return l.clusterId ?? SOLAR_NEIGHBORHOOD_ID
    case 'cluster':
      return l.clusterId
    case 'galactic-point':
      return null
  }
}

// The stars a ship can fly among where it is: its own cluster's (none out
// between clusters).
export function starsOfShipCluster(ship: Pick<ShipInstance, 'order' | 'location'>): StarData[] {
  const cluster = shipClusterId(ship)
  return cluster ? getStarsForNeighborhood(cluster) : []
}

// The distance between two clusters in thousands of light-years (0 for an unknown id).
export function klyBetweenClusters(a: string, b: string): number {
  const pa = NEIGHBORHOODS.find((n) => n.id === a)?.position
  const pb = NEIGHBORHOODS.find((n) => n.id === b)?.position
  return pa && pb ? Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) : 0
}
