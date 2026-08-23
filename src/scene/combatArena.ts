// The combat arena's 3D movement lattice.
//
// Combat happens on an unbounded integer lattice. Ships occupy nodes and
// travel along the lattice's *edges* — axis aligned or diagonal — rather than
// flying freely, which is what turns positioning into a decision rather than
// a formality.
//
// The cube the player sees is a *window* onto that lattice, not the lattice
// itself: it's centred on `Engagement.center` and spans ARENA_SPAN_UNITS.
// Recentring it slides the window, so a fight is never actually confined to
// one box — a ship can be walked across the system a window at a time.
// (Earlier versions treated the cube as the hard bounds of the battlefield,
// which meant a retreating ship eventually hit an invisible wall.) That's why
// node coordinates here are absolute and unbounded, and why the scene, not
// this module, applies the centring offset when it renders.
//
// Deliberately pure/stateless — every function is a function of its arguments
// alone, matching the rest of this project's physics layer (see
// shipPhysics.ts) so it can be unit-tested without mounting a scene.

import { Vector3 } from 'three'

// Edge length of the visible arena window, in arena units. Weapon ranges
// (combatData.ts's WEAPON_TYPES, roughly 3–11) are authored against this
// span: a Corvette's 3-unit autocannon reaches about a quarter of the way
// across, a Frigate's 11-unit missile battery nearly all the way.
export const ARENA_SPAN_UNITS = 12

// "Varying specificity" per the design brief — how finely the same physical
// span is subdivided. A coarse lattice means long, committing moves between
// widely spaced nodes; a fine one allows precise repositioning at the cost of
// far more nodes to path through. Purely a movement-resolution choice: it
// changes neither the window's size nor any weapon's reach.
export type GridDensity = 'coarse' | 'standard' | 'fine'

export const GRID_DENSITIES: GridDensity[] = ['coarse', 'standard', 'fine']

// Subdivisions per axis across the window. Node counts are (divisions + 1)^3
// — 125, 729, and 2197 — which is why the finest setting is capped here
// rather than left open-ended: every node is a potential render and pathing
// target.
export const GRID_DIVISIONS: Record<GridDensity, number> = {
  coarse: 4,
  standard: 8,
  fine: 12,
}

export const GRID_DENSITY_LABELS: Record<GridDensity, string> = {
  coarse: 'Coarse',
  standard: 'Standard',
  fine: 'Fine',
}

// An absolute lattice coordinate. Unbounded in every direction — the visible
// window constrains what can be *ordered* in one go (see isInsideWindow), not
// where a ship is allowed to exist.
export interface GridNode {
  x: number
  y: number
  z: number
}

// A celestial body sharing the arena. Combat happens somewhere — in orbit, or
// beside a star — and that somewhere is a large object that shots cannot pass
// through and ships cannot fly through. Two fleets on opposite sides of a
// star genuinely cannot engage until one of them comes around.
export interface CombatObstacle {
  name: string
  kind: 'star' | 'planet' | 'moon'
  color: string
  // The lattice node the body is centred on. Stored as a node (not a fixed
  // world position) so it remaps with everything else when density changes.
  node: GridNode
  // Physical radius in arena units — a real size, independent of density.
  radiusUnits: number
}

export function gridSpacing(density: GridDensity): number {
  return ARENA_SPAN_UNITS / GRID_DIVISIONS[density]
}

// Lattice coordinates -> arena-unit position. Absolute: the lattice origin
// maps to the world origin, and the *view* is responsible for translating so
// that the current window centre sits in front of the camera. Keeping this
// centring-free is what lets the window move without every stored position
// having to be rewritten.
export function nodeToArenaPosition(node: GridNode, density: GridDensity): Vector3 {
  const spacing = gridSpacing(density)
  return new Vector3(node.x * spacing, node.y * spacing, node.z * spacing)
}

// Inverse — snaps an arbitrary arena-unit position to the nearest node.
export function arenaPositionToNode(position: Vector3, density: GridDensity): GridNode {
  const spacing = gridSpacing(density)
  return {
    x: Math.round(position.x / spacing),
    y: Math.round(position.y / spacing),
    z: Math.round(position.z / spacing),
  }
}

export function nodesEqual(a: GridNode, b: GridNode): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

