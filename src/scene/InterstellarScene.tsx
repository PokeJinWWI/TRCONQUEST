import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { StarData } from '../data/starData'
import { STARS, UNITS_PER_LY } from '../data/starData'
import { useViewStore } from '../state/viewStore'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

const ENTER_DISTANCE = 6
const MAX_DISTANCE = 4200
const EXIT_DISTANCE = 3500
const FOCUS_ARRIVE_DISTANCE = 4
// How close (to the locked-on star) manually zooming in has to get before it
// counts as "entering" its system — mirrors system view's manual
// zoom-to-enter-satellite threshold, same select-first model.
const ENTER_SYSTEM_DISTANCE = 4.5

function toScenePos(star: StarData): [number, number, number] {
  return [
    star.position[0] * UNITS_PER_LY,
    star.position[2] * UNITS_PER_LY,
    star.position[1] * UNITS_PER_LY,
  ]
}

interface StarNodeProps {
  star: StarData
  selected: boolean
  onSelect: (star: StarData) => void
}

// Stars are just labels here, same as planets in system view — no 3D sphere
// model, just a fixed-size marker anchored at the star's true position.
function StarNode({ star, selected, onSelect }: StarNodeProps) {
  const [hovered, setHovered] = useState(false)
  const pos = toScenePos(star)

  return (
    <group position={pos}>
      <Html style={{ pointerEvents: 'auto' }}>
        <div
          className={`planet-marker star-node${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={() => onSelect(star)}
          onWheel={forwardWheelToCanvas}
        >
          <span className="marker-dot" style={{ borderColor: star.color }} />
          <span className="marker-label">{star.name}</span>
        </div>
      </Html>
    </group>
  )
}

export function InterstellarScene() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const enterSystem = useViewStore((s) => s.enterSystem)
  const enterGalactic = useViewStore((s) => s.enterGalactic)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const selectedStar = useMemo(() => STARS.find((s) => s.id === selectedId) ?? null, [selectedId])
  const focusedStar = useMemo(() => STARS.find((s) => s.id === focusedId) ?? null, [focusedId])

  // Select-first, same as system view: clicking a star just locks the
  // camera onto it (SelectionTracker, smooth eased pan) — flying all the way
  // in (CameraFocusRig) only starts once "Enter System" is pressed, or the
  // player manually zooms in close enough on their own.
  const handleSelect = (star: StarData) => {
    setSelectedId(star.id)
  }

  const handleEnterSystem = () => {
    if (selectedStar?.hasSystemData) setFocusedId(selectedStar.id)
  }

  // Same race as system view: r3f's onPointerMissed fires for any click that
  // doesn't raycast-hit a 3D object, including clicks on our HTML star
  // markers (they share the canvas's event container). Ignore misses that
  // actually landed on a marker so its own onClick isn't immediately undone.
  const handleUnfocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.planet-marker')) return
    setSelectedId(null)
  }

  return (
    <div className="interstellar-wrapper">
      <Canvas camera={{ position: [20, 30, 55], fov: 50, near: 0.05, far: 5000 }} onPointerMissed={handleUnfocus}>
        <color attach="background" args={['#020409']} />
        <ambientLight intensity={0.3} />
        <Stars radius={800} depth={200} count={5000} factor={3} fade speed={0.2} />

        {/* No connecting lines yet — those represent plotted routes, which
            the player draws later. Just the star nodes themselves for now. */}
        {STARS.map((star) => (
          <StarNode key={star.id} star={star} selected={star.id === selectedId} onSelect={handleSelect} />
        ))}

        {focusedStar && (
          <CameraFocusRig
            key={focusedStar.id}
            controlsRef={controlsRef}
            arriveDistance={FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() => new Vector3(...toScenePos(focusedStar))}
            onArrive={() => enterSystem(focusedStar.id)}
          />
        )}

        {selectedStar && !focusedStar && (
          <SelectionTracker controlsRef={controlsRef} getPosition={() => new Vector3(...toScenePos(selectedStar))} />
        )}

        {selectedStar?.hasSystemData && !focusedStar && (
          <DistanceThresholdWatcher
            mode="min"
            threshold={ENTER_SYSTEM_DISTANCE}
            onTrigger={handleEnterSystem}
            controlsRef={controlsRef}
          />
        )}

        {!focusedStar && (
          <>
            <DistanceThresholdWatcher mode="min" threshold={ENTER_DISTANCE} onTrigger={() => enterSystem('sol')} />
            <DistanceThresholdWatcher mode="max" threshold={EXIT_DISTANCE} onTrigger={enterGalactic} controlsRef={controlsRef} />
          </>
        )}

        <OrbitControls
          ref={controlsRef}
          enabled={!focusedStar}
          enablePan
          enableDamping
          dampingFactor={0.08}
          minDistance={1}
          maxDistance={MAX_DISTANCE}
        />
      </Canvas>

      {selectedStar && (
        <div className="star-info-panel">
          <div className="star-info-name">{selectedStar.name}</div>
          <div className="star-info-dist">{selectedStar.distanceLy.toFixed(2)} ly from Sol</div>
          {selectedStar.hasSystemData ? (
            focusedStar ? (
              <div className="star-info-status ok">Entering system…</div>
            ) : (
              <button type="button" className="detail-view-btn" onClick={handleEnterSystem}>
                Enter System
              </button>
            )
          ) : (
            <div className="star-info-status">No system data available</div>
          )}
        </div>
      )}
    </div>
  )
}
