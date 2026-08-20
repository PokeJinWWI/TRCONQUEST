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
// How close (to the locked-on planet) manually zooming in has to get before
// it counts as "entering" the planet, same idea as Detailed View but driven
// by the player's own zoom instead of the explicit button/fly animation.
const ENTER_PLANET_DISTANCE = 3
const SOL_NAME = 'Sol'

const ORIGIN = new Vector3(0, 0, 0)

export function SolarSystemScene() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  // Selecting a body locks the camera onto it immediately (see
  // SelectionTracker) — `selectedName` doubles as "what's tracked" except
  // while flying to a Detailed View, when CameraFocusRig takes over instead.
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [flyingToName, setFlyingToName] = useState<string | null>(null)
  const enterPlanet = useViewStore((s) => s.enterPlanet)
  const enterInterstellar = useViewStore((s) => s.enterInterstellar)

  const selectedPlanetData = useMemo(
    () => (selectedName && selectedName !== SOL_NAME ? PLANETS.find((p) => p.name === selectedName) : undefined),
    [selectedName],
  )
  const flyingPlanetData = useMemo(
    () => (flyingToName ? PLANETS.find((p) => p.name === flyingToName) : undefined),
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
    if (!selectedPlanetData) return
    setFlyingToName(selectedName)
  }

  return (
    <div className="solar-system-wrapper">
      <Canvas
        camera={{ position: [0, 6300, 8400], fov: 50, near: 0.02, far: 40000 }}
        onPointerMissed={handleUnfocus}
      >
        <color attach="background" args={['#020409']} />
        <ambientLight intensity={0.15} />
        <Stars radius={40000} depth={8000} count={6000} factor={4} fade speed={0.3} />

        <Sun selected={selectedName === SOL_NAME} onSelect={() => handleSelect(SOL_NAME)} />
        {PLANETS.map((planet) => (
          <Planet key={planet.name} data={planet} selected={selectedName === planet.name} onSelect={handleSelect} />
        ))}

        {flyingToName && flyingPlanetData && (
          <CameraFocusRig
            key={flyingToName}
            controlsRef={controlsRef}
            arriveDistance={FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() =>
              getPlanetPosition(flyingPlanetData, simDaysToYears(useGameTimeStore.getState().simDays))
            }
            onArrive={() => enterPlanet(flyingToName)}
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

        {selectedPlanetData && !flyingToName && (
          <DistanceThresholdWatcher
            mode="min"
            threshold={ENTER_PLANET_DISTANCE}
            onTrigger={() => enterPlanet(selectedName!)}
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
            selectedPlanetData && (
              <button type="button" className="detail-view-btn" onClick={handleDetailedView}>
                Detailed View
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
