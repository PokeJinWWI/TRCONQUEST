import { useState } from 'react'
import { Html } from '@react-three/drei'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface FocusableMarkerProps {
  name: string
  color: string
  radius: number
  focused: boolean
  onSelect: () => void
}

// The clickable name marker for a satellite-view subject (the primary body,
// or a moon in its own detail view): a small dot+label by default, or — once
// it's the focused/inspected object — a larger label anchored above the
// hologram instead of sitting on top of it, where it'd compete visually with
// the hologram itself.
export function FocusableMarker({ name, color, radius, focused, onSelect }: FocusableMarkerProps) {
  const [hovered, setHovered] = useState(false)

  if (focused) {
    return (
      <Html position={[0, radius + 0.6, 0]} center style={{ pointerEvents: 'auto' }}>
        <div className="focused-label" onClick={onSelect} onWheel={forwardWheelToCanvas}>
          {name}
        </div>
      </Html>
    )
  }

  return (
    <Html style={{ pointerEvents: 'auto' }}>
      <div
        className={`planet-marker${hovered ? ' hovered' : ''}`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={onSelect}
        onWheel={forwardWheelToCanvas}
      >
        <span className="marker-dot" style={{ borderColor: color }} />
        <span className="marker-label">{name}</span>
      </div>
    </Html>
  )
}
