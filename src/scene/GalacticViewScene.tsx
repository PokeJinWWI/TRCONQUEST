import { BattleBadge } from '../components/BattleBadge'
import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { NeighborhoodData } from '../data/neighborhoodData'
import { NEIGHBORHOODS, neighborhoodScenePosition } from '../data/neighborhoodData'
import { useViewStore } from '../state/viewStore'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { DeepSpaceClickPlane } from './DeepSpaceClickPlane'
import { forwardWheelToCanvas } from '../utils/forwardWheel'
import { DraggableWindow } from '../components/DraggableWindow'

const MAX_DISTANCE = 6000
const FOCUS_ARRIVE_DISTANCE = 5
// How close (to the locked-on neighborhood) manually zooming in has to get
// before it counts as "entering" it — mirrors InterstellarScene's own
// ENTER_SYSTEM_DISTANCE, same select-first-then-zoom-or-button model one
// level up.
const ENTER_INTERSTELLAR_DISTANCE = 6
// The plain "just arrived, nothing selected" camera position — used both as
// the far-view starting position AND, translated to sit next to whichever
// neighborhood a continuity arrival is returning to (see
// continuityNeighborhoodPosition below), as the near-view one too. Same
// "offset either way" idea InterstellarScene's own DEFAULT_CAMERA_OFFSET
// already uses one level down.
const DEFAULT_CAMERA_OFFSET: [number, number, number] = [40, 60, 110]
const FAR_START: [number, number, number] = [0, 900, 1600]

interface NeighborhoodNodeProps {
  neighborhood: NeighborhoodData
  selected: boolean
  onSelect: (neighborhood: NeighborhoodData) => void
}

// A neighborhood is just a point here, exactly the way a star is just a
// point in interstellar view — no attempt to render the systems inside it at
// this scale.
function NeighborhoodNode({ neighborhood, selected, onSelect }: NeighborhoodNodeProps) {
  const [hovered, setHovered] = useState(false)
  const pos = neighborhoodScenePosition(neighborhood)

  return (
    <group position={pos}>
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
        <div
          className={`planet-marker star-node neighborhood-node${hovered ? ' hovered' : ''}${selected ? ' selected' : ''}`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onClick={() => onSelect(neighborhood)}
          onWheel={forwardWheelToCanvas}
        >
          <span className="marker-dot" style={{ borderColor: neighborhood.color }} />
          {(hovered || selected) && <span className="marker-label">{neighborhood.name}</span>}
          <BattleBadge scope={{ neighborhood: neighborhood.id }} />
        </div>
      </Html>
    </group>
  )
}

export function GalacticViewScene() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const enterInterstellar = useViewStore((s) => s.enterInterstellar)
  const selectedId = useViewStore((s) => s.inViewSelection)
  const selectInView = useViewStore((s) => s.selectInView)
  const lockOnEnabled = useViewStore((s) => s.lockOnEnabled)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const selected = useMemo(() => NEIGHBORHOODS.find((n) => n.id === selectedId) ?? null, [selectedId])
  const focused = useMemo(() => NEIGHBORHOODS.find((n) => n.id === focusedId) ?? null, [focusedId])

  // If we're arriving here because the player zoomed out of a neighborhood's
  // interstellar view, inViewSelection is already seeded to that
  // neighborhood (see exitInterstellarToGalactic) — used once, at mount,
  // purely to start the camera framed on it directly rather than snapping
  // all the way out to the far default. Captured via a ref (not read
  // reactively), same reasoning as InterstellarScene's own
  // continuityStarIdRef, so a later in-scene click doesn't retroactively
  // move where the camera STARTED.
  const continuityNeighborhoodIdRef = useRef(useViewStore.getState().inViewSelection)
  const continuityNeighborhoodPosition = useMemo<[number, number, number] | null>(() => {
    const id = continuityNeighborhoodIdRef.current
    if (!id) return null
    const neighborhood = NEIGHBORHOODS.find((n) => n.id === id)
    return neighborhood ? neighborhoodScenePosition(neighborhood) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    if (!continuityNeighborhoodPosition) return FAR_START
    return [
      continuityNeighborhoodPosition[0] + DEFAULT_CAMERA_OFFSET[0],
      continuityNeighborhoodPosition[1] + DEFAULT_CAMERA_OFFSET[1],
      continuityNeighborhoodPosition[2] + DEFAULT_CAMERA_OFFSET[2],
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const initialTarget = useMemo<[number, number, number]>(
    () => continuityNeighborhoodPosition ?? [0, 0, 0],
    [continuityNeighborhoodPosition],
  )

  // Select-first, same as every other level: clicking just locks the camera
  // on (SelectionTracker) — flying all the way in only starts once "Enter
  // Neighborhood" is pressed, or the player zooms in close enough themselves.
  const handleSelect = (neighborhood: NeighborhoodData) => {
    selectInView(neighborhood.id)
  }

  const handleEnterNeighborhood = () => {
    if (selected?.hasInterstellarData) setFocusedId(selected.id)
  }

  const handleUnfocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.planet-marker')) return
    selectInView(null)
  }

  return (
    <div className="galactic-wrapper">
      <Canvas camera={{ position: initialCameraPosition, fov: 50, near: 0.5, far: 20000 }} onPointerMissed={handleUnfocus}>
        <color attach="background" args={['#020409']} />
        <ambientLight intensity={0.3} />
        <Stars radius={4000} depth={1000} count={6000} factor={6} fade speed={0.1} />

        <DeepSpaceClickPlane onDeselect={() => selectInView(null)} onOrderTo={() => {}} size={200000} />

        {NEIGHBORHOODS.map((neighborhood) => (
          <NeighborhoodNode
            key={neighborhood.id}
            neighborhood={neighborhood}
            selected={neighborhood.id === selectedId}
            onSelect={handleSelect}
          />
        ))}

        {focused && (
          <CameraFocusRig
            key={focused.id}
            controlsRef={controlsRef}
            arriveDistance={FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() => new Vector3(...neighborhoodScenePosition(focused))}
            onArrive={() => enterInterstellar(focused.id)}
          />
        )}

        {selected && !focused && lockOnEnabled && (
          <SelectionTracker controlsRef={controlsRef} getPosition={() => new Vector3(...neighborhoodScenePosition(selected))} />
        )}

        {selected?.hasInterstellarData && !focused && lockOnEnabled && (
          <DistanceThresholdWatcher
            mode="min"
            threshold={ENTER_INTERSTELLAR_DISTANCE}
            onTrigger={handleEnterNeighborhood}
            controlsRef={controlsRef}
          />
        )}

        <OrbitControls
          ref={controlsRef}
          target={initialTarget}
          enabled={!focused}
          enablePan
          enableDamping
          dampingFactor={0.08}
          minDistance={1}
          maxDistance={MAX_DISTANCE}
        />
      </Canvas>

      {selected && (
        <DraggableWindow title={selected.name} onClose={() => selectInView(null)}>
          <div className="inspect-row">
            <span className="inspect-label">Distance from core</span>
            <span className="inspect-value">{Math.hypot(selected.position[0], selected.position[1]).toFixed(1)} kly</span>
          </div>
          <div className="inspect-divider" />
          {selected.hasInterstellarData ? (
            focused ? (
              <div className="inspect-status ok">Entering neighborhood…</div>
            ) : (
              <button type="button" className="detail-view-btn" onClick={handleEnterNeighborhood}>
                Enter Neighborhood
              </button>
            )
          ) : (
            <div className="inspect-status">Not yet charted</div>
          )}
        </DraggableWindow>
      )}
    </div>
  )
}
