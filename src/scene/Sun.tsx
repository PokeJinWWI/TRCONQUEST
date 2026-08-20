import { useState } from 'react'
import { Html } from '@react-three/drei'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface SunProps {
  selected: boolean
  onSelect: () => void
}

export function Sun({ selected, onSelect }: SunProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <group>
      <pointLight color="#fff4d6" intensity={4000} decay={2} distance={2000} />
      <Html style={{ pointerEvents: 'auto' }}>
        <div
          className={`planet-marker${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={onSelect}
          onWheel={forwardWheelToCanvas}
        >
          <span className="marker-dot sun-dot" />
          <span className="marker-label">Sol</span>
        </div>
      </Html>
    </group>
  )
}
