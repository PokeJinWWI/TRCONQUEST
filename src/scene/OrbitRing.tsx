import { getOrbitPosition } from './orbitMath'

interface OrbitRingProps {
  radius: number
  inclinationDeg?: number
  ascendingNodeDeg?: number
}

export function OrbitRing({ radius, inclinationDeg = 0, ascendingNodeDeg = 0 }: OrbitRingProps) {
  const points: number[] = []
  const segments = 128
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2
    const p = getOrbitPosition(radius, theta, inclinationDeg, ascendingNodeDeg)
    points.push(p.x, p.y, p.z)
  }

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(points), 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#7ce8ff" transparent opacity={0.9} />
    </line>
  )
}
