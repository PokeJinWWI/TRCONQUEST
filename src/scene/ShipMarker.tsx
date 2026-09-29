import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import type { ShipInstance } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { useFleetStore } from '../state/fleetStore'
import { RELATION_COLORS } from '../data/shipData'
import { SHIP_ICON_SIZE, ShipIcon, roleOfClass } from './ShipIcon'
import { useRelationTo } from '../state/shipRelations'
import { playerShipRenderPosition } from './commsVisual'
import { hasOwnShipSelected, openShipFull } from './panelOpen'
import { isAdditiveClick, isNewTabClick, isNewTabContextMenu } from './selectionInput'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

// Screen-space vertical spacing between stacked markers sharing a body (see
// stackIndex below) — stacking downward from the base offset already
// applied by `.ship-marker`'s own CSS transform.
const STACK_STEP_PX = 14
const BASE_OFFSET_PX = { x: 4, y: -18 }

interface ShipMarkerProps {
  /** Every hull this one marker represents — a fleet resting together (see
   * shipPhysics.clusterRestingShipsByFleet), or just one ship traveling
   * alone or resting somewhere not shared with anyone. Always non-empty; the
   * FIRST entry is this cluster's "lead" — whose position/color/name drive
   * the marker, and whose id is what gets selected/followed. */
  ships: ShipInstance[]
  /** Right-click — orders the currently-selected ship (if any, and if it
   * isn't this one) to follow this cluster's lead ship instead of a normal
   * move order. */
  onOrderFollow?: (targetShipId: string) => void
  /** This cluster's position (0-based) among every other cluster
   * resting/orbiting the same body — used to stack their markers vertically
   * instead of letting them overlap into an unreadable pile (most likely
   * once two different fleets share a body), and to decide whether a name
   * label is needed at all (see isOrbiting below). Defaults as if this were
   * the only cluster there. */
  stackIndex?: number
  stackCount?: number
  /** Icon size in px — bigger in interstellar space (SHIP_ICON_SIZE). */
  iconSize?: number
}

// One marker per fleet resting together — a triangle instead of the
// celestial-body dot, so ships read as distinct from planets/stars at a
// glance, plus a count badge once more than one hull shares it. Position is
// a pure function of simDays (getShipRenderPosition), same as planets/moons
// — no accumulated per-frame movement, tracked off the cluster's lead ship
// since every member here is, by construction, resting at the exact same
// spot (see clusterRestingShipsByFleet). Noticing an order has finished and
// settling a ship into its resting location — which is also where it might
// join this fleet — is handled globally by useShipOrderSettler, not here.
export function ShipMarker({ ships, onOrderFollow, stackIndex = 0, stackCount = 1, iconSize = SHIP_ICON_SIZE.system }: ShipMarkerProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const selectShip = useShipStore((s) => s.selectShip)
  const fleets = useFleetStore((s) => s.fleets)
  const lead = ships[0]
  const relation = useRelationTo(lead.ownerId)
  const color = RELATION_COLORS[relation]
  // Selected if ANY member is in the selection, not just the lead — the
  // player can inspect a specific hull within a fleet (see ShipPanel's
  // roster), or have several fleets selected at once, without losing the
  // marker's own highlighted state.
  const selected = useShipStore((st) => ships.some((s) => st.selectedShipIds.includes(s.id)))
  const multi = ships.length > 1
  const fleetName = multi ? fleets.find((f) => f.id === lead.fleetId)?.name : undefined
  // A single resting, orbiting cluster reads as clutter with a name label
  // always on — Stellaris-style, just the triangle. But once more than one
  // cluster shares a body (two different fleets both resting at the same
  // planet), hiding every name defeats the purpose of being able to tell
  // them apart — so the label comes back exactly when there's another
  // cluster to distinguish this one from, stacked vertically (see
  // stackIndex) so the labels themselves don't overlap either. A cluster
  // still traveling (order in progress) or resting somewhere else (a star,
  // a bare point in space) always keeps its label regardless.
  const isOrbiting = !lead.order && lead.location.kind === 'orbiting'
  const hideLabel = isOrbiting && stackCount <= 1
  useFrame(() => {
    const simDays = useGameTimeStore.getState().simDays
    // Always the ship's real position (see commsVisual.playerShipRenderPosition).
    const { position } = playerShipRenderPosition(lead, simDays)
    groupRef.current?.position.copy(position)
  })

  return (
    <group ref={groupRef}>
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
        <div
          className={`ship-marker${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          // Shift+drag box selection picks the player's own markers by this (components/BoxSelectLayer).
          data-select-ship={relation === 'own' ? lead.id : undefined}
          style={
            stackIndex > 0
              ? { transform: `translate(${BASE_OFFSET_PX.x}px, ${BASE_OFFSET_PX.y - stackIndex * STACK_STEP_PX}px)` }
              : undefined
          }
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={(e) => (isNewTabClick(e) ? useWorkspaceStore.getState().openInNewTab({ selectedShipId: lead.id }) : isAdditiveClick(e) ? useShipStore.getState().toggleShipSelection(lead.id) : selectShip(lead.id))}
          onContextMenu={(e) => {
            e.preventDefault()
            // Ctrl-click on a Mac arrives here: open it in a new tab.
            if (isNewTabContextMenu(e)) useWorkspaceStore.getState().openInNewTab({ selectedShipId: lead.id })
            // With none of your ships selected, a right click opens its panel full screen.
            else if (!hasOwnShipSelected()) openShipFull(lead.id)
            else onOrderFollow?.(lead.id)
          }}
          onWheel={forwardWheelToCanvas}
        >
          <ShipIcon role={roleOfClass(lead.classId)} color={color} size={iconSize} />
          {multi && <span className="ship-marker-count">{ships.length}</span>}
          {!hideLabel && <span className="marker-label">{fleetName ?? lead.name}</span>}
        </div>
      </Html>
    </group>
  )
}
