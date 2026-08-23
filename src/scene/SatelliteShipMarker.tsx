import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import type { ShipInstance } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { ALLEGIANCE_COLORS } from '../data/shipData'
import { satelliteOrbitLocalPosition } from './shipPhysics'
import { useGameTimeStore } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

// Same stacking constants as ShipMarker (kept local rather than shared,
// same minor-duplication tradeoff as this file's other small constants).
const STACK_STEP_PX = 14
const BASE_OFFSET_PX = { x: 4, y: -18 }

interface SatelliteShipMarkerProps {
  ship: ShipInstance
  primaryVisualRadius: number
  /** Right-click — orders the currently-selected ship (if any, and if it
   * isn't this one) to follow this ship instead of a normal move order. */
  onOrderFollow?: (targetShipId: string) => void
  /** This ship's position (0-based) among every other ship orbiting this
   * same body (every ship this component ever renders already shares one —
   * see SatelliteViewScene's orbitingShips filter) — stacks their markers
   * vertically and brings back their name labels once there's more than one
   * to distinguish (see ShipMarker's identical stackIndex/stackCount). */
  stackIndex?: number
  stackCount?: number
}

// A ship resting in orbit around the body a satellite view is currently
// showing — the "correct corresponding view" a move order to that body
// should actually be visible in, not just an abstract system-AU point that
// only system view could ever render. Same triangle-marker visual language
// as ShipMarker (system/interstellar views), and — like system view — a
// live, continuously-animated orbit (see satelliteOrbitLocalPosition), not a
// static parking spot.
export function SatelliteShipMarker({
  ship,
  primaryVisualRadius,
  onOrderFollow,
  stackIndex = 0,
  stackCount = 1,
}: SatelliteShipMarkerProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const selected = ship.id === selectedShipId
  const color = ALLEGIANCE_COLORS[ship.allegiance]

  useFrame(() => {
    if (ship.location.kind !== 'orbiting') return
    const simDays = useGameTimeStore.getState().simDays
    const pos = satelliteOrbitLocalPosition(ship.location, primaryVisualRadius, simDays)
    groupRef.current?.position.set(...pos)
  })

  return (
    <group ref={groupRef}>
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
        <div
          className={`ship-marker${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          style={
            stackIndex > 0
              ? { transform: `translate(${BASE_OFFSET_PX.x}px, ${BASE_OFFSET_PX.y - stackIndex * STACK_STEP_PX}px)` }
              : undefined
          }
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={() => selectShip(ship.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            onOrderFollow?.(ship.id)
          }}
          onWheel={forwardWheelToCanvas}
        >
          <span className="ship-marker-icon" style={{ borderBottomColor: color }} />
          {stackCount > 1 && <span className="marker-label">{ship.name}</span>}
        </div>
      </Html>
    </group>
  )
}
