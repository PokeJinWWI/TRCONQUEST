import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface DistanceThresholdWatcherProps {
  mode: 'min' | 'max'
  threshold: number
  onTrigger: () => void
  /** Ignore crossings for this many ms after mount (default 500). */
  graceMs?: number
  /**
   * When provided, distance is measured from the current OrbitControls
   * target instead of the world origin — needed so "zoom out to leave this
   * view" still works correctly while the camera is locked onto an object
   * that isn't at the origin (e.g. tracking Saturn in system view).
   */
  controlsRef?: React.RefObject<OrbitControlsImpl | null>
}

/**
 * Fires `onTrigger` once when the camera's distance (from the world origin,
 * or from the current OrbitControls target if `controlsRef` is given)
 * crosses `threshold` — used to hand off to the next/previous view level as
 * the user scrolls past the edge of the current one (zoom out → level up,
 * zoom in → level down), on top of the explicit click/breadcrumb navigation.
 *
 * The grace period matters because trackpad/wheel scrolling has momentum —
 * a scroll gesture that triggers a level transition can still have leftover
 * momentum ticks land on the newly-mounted scene's fresh camera right after,
 * which without a grace period could immediately trigger *another* level
 * transition the player never meant to make.
 */
export function DistanceThresholdWatcher({ mode, threshold, onTrigger, graceMs = 500, controlsRef }: DistanceThresholdWatcherProps) {
  const triggeredRef = useRef(false)
  const mountedAtRef = useRef<number | null>(null)

  useFrame(({ camera }) => {
    if (triggeredRef.current) return
    if (mountedAtRef.current === null) mountedAtRef.current = performance.now()
    if (performance.now() - mountedAtRef.current < graceMs) return

    const distance = controlsRef?.current
      ? camera.position.distanceTo(controlsRef.current.target)
      : camera.position.length()
    const crossed = mode === 'max' ? distance > threshold : distance < threshold
    if (crossed) {
      triggeredRef.current = true
      onTrigger()
    }
  })

  return null
}
