import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import { ALLEGIANCE_COLORS } from '../data/shipData'
import { useShipStore } from '../state/shipStore'
import { useCombatStore } from '../state/combatStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { overallHealthFraction, participantArenaPosition, shipCombatProfile } from './combatResolution'
import { nodeToArenaPosition } from './combatArena'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface CombatShipMarkerProps {
  engagementId: string
  shipId: string
  /** Right-click — assigns this ship as the selected ship's firing target. */
  onOrderTarget?: (targetShipId: string) => void
}

// A combatant inside the arena. Unlike every other ship marker in this
// project, its position is read fresh from the store every frame rather than
// from props: the resolver rewrites participant state constantly during a
// fight, and threading that through React props would re-render the whole
// marker on every step. Reading via getState() in useFrame keeps the marker
// mounted and just moves its group.
//
// Carries an integrity bar directly on the marker (not just in the panel) —
// in a fleet fight the whole point of the arena view is seeing at a glance
// which ships are nearly dead without clicking through each one.
export function CombatShipMarker({ engagementId, shipId, onOrderTarget }: CombatShipMarkerProps) {
  const groupRef = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const ship = useShipStore((s) => s.ships.find((sh) => sh.id === shipId))
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  // Re-rendered only when the *health* actually moves enough to matter — the
  // bar is rounded to whole percent, so this subscription is far quieter than
  // one on the raw participant state.
  const healthPercent = useShipStore((s) => {
    const found = s.ships.find((sh) => sh.id === shipId)
    const profile = found ? shipCombatProfile(found) : null
    return found && profile ? Math.round(overallHealthFraction(found.combat, profile) * 100) : 0
  })

  useFrame(() => {
    const engagement = useCombatStore.getState().engagements.find((e) => e.id === engagementId)
    const participant = engagement?.participants.find((p) => p.shipId === shipId)
    if (!engagement || !participant) return
    // Positions are absolute lattice coordinates; the view draws relative to
    // the current window centre, so subtract it here.
    const pos = participantArenaPosition(participant, engagement.density, useGameTimeStore.getState().simDays)
    pos.sub(nodeToArenaPosition(engagement.center, engagement.density))
    groupRef.current?.position.copy(pos)
  })

  if (!ship) return null

  const selected = ship.id === selectedShipId
  const color = ALLEGIANCE_COLORS[ship.allegiance]
  const charging = !!ship.combat.ftlCharge

  return (
    <group ref={groupRef}>
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
        <div
          className={`ship-marker combat-ship-marker${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={() => selectShip(ship.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            onOrderTarget?.(ship.id)
          }}
          onWheel={forwardWheelToCanvas}
        >
          <span className="ship-marker-icon" style={{ borderBottomColor: color }} />
          <span className="marker-label">{ship.name}</span>
          <span className="combat-marker-health">
            <span className="combat-marker-health-fill" style={{ width: `${healthPercent}%`, background: color }} />
          </span>
          {/* A ship spooling a drive is defenceless and about to leave — the
              single most decision-relevant thing to see from across the
              arena, so it gets its own badge rather than living only in the
              panel. */}
          {charging && <span className="combat-marker-charging">FTL</span>}
        </div>
      </Html>
    </group>
  )
}
