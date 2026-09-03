import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import { ALLEGIANCE_COLORS } from '../data/shipData'
import { tacticBadge } from '../data/combatData'
import { useShipStore } from '../state/shipStore'
import { activeTacticIds, useCombatStore } from '../state/combatStore'
import { simDaysToSeconds, useGameTimeStore } from '../state/gameTimeStore'
import { isChaffActive, overallHealthFraction, participantArenaPosition, shipCombatProfile } from './combatResolution'
import { toVector3 } from './combatArena'
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
  // Whole sim-seconds only: chaff's badge just needs to appear and disappear,
  // and subscribing to the raw clock would re-render this marker every frame.
  const simDays = useGameTimeStore((s) => Math.floor(simDaysToSeconds(s.simDays) * 2) / 2 / 86400)
  const healthPercent = useShipStore((s) => {
    const found = s.ships.find((sh) => sh.id === shipId)
    const profile = found ? shipCombatProfile(found) : null
    return found && profile ? Math.round(overallHealthFraction(found.combat, profile) * 100) : 0
  })
  // A joined string, not an array — zustand's default equality check is a
  // reference compare, so an array/object built fresh on every store update
  // would re-render this marker every step even when nothing tactic-related
  // actually changed. Strings compare by value, so this is cheap and correct
  // without needing a shallow-equal selector.
  const activeTacticIdsKey = useCombatStore((s) => {
    const participant = s.engagements.find((e) => e.id === engagementId)?.participants.find((p) => p.shipId === shipId)
    return participant ? activeTacticIds(participant).join(',') : ''
  })
  const activeTactics = activeTacticIdsKey ? activeTacticIdsKey.split(',') : []

  useFrame(() => {
    const engagement = useCombatStore.getState().engagements.find((e) => e.id === engagementId)
    const participant = engagement?.participants.find((p) => p.shipId === shipId)
    if (!engagement || !participant) return
    // Positions are real, absolute arena coordinates; the view draws
    // relative to the current window centre, so subtract it here.
    const pos = participantArenaPosition(participant, useGameTimeStore.getState().simDays)
    pos.sub(toVector3(engagement.center))
    groupRef.current?.position.copy(pos)
  })

  if (!ship) return null

  const selected = ship.id === selectedShipId
  const color = ALLEGIANCE_COLORS[ship.allegiance]
  const charging = !!ship.combat.ftlCharge
  const chaffed = isChaffActive(ship.combat, simDays)

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
          {/* Chaff has to be visible on EVERY hull, not just your own, or it
              isn't counterplay — the response to an enemy raising chaff is to
              close the distance (see combatData's chaffMissChance), and you
              can't decide to do that without being told it's up. */}
          {chaffed && <span className="combat-marker-chaff">CHAFF</span>}
          {/* Same visual slot as chaff, one badge per active Tactic (see
              combatData's Tactics section) — visible on every hull, not just
              your own, same "this is counterplay, not a secret" reasoning as
              chaff's own badge. Hovering shows the effect (see tacticBadge's
              own comment on the "???" fallback for an unrecognized id). */}
          {activeTactics.map((id) => {
            const badge = tacticBadge(id)
            return (
              <span key={id} className="combat-marker-tactic" title={badge.title}>
                {badge.label}
              </span>
            )
          })}
        </div>
      </Html>
    </group>
  )
}
