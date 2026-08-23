import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, DoubleSide, Vector3, type Ray } from 'three'
import {
  ARENA_SPAN_UNITS,
  GRID_DIVISIONS,
  gridSpacing,
  type CombatObstacle,
  type GridDensity,
  type GridNode,
} from './combatArena'

// The arena's movement lattice, drawn DEFCON-style: pure wireframe, no
// surfaces. Three layers of decreasing subtlety — the full interior lattice
// (faint, it's reference not decoration), the node points ships can actually
// occupy, and the arena's outer cage (brightest, it's the hard boundary of
// the fight).

const LATTICE_COLOR = '#2b6b80'
const NODE_COLOR = '#7ce8ff'
const CAGE_COLOR = '#7ce8ff'

// The interior lattice gets fainter as it gets denser — at 'fine' there are
// 507 lines crossing the view, and at a fixed opacity they'd read as fog
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
// window's centre node — so sliding the window (see Engagement.center) costs
// nothing to redraw. The scene positions the whole group; only a density
// change rebuilds these buffers.

// Builds every axis-aligned lattice segment as one flat position buffer.
// For D subdivisions that's 3*(D+1)^2 segments (507 at 'fine'), all in a
// single draw call — cheap enough that there's no reason to cull interior
// lines or fade by distance.
function useLatticeGeometry(density: GridDensity): BufferGeometry {
  return useMemo(() => {
    const divisions = GRID_DIVISIONS[density]
    const spacing = gridSpacing(density)
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
  }, [density])
}

function useNodeGeometry(density: GridDensity): BufferGeometry {
  return useMemo(() => {
    const divisions = GRID_DIVISIONS[density]
    const spacing = gridSpacing(density)
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
  }, [density])
}

// The 12 edges of the window cube — drawn separately and brighter so the
// boundary of what can be ordered in one move always reads clearly, however
// faint the interior is.
function useCageGeometry(): BufferGeometry {
  return useMemo(() => {
    const half = ARENA_SPAN_UNITS / 2
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
  }, [])
}

// Nearest lattice node to a click ray, searched over the current window.
//
// A click ray passes through many nodes, so "what did they click on" can't be
// answered by a hit test — instead every node is scored by its perpendicular
// distance to the ray and the closest wins. That's the behavior players
// actually expect from a 3D grid (it picks what looks nearest the cursor
// line), and at 2,197 nodes worst case it's a trivial per-click loop rather
// than something needing 2,197 raycast targets in the scene.
//
// `ray` arrives in the group's local space (r3f transforms it for us), so the
// search runs in window-local coordinates and the result is offset back to an
// absolute node at the end.
export function nearestNodeToRay(ray: Ray, center: GridNode, density: GridDensity): GridNode {
  const divisions = GRID_DIVISIONS[density]
  const spacing = gridSpacing(density)
  const half = divisions / 2
  let best: GridNode = center
  let bestScore = Infinity
  const point = new Vector3()
  for (let x = 0; x <= divisions; x++) {
    for (let y = 0; y <= divisions; y++) {
      for (let z = 0; z <= divisions; z++) {
        point.set((x - half) * spacing, (y - half) * spacing, (z - half) * spacing)
        const score = ray.distanceSqToPoint(point)
        if (score < bestScore) {
          bestScore = score
          best = { x: center.x + x - half, y: center.y + y - half, z: center.z + z - half }
        }
      }
    }
  }
  return best
}

interface CombatGridProps {
  center: GridNode
  density: GridDensity
  obstacles: CombatObstacle[]
  /** Fires with the absolute lattice node nearest the click ray. */
  onPickNode: (node: GridNode) => void
}

// Drawn in window-local space and positioned by the caller — see
// CombatViewScene, which offsets the whole arena so the window centre sits at
// the scene origin.
export function CombatGrid({ center, density, obstacles, onPickNode }: CombatGridProps) {
  const lattice = useLatticeGeometry(density)
  const nodes = useNodeGeometry(density)
  const cage = useCageGeometry()
  const spacing = gridSpacing(density)
  // One node's worth of padding so nodes on the window's outer faces are
  // still comfortably inside the click-catcher.
  const catcherSize = ARENA_SPAN_UNITS + spacing

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
        const local = [
          (obstacle.node.x - center.x) * spacing,
          (obstacle.node.y - center.y) * spacing,
          (obstacle.node.z - center.z) * spacing,
        ] as const
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
          over them in the raycast order. */}
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          onPickNode(nearestNodeToRay(e.ray, center, density))
        }}
      >
        <boxGeometry args={[catcherSize, catcherSize, catcherSize]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
    </group>
  )
}
