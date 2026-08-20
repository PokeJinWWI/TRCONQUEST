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
  /** Force arrival after this many ms regardless of distance (default 2500). */
  maxFlightMs?: number
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
  maxFlightMs = 2500,
}: CameraFocusRigProps) {
  const arrivedRef = useRef(false)
  const startedAtRef = useRef<number | null>(null)

  useFrame(({ camera }, delta) => {
    if (arrivedRef.current) return
    const controls = controlsRef.current
    if (!controls) return
    if (startedAtRef.current === null) startedAtRef.current = performance.now()

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

    // Even with an exact (non-lagging) target, a fast-orbiting body — inner
    // planets at high game speed, in particular Mercury — can keep the
    // instantaneous offset from ever quite dipping under `arriveDistance`,
    // since each frame's "new" offset partly reflects how far the target
    // itself moved, not just how far the camera closed in. Rather than
    // chase a perfect closed-form solution for every possible orbital
    // speed, just guarantee the flight always completes within a bounded
    // real-world time — this is what actually fixes "Detailed View only
    // works when the planet happens to be moving toward the camera."
    const closeEnough = camera.position.distanceTo(targetScratch) < arriveDistance
    const timedOut = performance.now() - startedAtRef.current > maxFlightMs
    if (closeEnough || timedOut) {
      arrivedRef.current = true
      onArrive()
    }
  })

  return null
}
