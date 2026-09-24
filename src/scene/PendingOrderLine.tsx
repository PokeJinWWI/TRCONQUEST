import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Vector3, type InterleavedBufferAttribute, type PerspectiveCamera } from 'three'
import type { Line2 } from 'three-stdlib'
import type { ShipInstance, MoveDestination } from '../state/shipStore'
import { playerVisualShipRenderPosition } from './commsVisual'
import { useGameTimeStore } from '../state/gameTimeStore'
import { LINE_THICKNESS_PX, useSettingsStore } from '../state/settingsStore'
import { arrowWings, pixelsToWorldSize } from './routeArrow'

// Shaft (1 segment) + arrowhead (2 wing segments) = 3 disjoint segments —
// same shape as NavigationLine.
const SEGMENT_COUNT = 3

interface PendingOrderLineProps {
  ship: ShipInstance
  color: string
  /** Same screen-space-size concern as NavigationLine's own arrowLength —
   * see that component's prop comment and routeArrow.pixelsToWorldSize. In
   * CSS pixels, not world units. */
  arrowLength: number
  /** Same units as arrowLength — CSS pixels, converted to world units each
   * frame at the line's own distance from the camera. */
  dashSize: number
  gapSize: number
  /** Resolves ship.pendingMoveOrder.destination into a position in THIS
   * scene's own frame — returns null when the destination isn't
   * representable there (e.g. a hyperdrive jump to another star queued from
   * system view, which system view has no coordinate for), in which case
   * the line simply doesn't render rather than drawing something
   * meaningless. Each scene supplies its own — see SolarSystemScene/
   * InterstellarScene for what they resolve. */
  resolveTarget: (destination: MoveDestination, simDays: number) => Vector3 | null
}

// A strategic order still queued behind FTL comms delay (see
// ShipInstance.pendingMoveOrder and commsVisual.ts's queueMoveOrder) drawn
// as a DASHED shaft from wherever the ship currently reads (through the
// player's own comms-delay lens — same one ShipMarker itself renders
// through, so the line starts exactly where that marker is drawn) out to
// the destination the player actually clicked. Deliberately distinct from
// NavigationLine's solid arrow, which means "the ship is doing this right
// now" — this means "told to, but the signal hasn't gotten there yet."
//
// The two coexist by design: a ship still flying an old order while a new
// one queues behind delay shows BOTH at once — queueMoveOrder never touches
// ship.order while a command is merely pending (see its own comment), so
// the ship visibly keeps going until the new order actually arrives and
// supersedes it.
export function PendingOrderLine({ ship, color, arrowLength, dashSize, gapSize, resolveTarget }: PendingOrderLineProps) {
  const lineRef = useRef<Line2>(null)
  const seedPoints = useMemo(
    () => Array.from({ length: SEGMENT_COUNT * 2 }, () => [0, 0, 0] as [number, number, number]),
    [],
  )
  const thickness = useSettingsStore((s) => LINE_THICKNESS_PX[s.navigationLineThickness])

  useFrame((state) => {
    const line = lineRef.current
    const pending = ship.pendingMoveOrder
    if (!line || !pending) {
      if (line) line.visible = false
      return
    }
    const simDays = useGameTimeStore.getState().simDays
    const end = resolveTarget(pending.destination, simDays)
    if (!end) {
      line.visible = false
      return
    }
    line.visible = true

    // The player's own just-issued command isn't something comms delay
    // needs to hide FROM them — they clicked it — but the START point
    // should still match wherever the ship's own marker is currently drawn
    // (which IS delay-lensed), or the dashed line would visibly detach from
    // the marker it's supposed to originate at.
    const start = playerVisualShipRenderPosition(ship, simDays).position

    const attribute = line.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
    const buffer = attribute.data
    const array = buffer.array as Float32Array

    let segment = 0
    const write = (a: Vector3, b: Vector3) => {
      const offset = segment * 6
      array[offset] = a.x
      array[offset + 1] = a.y
      array[offset + 2] = a.z
      array[offset + 3] = b.x
      array[offset + 4] = b.y
      array[offset + 5] = b.z
      segment++
    }
    write(start, end)

    // Screen-constant arrow size — see NavigationLine's identical treatment
    // (routeArrow.pixelsToWorldSize) for why a fixed world-unit length reads
    // wrong at both ends of the zoom range, and why it's still capped
    // against the segment's own length on top of that.
    const camera = state.camera as PerspectiveCamera
    const distanceToEnd = camera.position.distanceTo(end)
    const pixelArrowLength = pixelsToWorldSize(arrowLength, distanceToEnd, camera.fov, state.size.height)
    const segLength = start.distanceTo(end)
    const scaledArrowLength = Math.min(pixelArrowLength, segLength * 0.35)
    const wings = arrowWings(start, end, state.camera.position, scaledArrowLength)
    if (wings) {
      write(end, wings.wing1)
      write(end, wings.wing2)
    }

    buffer.needsUpdate = true
    line.geometry.instanceCount = segment
    // Unlike a normal drei <Line>, whose own effect recomputes this only
    // when the `points` PROP changes, this geometry's positions are written
    // directly into the buffer above — the `points` prop itself never
    // changes reference, so nothing else will ever call this. Needed every
    // frame for the dash pattern (LineMaterial's USE_DASH shader) to read
    // correct per-vertex distances rather than whatever was seeded at mount.
    line.computeLineDistances()

    // Same screen-constant idea for the dash pattern itself — a fixed
    // world-unit dash/gap would shrink to a solid-looking blur far out and
    // stretch into a few huge dashes zoomed in close. Overrides the JSX
    // props' initial values directly on the live material each frame
    // (plain uniforms — see LineMaterial's dashSize/gapSize setters — no
    // shader recompile needed, unlike toggling `dashed` itself).
    line.material.dashSize = pixelsToWorldSize(dashSize, distanceToEnd, camera.fov, state.size.height)
    line.material.gapSize = pixelsToWorldSize(gapSize, distanceToEnd, camera.fov, state.size.height)
  })

  return (
    <Line
      ref={lineRef}
      points={seedPoints}
      segments
      color={color}
      lineWidth={thickness}
      transparent
      opacity={0.65}
      dashed
      dashSize={dashSize}
      gapSize={gapSize}
      frustumCulled={false}
    />
  )
}
