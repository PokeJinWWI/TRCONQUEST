import { useFrame } from '@react-three/fiber'
import type { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface SelectionTrackerProps {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  getPosition: () => Vector3
  /** How quickly the target eases toward the live position; higher = snappier. */
  speed?: number
}

/**
 * Eases OrbitControls' target toward a live (possibly moving) object position
 * every frame, while leaving user input fully enabled — this is the "camera
 * lock" once a body is focused: the object stays centered no matter how the
 * player zooms/orbits/pans from there. Since the easing runs continuously
 * (not just on a one-off transition), switching to a new target — or engaging
 * the lock in the first place — smoothly pans from wherever the camera was
 * already looking, rather than snapping. Runs at priority -2 so the target is
 * fresh before drei's OrbitControls applies it (priority -1).
 */
export function SelectionTracker({ controlsRef, getPosition, speed = 4 }: SelectionTrackerProps) {
  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!controls) return
    const t = 1 - Math.exp(-speed * delta)
    controls.target.lerp(getPosition(), t)
  }, -2)

  return null
}
