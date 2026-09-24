import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Vector3, type InterleavedBufferAttribute, type PerspectiveCamera } from 'three'
import type { Line2 } from 'three-stdlib'
import type { ShipInstance } from '../state/shipStore'
import { getShipRenderPosition } from './shipPhysics'
import { playerCommsDelayToShip, visualShipSnapshot } from './commsVisual'
import { useGameTimeStore } from '../state/gameTimeStore'
import { LINE_THICKNESS_PX, useSettingsStore } from '../state/settingsStore'
import { arrowWings, pixelsToWorldSize } from './routeArrow'

// Shaft (1 segment) + arrowhead (2 wing segments) = 3 disjoint segments.
const SEGMENT_COUNT = 3

interface NavigationLineProps {
  ship: ShipInstance
  color: string
  /** How big the arrowhead reads on screen, in CSS pixels — see
   * routeArrow.pixelsToWorldSize. A screen-space size rather than a world
   * one so it reads the same whether the camera is zoomed in close or all
   * the way out (a fixed world-unit length used to look tiny far out and
   * enormous zoomed in close — a real, reported bug). Still capped against
   * the segment's own length below, so a short hop's chevron never dwarfs
   * its own shaft. */
  arrowLength: number
}

// A ship's current order, drawn as a straight shaft from its live position to
// where it's headed, with a chevron arrowhead at the destination end — the
// out-of-combat counterpart to CombatPathLine. Route lines were combat-only
// until a player asked for the same visibility outside a fight; same Line2
// choice for a real pixel width (see CombatPathLine's own comment on why
// plain `lineSegments` can't give one).
//
// Only ever mounted for a ship that currently HAS an order (see the caller),
// so this doesn't need CombatPathLine's "stay mounted, hide via draw range"
// trick — an order lasts many real seconds, not the kind of per-step state
// that flickers in and out from one frame to the next.
export function NavigationLine({ ship, color, arrowLength }: NavigationLineProps) {
  const lineRef = useRef<Line2>(null)
  const seedPoints = useMemo(
    () => Array.from({ length: SEGMENT_COUNT * 2 }, () => [0, 0, 0] as [number, number, number]),
    [],
  )
  const thickness = useSettingsStore((s) => LINE_THICKNESS_PX[s.navigationLineThickness])

  useFrame((state) => {
    const line = lineRef.current
    if (!line || !ship.order) {
      if (line) line.visible = false
      return
    }
    // Comms-delay-aware — see commsVisual.ts. Both ends come from the SAME
    // reconstructed-as-of-the-delay order, not a mix of a stale start with
    // the ship's true live destination — otherwise the line would leak
    // exactly the information the delay is supposed to be hiding. Falls
    // back to the live order (and this early-returns if that's since
    // completed and the delayed snapshot has nothing to show) — the
    // caller's own mount condition already checks the live ship.order, so
    // that's the one case this doesn't fully cover (see this session's plan
    // for why membership/mounting stays on live truth).
    const simDays = useGameTimeStore.getState().simDays
    const delay = playerCommsDelayToShip(ship, simDays)
    const snap = delay > 0 ? visualShipSnapshot(ship, delay, simDays) : { location: ship.location, order: ship.order, combat: ship.combat }
    if (!snap.order) {
      line.visible = false
      return
    }
    line.visible = true

    const { position: start } = getShipRenderPosition({ ...ship, location: snap.location, order: snap.order }, simDays - delay)
    const end = new Vector3(...snap.order.endPosition)

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

    // Screen-constant size (see routeArrow.pixelsToWorldSize), computed at
    // the endpoint's own distance from the camera each frame — a long-range
    // order doesn't get a tiny arrow just because it's viewed from far away,
    // and zooming in close doesn't inflate it either. Still capped against
    // the segment's own length — a short hop (say, a nudge to a nearby
    // point) drawn with the full screen-space arrowLength would put the
    // wings' back-offset past the START of the line, reading as an oversized
    // chevron dwarfing the shaft it's supposed to cap.
    const camera = state.camera as PerspectiveCamera
    const pixelArrowLength = pixelsToWorldSize(arrowLength, camera.position.distanceTo(end), camera.fov, state.size.height)
    const segLength = start.distanceTo(end)
    const scaledArrowLength = Math.min(pixelArrowLength, segLength * 0.35)
    const wings = arrowWings(start, end, state.camera.position, scaledArrowLength)
    if (wings) {
      write(end, wings.wing1)
      write(end, wings.wing2)
    }

    buffer.needsUpdate = true
    line.geometry.instanceCount = segment
  })

  return (
    <Line
      ref={lineRef}
      points={seedPoints}
      segments
      color={color}
      lineWidth={thickness}
      transparent
      opacity={0.9}
      frustumCulled={false}
    />
  )
}
