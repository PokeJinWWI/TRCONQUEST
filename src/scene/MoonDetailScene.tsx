import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { HologramBody } from './HologramBody'
import { FocusableMarker } from './FocusableMarker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import type { MoonData } from './moonData'
import type { InspectableBody } from './inspectableBody'
import { InspectPanel } from '../components/InspectPanel'

interface MoonDetailSceneProps {
  moon: MoonData
  /** The parent planet's distance from Sol, in AU — moons share their
   * planet's solar distance, so this feeds the same habitable-zone
   * heuristic used for planets (see bodyStats.ts). */
  parentOrbitAU: number | undefined
  onExit: () => void
}

const VISUAL_RADIUS = 3
// Same "shrink to a dot before handing back" tuning as the planet/star
// satellite view, relative to the same visual radius.
const MAX_DISTANCE = 160
const EXIT_DISTANCE = 130

export function MoonDetailScene({ moon, parentOrbitAU, onExit }: MoonDetailSceneProps) {
  const [inspected, setInspected] = useState(false)

  const body: InspectableBody = useMemo(
    () => ({
      name: moon.name,
      kind: 'moon',
      color: moon.color,
      radiusKm: moon.radiusKm,
      orbitPeriodDays: moon.periodDays,
      orbitAU: parentOrbitAU,
    }),
    [moon, parentOrbitAU],
  )

  const handleUnfocus = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('.planet-marker, .focused-label')) return
    setInspected(false)
  }

  return (
    <div className="satellite-view-wrapper">
      <Canvas camera={{ position: [0, 2, 9], fov: 50, near: 0.05, far: 2000 }} onPointerMissed={handleUnfocus}>
        <color attach="background" args={['#020409']} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[8, 4, 6]} intensity={2.2} color="#fff4d6" />
        <Stars radius={300} depth={80} count={3000} factor={2} fade speed={0.2} />

        <HologramBody color={moon.color} radius={VISUAL_RADIUS} variant="planet" onSelect={() => setInspected(true)} />
        <FocusableMarker name={moon.name} radius={VISUAL_RADIUS} onSelect={() => setInspected(true)} />

        <DistanceThresholdWatcher mode="max" threshold={EXIT_DISTANCE} onTrigger={onExit} />

        <OrbitControls
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={VISUAL_RADIUS + 1}
          maxDistance={MAX_DISTANCE}
        />
      </Canvas>

      {inspected && <InspectPanel body={body} onClose={() => setInspected(false)} />}
    </div>
  )
}
