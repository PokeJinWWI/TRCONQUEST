// The combat arena — real coordinates plus a lattice used only for
// pathfinding.
//
// Every position that's actual game state (a ship's location, a celestial
// body's location, where the visible window is centred) is a continuous
// `ArenaPoint` in real arena units — NOT an index into any grid. The lattice
// (`GridNode`, subdivided per `GridDensity`) is a planning aid: when a ship
// needs to route around a body, its current and desired real positions are
// snapped to the nearest lattice nodes, a route is found through that index
// space, and the result is converted straight back to real waypoints. Once
// planned, a route is just a list of real points — it doesn't matter what
// density planned it, and it never needs to be re-planned or "remapped" if
// density changes afterward.
//
// The lattice has one further job, added later and deliberately kept on the
// INPUT side: it supplies the depth a mouse click cannot (see
// pickLatticeNode), so a player-issued move order resolves to a node rather
// than to an arbitrary point along the view ray. That constrains what the
// player can *ask for*; it does not constrain where a ship can be. Stance and
// auto-approach destinations remain continuous, and nothing is ever stored as
// an index — the distinction this header is about is unaffected.
//
// This split exists because an earlier version stored positions AS lattice
// indices (density-dependent), and remapped them by round-tripping through
// real coordinates every time density changed. That remap snapped each
// position to the *nearest* node of the new, differently-spaced lattice —
// which is a real jump whenever the original position wasn't already exactly
// on a multiple of the new spacing (routine, since ships rarely land exactly
// on a coarse-grid intersection). It looked like ships "teleporting to the
// nearest intersection" on every density change, which is exactly what it
// was. Storing real coordinates as the ground truth and treating the lattice
// as ephemeral removes the bug at the root: nothing needs remapping, because
// nothing is stored in density-relative terms to begin with.
//
// The visible cube the player sees is a *window* onto this real coordinate
// space — centred on `Engagement.center` (a real point) and spanning
// ARENA_SPAN_UNITS, a constant regardless of density. Recentring slides the
// window; it never touches a ship's or a body's actual position.
//
// Deliberately pure/stateless — every function is a function of its
// arguments alone, matching the rest of this project's physics layer (see
// shipPhysics.ts) so it can be unit-tested without mounting a scene.

import { Vector3 } from 'three'
import { PLANETS } from './planetData'
import { STARS } from '../data/starData'

// Edge length of the visible arena window, in arena units — and, not
// coincidentally, the physical scale the whole coordinate system is built
// against. Weapon ranges (combatData.ts's WEAPON_TYPES, roughly 3–11) are
// authored against this span: a Corvette's 3-unit autocannon reaches about a
// quarter of the way across, a Frigate's 11-unit missile battery nearly all
// the way. Constant regardless of density — density only changes how finely
// this same physical span is subdivided for pathfinding/visualization.
export const ARENA_SPAN_UNITS = 12

// "Varying specificity" per the design brief — how finely the lattice used
// for pathfinding, visualization, and click placement is subdivided. It
// changes neither the window's physical size nor any weapon's reach, and it
// never moves anything that already exists (see the header above). It does
// decide how finely a player can *place* a ship with a click, which is what
// makes it a real tactical control rather than a display preference.
export type GridDensity = 'coarse' | 'standard' | 'fine'

export const GRID_DENSITIES: GridDensity[] = ['coarse', 'standard', 'fine']

// Subdivisions per axis. Node counts are (divisions + 1)^3 — 125, 729, and
// 4913 — which is why the finest setting is capped here rather than left
// open-ended: every node is a potential render and pathing target.
//
// Each density is exactly DOUBLE the previous one, and that nesting is a
// requirement rather than a coincidence — it's what makes the fine lattice
// the game's single placement resolution.
//
// A move order resolves to one of the nodes actually DRAWN at the current
// density (see pickLatticeNode — the player can only aim at dots they can
// see). Because 4 | 8 | 16 nests, every drawn node at every density is also a
// fine node, so wherever a ship is placed and whatever density placed it, it
// lands on a fine-lattice intersection. Two consequences, both intended:
//   - In fine view a ship always sits exactly on a drawn intersection.
//   - In coarse or standard view it frequently sits between the drawn ones,
//     because those densities don't draw every position a ship can occupy.
// It also gives the density control real weight for movement instead of being
// purely cosmetic: coarse is for quick chunky repositioning, fine is for
// placing a hull exactly.
//
// (The previous value, fine: 12, did not nest — standard's 1.5-unit spacing
// has no counterpart on a 1.0-unit lattice, so ordering at standard density
// would have landed ships up to 0.87 units off the dot that was clicked.)
export const GRID_DIVISIONS: Record<GridDensity, number> = {
  coarse: 4,
  standard: 8,
  fine: 16,
}


