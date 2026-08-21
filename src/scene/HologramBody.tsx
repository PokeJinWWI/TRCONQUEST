import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BackSide, Color, type Group, type Mesh } from 'three'
import { useGameTimeStore, simDaysToYears } from '../state/gameTimeStore'

interface HologramBodyProps {
  color: string
  radius: number
  /** Stars render with a bright glowing core instead of a dark one. */
  variant?: 'planet' | 'star'
  /** When provided, clicking anywhere on the hologram (not just its label marker) selects it. */
  onSelect?: () => void
  /** Right-click anywhere on the hologram — orders the currently-selected
   * ship (if any) here. Omitted by MoonDetailScene, since a moon isn't a
   * valid move-order target yet. */
  onOrderTo?: () => void
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

// DEFCON/HUD-style "hologram" body: a core, a sparse lat/long wireframe
// grid, a glowing dot cloud, and a fresnel rim glow — all procedural, no
// texture assets required, and in keeping with the game's vector-art style.
// Used for planets (dark, reflective-looking core) and stars (bright,
// self-luminous core) alike.
export function HologramBody({ color, radius, variant = 'planet', onSelect, onOrderTo }: HologramBodyProps) {
  const groupRef = useRef<Group>(null)
  const coreRef = useRef<Mesh>(null)
  const dotPositions = useFibonacciSphere(220, radius * 1.01)
  const accent = useMemo(() => new Color(color), [color])
  const rimUniforms = useMemo(() => ({ glowColor: { value: accent } }), [accent])
  const isStar = variant === 'star'

  useFrame(() => {
    const simYears = simDaysToYears(useGameTimeStore.getState().simDays)
    const rotation = simYears * Math.PI * 4
    if (groupRef.current) groupRef.current.rotation.y = rotation
    if (coreRef.current) coreRef.current.rotation.y = rotation * 0.6
  })

  return (
    <group>
      {/* Core — spins slightly slower, giving the grid/dots a parallax "hologram" feel */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[radius * 0.97, 48, 48]} />
        {isStar ? (
          <meshBasicMaterial color={color} />
        ) : (
          <meshStandardMaterial color="#03060a" emissive={color} emissiveIntensity={0.06} roughness={1} />
        )}
      </mesh>

      <group ref={groupRef}>
        {/* Sparse lat/long wireframe grid */}
        <mesh>
          <sphereGeometry args={[radius * 1.002, 20, 14]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.35} />
        </mesh>

        {/* Glowing dot cloud scattered across the surface */}
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dotPositions, 3]} />
          </bufferGeometry>
          <pointsMaterial
            color={color}
            size={radius * 0.05}
            sizeAttenuation
            transparent
            opacity={0.9}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </points>
      </group>

      {/* Fresnel rim glow (atmosphere-style halo, or a corona for stars) */}
      <mesh scale={isStar ? 1.25 : 1.1}>
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

      {isStar && <pointLight color={color} intensity={8} decay={2} distance={200} />}

      {/* Invisible, slightly oversized click-catcher — lets clicking directly
          on the hologram select it, not just its separate Html label marker. */}
      {onSelect && (
        <mesh
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
          onContextMenu={(e) => {
            e.stopPropagation()
            e.nativeEvent.preventDefault()
            onOrderTo?.()
          }}
          onPointerOver={() => {
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto'
          }}
        >
          <sphereGeometry args={[radius * 1.15, 24, 24]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}
