import { useState } from 'react'
import { Html } from '@react-three/drei'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface SunProps {
  selected: boolean
  onSelect: () => void
  /** Right-click — orders the currently-selected ship (if any) here. */
  onOrderTo?: () => void
  /** The system's own star name/color — defaults to Sol's so every existing
   * call site keeps rendering exactly as before. */
  name?: string
  color?: string
  /** Scene-unit position — nonzero for a component star in a multi-star
   * system (see starData's StarComponent). Defaults to the origin. */
  position?: [number, number, number]
}

export function Sun({ selected, onSelect, onOrderTo, name = 'Sol', color = '#fff4d6', position = [0, 0, 0] }: SunProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <group position={position}>
      <pointLight color={color} intensity={4000} decay={2} distance={2000} />
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
          <span className="marker-label">{name}</span>
        </div>
      </Html>
    </group>
  )
}
