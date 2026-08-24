import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, LineSegments } from 'three'
import { useCombatStore } from '../state/combatStore'
import { useShipStore } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { activeEnemyContacts, participantArenaPosition } from './combatResolution'

// Generous ceiling on simultaneous engaged pairs — an N-vs-N brawl is
// O(N^2) pairs in the worst case, and this covers well past any fleet size
// the game can currently produce. Allocated once; `setDrawRange` selects how
// much is live each frame, so pairs forming and breaking never reallocate.
const MAX_PAIRS = 128

const ENGAGED_COLOR = '#ffd23f'
// Short dashes with a wide gap — reads clearly as "contact" rather than
// being mistaken for a movement route (which is drawn solid, in the ship's
// own allegiance color).
const DASH_SIZE = 0.35
const GAP_SIZE = 0.3

interface CombatEngagementLineProps {
  engagementId: string
}

// A yellow dashed line between every pair of ships actively trading fire.
//
// Deliberately drawn as a straight segment between the two hulls, ignoring
// the movement lattice entirely — this is a *line of fire*, and shots
// already travel in straight lines (see combatArena.hasLineOfFire). Drawing
// it on the grid would imply a constraint that doesn't exist for gunnery.
//
// Pairs come from the same `activeEnemyContacts` used for the "Engaged
// Against" readout and for FTL risk, so what the player sees drawn here is
// exactly what the simulation counts as an active engagement — there's no
// second, cosmetic definition that could drift from the real one.
export function CombatEngagementLine({ engagementId }: CombatEngagementLineProps) {
  const lineRef = useRef<LineSegments>(null)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_PAIRS * 2 * 3), 3))
    g.setDrawRange(0, 0)
    return g
  }, [])
  const positions = useRef<Float32Array>(geometry.getAttribute('position').array as Float32Array)

  useFrame(() => {
    const engagement = useCombatStore.getState().engagements.find((e) => e.id === engagementId)
    if (!engagement) {
      geometry.setDrawRange(0, 0)
      return
    }
    const ships = useShipStore.getState().ships
    const simDays = useGameTimeStore.getState().simDays
    const center = engagement.center
    const array = positions.current
    let vertex = 0

    for (const participant of engagement.participants) {
      const contacts = activeEnemyContacts(participant, engagement, ships, simDays)
      for (const other of contacts) {
        // Each pair is symmetric, so draw it once — from whichever end sorts
        // first by ship id.
        if (participant.shipId > other.shipId) continue
        if (vertex >= MAX_PAIRS * 2) break
        const a = participantArenaPosition(participant, simDays)
        const b = participantArenaPosition(other, simDays)
        array[vertex * 3] = a.x - center.x
        array[vertex * 3 + 1] = a.y - center.y
        array[vertex * 3 + 2] = a.z - center.z
        vertex++
        array[vertex * 3] = b.x - center.x
        array[vertex * 3 + 1] = b.y - center.y
        array[vertex * 3 + 2] = b.z - center.z
        vertex++
      }
    }

    geometry.setDrawRange(0, vertex)
    geometry.getAttribute('position').needsUpdate = true
    // Dash spacing is computed from vertex distances, so it has to be
    // recomputed whenever the endpoints move — otherwise the dashes stretch
    // and smear as ships close or separate.
    if (vertex > 0) lineRef.current?.computeLineDistances()
  })

  return (
    <lineSegments ref={lineRef} geometry={geometry} frustumCulled={false}>
      <lineDashedMaterial color={ENGAGED_COLOR} dashSize={DASH_SIZE} gapSize={GAP_SIZE} transparent opacity={0.9} />
    </lineSegments>
  )
}
