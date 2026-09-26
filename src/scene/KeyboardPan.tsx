import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Spherical, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { isTypingTarget } from '../hooks/useKeyboardControls'
import { useMenuStore } from '../state/menuStore'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'

// W A S D camera movement, for every scene with an orbit camera. Which keys are
// down is tracked globally (one pair of window listeners, shared by however
// many scenes mount); each scene's <KeyboardPan> just reads it every frame.
const held = new Set<'w' | 'a' | 's' | 'd'>()
let installed = 0
let cleanup: (() => void) | null = null

const KEY_BY_CODE: Record<string, 'w' | 'a' | 's' | 'd'> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' }

function installKeys(): () => void {
  installed++
  if (installed === 1) {
    const down = (e: KeyboardEvent) => {
      const key = KEY_BY_CODE[e.code]
      if (!key || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      held.add(key)
    }
    const up = (e: KeyboardEvent) => {
      const key = KEY_BY_CODE[e.code]
      if (key) held.delete(key)
    }
    const clear = () => held.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    cleanup = () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      held.clear()
    }
  }
  return () => {
    installed--
    if (installed === 0) cleanup?.()
  }
}

// How far the camera moves per second, as a share of its distance from what
// it's looking at (so panning feels the same zoomed in or out).
const PAN_SPEED = 0.9
// How fast an orbiting camera turns, radians per second.
const ORBIT_SPEED = 1.3

interface KeyboardPanProps {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  // 'pan' slides the camera and its target across the scene (the map views);
  // 'orbit' turns the camera around the thing it's looking at (the globe and
  // arena views, where there's nothing to slide across).
  mode?: 'pan' | 'orbit'
}

const forward = new Vector3()
const right = new Vector3()
const move = new Vector3()
const offset = new Vector3()
const spherical = new Spherical()

export function KeyboardPan({ controlsRef, mode = 'pan' }: KeyboardPanProps) {
  useEffect(() => installKeys(), [])

  useFrame((state, delta) => {
    const controls = controlsRef.current
    if (!controls || held.size === 0 || !controls.enabled) return
    if (useMenuStore.getState().open || !usePlayerStore.getState().selectedCountryId) return
    const dt = Math.min(delta, 0.1)
    // Steering the camera by hand ends "lock-on" (the camera following the
    // selection) — otherwise the lock just pulls the view straight back. The
    // top-bar toggle shows it's off; click it to lock on again.
    if (useViewStore.getState().lockOnEnabled) useViewStore.setState({ lockOnEnabled: false })
    const x = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0)
    const y = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0)
    const camera = state.camera
    const target = controls.target

    if (mode === 'orbit') {
      offset.copy(camera.position).sub(target)
      spherical.setFromVector3(offset)
      spherical.theta -= x * ORBIT_SPEED * dt
      spherical.phi = Math.min(Math.PI - 0.05, Math.max(0.05, spherical.phi - y * ORBIT_SPEED * dt))
      offset.setFromSpherical(spherical)
      camera.position.copy(target).add(offset)
      return
    }

    // Pan: W is "into the scene" along the ground plane, A/D sideways.
    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) {
      // Looking straight down: "forward" is the way the camera's own up points.
      forward.set(0, 1, 0).applyQuaternion(camera.quaternion)
      forward.y = 0
    }
    forward.normalize()
    right.crossVectors(forward, camera.up).normalize()
    const distance = camera.position.distanceTo(target)
    move.set(0, 0, 0).addScaledVector(forward, y).addScaledVector(right, x)
    if (move.lengthSq() === 0) return
    move.normalize().multiplyScalar(distance * PAN_SPEED * dt)
    camera.position.add(move)
    target.add(move)
  })

  return null
}
