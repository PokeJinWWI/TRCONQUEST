import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'

export function GalacticViewScene() {
  return (
    <div className="galactic-wrapper">
      <Canvas camera={{ position: [0, 0, 40], fov: 50 }}>
        <color attach="background" args={['#020409']} />
        <Stars radius={800} depth={300} count={8000} factor={4} fade speed={0.15} />
      </Canvas>
      <div className="galactic-placeholder">
        <div className="galactic-placeholder-title">GALACTIC VIEW</div>
        <div className="galactic-placeholder-sub">Not yet charted</div>
      </div>
    </div>
  )
}
