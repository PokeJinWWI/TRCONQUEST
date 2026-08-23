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

// Screen-space vertical spacing between stacked markers sharing a body (see
// stackIndex below) — stacking downward from the base offset already
// applied by `.ship-marker`'s own CSS transform.
const STACK_STEP_PX = 14
const BASE_OFFSET_PX = { x: 4, y: -18 }

interface ShipMarkerProps {
  ship: ShipInstance
  /** Right-click — orders the currently-selected ship (if any, and if it
   * isn't this one) to follow this ship instead of a normal move order. */
  onOrderFollow?: (targetShipId: string) => void
  /** This ship's position (0-based) among every other ship resting/orbiting
   * the same body — used to stack their markers vertically instead of
   * letting them overlap into an unreadable pile, and to decide whether a
   * name label is needed at all (see isOrbiting below). Defaults as if this
   * were the only ship there. */
  stackIndex?: number
  stackCount?: number
}

// A spawned ship's marker — a triangle instead of the celestial-body dot, so
// ships read as distinct from planets/stars at a glance. Position is a pure
// function of simDays (getShipRenderPosition), same as planets/moons — no
// accumulated per-frame movement. Noticing an order has finished and
// settling the ship into its resting location is handled globally by
// useShipOrderSettler, not here — this marker isn't guaranteed to be mounted
// in every view a ship's order could complete in (see that hook's comment).
export function ShipMarker({ ship, onOrderFollow, stackIndex = 0, stackCount = 1 }: ShipMarkerProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  const color = ALLEGIANCE_COLORS[ship.allegiance]
  const selected = ship.id === selectedShipId
  // A single resting, orbiting fleet reads as clutter with a name label
  // always on — Stellaris-style, just the triangle. But once more than one
  // ship shares a body (e.g. one following another there — see
  // ShipInstance.followingShipId), hiding every name defeats the purpose of
  // being able to tell them apart at all — so the label comes back exactly
  // when there's another ship to distinguish it from, stacked vertically
  // (see stackIndex) so the labels themselves don't overlap either. A ship
  // still travelling (order in progress) or resting somewhere else (a star,
  // a bare point in space) always keeps its label regardless.
  const isOrbiting = !ship.order && ship.location.kind === 'orbiting'
  const hideLabel = isOrbiting && stackCount <= 1

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
          {!hideLabel && <span className="marker-label">{ship.name}</span>}
        </div>
      </Html>
    </group>
  )
}
