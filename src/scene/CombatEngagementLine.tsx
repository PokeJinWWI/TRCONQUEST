import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, LineSegments } from 'three'
import { useCombatStore } from '../state/combatStore'
import { useShipStore } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { activeEnemyContacts, participantArenaPosition, rangeContactStatus } from './combatResolution'

// Generous ceiling on simultaneous pairs of ONE color category — an N-vs-N
// brawl is O(N^2) pairs in the worst case, and each category gets its own
// buffer (see the three geometries below) so one color filling up can't
// crowd out another's budget. Allocated once; `setDrawRange` selects how
// much is live each frame, so pairs forming and breaking never reallocate.
const MAX_PAIRS = 128

// Mutual — both ends of the pair can reach each other. The single color this
// whole line used to draw in, kept for the case that hasn't changed.
const MUTUAL_COLOR = '#ffd23f'
// Only the hostile end of the pair can reach the friendly/player end —
// genuinely dangerous: this ship is taking fire it cannot return. Same red
// ALLEGIANCE_COLORS already uses for a hostile marker.
const HOSTILE_ONLY_COLOR = '#ff3b3b'
// Only the friendly/player end can reach the hostile — a free shot, no
// retaliation possible at this range. Same green ALLEGIANCE_COLORS already
// uses for a player marker.
const FRIENDLY_ONLY_COLOR = '#4ade80'

const DASH_SIZE = 0.35
const GAP_SIZE = 0.3

function useLineBuffer(): BufferGeometry {
  return useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_PAIRS * 2 * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
}

interface CombatEngagementLineProps {
  engagementId: string
}

// A small per-frame accumulator for one color category's line buffer — three
// of these (mutual/hostile-only/friendly-only) share the same write pattern,
// so the loop below fills whichever one a pair's classification picks
// without duplicating the vertex-writing code three times over.
interface LineWriter {
  array: Float32Array
  vertex: number
}

function writeSegment(writer: LineWriter, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  if (writer.vertex >= MAX_PAIRS * 2) return
  const { array } = writer
  array[writer.vertex * 3] = ax
  array[writer.vertex * 3 + 1] = ay
  array[writer.vertex * 3 + 2] = az
  writer.vertex++
  array[writer.vertex * 3] = bx
  array[writer.vertex * 3 + 1] = by
  array[writer.vertex * 3 + 2] = bz
  writer.vertex++
}