export const GRID_DENSITY_LABELS: Record<GridDensity, string> = {
  coarse: 'Coarse',
  standard: 'Standard',
  fine: 'Fine',
}

// A real, continuous point in arena units — actual game state (a ship's
// position, a body's position, the window's centre). Plain numbers (not a
// THREE.Vector3) so it stores cleanly in zustand; convert with toVector3
// when vector math is needed.
export interface ArenaPoint {
  x: number
  y: number
  z: number
}

export const ARENA_ORIGIN: ArenaPoint = { x: 0, y: 0, z: 0 }

export function toVector3(p: ArenaPoint): Vector3 {
  return new Vector3(p.x, p.y, p.z)
}

export function pointDistance(a: ArenaPoint, b: ArenaPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// An index into the pathfinding lattice at a given density — NOT a place
// anything actually is. Ephemeral: computed on demand when a route needs
// planning, then immediately converted back to real ArenaPoints. Never
// stored as game state — see the header above for why that distinction is
// load-bearing.
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
  position: ArenaPoint
  // Physical radius in arena units.
  radiusUnits: number
  // Arena-scale surface gravity, in arena-units/s^2 — see arenaSurfaceGravity
  // for how this is derived from real mass. Consulted only by a ship with no
  // thrust of its own (see combatResolution.integrateMotion): a working
  // engine is strong enough that the game treats a fight as flat space (per
  // the design brief), so this never affects a ship that still has power.
  surfaceGravityUnitsPerSecondSq: number
  // Set only for a body that's actually moving in this frame — an orbiting
  // moon (see combatResolution's moonArenaState), not the planet/star every
  // other position in the arena is implicitly anchored to (see this file's
  // header: the arena is a real coordinate space centred on whatever the
  // fight is orbiting, so that body is always at rest here BY that framing,
  // whatever it's actually doing around the Sun). Absent, not zero, for
  // anything else — "this body doesn't move" and "this body moves at exactly
  // zero" aren't the same claim, and only the moon needs the first one
  // spelled out yet. What CombatParticipant.inheritVelocity locks onto.
  velocity?: ArenaPoint
}

// `span` defaults to ARENA_SPAN_UNITS (the fixed grain used for arranging
// ships within one fleet's own spawn face — see startingPoint) but every
// caller reasoning about the WINDOW itself (rendering, click-picking, and
// route-finding around obstacles) passes the engagement's own real span —
// see combatResolution.arenaWindowSpan — so the lattice a player sees, the
// lattice a click resolves against, and the lattice a route is planned
// through are always the same one.
export function gridSpacing(density: GridDensity, span: number = ARENA_SPAN_UNITS): number {
  return span / GRID_DIVISIONS[density]
}

// --- Body sizing, and the arena's one real physical anchor -----------------

// Earth's radius, the reference body sizing is expressed against.
const EARTH_RADIUS_KM = PLANETS.find((p) => p.name === 'Earth')?.radiusKm ?? 6371

// True to scale: a direct linear ratio against Earth, so 1 arena unit means
// the same real distance (~5,309 km) no matter which body you're measuring —
// Earth stays 1.2 units (this is the anchor, so it's unchanged from before),
// Sol comes out to ~131 units, Jupiter ~13. This project ran on a fourth-root
// compression here for a long time specifically to dodge the consequence of
// that: a body over 100 units across doesn't fit any fixed-size arena
// window. It doesn't need to — the window is a camera frame onto an
// unbounded lattice (see this file's own header, and Recenter), not the edge
// of playable space, so a body bigger than one window's span is just a body
// you fly alongside rather than one you always see the whole of. The
// intended, accepted consequence: a fight near something Sol-sized reads as
// genuinely vast, and covering it at a fixed ship speed takes proportionally
// longer — slower, bigger battles near big bodies, fast tight ones near
// small ones, exactly because the ratio between "how big" and "how fast" is
// now real instead of picked. Only the lower clamp remains, so something
// Luna-sized doesn't shrink into an unclickable dot.
const ARENA_BODY_RADIUS_AT_EARTH = 1.2
const MIN_BODY_RADIUS_UNITS = 0.8

