import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import type { ShipInstance } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { ALLEGIANCE_COLORS } from '../data/shipData'
import { getShipRenderPosition } from './shipPhysics'
import { useGameTimeStore } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface ShipMarkerProps {
  ship: ShipInstance
}

// A spawned ship's marker — a triangle instead of the celestial-body dot, so
// ships read as distinct from planets/stars at a glance. Position is a pure
// function of simDays (getShipRenderPosition), same as planets/moons — no
// accumulated per-frame movement. Noticing an order has finished and
// settling the ship into its resting location is handled globally by
// useShipOrderSettler, not here — this marker isn't guaranteed to be mounted
// in every view a ship's order could complete in (see that hook's comment).
export function ShipMarker({ ship }: ShipMarkerProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const color = ALLEGIANCE_COLORS[ship.allegiance]
  const selected = ship.id === selectedShipId
  // A resting, orbiting fleet reads as clutter with a name label always on
  // (especially once several are parked at the same body) — Stellaris-style,
  // just the triangle. A ship still travelling (order in progress) or
  // resting somewhere else (a star, a bare point in space) keeps its label,
  // since there's nothing else nearby to make it obvious which ship it is.
  const isOrbiting = !ship.order && ship.location.kind === 'orbiting'

  useFrame(() => {
    const simDays = useGameTimeStore.getState().simDays
    const { position } = getShipRenderPosition(ship, simDays)
    groupRef.current?.position.copy(position)
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
          {!isOrbiting && <span className="marker-label">{ship.name}</span>}
        </div>
      </Html>
    </group>
  )
}
