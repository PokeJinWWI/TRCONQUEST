import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { OrbitRing } from './OrbitRing'
import { useGameTimeStore } from '../state/gameTimeStore'

interface ShipOrbitRingProps {
  radius: number
  inclinationDeg: number
  /** The body's own live position (e.g. shipPhysics.bodyLivePosition) — the
   * ring has to track a moving planet the same way the ship's own marker
   * does, unlike OrbitRing's other uses (a planet's ring around Sol, a
   * moon's ring in satellite view) where the center never moves on screen. */
  getCenterPosition: (simDays: number) => { x: number; y: number; z: number }
}

// One ring per (body, inclination) pair with at least one resting orbiting
// ship — not one per ship, since every ship sharing a body and inclination
// traces the exact same circle, just at a different point along it.
export function ShipOrbitRing({ radius, inclinationDeg, getCenterPosition }: ShipOrbitRingProps) {
  const groupRef = useRef<Group>(null)

  useFrame(() => {
    const simDays = useGameTimeStore.getState().simDays
    const pos = getCenterPosition(simDays)
    groupRef.current?.position.set(pos.x, pos.y, pos.z)
  })

  return (
    <group ref={groupRef}>
      <OrbitRing radius={radius} inclinationDeg={inclinationDeg} />
    </group>
  )
}
