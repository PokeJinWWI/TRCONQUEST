import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BackSide, Color, type Group, type Mesh } from 'three'
import type { PlanetData } from './planetData'
import { useGameTimeStore, simDaysToYears } from '../state/gameTimeStore'

interface HologramPlanetProps {
  data: PlanetData
  radius: number
}

const RIM_VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const RIM_FRAGMENT_SHADER = `
  uniform vec3 glowColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.4);
    gl_FragColor = vec4(glowColor, fresnel * 0.85);
  }
`

function useFibonacciSphere(count: number, radius: number) {
  return useMemo(() => {
    const positions = new Float32Array(count * 3)
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / Math.max(count - 1, 1)) * 2
      const r = Math.sqrt(Math.max(1 - y * y, 0))
      const theta = goldenAngle * i
      positions[i * 3] = Math.cos(theta) * r * radius
      positions[i * 3 + 1] = y * radius
      positions[i * 3 + 2] = Math.sin(theta) * r * radius
    }
    return positions
  }, [count, radius])
}

// DEFCON/HUD-style "hologram" body: a dark core, a sparse lat/long wireframe
// grid, a glowing dot cloud, and a fresnel rim glow — all procedural, no
// texture assets required, and in keeping with the game's vector-art style.
export function HologramPlanet({ data, radius }: HologramPlanetProps) {
  const groupRef = useRef<Group>(null)
  const coreRef = useRef<Mesh>(null)
  const dotPositions = useFibonacciSphere(220, radius * 1.01)
  const accent = useMemo(() => new Color(data.color), [data.color])
  const rimUniforms = useMemo(() => ({ glowColor: { value: accent } }), [accent])

  useFrame(() => {
    const simYears = simDaysToYears(useGameTimeStore.getState().simDays)
    const rotation = simYears * Math.PI * 4
    if (groupRef.current) groupRef.current.rotation.y = rotation
    if (coreRef.current) coreRef.current.rotation.y = rotation * 0.6
  })

  return (
    <group>
      {/* Dark core — spins slightly slower, giving the grid/dots a parallax "hologram" feel */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[radius * 0.97, 48, 48]} />
        <meshStandardMaterial color="#03060a" emissive={data.color} emissiveIntensity={0.06} roughness={1} />
      </mesh>

      <group ref={groupRef}>
        {/* Sparse lat/long wireframe grid */}
        <mesh>
          <sphereGeometry args={[radius * 1.002, 20, 14]} />
          <meshBasicMaterial color={data.color} wireframe transparent opacity={0.35} />
        </mesh>

        {/* Glowing dot cloud scattered across the surface */}
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dotPositions, 3]} />
          </bufferGeometry>
          <pointsMaterial
            color={data.color}
            size={radius * 0.05}
            sizeAttenuation
            transparent
            opacity={0.9}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </points>
      </group>

      {/* Fresnel rim glow (atmosphere-style halo) */}
      <mesh scale={1.1}>
        <sphereGeometry args={[radius, 32, 32]} />
        <shaderMaterial
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          side={BackSide}
          uniforms={rimUniforms}
          vertexShader={RIM_VERTEX_SHADER}
          fragmentShader={RIM_FRAGMENT_SHADER}
        />
      </mesh>
    </group>
  )
}
