import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { AsteroidBeltData } from '../data/asteroidBeltData'
import { UNITS_PER_AU } from './planetData'

interface AsteroidBeltProps {
  data: AsteroidBeltData
}

const PARTICLE_COUNT = 900

// A deterministic scatter of points in the belt's annulus — same "fixed, not
// random per render" spirit as planetData's phaseDeg: a seeded generator
// (not Math.random) so the belt's shape is stable across re-renders instead
// of reshuffling.
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function AsteroidBelt({ data }: AsteroidBeltProps) {
  const geometry = useMemo(() => {
    const rng = seededRandom(data.name.length * 7919 + Math.round(data.innerAU * 1000))
    const innerRadius = data.innerAU * UNITS_PER_AU
    const outerRadius = data.outerAU * UNITS_PER_AU
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = rng() * Math.PI * 2
      const radius = innerRadius + rng() * (outerRadius - innerRadius)
      const thickness = (rng() - 0.5) * (outerRadius - innerRadius) * 0.08
      positions[i * 3] = Math.cos(angle) * radius
      positions[i * 3 + 1] = thickness
      positions[i * 3 + 2] = Math.sin(angle) * radius
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geo
  }, [data.name, data.innerAU, data.outerAU])

  return (
    <points geometry={geometry}>
      <pointsMaterial color={data.color} size={0.35} sizeAttenuation transparent opacity={0.6} />
    </points>
  )
}
