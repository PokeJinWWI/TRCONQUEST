import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import type { Vector3, InterleavedBufferAttribute, PerspectiveCamera } from 'three'
import type { Line2 } from 'three-stdlib'
import type { ShipInstance, MoveDestination } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { LINE_THICKNESS_PX, useSettingsStore } from '../state/settingsStore'
import { arrowWings, pixelsToWorldSize } from './routeArrow'

// The most legs drawn for one ship's queue.
const MAX_LEGS = 16
const SEGMENTS = MAX_LEGS * 3

interface QueuedRouteLineProps {
  ship: ShipInstance
  color: string
  arrowLength: number
  dashSize: number
  gapSize: number
  // Where a destination is in THIS scene's frame, or null if it isn't
  // representable here (same contract as PendingOrderLine.resolveTarget).
  resolveTarget: (destination: MoveDestination, simDays: number) => Vector3 | null
}

// The orders queued behind a ship's current one (Shift + right-click): a dashed
// route from where the current order ends through each queued destination in
// turn, with an arrowhead at every stop. Distinct from NavigationLine's solid
// line ("flying this now") and PendingOrderLine's ("the command hasn't arrived
// yet"): this one is "then this".
export function QueuedRouteLine({ ship, color, arrowLength, dashSize, gapSize, resolveTarget }: QueuedRouteLineProps) {
  const lineRef = useRef<Line2>(null)
  const seed = useMemo(() => Array.from({ length: SEGMENTS * 2 }, () => [0, 0, 0] as [number, number, number]), [])
  const thickness = useSettingsStore((s) => LINE_THICKNESS_PX[s.navigationLineThickness])

  useFrame((state) => {
    const line = lineRef.current
    const queue = ship.orderQueue
    if (!line || !queue || queue.length === 0 || !ship.order) {
      if (line) line.visible = false
      return
    }
    const simDays = useGameTimeStore.getState().simDays
    let previous = resolveTarget(ship.order.destination, simDays)
    if (!previous) {
      line.visible = false
      return
    }
    const buffer = (line.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data
    const array = buffer.array as Float32Array
    const camera = state.camera as PerspectiveCamera
    let segment = 0
    const write = (a: Vector3, b: Vector3) => {
      if (segment >= SEGMENTS) return
      const o = segment * 6
      array[o] = a.x
      array[o + 1] = a.y
      array[o + 2] = a.z
      array[o + 3] = b.x
      array[o + 4] = b.y
      array[o + 5] = b.z
      segment++
    }
    let nearest = Infinity
    for (const destination of queue.slice(0, MAX_LEGS)) {
      const next = resolveTarget(destination, simDays)
      if (!next) break
      write(previous, next)
      const distance = camera.position.distanceTo(next)
      nearest = Math.min(nearest, distance)
      const arrow = Math.min(pixelsToWorldSize(arrowLength, distance, camera.fov, state.size.height), previous.distanceTo(next) * 0.35)
      const wings = arrowWings(previous, next, camera.position, arrow)
      if (wings) {
        write(next, wings.wing1)
        write(next, wings.wing2)
      }
      previous = next
    }
    line.visible = segment > 0
    buffer.needsUpdate = true
    line.geometry.instanceCount = segment
    line.computeLineDistances()
    const ref = Number.isFinite(nearest) ? nearest : 1
    line.material.dashSize = pixelsToWorldSize(dashSize, ref, camera.fov, state.size.height)
    line.material.gapSize = pixelsToWorldSize(gapSize, ref, camera.fov, state.size.height)
  })

  return (
    <Line ref={lineRef} points={seed} segments color={color} lineWidth={thickness} transparent opacity={0.55} dashed dashSize={dashSize} gapSize={gapSize} frustumCulled={false} />
  )
}
