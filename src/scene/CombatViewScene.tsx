import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { CombatGrid } from './CombatGrid'
import { CombatShipMarker } from './CombatShipMarker'
import { CombatPathLine } from './CombatPathLine'
import { CombatEngagementLine } from './CombatEngagementLine'
import { ShipPanel } from './ShipPanel'
import { CombatPanel, combatPanelVerticalOffset } from '../components/CombatPanel'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { type ArenaPoint } from './combatArena'
import { orderParticipantTo } from './combatResolution'
import { useCombatStore } from '../state/combatStore'
import { useShipStore } from '../state/shipStore'
import { useViewStore } from '../state/viewStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { ALLEGIANCE_COLORS } from '../data/shipData'

// The arena is 12 units across, so these frame it the way satellite view's
// constants frame a 3-unit hologram — far enough out to see the whole cage,
// close enough that individual nodes stay pickable.
const INITIAL_DISTANCE = 26
const MIN_DISTANCE = 4
const MAX_DISTANCE = 90
// Zoom out past this and the view hands back to the system, same
// scroll-past-the-edge gesture every other view level uses.
const EXIT_DISTANCE = 70

interface CombatViewSceneProps {
  engagementId: string
}

// The combat "detailed view" — an engagement rendered as a navigable 3D
// arena. Structurally a sibling of SatelliteViewScene (its own Canvas,
// OrbitControls, exit-by-zooming-out watcher, and a panel outside the
// Canvas), but its subject is a fight rather than a body.
export function CombatViewScene({ engagementId }: CombatViewSceneProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const exitCombat = useViewStore((s) => s.exitCombat)
  const engagement = useCombatStore((s) => s.engagements.find((e) => e.id === engagementId))
  const setParticipant = useCombatStore((s) => s.setParticipant)
  const setParticipantTarget = useCombatStore((s) => s.setParticipantTarget)
  const setCenter = useCombatStore((s) => s.setCenter)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const ships = useShipStore((s) => s.ships)

  // The fight ended while we were watching it (one side wiped out, or fled).
  // There's nothing left to render, so hand back to the system view rather
  // than sitting in an empty arena. Done in an effect, not during render,
  // since it's a store write.
  useEffect(() => {
    if (!engagement) exitCombat()
  }, [engagement, exitCombat])

  const selectedParticipant = useMemo(
    () => engagement?.participants.find((p) => p.shipId === selectedShipId) ?? null,
    [engagement, selectedShipId],
  )
  const selectedShip = ships.find((s) => s.id === selectedShipId)
  const canCommand = selectedShip?.allegiance === 'player' && !!selectedParticipant

  // Right-click the grid: walk the selected ship to the picked destination,
  // which CombatGrid has already resolved to a fine-lattice node (see
  // combatArena's pickLatticeNode — a click is a ray, and the lattice is what
  // supplies the depth it can't). Latches manual control (see
  // CombatParticipant.holdPosition) so the resolver's auto-approach doesn't
  // immediately undo the order.
  const handlePickPoint = (point: ArenaPoint) => {
    if (!engagement || !selectedParticipant || !canCommand) return
    // A ship spooling a drive has committed to leaving and can't maneuver.
    if (selectedShip?.combat.ftlCharge) return
    const simDays = useGameTimeStore.getState().simDays
    const ordered = orderParticipantTo(selectedParticipant, point, engagement.density, simDays, engagement.obstacles)
    // orderParticipantTo returns the participant unchanged when no route
    // exists (the point is inside a body, or walled off) — don't latch
    // manual control off an order that was refused.
    if (ordered === selectedParticipant) return
    // A manual order also drops chase and inherit-velocity (see
    // CombatParticipant.chasing/inheritVelocityFrom) — the player is taking
    // explicit control, so "resume auto" afterward should land back on the
    // ship's own stance rather than silently resuming a pursuit or a
    // velocity lock they never re-requested.
    setParticipant(engagement.id, { ...ordered, holdPosition: true, chasing: false, inheritVelocityFrom: null })
  }

  // Slides the window so it re-centres on the selected ship, putting fresh
  // space within ordering range. This is what stops the cube being a cage:
  // a ship can be walked anywhere, one window at a time.
  const handleRecenter = () => {
    if (!engagement || !selectedParticipant) return
    setCenter(engagement.id, selectedParticipant.position)
  }

  // Right-click a hostile marker: concentrate this ship's fire on it. A
  // second right-click on the SAME hostile clears it back to auto-targeting
  // — the same gesture that sets a target also undoes it, so there's a way
  // to revert without hunting for the panel's separate "Auto" button.
  const handleOrderTarget = (targetShipId: string) => {
    if (!engagement || !selectedParticipant || !canCommand) return
    const target = engagement.participants.find((p) => p.shipId === targetShipId)
    if (!target || target.side === selectedParticipant.side) return
    const alreadyTargeted = selectedParticipant.targetShipId === targetShipId
    setParticipantTarget(engagement.id, selectedParticipant.shipId, alreadyTargeted ? null : targetShipId)
  }

  if (!engagement) return null

  return (
    <div className="solar-system-wrapper">
      <Canvas camera={{ position: [INITIAL_DISTANCE * 0.6, INITIAL_DISTANCE * 0.5, INITIAL_DISTANCE * 0.7], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <Stars radius={300} depth={60} count={2000} factor={4} saturation={0} fade speed={0} />

        <CombatGrid
          center={engagement.center}
          density={engagement.density}
          obstacles={engagement.obstacles}
          onPickPoint={handlePickPoint}
        />

        {/* Committed routes for the player's own and allied ships only.
            Hostile and neutral ships still manoeuvre exactly as before — this
            hides the *information*, not the behaviour. Knowing precisely
            where an enemy is headed several seconds early trivialises the
            positioning the fight is played on; reading their heading off the
            hulls themselves is the intended skill. Each line reads its own
            live state per frame (it stays mounted and hides itself when
            there's no route), so a route appearing or completing doesn't
            remount anything. */}
        {engagement.participants.map((p) => {
          const ship = ships.find((s) => s.id === p.shipId)
          if (!ship) return null
          if (ship.allegiance !== 'player' && ship.allegiance !== 'friendly') return null
          return (
            <CombatPathLine
              key={`path-${p.shipId}`}
              engagementId={engagement.id}
              shipId={p.shipId}
              color={ALLEGIANCE_COLORS[ship.allegiance]}
            />
          )
        })}

        {/* Who is actually shooting at whom, right now. */}
        <CombatEngagementLine engagementId={engagement.id} />

        {engagement.participants.map((p) => (
          <CombatShipMarker
            key={p.shipId}
            engagementId={engagement.id}
            shipId={p.shipId}
            onOrderTarget={handleOrderTarget}
          />
        ))}

        <DistanceThresholdWatcher mode="max" threshold={EXIT_DISTANCE} onTrigger={exitCombat} controlsRef={controlsRef} />

        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={MIN_DISTANCE}
          maxDistance={MAX_DISTANCE}
        />
      </Canvas>

      <CombatPanel engagement={engagement} onRecenter={canCommand ? handleRecenter : undefined} />
      {/* Pushed right by the same gap the order panel is pushed left, so
          the two don't open on top of each other. */}
      {selectedShipId && <ShipPanel initialOffset={{ x: 0, y: combatPanelVerticalOffset() }} anchor="right" />}
    </div>
  )
}
