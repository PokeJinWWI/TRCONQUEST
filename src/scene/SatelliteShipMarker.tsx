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

interface SatelliteShipMarkerProps {
  ship: ShipInstance
  primaryVisualRadius: number
}

// A ship resting in orbit around the body a satellite view is currently
// showing — the "correct corresponding view" a move order to that body
// should actually be visible in, not just an abstract system-AU point that
// only system view could ever render. Same triangle-marker visual language
// as ShipMarker (system/interstellar views), and — like system view — a
// live, continuously-animated orbit (see satelliteOrbitLocalPosition), not a
// static parking spot. No name label — every ship here is, by construction,
// resting in orbit (see SatelliteViewScene's orbitingShips filter), and a
// resting orbiting fleet never shows one (see ShipMarker's isOrbiting).
export function SatelliteShipMarker({ ship, primaryVisualRadius }: SatelliteShipMarkerProps) {
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
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={() => selectShip(ship.id)}
          onWheel={forwardWheelToCanvas}
        >
          <span className="ship-marker-icon" style={{ borderBottomColor: color }} />
        </div>
      </Html>
    </group>
  )
}