// Dashed lines between every pair of ships actively trading fire, colored by
// who can actually reach whom rather than one flat color for "in contact":
// yellow when both ends can hit each other, red when only the hostile end
// can (this ship is taking fire it can't return — the situation to notice
// fastest), green when only the friendly/player end can (a free shot, no
// retaliation possible at this range). "Friendly/player end" is read off
// each ship's own allegiance, not a fixed side-0/side-1 label, so this reads
// correctly regardless of which side the player's fleet ended up on.
//
// Deliberately drawn as a straight segment between the two hulls, ignoring
// the movement lattice entirely — this is a *line of fire*, and shots
// already travel in straight lines (see combatArena.hasLineOfFire). Drawing
// it on the grid would imply a constraint that doesn't exist for gunnery.
//
// Pairs come from the same `activeEnemyContacts` used for the "Engaged
// Against" readout and for FTL risk, so what the player sees drawn here is
// exactly what the simulation counts as an active engagement — there's no
// second, cosmetic definition that could drift from the real one. That
// function already only returns a pair once EITHER side is within range and
// has line of fire, which is exactly the set this needs to then split into
// yellow/red/green by asking THE SAME question for each side individually.
export function CombatEngagementLine({ engagementId }: CombatEngagementLineProps) {
  const mutualRef = useRef<LineSegments>(null)
  const hostileOnlyRef = useRef<LineSegments>(null)
  const friendlyOnlyRef = useRef<LineSegments>(null)
  const mutualGeometry = useLineBuffer()
  const hostileOnlyGeometry = useLineBuffer()
  const friendlyOnlyGeometry = useLineBuffer()

  useFrame(() => {
    const engagement = useCombatStore.getState().engagements.find((e) => e.id === engagementId)
    if (!engagement) {
      mutualGeometry.setDrawRange(0, 0)
      hostileOnlyGeometry.setDrawRange(0, 0)
      friendlyOnlyGeometry.setDrawRange(0, 0)
      return
    }
    const ships = useShipStore.getState().ships
    const shipsById = new Map(ships.map((s) => [s.id, s]))
    const simDays = useGameTimeStore.getState().simDays
    const center = engagement.center

    const mutual: LineWriter = { array: mutualGeometry.getAttribute('position').array as Float32Array, vertex: 0 }
    const hostileOnly: LineWriter = { array: hostileOnlyGeometry.getAttribute('position').array as Float32Array, vertex: 0 }
    const friendlyOnly: LineWriter = { array: friendlyOnlyGeometry.getAttribute('position').array as Float32Array, vertex: 0 }

    for (const participant of engagement.participants) {
      const contacts = activeEnemyContacts(participant, engagement, ships, simDays)
      for (const other of contacts) {
        // Each pair is symmetric, so classify and draw it once — from
        // whichever end sorts first by ship id.
        if (participant.shipId > other.shipId) continue

        const selfShip = shipsById.get(participant.shipId)
        const otherShip = shipsById.get(other.shipId)
        if (!selfShip || !otherShip) continue

        const a = participantArenaPosition(participant, simDays)
        const b = participantArenaPosition(other, simDays)
        const { aCanHit: selfCanHit, bCanHit: otherCanHit } = rangeContactStatus(participant, selfShip, other, otherShip, simDays)

        // Neutrals never fight (see areHostile), so every pair here is
        // exactly one friendly/player hull and one hostile one — never both,
        // never neither.
        const selfIsFriendly = selfShip.allegiance === 'player' || selfShip.allegiance === 'friendly'
        const friendlyCanHit = selfIsFriendly ? selfCanHit : otherCanHit
        const hostileCanHit = selfIsFriendly ? otherCanHit : selfCanHit

        const writer = friendlyCanHit && hostileCanHit ? mutual : hostileCanHit ? hostileOnly : friendlyOnly
        writeSegment(writer, a.x - center.x, a.y - center.y, a.z - center.z, b.x - center.x, b.y - center.y, b.z - center.z)
      }
    }

    mutualGeometry.setDrawRange(0, mutual.vertex)
    hostileOnlyGeometry.setDrawRange(0, hostileOnly.vertex)
    friendlyOnlyGeometry.setDrawRange(0, friendlyOnly.vertex)
    mutualGeometry.getAttribute('position').needsUpdate = true
    hostileOnlyGeometry.getAttribute('position').needsUpdate = true
    friendlyOnlyGeometry.getAttribute('position').needsUpdate = true
    // Dash spacing is computed from vertex distances, so it has to be
    // recomputed whenever the endpoints move — otherwise the dashes stretch
    // and smear as ships close or separate.
    if (mutual.vertex > 0) mutualRef.current?.computeLineDistances()
    if (hostileOnly.vertex > 0) hostileOnlyRef.current?.computeLineDistances()
    if (friendlyOnly.vertex > 0) friendlyOnlyRef.current?.computeLineDistances()
  })

  return (
    <>
      <lineSegments ref={mutualRef} geometry={mutualGeometry} frustumCulled={false}>
        <lineDashedMaterial color={MUTUAL_COLOR} dashSize={DASH_SIZE} gapSize={GAP_SIZE} transparent opacity={0.9} />
      </lineSegments>
      <lineSegments ref={hostileOnlyRef} geometry={hostileOnlyGeometry} frustumCulled={false}>
        <lineDashedMaterial color={HOSTILE_ONLY_COLOR} dashSize={DASH_SIZE} gapSize={GAP_SIZE} transparent opacity={0.9} />
      </lineSegments>
      <lineSegments ref={friendlyOnlyRef} geometry={friendlyOnlyGeometry} frustumCulled={false}>
        <lineDashedMaterial color={FRIENDLY_ONLY_COLOR} dashSize={DASH_SIZE} gapSize={GAP_SIZE} transparent opacity={0.9} />
      </lineSegments>
    </>
  )
}
