import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Vector3, type InterleavedBufferAttribute } from 'three'
import type { Line2 } from 'three-stdlib'
import { useCombatStore } from '../state/combatStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { LINE_THICKNESS_PX, useSettingsStore } from '../state/settingsStore'
import { participantArenaPosition } from './combatResolution'
import { arrowWings } from './routeArrow'
import type { ArenaPoint } from './combatArena'

// The most legs a route is ever drawn with. A detour around the largest
// body tops out around 30; this leaves generous headroom.
const MAX_LEGS = 64
// Each leg draws as up to three disjoint segments — the shaft, plus two
// arrowhead wings at its own endpoint — all sharing one buffer so a route
// changing length never reallocates it (`instanceCount` selects how much is
// live).
const MAX_SEGMENTS = MAX_LEGS * 3

// A leg's arrowhead is sized off its OWN length, not a flat constant, so a
// short final approach doesn't grow an oversized chevron relative to the
// shaft it's attached to — capped so a long leg's arrowhead stays a chevron
// rather than turning into a second shaft.
const ARROW_LENGTH_FRACTION = 0.28
const ARROW_MAX_LENGTH = 0.45

interface CombatPathLineProps {
  engagementId: string
  shipId: string
  color?: string
}

// The route a ship is currently committed to flying, drawn from where it
// *actually is* right now through each remaining waypoint, with a chevron
// arrowhead at the end of every leg showing which way that leg is flown.
//
// Reading the live position every frame (rather than taking it as a prop)
// is what fixes a real glitch: the route used to be drawn from the ship's
// stored position through `path`, and the resolver consumed `path[0]` the
// instant a leg began. For the common single-waypoint order that emptied
// `path` immediately, so the line vanished the moment the order was given
// even though the ship was still flying it. Now the line shrinks smoothly
// as the ship closes on each waypoint and disappears only on arrival.
//
// Only ever mounted for ships the player can see routes for — see
// CombatViewScene, which no longer draws them for hostiles or neutrals.
export function CombatPathLine({ engagementId, shipId, color = '#4ade80' }: CombatPathLineProps) {
  const lineRef = useRef<Line2>(null)
  // A stable, full-size seed so drei builds the interleaved buffer once at
  // mount; every frame after that writes into it in place.
  const seedPoints = useMemo(
    () => Array.from({ length: MAX_SEGMENTS * 2 }, () => [0, 0, 0] as [number, number, number]),
    [],
  )
  const thickness = useSettingsStore((s) => LINE_THICKNESS_PX[s.navigationLineThickness])

  useFrame((state) => {
    const line = lineRef.current
    if (!line) return

    const engagement = useCombatStore.getState().engagements.find((e) => e.id === engagementId)
    const participant = engagement?.participants.find((p) => p.shipId === shipId)
    if (!engagement || !participant || participant.path.length === 0) {
      line.visible = false
      return
    }
    line.visible = true

    const center = engagement.center
    const live = participantArenaPosition(participant, useGameTimeStore.getState().simDays)

    // Line2 stores both endpoints of each segment in one interleaved buffer
    // of stride 6 — [startXYZ, endXYZ] per segment — so writing it directly
    // avoids geometry.setPositions, which reallocates that buffer on every
    // call and would do so 60 times a second per ship.
    const attribute = line.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
    const buffer = attribute.data
    const array = buffer.array as Float32Array

    let segment = 0
    const write = (a: Vector3, b: Vector3) => {
      if (segment >= MAX_SEGMENTS) return
      const offset = segment * 6
      array[offset] = a.x
      array[offset + 1] = a.y
      array[offset + 2] = a.z
      array[offset + 3] = b.x
      array[offset + 4] = b.y
      array[offset + 5] = b.z
      segment++
    }

    // Window-local: everything is drawn relative to the arena's current
    // center, which the scene positions as a group.
    let previous: ArenaPoint = { x: live.x, y: live.y, z: live.z }
    for (const waypoint of participant.path) {
      if (segment >= MAX_SEGMENTS) break
      const start = new Vector3(previous.x - center.x, previous.y - center.y, previous.z - center.z)
      const end = new Vector3(waypoint.x - center.x, waypoint.y - center.y, waypoint.z - center.z)
      write(start, end)

      const arrowLength = Math.min(start.distanceTo(end) * ARROW_LENGTH_FRACTION, ARROW_MAX_LENGTH)
      const wings = arrowWings(start, end, state.camera.position, arrowLength)
      if (wings) {
        write(end, wings.wing1)
        write(end, wings.wing2)
      }
      previous = waypoint
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
      opacity={0.95}
      frustumCulled={false}
    />
  )
}
