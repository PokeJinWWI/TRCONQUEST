import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import type { PlanetData } from './planetData'
import { HologramPlanet } from './HologramPlanet'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { useViewStore } from '../state/viewStore'

interface PlanetViewSceneProps {
  data: PlanetData
}

const VISUAL_RADIUS = 3
// Tuned so the planet has visibly shrunk to a small, distant shape before
// handing back to system view — not a modest zoom-out (matches the same
// "shrink to a dot before leaving" treatment used for system/interstellar).
const MAX_DISTANCE = 160
const EXIT_DISTANCE = 130

export function PlanetViewScene({ data }: PlanetViewSceneProps) {
  const selectedStarId = useViewStore((s) => s.selectedStarId)
  const enterSystem = useViewStore((s) => s.enterSystem)

  return (
    <Canvas camera={{ position: [0, 2, 9], fov: 50, near: 0.05, far: 2000 }}>
      <color attach="background" args={['#020409']} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[8, 4, 6]} intensity={2.2} color="#fff4d6" />
      <Stars radius={300} depth={80} count={3000} factor={2} fade speed={0.2} />

      <HologramPlanet data={data} radius={VISUAL_RADIUS} />
      <DistanceThresholdWatcher mode="max" threshold={EXIT_DISTANCE} onTrigger={() => enterSystem(selectedStarId)} />

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={VISUAL_RADIUS + 1}
        maxDistance={MAX_DISTANCE}
      />
    </Canvas>
  )
}
