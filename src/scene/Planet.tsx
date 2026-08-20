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
}

export function Planet({ data, selected, onSelect }: PlanetProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)

  useFrame(() => {
    const simYears = simDaysToYears(useGameTimeStore.getState().simDays)
    const pos = getPlanetPosition(data, simYears)
    groupRef.current?.position.copy(pos)
  })

  return (
    <group>
      <OrbitRing
        radius={data.orbitRadius}
        inclinationDeg={data.inclinationDeg}
        ascendingNodeDeg={data.ascendingNodeDeg}
      />
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[data.radius, 24, 24]} />
          <meshStandardMaterial
            color={data.color}
            emissive={data.color}
            emissiveIntensity={0.5}
          />
        </mesh>
        <Html style={{ pointerEvents: 'auto' }}>
          <div
            className={`planet-marker${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onClick={() => onSelect(data.name)}
            onWheel={forwardWheelToCanvas}
          >
            <span className="marker-dot" style={{ borderColor: data.color }} />
            <span className="marker-label">{data.name}</span>
          </div>
        </Html>
      </group>
    </group>
  )
}