// The same real linear ratio arenaBodyRadius uses, exposed on its own for
// anything measuring a real km quantity that ISN'T a body's own radius (a
// moon's orbit distance, for instance — see combatResolution's
// moonArenaState) and so has no reason for the size-specific minimum clamp.
export function arenaDistanceFromKm(km: number): number {
  return ARENA_BODY_RADIUS_AT_EARTH * (km / EARTH_RADIUS_KM)
}

export function arenaBodyRadius(radiusKm: number): number {
  return Math.max(MIN_BODY_RADIUS_UNITS, arenaDistanceFromKm(radiusKm))
}

// --- Gravity -----------------------------------------------------------

// Real surface gravity (g = GM/R^2, in m/s^2) — the standard inverse-square
// law evaluated at a body's own surface, so gravitationalAcceleration below
// only needs to scale it by (R/r)^2 for any distance r >= R.
const GRAVITATIONAL_CONSTANT_M3_PER_KG_S2 = 6.6743e-11

function realSurfaceGravityMs2(massKg: number, radiusKm: number): number {
  const radiusM = radiusKm * 1000
  return (GRAVITATIONAL_CONSTANT_M3_PER_KG_S2 * massKg) / (radiusM * radiusM)
}

// Real gravity, like real body radii above, is meaningless to convert
// directly at this scale — there's no consistent km-per-unit factor to even
// attempt one (see arenaBodyRadius's own note), and a literal real fall time
// from a planet's surface is on the order of TENS OF MINUTES, worthless
// against fights that run for tens of SECONDS. Same fix as everywhere else
// in this file: pick one honest anchor and scale everything else against it
// by its REAL ratio, rather than pretending real units survive the
// compression. The anchor here is Earth, and it's chosen for what it does at
// the OTHER end of the ratio: a ship with dead thrust sitting at rest a
// modest distance outside Earth's own arena radius should visibly fall and
// reach the surface within several real seconds — legible within one fight,
// not an imperceptible drift and not an instant, unavoidable trap. Every
// other body's arena gravity is then this constant scaled by that body's
// REAL surface-gravity ratio to Earth's, so Sol pulls roughly 28x harder and
// Luna about a sixth as hard — exactly like the real solar system, just
// timed to fit a fight this arena can actually run.
const ARENA_SURFACE_GRAVITY_AT_EARTH_UNITS_PER_S2 = 0.03
const EARTH_MASS_KG = PLANETS.find((p) => p.name === 'Earth')?.massKg ?? 5.972e24
const EARTH_SURFACE_GRAVITY_MS2 = realSurfaceGravityMs2(EARTH_MASS_KG, EARTH_RADIUS_KM)

export function arenaSurfaceGravity(massKg: number, radiusKm: number): number {
  return ARENA_SURFACE_GRAVITY_AT_EARTH_UNITS_PER_S2 * (realSurfaceGravityMs2(massKg, radiusKm) / EARTH_SURFACE_GRAVITY_MS2)
}

// Net gravitational pull on a point from every body sharing the arena, each
// contribution following the real inverse-square law (g(r) = g_surface *
// (R/r)^2) at its own already-compressed arena-scale surface gravity.
// Summed rather than nearest-body-only: an Earth fight now shares the arena
// with Luna too (see combatResolution's EARTH_MOON_OFFSET), and a ship
// drifting between them should feel the pull of both, not just whichever is
// closest at that instant.
export function gravitationalAcceleration(point: ArenaPoint, obstacles: CombatObstacle[]): Vector3 {
  const total = new Vector3()
  for (const obstacle of obstacles) {
    const toBody = toVector3(obstacle.position).sub(toVector3(point))
    const distance = toBody.length()
    if (distance < 1e-6) continue
    const g = obstacle.surfaceGravityUnitsPerSecondSq * (obstacle.radiusUnits / distance) ** 2
    total.add(toBody.normalize().multiplyScalar(g))
  }
  return total
}

const SPEED_OF_LIGHT_KM_S = 299_792.458
const SOL_RADIUS_KM = STARS.find((s) => s.id === 'sol')?.radiusKm ?? 696_000

