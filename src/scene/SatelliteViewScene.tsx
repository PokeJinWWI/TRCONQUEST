import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { HologramBody } from './HologramBody'
import { FocusableMarker } from './FocusableMarker'
import { Moon } from './Moon'
import { MoonDetailScene } from './MoonDetailScene'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { getMoonPosition } from './orbitMath'
import { PLANETS, SUN_RADIUS_KM, UNITS_PER_AU } from './planetData'
import { getMoonsForPlanet } from './moonData'
import type { MoonData } from './moonData'
import type { InspectableBody } from './inspectableBody'
import { useGameTimeStore, simDaysToYears } from '../state/gameTimeStore'
import { useViewStore } from '../state/viewStore'
import { InspectPanel } from '../components/InspectPanel'

interface SatelliteViewSceneProps {
  bodyName: string
}

const PRIMARY_VISUAL_RADIUS = 3
// Tuned so the body has visibly shrunk to a small, distant shape before
// handing back to system view — matches the "shrink to a dot" treatment
// used for the other view-level transitions.
const MAX_DISTANCE = 160
const EXIT_DISTANCE = 130
// Moons are tiny relative to the primary body's visual scale, so a much
// tighter arrive distance than the system view's planet fly-in reads right.
const MOON_FOCUS_ARRIVE_DISTANCE = 1
const SOL_COLOR = '#ffd27a'

export function SatelliteViewScene({ bodyName }: SatelliteViewSceneProps) {
  const exitSatelliteToSystem = useViewStore((s) => s.exitSatelliteToSystem)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const [inspected, setInspected] = useState<InspectableBody | null>(null)
  const [flyingToMoon, setFlyingToMoon] = useState<MoonData | null>(null)
  // Set once CameraFocusRig arrives at a moon — swaps this scene over to
  // MoonDetailScene until the player zooms back out.
  const [focusedMoon, setFocusedMoon] = useState<MoonData | null>(null)

  const isStar = bodyName === 'Sol'
  const planetData = useMemo(() => (!isStar ? PLANETS.find((p) => p.name === bodyName) : undefined), [bodyName, isStar])
  const color = isStar ? SOL_COLOR : planetData?.color ?? '#ffffff'
  const orbitAU = planetData ? planetData.orbitRadius / UNITS_PER_AU : undefined
  const moonInfo = useMemo(() => (!isStar ? getMoonsForPlanet(bodyName) : { totalCount: 0, moons: [] }), [bodyName, isStar])

  const primaryBody: InspectableBody = useMemo(() => {
    if (isStar) {
      return { name: 'Sol', kind: 'star', color, radiusKm: SUN_RADIUS_KM }
    }
    return {
      name: planetData?.name ?? bodyName,
      kind: 'planet',
      color,
      radiusKm: planetData?.radiusKm ?? 0,
      orbitAU,
      orbitPeriodYears: planetData?.orbitPeriodYears,
      moonCount: moonInfo.totalCount,
    }
  }, [isStar, planetData, color, orbitAU, moonInfo, bodyName])

  // The moon currently open in the inspect window, if any — also what gets
  // camera-locked (SelectionTracker) and what "Detailed View" flies to.
  const selectedMoon = useMemo(
    () => (inspected?.kind === 'moon' ? moonInfo.moons.find((m) => m.name === inspected.name) ?? null : null),
    [inspected, moonInfo],
  )

  const handleSelectMoon = (moon: MoonData) => {
    setInspected({
      name: moon.name,
      kind: 'moon',
      color: moon.color,
      radiusKm: moon.radiusKm,
      orbitPeriodDays: moon.periodDays,
      orbitAU,
    })
  }

  // Same onPointerMissed/marker-click race as every other view — ignore
  // misses that actually landed on a marker or the prominent focused label.
  const handleUnfocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.planet-marker, .focused-label')) return
    setInspected(null)
  }

  const handleDetailedView = () => {
    if (selectedMoon) setFlyingToMoon(selectedMoon)
  }

  if (focusedMoon) {
    return (
      <div key={`moon:${focusedMoon.name}`} className="view-transition">
        <MoonDetailScene moon={focusedMoon} parentOrbitAU={orbitAU} onExit={() => setFocusedMoon(null)} />
      </div>
    )
  }

  return (
    <div key="primary" className="view-transition">
      <div className="satellite-view-wrapper">
        <Canvas camera={{ position: [0, 2, 9], fov: 50, near: 0.05, far: 2000 }} onPointerMissed={handleUnfocus}>
          <color attach="background" args={['#020409']} />
          <ambientLight intensity={0.25} />
          {!isStar && <directionalLight position={[8, 4, 6]} intensity={2.2} color="#fff4d6" />}
          <Stars radius={300} depth={80} count={3000} factor={2} fade speed={0.2} />

          <HologramBody
            color={color}
            radius={PRIMARY_VISUAL_RADIUS}
            variant={isStar ? 'star' : 'planet'}
            onSelect={() => setInspected(primaryBody)}
          />
          <FocusableMarker
            name={primaryBody.name}
            color={color}
            radius={PRIMARY_VISUAL_RADIUS}
            focused={inspected?.name === primaryBody.name}
            onSelect={() => setInspected(primaryBody)}
          />

          {moonInfo.moons.map((moon) => (
            <Moon key={moon.name} moon={moon} selected={inspected?.name === moon.name} onSelect={handleSelectMoon} />
          ))}

          {flyingToMoon && (
            <CameraFocusRig
              key={flyingToMoon.name}
              controlsRef={controlsRef}
              arriveDistance={MOON_FOCUS_ARRIVE_DISTANCE}
              getTargetPosition={() => getMoonPosition(flyingToMoon, simDaysToYears(useGameTimeStore.getState().simDays))}
              onArrive={() => {
                setFocusedMoon(flyingToMoon)
                setFlyingToMoon(null)
              }}
            />
          )}

          {selectedMoon && !flyingToMoon && (
            <SelectionTracker
              controlsRef={controlsRef}
              getPosition={() => getMoonPosition(selectedMoon, simDaysToYears(useGameTimeStore.getState().simDays))}
            />
          )}

          {!flyingToMoon && (
            <DistanceThresholdWatcher
              mode="max"
              threshold={EXIT_DISTANCE}
              onTrigger={exitSatelliteToSystem}
              controlsRef={controlsRef}
            />
          )}

          <OrbitControls
            ref={controlsRef}
            enabled={!flyingToMoon}
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            minDistance={PRIMARY_VISUAL_RADIUS + 1}
            maxDistance={MAX_DISTANCE}
          />
        </Canvas>

        {inspected && (
          <InspectPanel
            body={inspected}
            onClose={() => setInspected(null)}
            action={
              selectedMoon
                ? {
                    label: 'Detailed View',
                    pendingLabel: 'Entering orbit…',
                    pending: !!flyingToMoon,
                    onClick: handleDetailedView,
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  )
}
