import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface CameraFocusRigProps {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  getTargetPosition: () => Vector3
  arriveDistance: number
  onArrive: () => void
  /** How quickly the camera converges on the target; higher = snappier. */
  speed?: number
}

const targetScratch = new Vector3()
const offsetScratch = new Vector3()

/**
 * Animates the camera (and OrbitControls target) toward a live object
 * position each frame — the object can be moving (an orbiting planet) since
 * getTargetPosition is re-evaluated every frame — until within
 * `arriveDistance`, then fires `onArrive` once. Mount this with a `key` tied
 * to the focused object's identity so remounting resets the "arrived" guard.
 */
export function CameraFocusRig({
  controlsRef,
  getTargetPosition,
  arriveDistance,
  onArrive,
  speed = 3.2,
}: CameraFocusRigProps) {
  const arrivedRef = useRef(false)

  useFrame(({ camera }, delta) => {
    if (arrivedRef.current) return
    const controls = controlsRef.current
    if (!controls) return

    // Snap the target to the live position exactly (no lag) — only the
    // camera's distance eases in. Lerping the target itself would leave it
    // perpetually trailing a moving planet, and since arrival is judged
    // against the true live position, a fast-enough orbit could mean the
    // camera "closes the gap" to the lagged target forever without ever
    // actually getting close to the real thing.
    targetScratch.copy(getTargetPosition())
    controls.target.copy(targetScratch)

    const t = 1 - Math.exp(-speed * delta)
    offsetScratch.copy(camera.position).sub(controls.target)
    const currentDistance = offsetScratch.length()
    const desiredDistance = currentDistance + (arriveDistance * 0.5 - currentDistance) * t
    offsetScratch.setLength(Math.max(desiredDistance, 0.001))
    camera.position.copy(controls.target).add(offsetScratch)

    controls.update()

    if (camera.position.distanceTo(targetScratch) < arriveDistance) {
      arrivedRef.current = true
      onArrive()
    }
  })

  return null
}