// How fast light would cross the arena, in arena units per sim-second — and
// deliberately NOT derived from arenaBodyRadius(Sol) anymore. It used to be:
// back when body sizes were fourth-root compressed, Sol's arena radius was a
// small, arbitrary ~3.9 units, and computing light-speed from "how many of
// those units light crosses in Sol's real crossing time" was a reasonable
// way to keep ship speeds honest. Now that body radius is a real linear
// ratio (see arenaBodyRadius's own comment), Sol's arena radius is ~131
// units on its own real terms — and re-deriving light-speed from THAT would
// make every hull's absolute speed balloon by the same ~34x Sol's radius
// just grew by, which would silently retune combat pacing at every OTHER
// body too, Earth included, where this project's actual balance testing
// lives. So this is now a fixed pacing constant instead: the exact value the
// old Sol-derived formula produced (~1.671 units/s, computed once from Sol's
// former ~3.88-unit arena radius), kept as a picked number so ship speed and
// body-radius scale can vary independently — a hull's absolute speed no
// longer changes just because some body's real size got measured correctly.
const LEGACY_SOL_PACING_RADIUS_UNITS = 3.8792
export const ARENA_LIGHT_SPEED_UNITS_PER_SECOND =
  (2 * LEGACY_SOL_PACING_RADIUS_UNITS) / ((2 * SOL_RADIUS_KM) / SPEED_OF_LIGHT_KM_S)

// Lattice index -> real point, at a given density's spacing. Used only when
// converting a freshly-computed route back into real waypoints (see
// latticePath's callers) — never to derive where anything currently *is*.
export function nodeToArenaPosition(node: GridNode, density: GridDensity, span: number = ARENA_SPAN_UNITS): Vector3 {
  const spacing = gridSpacing(density, span)
  return new Vector3(node.x * spacing, node.y * spacing, node.z * spacing)
}

// Inverse — snaps a real point to the nearest lattice index at a given
// density. Used only to find a start/end node for route planning.
export function arenaPositionToNode(position: Vector3, density: GridDensity, span: number = ARENA_SPAN_UNITS): GridNode {
  const spacing = gridSpacing(density, span)
  return {
    x: Math.round(position.x / spacing),
    y: Math.round(position.y / spacing),
    z: Math.round(position.z / spacing),
  }
}

export function nodesEqual(a: GridNode, b: GridNode): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