// Straight-line separation in arena units — what weapon range is measured
// against. Note this is the *euclidean* distance between two nodes, not the
// length of the lattice path between them: a weapon fires across open space
// even though the ship carrying it has to travel the lattice to get there.
// That asymmetry is deliberate, and is what makes cutting a diagonal worth
// doing.
export function arenaDistance(a: GridNode, b: GridNode, density: GridDensity): number {
  return nodeToArenaPosition(a, density).distanceTo(nodeToArenaPosition(b, density))
}

// Whether a node falls inside the currently-visible window. Used to bound
// what the player can order in a single move and what the grid draws — never
// to constrain where a ship may be, since recentring is what extends reach.
export function isInsideWindow(node: GridNode, center: GridNode, density: GridDensity): boolean {
  const half = GRID_DIVISIONS[density] / 2
  return (
    Math.abs(node.x - center.x) <= half &&
    Math.abs(node.y - center.y) <= half &&
    Math.abs(node.z - center.z) <= half
  )
}

export function clampToWindow(node: GridNode, center: GridNode, density: GridDensity): GridNode {
  const half = GRID_DIVISIONS[density] / 2
  const clamp = (v: number, c: number) => Math.max(c - half, Math.min(c + half, Math.round(v)))
  return { x: clamp(node.x, center.x), y: clamp(node.y, center.y), z: clamp(node.z, center.z) }
}

// Changing density changes the spacing between nodes, so the same integer
// coordinate would mean a different physical place — every ship would appear
// to jump. Remapping preserves the *world position* across the change, so a
// density switch is a change of movement resolution and nothing else.
export function remapNode(node: GridNode, from: GridDensity, to: GridDensity): GridNode {
  if (from === to) return node
  return arenaPositionToNode(nodeToArenaPosition(node, from), to)
}

// Whether a point in arena units lies inside a body. `clearance` pads the
// body so ships path *around* it with a margin rather than grazing it.
export function isInsideObstacle(position: Vector3, obstacle: CombatObstacle, density: GridDensity, clearance = 0): boolean {
  const center = nodeToArenaPosition(obstacle.node, density)
  return position.distanceTo(center) <= obstacle.radiusUnits + clearance
}

export function isNodeBlocked(node: GridNode, obstacles: CombatObstacle[], density: GridDensity, clearance = 0): boolean {
  if (obstacles.length === 0) return false
  const position = nodeToArenaPosition(node, density)
  return obstacles.some((o) => isInsideObstacle(position, o, density, clearance))
}

// Does the straight segment a→b pass through this sphere? The line-of-fire
// test: shots travel in straight lines, so a body between two ships stops
// them shooting each other regardless of range.
//
// Solved by finding the closest approach of the segment to the sphere centre
// and comparing against the radius — clamping the projection parameter to
// [0,1] is what makes this a *segment* test rather than an infinite-line one,
// so a body behind the shooter never blocks anything.
export function segmentIntersectsSphere(a: Vector3, b: Vector3, center: Vector3, radius: number): boolean {
  const ab = b.clone().sub(a)
  const lengthSq = ab.lengthSq()
  if (lengthSq === 0) return a.distanceTo(center) <= radius
  const t = Math.max(0, Math.min(1, center.clone().sub(a).dot(ab) / lengthSq))
  const closest = a.clone().add(ab.multiplyScalar(t))
  return closest.distanceTo(center) <= radius
}

// Clear line of fire between two arena positions, given the bodies present.
export function hasLineOfFire(
  from: Vector3,
  to: Vector3,
  obstacles: CombatObstacle[],
  density: GridDensity,
): boolean {
  return !obstacles.some((o) =>
    segmentIntersectsSphere(from, to, nodeToArenaPosition(o.node, density), o.radiusUnits),
  )
}

// An axis-aligned box of lattice nodes, used to bound a pathfinding search.
export interface NodeBounds {
  min: GridNode
  max: GridNode
}

