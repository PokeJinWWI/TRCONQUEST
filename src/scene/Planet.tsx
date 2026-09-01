import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import type { PlanetData } from './planetData'
import { OrbitRing } from './OrbitRing'
import { getPlanetPosition } from './orbitMath'
import { useGameTimeStore, simDaysToYears } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface PlanetProps {
  data: PlanetData
  selected: boolean
  onSelect: (name: string) => void
  /** Right-click — orders the currently-selected ship (if any) here. */
  onOrderTo?: (name: string) => void
  /** Active map mode's color for this planet (see mapModeColor.ts) — replaces
   * `data.color` for the mesh and marker dot when set. Undefined (no map
   * mode active) falls back to the planet's own natural color. */
  colorOverride?: string
}

export function Planet({ data, selected, onSelect, onOrderTo, colorOverride }: PlanetProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const displayColor = colorOverride ?? data.color

  useFrame(() => {
    const simYears = simDaysToYears(useGameTimeStore.getState().simDays)
    const pos = getPlanetPosition(data, simYears)
    groupRef.current?.position.copy(pos)
  })

  return (
    <group>
      {/* The orbit ring is centered on the planet's parent star, which in a
          multi-star system is offset from the barycenter (see
          PlanetData.centerOffset) — a no-op [0,0,0] in a single-star system.
          The orbiting mesh below is already offset via getPlanetPosition. */}
      <group position={data.centerOffset}>
        <OrbitRing
          radius={data.orbitRadius}
          inclinationDeg={data.inclinationDeg}
          ascendingNodeDeg={data.ascendingNodeDeg}
        />
      </group>
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[data.radius, 24, 24]} />
          <meshStandardMaterial
            color={displayColor}
            emissive={displayColor}
            emissiveIntensity={0.5}
          />
        </mesh>
        <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
          <div
            className={`planet-marker${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onClick={() => onSelect(data.name)}
            onContextMenu={(e) => {
              e.preventDefault()
              onOrderTo?.(data.name)
            }}
            onWheel={forwardWheelToCanvas}
          >
            <span className="marker-dot" style={{ borderColor: displayColor }} />
            <span className="marker-label">{data.name}</span>
          </div>
        </Html>
      </group>
    </group>
  )
}