// Plain arithmetic rather than nodeToArenaPosition + Vector3.distanceTo —
// this is A*'s innermost hot path (every neighbor of every expanded node,
// twice: once for the running cost, once for the heuristic), and allocating
// two Vector3 objects per call turned out to be the real cost of a search
// near a big body, not the node count itself. Same spacing, same result,
// zero allocation.
export function arenaDistance(a: GridNode, b: GridNode, density: GridDensity, span: number = ARENA_SPAN_UNITS): number {
  const spacing = gridSpacing(density, span)
  const dx = (a.x - b.x) * spacing
  const dy = (a.y - b.y) * spacing
  const dz = (a.z - b.z) * spacing
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// Whether a real point falls inside the currently-visible window — the
// window's physical size never changes with density, so this needs no
// density parameter at all. It DOES change per engagement (see
// combatResolution.arenaWindowSpan), so callers pass their own span rather
// than relying on the ARENA_SPAN_UNITS default. Used to bound what the
// player can order in a single move and what the grid draws — never to
// constrain where a ship may actually be (recentring is what extends reach).
export function isInsideWindow(point: ArenaPoint, center: ArenaPoint, span: number = ARENA_SPAN_UNITS): boolean {
  const half = span / 2
  return (
    Math.abs(point.x - center.x) <= half &&
    Math.abs(point.y - center.y) <= half &&
    Math.abs(point.z - center.z) <= half
  )
}

// Whether a real point lies inside a body, with an optional clearance
// margin so ships path *around* it rather than grazing it.
export function isPointBlocked(point: ArenaPoint, obstacles: CombatObstacle[], clearance = 0): boolean {
  return obstacles.some((o) => pointDistance(point, o.position) <= o.radiusUnits + clearance)
}

// Same check for a lattice node, used only inside route planning (A*/greedy
// clip detection) — converts to a real point at the given density, then
// defers to isPointBlocked.
export function isNodeBlocked(
  node: GridNode,
  obstacles: CombatObstacle[],
  density: GridDensity,
  clearance = 0,
  span: number = ARENA_SPAN_UNITS,
): boolean {
  if (obstacles.length === 0) return false
  const spacing = gridSpacing(density, span)
  const p = { x: node.x * spacing, y: node.y * spacing, z: node.z * spacing }
  return isPointBlocked(p, obstacles, clearance)
}

// --- Picking a destination from a click ------------------------------------
//
// A mouse click is a RAY, not a point: it fixes two screen axes and says
// nothing about depth. The previous implementation hid that fact instead of
// solving it — it raycast an invisible box spanning the window and used the
// hit as the destination. A raycast against a box always returns a point on
// the box's *surface*, so every order landed on the arena's outer shell at
// whatever spot happened to lie along the view ray. It looked correct only
// from the camera angle it was issued at (shell point and intended target
// being collinear from there) and was revealed as wrong the moment the camera
// moved. Measured against the real geometry, all 729 standard-density nodes
// mis-picked, the worst by 19.8 units across a 12-unit arena.
//
// The lattice is what resolves the ambiguity: its nodes are discrete points
// in 3D, so "which node did the cursor land on" has a single answer where
// "how deep along this ray" has none.

// A density's nodes are laid out relative to the WINDOW CENTRE (see
// CombatGrid), not to the arena origin, so anything reasoning about "which
// node is this" has to use the same origin. Clamped to the window's extent.
export function snapToLatticeNode(
  point: ArenaPoint,
  center: ArenaPoint,
  density: GridDensity,
  span: number = ARENA_SPAN_UNITS,
): ArenaPoint {
  const spacing = gridSpacing(density, span)
  const half = GRID_DIVISIONS[density] / 2
  const axis = (value: number, origin: number): number => {
    const steps = Math.max(-half, Math.min(half, Math.round((value - origin) / spacing)))
    return origin + steps * spacing
  }
  return { x: axis(point.x, center.x), y: axis(point.y, center.y), z: axis(point.z, center.z) }
}

/** Where a node ends up on screen, as supplied by the caller's camera. */
export interface ProjectedNode {
  /** Screen position, in pixels. */
  x: number
  y: number
  /** Distance from the camera — used only to break ties between nodes the
   * cursor is equally close to, where the nearer one is the one the player
   * can actually see and therefore meant to click. */
  depth: number
  /** False for anything behind the camera or outside the frustum. */
  visible: boolean
}

export interface PickLatticeOptions {
  /** Nodes for which this returns true are skipped — used to exclude nodes
   * buried inside a body, which are never legal destinations, so that
   * clicking across a star picks a reachable node instead of silently
   * refusing the order. */
  isBlocked?: (point: ArenaPoint) => boolean
  /** How much closer to the cursor, in pixels, one node must be than another
   * before screen proximity decides between them outright. Nodes within this
   * much of the best candidate are treated as visually overlapping and
   * resolved by depth instead. Deliberately small: it exists to disambiguate
   * dots drawn on top of each other, NOT to let a node the cursor merely
   * happens to be near outrank the one it is actually on. */
  tieRadius?: number
}

const DEFAULT_TIE_RADIUS_PX = 4

// The node a click selects. Takes the projection as a callback rather than a
// camera so it stays pure and testable without mounting a scene — the same
// reasoning as the rest of this module.
//
// Screen proximity decides, and depth only breaks ties between nodes that are
// drawn on top of each other. Two passes: find the node nearest the cursor,
// then among everything within `tieRadius` of that distance take the one
// nearest the camera.
//
// The ordering matters and was got wrong once. An earlier version treated any
// node within a fixed radius of the cursor as "clicked" and ranked that whole
// band by depth, which let a node 13px away outrank the one the cursor was
// sitting exactly on, purely for being nearer the camera. Measured live, four
// of five clicks then landed on a neighbour rather than the dot aimed at —
// wrong in a less dramatic way than the shell bug, but wrong for the same
// underlying reason: something other than where the player pointed was
// deciding the answer.
//
// What survives is genuinely irreducible: nodes that really do share a view
// ray cannot be told apart by one click. Front-most is the honest answer
// there — it is the dot the player can see — and orbiting slightly breaks the
// alignment and exposes the rest.
export function pickLatticeNode(
  center: ArenaPoint,
  density: GridDensity,
  cursor: { x: number; y: number },
  project: (point: ArenaPoint) => ProjectedNode,
  options: PickLatticeOptions = {},
  span: number = ARENA_SPAN_UNITS,
): ArenaPoint | null {
  const { isBlocked, tieRadius = DEFAULT_TIE_RADIUS_PX } = options
  const divisions = GRID_DIVISIONS[density]
  const spacing = gridSpacing(density, span)
  const half = divisions / 2

  const nodeAt = (ix: number, iy: number, iz: number): ArenaPoint => ({
    x: center.x + (ix - half) * spacing,
    y: center.y + (iy - half) * spacing,
    z: center.z + (iz - half) * spacing,
  })

  let nearestScreen = Infinity
  for (let ix = 0; ix <= divisions; ix++) {
    for (let iy = 0; iy <= divisions; iy++) {
      for (let iz = 0; iz <= divisions; iz++) {
        const point = nodeAt(ix, iy, iz)
        if (isBlocked?.(point)) continue
        const projected = project(point)
        if (!projected.visible) continue
        const screen = Math.hypot(projected.x - cursor.x, projected.y - cursor.y)
        if (screen < nearestScreen) nearestScreen = screen
      }
    }
  }
  if (nearestScreen === Infinity) return null

  const cutoff = nearestScreen + tieRadius
  let best: ArenaPoint | null = null
  let bestDepth = Infinity
  for (let ix = 0; ix <= divisions; ix++) {
    for (let iy = 0; iy <= divisions; iy++) {
      for (let iz = 0; iz <= divisions; iz++) {
        const point = nodeAt(ix, iy, iz)
        if (isBlocked?.(point)) continue
        const projected = project(point)
        if (!projected.visible) continue
        const screen = Math.hypot(projected.x - cursor.x, projected.y - cursor.y)
        if (screen > cutoff) continue
        if (projected.depth < bestDepth) {
          bestDepth = projected.depth
          best = point
        }
      }
    }
  }

  return best
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

// Clear line of fire between two real arena positions, given the bodies
// present. Obstacles already carry real positions, so this needs no density.
export function hasLineOfFire(from: Vector3, to: Vector3, obstacles: CombatObstacle[]): boolean {
  return !obstacles.some((o) => segmentIntersectsSphere(from, to, toVector3(o.position), o.radiusUnits))
}

// Same idea, but for MOVEMENT rather than gunnery — a ship must not fly
// through a body either, and gets a clearance margin so it doesn't graze the
// surface while passing.
export function segmentClearsObstacles(a: Vector3, b: Vector3, obstacles: CombatObstacle[], clearance = 0): boolean {
  return !obstacles.some((o) => segmentIntersectsSphere(a, b, toVector3(o.position), o.radiusUnits + clearance))
}

// An axis-aligned box of lattice nodes, used to bound a pathfinding search.
export interface NodeBounds {
  min: GridNode
  max: GridNode
}

// The search box for a route: the box containing both endpoints, grown by
// `margin` so there's room to detour around anything in between.
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
// it — a diagonal hop is longer in distance (and therefore in time) so it
// costs what it should without needing a separate rule. `bounds` keeps a
// search finite; omit it for an unbounded walk.
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

// How long one hop between adjacent lattice nodes takes, in sim-seconds, at
// a given speed — used only while planning a route in index space.
export function traversalSeconds(
  from: GridNode,
  to: GridNode,
  density: GridDensity,
  unitsPerSecond: number,
  span: number = ARENA_SPAN_UNITS,
): number {
  if (unitsPerSecond <= 0) return Infinity
  return arenaDistance(from, to, density, span) / unitsPerSecond
}

// The real-coordinate equivalent, used once a route has been converted to
// real waypoints (or for the common unobstructed case, which never touches
// the lattice at all) — see combatResolution.orderParticipantTo.
export function realTraversalSeconds(from: ArenaPoint, to: ArenaPoint, unitsPerSecond: number): number {
  if (unitsPerSecond <= 0) return Infinity
  return pointDistance(from, to) / unitsPerSecond
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
  // Each hop closes every axis that still differs by exactly one, so the
  // trip takes precisely max(|dx|,|dy|,|dz|) hops — deriving the guard from
  // that makes it exact rather than an arbitrary cap.
  let guard = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z)) + 1
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
// Bounded to a search box around the two endpoints (see boundsFor), which
// keeps the search finite without coupling it to the display window — a
// route must be plannable regardless of where the player has the camera
// framed.
// Hard cap on how many nodes a single detour search will ever expand.
// Node count in the search box scales with the CUBE of (widest obstacle's
// radius / grid spacing) — see detourMargin — which was a small, safe number
// back when every body's arena radius topped out around ~4 units. Now that
// body radius is true-to-scale (see combatResolution's arenaBodyRadius),
// Sol's ~131-unit radius alone implies a search box tens of millions of
// nodes wide, and the frontier scan below is a linear scan per iteration on
// top of that — undoubtedly what an unbounded search actually hung on. This
// doesn't fix that ships can't (yet) find a good detour around something
// Sol-sized, but a route the search gives up early on has the SAME "no route
// found, hold position" fallback latticePath already has for a genuinely
// unreachable destination — a real UX gap, not a crash or a hang.
const MAX_ASTAR_EXPANSIONS = 20000

// The open set's frontier, ordered by f-score. A body big enough to need a
// real detour (Sol) routinely produces search boxes in the low thousands of
// nodes (see boundsFor/detourMargin) — nowhere near MAX_ASTAR_EXPANSIONS, but
// still enough that re-scanning the WHOLE frontier on every single pop (the
// previous plain-array implementation) cost multiple milliseconds per call,
// and this search reruns every 0.1s step for every ship whose route needs
// one. A binary heap turns each pop into O(log n) instead of O(n), which is
// what actually made combat near a large body slow — not the geometry, not
// the node count itself, just this one re-scan.
class OpenSet {
  private items: { node: GridNode; f: number }[] = []

  get size(): number {
    return this.items.length
  }

  push(node: GridNode, f: number): void {
    this.items.push({ node, f })
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent].f <= this.items[i].f) break
      ;[this.items[parent], this.items[i]] = [this.items[i], this.items[parent]]
      i = parent
    }
  }

  // Lowest-f entry. Duplicate, since-improved entries for an already-popped
  // node can still be sitting in here — same as the array version tolerated,
  // and handled the same way: the caller skips anything already `closed`.
  pop(): GridNode | undefined {
    const top = this.items[0]
    if (!top) return undefined
    const last = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = last
      let i = 0
      const n = this.items.length
      for (;;) {
        const left = 2 * i + 1
        const right = 2 * i + 2
        let smallest = i
        if (left < n && this.items[left].f < this.items[smallest].f) smallest = left
        if (right < n && this.items[right].f < this.items[smallest].f) smallest = right
        if (smallest === i) break
        ;[this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]]
        i = smallest
      }
    }
    return top.node
  }
}