// The search box for a route: the box containing both endpoints, grown by
// `margin` so there's room to detour around anything in between.
//
// Derived from the endpoints rather than from the visible window on purpose.
// An earlier version bounded the search to `Engagement.center`'s window,
// which deadlocked any ship that ended up outside it (recentring or a density
// remap can both put a ship outside): every neighbour was out of bounds, A*
// found nothing, and the ship froze in place. Pathing is simulation; the
// window is a camera. They must not be coupled.
export function boundsFor(a: GridNode, b: GridNode, margin: number): NodeBounds {
  return {
    min: { x: Math.min(a.x, b.x) - margin, y: Math.min(a.y, b.y) - margin, z: Math.min(a.z, b.z) - margin },
    max: { x: Math.max(a.x, b.x) + margin, y: Math.max(a.y, b.y) + margin, z: Math.max(a.z, b.z) + margin },
  }
}

export function isInsideBounds(node: GridNode, bounds: NodeBounds): boolean {
  return (
    node.x >= bounds.min.x && node.x <= bounds.max.x &&
    node.y >= bounds.min.y && node.y <= bounds.max.y &&
    node.z >= bounds.min.z && node.z <= bounds.max.z
  )
}

// Every node reachable in one hop: the 26 surrounding cells (6 face-adjacent,
// 12 edge-diagonal, 8 corner-diagonal). Diagonals are included per the design
// decision that ships may cut across a cell rather than being forced around
// it — a diagonal hop is longer in distance (and therefore in time, see
// traversalSeconds) so it costs what it should without needing a separate
// rule. `bounds` keeps a search finite; omit it for an unbounded walk.
export function neighborsOf(node: GridNode, bounds?: NodeBounds): GridNode[] {
  const result: GridNode[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        const candidate = { x: node.x + dx, y: node.y + dy, z: node.z + dz }
        if (!bounds || isInsideBounds(candidate, bounds)) result.push(candidate)
      }
    }
  }
  return result
}

// How long one hop between adjacent nodes takes, in sim-seconds, at a given
// speed. Because a diagonal hop is physically longer than a face-adjacent
// one, this falls out of the distance directly — no separate diagonal-cost
// rule is needed.
export function traversalSeconds(from: GridNode, to: GridNode, density: GridDensity, unitsPerSecond: number): number {
  if (unitsPerSecond <= 0) return Infinity
  return arenaDistance(from, to, density) / unitsPerSecond
}

function nodeKey(node: GridNode): string {
  return `${node.x},${node.y},${node.z}`
}

// Greedy straight-line route: step one node per axis per hop, taking
// diagonals wherever more than one axis still needs to change. Optimal when
// nothing is in the way, and it's what produces the characteristic staircase
// of "travel via the lines on the grid."
function greedyPath(from: GridNode, to: GridNode): GridNode[] {
  const path: GridNode[] = []
  const step = (a: number, b: number) => Math.sign(b - a)
  let current = { ...from }
  // Each hop closes every axis that still differs by exactly one, so the trip
  // takes precisely max(|dx|,|dy|,|dz|) hops. Deriving the guard from that
  // makes it exact rather than a cap — an earlier version sized it to the
  // cube (`divisions * 3`), which silently truncated any route longer than
  // one window once the lattice became unbounded, leaving ships short of
  // where they were sent.
  let guard =
    Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z)) + 1
  while (!nodesEqual(current, to) && guard-- > 0) {
    current = {
      x: current.x + step(current.x, to.x),
      y: current.y + step(current.y, to.y),
      z: current.z + step(current.z, to.z),
    }
    path.push(current)
  }
  return path
}

