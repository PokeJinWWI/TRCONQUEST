import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { PLANETS, UNITS_PER_AU } from './planetData'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { getPlanetPosition } from './orbitMath'
import { useGameTimeStore, simDaysToYears } from '../state/gameTimeStore'
import { useViewStore } from '../state/viewStore'

const MAX_DISTANCE = 32000
const EXIT_DISTANCE = 26000
const FOCUS_ARRIVE_DISTANCE = 1.4
// How close (to the locked-on body) manually zooming in has to get before it
// counts as "entering" satellite view, same idea as Detailed View but driven
// by the player's own zoom instead of the explicit button/fly animation.
const ENTER_SATELLITE_DISTANCE = 3
const SOL_NAME = 'Sol'

// Default, far-out starting camera direction/distance for a fresh arrival
// (fly-in from interstellar, breadcrumb) — the whole system reads as a
// distant cluster, matching the "shrink to a dot" feel of leaving it.
const FAR_START = new Vector3(0, 6300, 8400)
// "Somewhat close" starting distance used instead when returning from
// satellite view via zoom-out, so exiting a body's close-up reads as
// gradually pulling back to a lower level of detail, not jumping to a
// different, distant view.
const NEAR_START_DISTANCE = 18

const ORIGIN = new Vector3(0, 0, 0)

function getBodyPosition(name: string): Vector3 {
  if (name === SOL_NAME) return ORIGIN.clone()
  const data = PLANETS.find((p) => p.name === name)
  if (!data) return ORIGIN.clone()
  return getPlanetPosition(data, simDaysToYears(useGameTimeStore.getState().simDays))
}

export function SolarSystemScene() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const enterSatellite = useViewStore((s) => s.enterSatellite)
  const enterInterstellar = useViewStore((s) => s.enterInterstellar)

  // If we're arriving here because the player zoomed out of a body's
  // satellite view, selectedBodyName is still set (see exitSatelliteToSystem)
  // — use it once, at mount, to both pre-select that body (so the camera
  // lock engages immediately) and to start the camera nearby instead of at
  // the far default. A fresh arrival (breadcrumb, interstellar fly-in) has
  // selectedBodyName cleared, so this is a no-op in that case.
  const continuityBodyRef = useRef(useViewStore.getState().selectedBodyName)

  // Selecting a body locks the camera onto it immediately (see
  // SelectionTracker) — `selectedName` doubles as "what's tracked" except
  // while flying to a Detailed View, when CameraFocusRig takes over instead.
  const [selectedName, setSelectedName] = useState<string | null>(() => continuityBodyRef.current)
  const [flyingToName, setFlyingToName] = useState<string | null>(null)

  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    if (!continuityBodyRef.current) return [FAR_START.x, FAR_START.y, FAR_START.z]
    const target = getBodyPosition(continuityBodyRef.current)
    const dir = FAR_START.clone().normalize().multiplyScalar(NEAR_START_DISTANCE)
    const pos = target.add(dir)
    return [pos.x, pos.y, pos.z]
    // Computed once, at mount, from whatever the state was at that moment —
    // deliberately not reactive to later selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedPlanetData = useMemo(
    () => (selectedName && selectedName !== SOL_NAME ? PLANETS.find((p) => p.name === selectedName) : undefined),
    [selectedName],
  )
  const flyingPlanetData = useMemo(
    () => (flyingToName && flyingToName !== SOL_NAME ? PLANETS.find((p) => p.name === flyingToName) : undefined),
    [flyingToName],
  )

  const handleSelect = (name: string) => {
    setSelectedName(name)
    setFlyingToName(null)
  }

  // r3f's onPointerMissed fires for any click inside the canvas's shared
  // event container that doesn't hit a 3D object — which includes clicks on
  // our HTML marker overlays (they share that container so drei's Html can
  // render above the canvas). Without this guard, selecting a planet and the
  // "miss" firing for that same click race in the same tick and the miss
  // wins, silently undoing the selection. Ignore misses that actually landed
  // on a marker; the marker's own onClick already handled them.
  const handleUnfocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.planet-marker')) return
    setSelectedName(null)
  }

  const handleDetailedView = () => {
    if (!selectedName) return
    setFlyingToName(selectedName)
  }

  return (
    <div className="solar-system-wrapper">
      <Canvas
        camera={{ position: initialCameraPosition, fov: 50, near: 0.02, far: 40000 }}
        onPointerMissed={handleUnfocus}
      >
        <color attach="background" args={['#020409']} />
        <ambientLight intensity={0.15} />
        <Stars radius={40000} depth={8000} count={6000} factor={4} fade speed={0.3} />

        <Sun selected={selectedName === SOL_NAME} onSelect={() => handleSelect(SOL_NAME)} />
        {PLANETS.map((planet) => (
          <Planet key={planet.name} data={planet} selected={selectedName === planet.name} onSelect={handleSelect} />
        ))}

        {flyingToName && (
          <CameraFocusRig
            key={flyingToName}
            controlsRef={controlsRef}
            arriveDistance={FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() =>
              flyingPlanetData
                ? getPlanetPosition(flyingPlanetData, simDaysToYears(useGameTimeStore.getState().simDays))
                : ORIGIN
            }
            onArrive={() => enterSatellite(flyingToName)}
          />
        )}

        {selectedName && !flyingToName && (
          <SelectionTracker
            controlsRef={controlsRef}
            getPosition={() =>
              selectedPlanetData
                ? getPlanetPosition(selectedPlanetData, simDaysToYears(useGameTimeStore.getState().simDays))
                : ORIGIN
            }
          />
        )}

        {!flyingToName && (
          <DistanceThresholdWatcher
            mode="max"
            threshold={EXIT_DISTANCE}
            onTrigger={enterInterstellar}
            controlsRef={controlsRef}
          />
        )}

        {selectedName && !flyingToName && (
          <DistanceThresholdWatcher
            mode="min"
            threshold={ENTER_SATELLITE_DISTANCE}
            onTrigger={() => enterSatellite(selectedName)}
            controlsRef={controlsRef}
          />
        )}

        <OrbitControls
          ref={controlsRef}
          enabled={!flyingToName}
          enablePan
          enableDamping
          dampingFactor={0.08}
          minDistance={0.2}
          maxDistance={MAX_DISTANCE}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />
      </Canvas>

      {selectedName && (
        <div className="star-info-panel">
          <div className="star-info-name">{selectedName}</div>
          {selectedName === SOL_NAME ? (
            <div className="star-info-dist">The system's star</div>
          ) : (
            selectedPlanetData && (
              <div className="star-info-dist">
                {(selectedPlanetData.orbitRadius / UNITS_PER_AU).toFixed(2)} AU · {selectedPlanetData.orbitPeriodYears.toFixed(2)} yr orbit
              </div>
            )
          )}
          {flyingToName ? (
            <div className="star-info-status ok">Entering orbit…</div>
          ) : (
            <button type="button" className="detail-view-btn" onClick={handleDetailedView}>
              Detailed View
            </button>
          )}
        </div>
      )}
    </div>
  )
}
