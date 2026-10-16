import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import type { Group } from 'three'
import { SurfaceGlobeMesh } from './GroundViewScene'
import { HoloPlanet } from './HoloPlanet'
import { groundSurface } from './groundLogic'
import { OrbitRing } from './OrbitRing'
import { getMoonPosition, getOrbitPosition } from './orbitMath'
import { rotationHours } from '../data/bodyRotation'
import type { MoonData } from './moonData'
import type { MenuWorld } from './menuWorld'

// The main menu's background: the world big on the right, turning on its axis, with its moons
// circling it on their rings and a few specks of orbital traffic. All motion runs on the scene's
// own clock (the game clock does not run on the menu).
// A world drawn exactly as the ground map draws it (GroundViewScene's own globe), unowned.
function GroundGlobe({ bodyName, radius, color }: { bodyName: string; radius: number; color: string }) {
  const surface = useMemo(() => groundSurface(bodyName, {}), [bodyName])
  // A world with no ground (a gas giant) has no map: the plain hologram.
  if (!surface) return <HoloPlanet color={color} radius={radius} />
  return <SurfaceGlobeMesh surface={surface} radius={radius} />
}

const PRIMARY_RADIUS = 3 // the radius moonData lays its orbits out for
const SPIN_SECONDS = 60 // one turn of the world on the menu, whatever its real day
const MOON_YEARS_PER_SECOND = 0.08 // moonData's own time scale (MOON_TIME_DILATION included)
const TILT = 0.28 // radians the axis leans
const ORBIT_SQUEEZE = 0.35 // moonData's rings are laid out for a roomy view; pulled in so they fit the screen

function OrbitingMoon({ moon }: { moon: MoonData }) {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    ref.current?.position.copy(getMoonPosition(moon, state.clock.elapsedTime * MOON_YEARS_PER_SECOND))
  })
  return (
    <>
      <OrbitRing radius={moon.orbitRadius} inclinationDeg={moon.inclinationDeg} />
      <group ref={ref}>
        <GroundGlobe bodyName={moon.name} radius={moon.visualRadius} color={moon.color} />
      </group>
    </>
  )
}

// Decoration, not simulation: a handful of bright specks on inclined rings close in.
const TRAFFIC = [
  { radius: 1.5, incl: 62, node: 20, period: 9, phase: 0 },
  { radius: 1.9, incl: -38, node: 140, period: 14, phase: 2.1 },
  { radius: 2.3, incl: 8, node: 0, period: 22, phase: 4.0 },
  { radius: 1.7, incl: 80, node: 250, period: 11, phase: 5.2 },
]
function Speck({ radius, incl, node, period, phase }: (typeof TRAFFIC)[number]) {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    const angle = phase + (state.clock.elapsedTime / period) * Math.PI * 2
    ref.current?.position.copy(getOrbitPosition(PRIMARY_RADIUS + radius, angle, incl, node))
  })
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  )
}

function World({ world }: { world: MenuWorld }) {
  const viewport = useThree((s) => s.viewport)
  const spin = useRef<Group>(null)
  // Spin direction follows the real rotation (Venus turns backwards).
  const direction = rotationHours(world.name) < 0 ? -1 : 1
  useFrame((state) => {
    if (spin.current) spin.current.rotation.y = direction * (state.clock.elapsedTime / SPIN_SECONDS) * Math.PI * 2
  })
  const moons = useMemo(() => world.moons.map((m) => ({ ...m, orbitRadius: PRIMARY_RADIUS + (m.orbitRadius - PRIMARY_RADIUS) * ORBIT_SQUEEZE })), [world])
  const scale = (viewport.height * 0.32) / PRIMARY_RADIUS
  const x = Math.min(viewport.width * 0.24, viewport.width / 2 - viewport.height * 0.34)
  return (
    <group position={[x, -viewport.height * 0.03, 0]} scale={scale} rotation={[0, 0, TILT]}>
      <group ref={spin}>
        <GroundGlobe bodyName={world.name} radius={PRIMARY_RADIUS} color={world.color} />
      </group>
      {moons.map((m) => (
        <OrbitingMoon key={m.name} moon={m} />
      ))}
      {TRAFFIC.map((t) => (
        <Speck key={t.period} {...t} />
      ))}
    </group>
  )
}

export function MenuBackdrop({ world }: { world: MenuWorld }) {
  return (
    <Canvas className="menu-backdrop" camera={{ position: [0, 0, 16], fov: 45, near: 0.1, far: 1000 }} dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }}>
      <Stars radius={200} depth={60} count={2500} factor={3} fade speed={0.3} />
      <World world={world} />
    </Canvas>
  )
}
