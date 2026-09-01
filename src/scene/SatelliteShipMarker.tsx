import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import type { ShipInstance } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { useFleetStore } from '../state/fleetStore'
import { ALLEGIANCE_COLORS } from '../data/shipData'
import { satelliteOrbitLocalPosition } from './shipPhysics'
import { useGameTimeStore } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

// Same stacking constants as ShipMarker (kept local rather than shared,
// same minor-duplication tradeoff as this file's other small constants).
const STACK_STEP_PX = 14
const BASE_OFFSET_PX = { x: 4, y: -18 }

interface SatelliteShipMarkerProps {
  /** Every hull this one marker represents — a fleet resting together (see
   * shipPhysics.clusterRestingShipsByFleet). Always non-empty; the FIRST
   * entry is this cluster's lead, whose position/color/name drive the
   * marker. */
  ships: ShipInstance[]
  primaryVisualRadius: number
  /** Right-click — orders the currently-selected ship (if any, and if it
   * isn't this one) to follow this cluster's lead ship instead of a normal
   * move order. */
  onOrderFollow?: (targetShipId: string) => void
  /** This cluster's position (0-based) among every other cluster orbiting
   * this same body (every ship this component ever renders already shares
   * one — see SatelliteViewScene's orbitingShips filter) — stacks their
   * markers vertically and brings back their name labels once there's more
   * than one to distinguish (see ShipMarker's identical stackIndex/
   * stackCount). */
  stackIndex?: number
  stackCount?: number
}

// A fleet resting in orbit around the body a satellite view is currently
// showing — the "correct corresponding view" a move order to that body
// should actually be visible in, not just an abstract system-AU point that
// only system view could ever render. Same triangle-marker visual language
// as ShipMarker (system/interstellar views), and — like system view — a
// live, continuously-animated orbit (see satelliteOrbitLocalPosition), not a
// static parking spot.
export function SatelliteShipMarker({
  ships,
  primaryVisualRadius,
  onOrderFollow,
  stackIndex = 0,
  stackCount = 1,
}: SatelliteShipMarkerProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const fleets = useFleetStore((s) => s.fleets)
  const lead = ships[0]
  const selected = ships.some((s) => s.id === selectedShipId)
  const color = ALLEGIANCE_COLORS[lead.allegiance]
  const multi = ships.length > 1
  const fleetName = multi ? fleets.find((f) => f.id === lead.fleetId)?.name : undefined

  useFrame(() => {
    if (lead.location.kind !== 'orbiting') return
    const simDays = useGameTimeStore.getState().simDays
    const pos = satelliteOrbitLocalPosition(lead.location, primaryVisualRadius, simDays)
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
          onClick={() => selectShip(lead.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            onOrderFollow?.(lead.id)
          }}
          onWheel={forwardWheelToCanvas}
        >
          <span className="ship-marker-icon" style={{ borderBottomColor: color }} />
          {multi && <span className="ship-marker-count">{ships.length}</span>}
          {stackCount > 1 && <span className="marker-label">{fleetName ?? lead.name}</span>}
        </div>
      </Html>
    </group>
  )
}
