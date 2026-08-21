import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import type { MoonData } from './moonData'
import { HologramBody } from './HologramBody'
import { OrbitRing } from './OrbitRing'
import { getMoonPosition } from './orbitMath'
import { useGameTimeStore, simDaysToYears } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface MoonProps {
  moon: MoonData
  selected: boolean
  onSelect: (moon: MoonData) => void
}

// Rendered as an actual hologram sphere (sized to moon.visualRadius, already
// scaled/clamped from the moon's real size relative to its planet — see
// moonData.ts) plus the usual label marker, not just a marker dot like
// planets in system view — a moon big enough to matter (Luna is a quarter of
// Earth's size) should visibly read as a body here, not just a name. Its
// true full-detail shape still only shows in its own detail view
// (MoonDetailScene), reached via "Detailed View" after selecting it.
export function Moon({ moon, selected, onSelect }: MoonProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)

  useFrame(() => {
    const simYears = simDaysToYears(useGameTimeStore.getState().simDays)
    const pos = getMoonPosition(moon, simYears)
    groupRef.current?.position.copy(pos)
  })

  return (
    <group>
      <OrbitRing radius={moon.orbitRadius} inclinationDeg={moon.inclinationDeg} ascendingNodeDeg={0} />
      <group ref={groupRef}>
        <HologramBody color={moon.color} radius={moon.visualRadius} variant="planet" onSelect={() => onSelect(moon)} />
        <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
          <div
            className={`planet-marker${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onClick={() => onSelect(moon)}
            onWheel={forwardWheelToCanvas}
          >
            <span className="marker-dot" style={{ borderColor: moon.color }} />
            <span className="marker-label">{moon.name}</span>
          </div>
        </Html>
      </group>
    </group>
  )
}
