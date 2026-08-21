import { useState } from 'react'
import { Html } from '@react-three/drei'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface SunProps {
  selected: boolean
  onSelect: () => void
  /** Right-click — orders the currently-selected ship (if any) here. */
  onOrderTo?: () => void
}

export function Sun({ selected, onSelect, onOrderTo }: SunProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <group>
      <pointLight color="#fff4d6" intensity={4000} decay={2} distance={2000} />
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
        <div
          className={`planet-marker${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={onSelect}
          onContextMenu={(e) => {
            e.preventDefault()
            onOrderTo?.()
          }}
          onWheel={forwardWheelToCanvas}
        >
          <span className="marker-dot sun-dot" />
          <span className="marker-label">Sol</span>
        </div>
      </Html>
    </group>
  )
}