function astarPath(
  from: GridNode,
  to: GridNode,
  bounds: NodeBounds,
  density: GridDensity,
  obstacles: CombatObstacle[],
  clearance: number,
  span: number = ARENA_SPAN_UNITS,
): GridNode[] | null {
  const goalKey = nodeKey(to)
  const cameFrom = new Map<string, GridNode>()
  const gScore = new Map<string, number>([[nodeKey(from), 0]])
  const open = new OpenSet()
  open.push(from, arenaDistance(from, to, density, span))
  const closed = new Set<string>()

  while (open.size > 0) {
    if (closed.size > MAX_ASTAR_EXPANSIONS) return null
    const current = open.pop()!
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
      if (isNodeBlocked(neighbor, obstacles, density, clearance, span)) continue
      const tentative = (gScore.get(currentKey) ?? Infinity) + arenaDistance(current, neighbor, density, span)
      if (tentative >= (gScore.get(key) ?? Infinity)) continue
      cameFrom.set(key, current)
      gScore.set(key, tentative)
      open.push(neighbor, tentative + arenaDistance(neighbor, to, density, span))
    }
  }
  return null
}

export interface PathOptions {
  /** Bodies to route around. Omit (or pass empty) for open space. */
  obstacles?: CombatObstacle[]
  /** Extra margin around each body, in arena units. */
  clearance?: number
  /** The window span this route is being planned against — see
   * combatResolution.arenaWindowSpan. Must match whatever span the caller's
   * `from`/`to` nodes were snapped against (arenaPositionToNode), or the
   * route will be planned on a differently-spaced lattice than the one the
   * endpoints actually sit on. */
  span?: number
}

