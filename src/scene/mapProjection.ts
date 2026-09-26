import type { SurfacePoint } from './surfaceMesh'

// The planetary map's flat (equirectangular) projection. Longitude runs east
// with the globe's own orientation (seen from outside with +y up, east is the
// viewer's right), latitude is the angle from the equator toward +y. The flat
// map is FLAT_WIDTH x FLAT_HEIGHT scene units, twice as wide as tall, centred
// on the origin.
export const FLAT_WIDTH = 40
export const FLAT_HEIGHT = 20

export function lonLatOf(p: SurfacePoint): { lon: number; lat: number } {
  return { lon: Math.atan2(-p.z, p.x), lat: Math.asin(Math.max(-1, Math.min(1, p.y))) }
}

export function fromLonLat(lon: number, lat: number): SurfacePoint {
  const c = Math.cos(lat)
  return { x: c * Math.cos(lon), y: Math.sin(lat), z: -c * Math.sin(lon) }
}

// A surface point on the flat map, `z` above the ground.
export function flatPos(p: SurfacePoint, z = 0): [number, number, number] {
  const { lon, lat } = lonLatOf(p)
  return [(lon / Math.PI) * (FLAT_WIDTH / 2), (lat / (Math.PI / 2)) * (FLAT_HEIGHT / 2), z]
}

// The surface point under a spot on the flat map (clamped to the map).
export function fromFlat(x: number, y: number): SurfacePoint {
  const lon = Math.max(-Math.PI, Math.min(Math.PI, (x / (FLAT_WIDTH / 2)) * Math.PI))
  const lat = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, (y / (FLAT_HEIGHT / 2)) * (Math.PI / 2)))
  return fromLonLat(lon, lat)
}

// Whether a straight segment between two surface points would cross the map's
// seam (the 180° meridian), so it has to be left out rather than drawn all the
// way across the map.
export function crossesSeam(a: SurfacePoint, b: SurfacePoint): boolean {
  return Math.abs(lonLatOf(a).lon - lonLatOf(b).lon) > Math.PI
}
