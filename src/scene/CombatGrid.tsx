import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, DoubleSide, Vector3 } from 'three'
import {
  GRID_DIVISIONS,
  gridSpacing,
  isPointBlocked,
  pickLatticeNode,
  type ArenaPoint,
  type CombatObstacle,
  type GridDensity,
} from './combatArena'

// The arena's movement lattice, drawn DEFCON-style: pure wireframe, no
// surfaces. Three layers of decreasing subtlety — the full interior lattice
// (faint, it's reference not decoration), the node points (the things a move
// order actually resolves to, so they need to read as targets), and the
// arena's outer cage (brightest, it's the hard boundary of what's currently
// in frame).

const LATTICE_COLOR = '#2b6b80'
const NODE_COLOR = '#7ce8ff'
const CAGE_COLOR = '#7ce8ff'

// The interior lattice gets fainter as it gets denser — at 'fine' there are
// 867 lines crossing the view, and at a fixed opacity they'd read as fog
// rather than as a grid. Scales the other way too: a coarse lattice is sparse
// enough to carry more weight.
const LATTICE_OPACITY: Record<GridDensity, number> = {
  coarse: 0.5,
  standard: 0.3,
  fine: 0.16,
}

const NODE_SIZE: Record<GridDensity, number> = {
  coarse: 0.16,
  standard: 0.11,
  fine: 0.07,
}

// All geometry below is built in *window-local* space — relative to the
// window's center point — so sliding the window (see Engagement.center) costs
// nothing to redraw. The scene positions the whole group; only a density
// change rebuilds these buffers.