// How much room beyond the two endpoints the detour search is allowed, in
// nodes. Sized from the largest body present so there's always space to go
// around it, plus a couple of nodes of slack.
export function detourMargin(obstacles: CombatObstacle[], density: GridDensity, span: number = ARENA_SPAN_UNITS): number {
  const spacing = gridSpacing(density, span)
  const widest = obstacles.reduce((max, o) => Math.max(max, o.radiusUnits), 0)
  return Math.ceil(widest / spacing) + 2
}

// Route from one lattice node to another along lattice edges. Uses the
// greedy straight-line walk in open space (cheap, and exactly optimal
// there), and falls back to A* only when a body actually sits on that
// straight route — so the common case pays nothing for the obstacle system
// existing. Returns the intermediate nodes *excluding* `from` and including
// `to`.
//
// This is purely an INDEX-SPACE planning primitive now — see
// combatResolution.orderParticipantTo for how its output gets converted into
// the real waypoints a ship actually walks, and for why it's only consulted
// at all when the straight-line real path is blocked.
export function latticePath(from: GridNode, to: GridNode, density: GridDensity, options: PathOptions = {}): GridNode[] {
  const { obstacles = [], clearance = 0, span = ARENA_SPAN_UNITS } = options
  const greedy = greedyPath(from, to)
  if (obstacles.length === 0) return greedy

  const clips = greedy.some((node) => isNodeBlocked(node, obstacles, density, clearance, span))
  if (!clips) return greedy

  const bounds = boundsFor(from, to, detourMargin(obstacles, density, span))
  const routed = astarPath(from, to, bounds, density, obstacles, clearance, span)
  // No route exists — the destination is inside a body. Hold position rather
  // than flying through it.
  return routed ?? []
}