// A* over the lattice, used only when there's something to route around.
// Bounded to the visible window, so the search space is at most 2,197 nodes
// even at the finest density — small enough to solve exactly rather than
// approximate. Cost and heuristic are both euclidean arena distance, which
// keeps the heuristic admissible (a straight line is never longer than any
// lattice route) and therefore the result optimal.
function astarPath(
  from: GridNode,
  to: GridNode,
  bounds: NodeBounds,
  density: GridDensity,
  obstacles: CombatObstacle[],
  clearance: number,
): GridNode[] | null {
  const goalKey = nodeKey(to)
  const cameFrom = new Map<string, GridNode>()
  const gScore = new Map<string, number>([[nodeKey(from), 0]])
  // A plain array used as the open set — the frontier stays small enough at
  // these node counts that a binary heap wouldn't earn its complexity.
  const open: { node: GridNode; f: number }[] = [
    { node: from, f: arenaDistance(from, to, density) },
  ]
  const closed = new Set<string>()

  while (open.length > 0) {
    let bestIndex = 0
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIndex].f) bestIndex = i
    const { node: current } = open.splice(bestIndex, 1)[0]
    const currentKey = nodeKey(current)
    if (currentKey === goalKey) {
      const path: GridNode[] = []
      let cursor = current
      while (!nodesEqual(cursor, from)) {
        path.unshift(cursor)
        const previous = cameFrom.get(nodeKey(cursor))
        if (!previous) break
        cursor = previous
      }
      return path
    }
    if (closed.has(currentKey)) continue
    closed.add(currentKey)

    for (const neighbor of neighborsOf(current, bounds)) {
      const key = nodeKey(neighbor)
      if (closed.has(key)) continue
      if (isNodeBlocked(neighbor, obstacles, density, clearance)) continue
      const tentative = (gScore.get(currentKey) ?? Infinity) + arenaDistance(current, neighbor, density)
      if (tentative >= (gScore.get(key) ?? Infinity)) continue
      cameFrom.set(key, current)
      gScore.set(key, tentative)
      open.push({ node: neighbor, f: tentative + arenaDistance(neighbor, to, density) })
    }
  }
  return null
}

export interface PathOptions {
  /** Bodies to route around. Omit (or pass empty) for open space. */
  obstacles?: CombatObstacle[]
  /** Extra margin around each body, in arena units. */
  clearance?: number
}

// How much room beyond the two endpoints the detour search is allowed, in
// nodes. Sized from the largest body present so there's always space to go
// around it, plus a couple of nodes of slack.
function detourMargin(obstacles: CombatObstacle[], density: GridDensity): number {
  const spacing = gridSpacing(density)
  const widest = obstacles.reduce((max, o) => Math.max(max, o.radiusUnits), 0)
  return Math.ceil(widest / spacing) + 2
}

// Route from one node to another along lattice edges. Uses the greedy
// straight-line walk in open space (cheap, and exactly optimal there), and
// falls back to A* only when a body actually sits on that straight route —
// so the common case pays nothing for the obstacle system existing.
// Returns the intermediate nodes *excluding* `from` and including `to`.
export function latticePath(from: GridNode, to: GridNode, density: GridDensity, options: PathOptions = {}): GridNode[] {
  const { obstacles = [], clearance = 0 } = options
  const greedy = greedyPath(from, to)
  if (obstacles.length === 0) return greedy

  const clips = greedy.some((node) => isNodeBlocked(node, obstacles, density, clearance))
  if (!clips) return greedy

  const bounds = boundsFor(from, to, detourMargin(obstacles, density))
  const routed = astarPath(from, to, bounds, density, obstacles, clearance)
  // No route exists — the destination is inside a body. Hold position rather
  // than flying through it.
  return routed ?? []
}

// Total sim-seconds to walk a whole path at a given speed.
export function pathSeconds(from: GridNode, path: GridNode[], density: GridDensity, unitsPerSecond: number): number {
  let total = 0
  let prev = from
  for (const node of path) {
    total += traversalSeconds(prev, node, density, unitsPerSecond)
    prev = node
  }
  return total
}

// The lattice node at the middle of a fresh engagement's window. Also where
// the location's celestial body is placed, so a fight in orbit starts with
// that body squarely between the two sides.
export function arenaCenterNode(density: GridDensity): GridNode {
  const mid = GRID_DIVISIONS[density] / 2
  return { x: mid, y: mid, z: mid }
}

// Opening positions: the two sides start on opposite faces of the window,
// spread across that face so multiple ships per side don't stack on one node.
// Deterministic (index-driven, no randomness) so a given engagement always
// sets up the same way — same reasoning as shipPhysics's hash-derived resting
// offsets.
export function startingNode(sideIndex: 0 | 1, shipIndex: number, density: GridDensity): GridNode {
  const divisions = GRID_DIVISIONS[density]
  const mid = Math.floor(divisions / 2)
  // Fan ships out over a small square on their side's face, wrapping every
  // 3 columns so a large fleet spreads in two dimensions rather than a line.
  const column = shipIndex % 3
  const row = Math.floor(shipIndex / 3)
  const offset = (v: number) => Math.max(0, Math.min(divisions, v))
  return {
    x: offset(mid + column - 1),
    y: offset(mid + row - 1),
    z: sideIndex === 0 ? 0 : divisions,
  }
}