// Builds every axis-aligned lattice segment as one flat position buffer.
// For D subdivisions that's 3*(D+1)^2 segments (867 at 'fine'), all in a
// single draw call — cheap enough that there's no reason to cull interior
// lines or fade by distance.
function useLatticeGeometry(density: GridDensity, span: number): BufferGeometry {
  return useMemo(() => {
    const divisions = GRID_DIVISIONS[density]
    const spacing = gridSpacing(density, span)
    const half = divisions / 2
    const positions: number[] = []
    const at = (x: number, y: number, z: number) => [(x - half) * spacing, (y - half) * spacing, (z - half) * spacing]

    for (let a = 0; a <= divisions; a++) {
      for (let b = 0; b <= divisions; b++) {
        // Lines running along each axis in turn, spanning the full window.
        const xs = [at(0, a, b), at(divisions, a, b)]
        const ys = [at(a, 0, b), at(a, divisions, b)]
        const zs = [at(a, b, 0), at(a, b, divisions)]
        for (const [start, end] of [xs, ys, zs] as const) {
          positions.push(...start, ...end)
        }
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geometry
  }, [density, span])
}

function useNodeGeometry(density: GridDensity, span: number): BufferGeometry {
  return useMemo(() => {
    const divisions = GRID_DIVISIONS[density]
    const spacing = gridSpacing(density, span)
    const half = divisions / 2
    const positions: number[] = []
    for (let x = 0; x <= divisions; x++) {
      for (let y = 0; y <= divisions; y++) {
        for (let z = 0; z <= divisions; z++) {
          positions.push((x - half) * spacing, (y - half) * spacing, (z - half) * spacing)
        }
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geometry
  }, [density, span])
}

// The 12 edges of the window cube — drawn separately and brighter so the
// boundary of what can be ordered in one move always reads clearly, however
// faint the interior is.
function useCageGeometry(span: number): BufferGeometry {
  return useMemo(() => {
    const half = span / 2
    const corners: [number, number, number][] = []
    for (const x of [-half, half]) for (const y of [-half, half]) for (const z of [-half, half]) corners.push([x, y, z])
    const positions: number[] = []
    for (let i = 0; i < corners.length; i++) {
      for (let j = i + 1; j < corners.length; j++) {
        // Two corners form a cube edge iff they differ on exactly one axis.
        const differing = corners[i].filter((v, k) => v !== corners[j][k]).length
        if (differing !== 1) continue
        positions.push(...corners[i], ...corners[j])
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geometry
  }, [span])
}

interface CombatGridProps {
  center: ArenaPoint
  density: GridDensity
  obstacles: CombatObstacle[]
  // The window's own real span, in arena units — see
  // combatResolution.arenaWindowSpan. Proportional to the widest obstacle
  // sharing the engagement rather than a fixed size, so a body big enough to
  // matter (Sol) gets a window that actually contains it and the fleets
  // fighting near it, not a tiny fixed cage that needs constant Recentring.
  span: number
   /** Fires with the picked destination, in real absolute arena coordinates:
   * one of the nodes currently DRAWN at this density, which by the nesting
   * rule on GRID_DIVISIONS is always a fine-lattice point too. See
   * pickLatticeNode for why a click has to resolve to a node at all — a click
   * is a ray, and the lattice is the only thing supplying the depth it
   * lacks. */
  onPickPoint: (point: ArenaPoint) => void
}

// Drawn in window-local space and positioned by the caller — see
// CombatViewScene, which offsets the whole arena so the window center sits at
// the scene origin.
export function CombatGrid({ center, density, obstacles, span, onPickPoint }: CombatGridProps) {
  const lattice = useLatticeGeometry(density, span)
  const nodes = useNodeGeometry(density, span)
  const cage = useCageGeometry(span)
  const spacing = gridSpacing(density, span)
  // Needed to turn projected NDC into the pixel distances pickLatticeNode
  // reasons about — a capture radius means nothing until it's in screen units.
  const size = useThree((s) => s.size)
  // One node's worth of padding so the window's outer faces are still
  // comfortably inside the click-catcher.
  const catcherSize = span + spacing

  return (
    <group>
      <lineSegments geometry={lattice}>
        <lineBasicMaterial color={LATTICE_COLOR} transparent opacity={LATTICE_OPACITY[density]} />
      </lineSegments>

      <points geometry={nodes}>
        <pointsMaterial color={NODE_COLOR} size={NODE_SIZE[density]} transparent opacity={0.55} sizeAttenuation />
      </points>

      <lineSegments geometry={cage}>
        <lineBasicMaterial color={CAGE_COLOR} transparent opacity={0.5} />
      </lineSegments>

      {/* The celestial bodies sharing the arena. Rendered as a wireframe
          sphere plus a translucent shell rather than a solid one, matching
          this project's DEFCON/hologram language — and, practically, so
          ships behind the body stay visible as silhouettes instead of
          vanishing, which would make "why can't I shoot?" unreadable. */}
      {obstacles.map((obstacle) => {
        // Real position minus real center = window-local offset — no
        // density/spacing multiplication needed, both are already in real
        // arena units.
        const local: [number, number, number] = [
          obstacle.position.x - center.x,
          obstacle.position.y - center.y,
          obstacle.position.z - center.z,
        ]
        return (
          <group key={obstacle.name} position={local}>
            <mesh>
              <sphereGeometry args={[obstacle.radiusUnits, 24, 16]} />
              <meshBasicMaterial color={obstacle.color} transparent opacity={0.13} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[obstacle.radiusUnits, 16, 10]} />
              <meshBasicMaterial color={obstacle.color} wireframe transparent opacity={0.4} />
            </mesh>
          </group>
        )
      })}

      {/* Invisible click-catcher spanning the window. Kept as a real mesh
          with a zero-opacity material rather than `visible={false}`, because
          an invisible object is skipped by the raycaster entirely and would
          never receive the click. DoubleSide so it still catches once the
          camera is inside the cage. Rendered last so the bodies above don't
          swallow clicks — they're drawn without depth write and this sits
          over them in the raycast order.
          Right-click, not left: left-click-drag is OrbitControls' rotate
          gesture, and sharing the button with movement made ordinary camera
          orbiting and issuing a move order fight over the same input. Moving
          a ship is now unambiguously right-click, matching targeting
          (right-click a hostile marker) — the two never collide since
          they're different objects.
          NOTE: this mesh is only an event *receiver* now. Its intersection
          point is deliberately ignored — reading `e.point` is exactly the bug
          documented above pickLatticeNode, since a box raycast can only ever
          report a point on the box's own shell. What the click contributes is
          the cursor ray; the lattice supplies the depth. */}
      <mesh
        onContextMenu={(e) => {
          e.stopPropagation()
          e.nativeEvent.preventDefault()
          const camera = e.camera
          const toPixels = (ndcX: number, ndcY: number) => ({
            x: (ndcX * 0.5 + 0.5) * size.width,
            y: (-ndcY * 0.5 + 0.5) * size.height,
          })
          const world = new Vector3()
          const picked = pickLatticeNode(
            center,
            density,
            toPixels(e.pointer.x, e.pointer.y),
            (point) => {
              // Node geometry is drawn window-local, and the scene leaves this
              // group at the origin, so local coordinates *are* world ones.
              world.set(point.x - center.x, point.y - center.y, point.z - center.z)
              const depth = world.distanceTo(camera.position)
              world.project(camera)
              const screen = toPixels(world.x, world.y)
              return { ...screen, depth, visible: world.z >= -1 && world.z <= 1 }
            },
            { isBlocked: (point) => isPointBlocked(point, obstacles) },
            span,
          )
          if (picked) onPickPoint(picked)
        }}
      >
        <boxGeometry args={[catcherSize, catcherSize, catcherSize]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
    </group>
  )
}