// Total sim-seconds to walk a whole lattice-index path at a given speed —
// used by tests exercising latticePath directly in index space.
export function pathSeconds(
  from: GridNode,
  path: GridNode[],
  density: GridDensity,
  unitsPerSecond: number,
  span: number = ARENA_SPAN_UNITS,
): number {
  let total = 0
  let prev = from
  for (const node of path) {
    total += traversalSeconds(prev, node, density, unitsPerSecond, span)
    prev = node
  }
  return total
}

// Opening positions: the two sides start on opposite faces of the window,
// spread across that face so multiple ships per side don't stack on one
// point. Deterministic (index-driven, no randomness) so a given engagement
// always sets up the same way — same reasoning as shipPhysics's hash-derived
// resting offsets. Returns a real point directly (relative to the window
// centre being the origin at spawn time — see combatResolution.syncEngagements,
// which anchors a fresh engagement's window at ARENA_ORIGIN).
//
// `windowSpan` is the engagement's own real span (see
// combatResolution.arenaWindowSpan) — defends against a body bigger than the
// default window itself. Sol's true-to-scale radius (see arenaBodyRadius) is
// ~131 units, comfortably past ARENA_SPAN_UNITS's own 12-unit default, so
// without a caller-supplied override a fight starting "at Sol" would spawn
// both fleets INSIDE the star and the resolver's own collision check (a ship
// whose position lies inside a body is destroyed — see stepEngagements)
// would kill everyone on step one. The caller (combatResolution, which
// already has the engagement's obstacles in hand) is what actually knows how
// big the local body is; this just refuses to place anyone closer than it's
// told is safe. Deliberately NOT used for the ship-fan-out spacing below —
// that's about keeping a handful of hulls from stacking on one point within
// their own side's face, which stays at the same fine grain regardless of
// how big the window itself has grown.
export function startingPoint(sideIndex: 0 | 1, shipIndex: number, density: GridDensity, windowSpan: number = ARENA_SPAN_UNITS): ArenaPoint {
  const spacing = gridSpacing(density)
  const half = windowSpan / 2
  // Fan ships out over a small square on their side's face, wrapping every
  // 3 columns so a large fleet spreads in two dimensions rather than a line.
  const column = shipIndex % 3
  const row = Math.floor(shipIndex / 3)
  return {
    x: (column - 1) * spacing,
    y: (row - 1) * spacing,
    z: sideIndex === 0 ? -half : half,
  }
}
