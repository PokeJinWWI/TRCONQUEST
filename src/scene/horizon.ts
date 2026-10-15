// Which side of a globe can be seen (pure): the markers drawn over the ground map hide themselves behind the planet's horizon.
//
// A point on the globe (a unit vector; the globe's radius is `radius`) is visible only on the camera's side of the horizon, where
// p . camera > radius. The old test compared against a fifth of that, so markers on the far side of the planet were drawn over it, at
// screen positions that are not where they stand ("buildings that are not even on the planet").
export const HORIZON_SLACK = 0.97 // a little forgiveness at the limb, so a marker there does not flicker

export function facesCamera(p: { x: number; y: number; z: number }, cam: { x: number; y: number; z: number }, radius: number): boolean {
  return p.x * cam.x + p.y * cam.y + p.z * cam.z > radius * HORIZON_SLACK
}
