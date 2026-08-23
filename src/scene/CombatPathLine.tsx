import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { nodeToArenaPosition, type GridDensity, type GridNode } from './combatArena'

interface CombatPathLineProps {
  /** Where the ship is now — the path's first leg starts here. */
  from: GridNode
  /** Remaining queued nodes, in order. */
  path: GridNode[]
  density: GridDensity
  /** The window's centre node — positions are drawn relative to it. */
  center: GridNode
  color?: string
}

// The lattice route a ship is currently committed to walking. Worth drawing
// for its own sake, not just as feedback: the whole point of constraining
// movement to the grid is that a route has a *shape*, and a ship crossing the
// arena diagonally visibly staircases rather than gliding. Without this the
// constraint is invisible and the grid may as well be decoration.
export function CombatPathLine({ from, path, density, center, color = '#4ade80' }: CombatPathLineProps) {
  const geometry = useMemo(() => {
    if (path.length === 0) return null
    const origin = nodeToArenaPosition(center, density)
    const positions: number[] = []
    let previous = from
    for (const node of path) {
      const a = nodeToArenaPosition(previous, density).sub(origin)
      const b = nodeToArenaPosition(node, density).sub(origin)
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      previous = node
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return g
  }, [from, path, density, center])

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.85} />
    </lineSegments>
  )
}
