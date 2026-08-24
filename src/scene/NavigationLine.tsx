import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Vector3, type InterleavedBufferAttribute } from 'three'
import type { Line2 } from 'three-stdlib'
import type { ShipInstance } from '../state/shipStore'
import { getShipRenderPosition } from './shipPhysics'
import { useGameTimeStore } from '../state/gameTimeStore'
import { LINE_THICKNESS_PX, useSettingsStore } from '../state/settingsStore'
import { arrowWings } from './routeArrow'

// Shaft (1 segment) + arrowhead (2 wing segments) = 3 disjoint segments.
const SEGMENT_COUNT = 3

interface NavigationLineProps {
  ship: ShipInstance
  color: string
  /** How far the arrowhead's wings reach back from the destination point, in
   * THIS view's own world units. Every view level has its own physical scale
   * (system view spans ~600 units out to Neptune, interstellar spans
   * thousands), so there's no one constant that reads right everywhere — see
   * the caller (SolarSystemScene/InterstellarScene) for how it picked this. */
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
    line.visible = true

    const { position: start } = getShipRenderPosition(ship, useGameTimeStore.getState().simDays)
    const end = new Vector3(...ship.order.endPosition)

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

    const wings = arrowWings(start, end, state.camera.position, arrowLength)
    if (wings) {
      write(end, wings.wing1)
      write(end, wings.wing2)
    }

    buffer.needsUpdate = true
    line.geometry.instanceCount = segment
    // @@PROBE@@
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>
      const bag = (w.__navProbe ??= {}) as Record<string, unknown>
      ;(bag as Record<string, unknown>)[ship.id] = {
        segments: segment,
        start: start.toArray(),
        end: end.toArray(),
        wings: wings ? { w1: wings.wing1.toArray(), w2: wings.wing2.toArray() } : null,
        linewidth: (line.material as unknown as { linewidth: number }).linewidth,
        color: (line.material as unknown as { color: { getHexString: () => string } }).color.getHexString(),
      }
    }
    // @@END-PROBE@@
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
