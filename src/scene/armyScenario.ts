// Setting up a ground-battle scenario (data/armyScenarios.ts): finding a
// patch of the right terrain on the scenario's world, and putting the two
// forces on it. Pure — it reads a body's surface and returns armies; loading
// them into the stores is scene/scenarioLoader.ts, and the tests run the very
// same armies through stepGroundWar (tests/armyScenarios.test.ts).
//
// A battlefield is two spots on a world: the player's, on a chosen terrain, and
// the enemy's a set number of map cells away. The enemy force marches on the player's spot —
// on a world nobody owns there are no key nodes for the ground AI to head for,
// so the scenario hands the enemy its first move; from then on it holds where
// it meets resistance, exactly as any advancing unit does (groundResolution).
// The player's units are left alone: they hold, dig in, and fire on what comes
// into range until the player orders otherwise.
import type { ArmyScenario, ArmyScenarioForce } from '../data/armyScenarios'
import { UNIT_TYPES, type TerrainId } from '../data/groundData'
import { makeUnits, type Army, type GroundUnit } from './armyLogic'
import { findPath, groundSurface } from './groundLogic'
import { passableFor, terrainAt, type BodySurface } from './planetTerrain'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'

export interface Battlefield {
  playerNode: number
  enemyNode: number
}

// A player anchor needs at least this many of its six neighbours to share its
// terrain, so the force standing around it really is standing on it.
const MIN_SAME_TERRAIN_NEIGHBOURS = 4

function sameTerrainNeighbours(surface: BodySurface, node: number): number {
  const t = terrainAt(surface, node)
  return surfaceMesh().neighbors.fine[node].filter((n) => terrainAt(surface, n) === t).length
}

// Every node exactly `cells` steps from `from` across the fine grid, in
// index order.
function nodesAtDistance(from: number, cells: number): number[] {
  const mesh = surfaceMesh()
  const seen = new Set<number>([from])
  let frontier = [from]
  for (let d = 0; d < cells; d++) {
    const next: number[] = []
    for (const node of frontier) {
      for (const n of mesh.neighbors.fine[node]) {
        if (seen.has(n)) continue
        seen.add(n)
        next.push(n)
      }
    }
    frontier = next
  }
  return frontier.sort((a, b) => a - b)
}

// The first (lowest-numbered) pair that fits: a node of `playerTerrain` with
// its neighbours mostly the same, and walkable ground `gapCells` away on the
// same landmass with an infantry route between them. Deterministic — a
// world's surface is fixed, so a scenario always lands in the same place.
// Null if the world has none.
export function findBattlefield(surface: BodySurface, playerTerrain: TerrainId, gapCells: number): Battlefield | null {
  const mesh = surfaceMesh()
  for (let p = 0; p < mesh.count.fine; p++) {
    if (terrainAt(surface, p) !== playerTerrain || sameTerrainNeighbours(surface, p) < MIN_SAME_TERRAIN_NEIGHBOURS) continue
    for (const e of nodesAtDistance(p, gapCells)) {
      if (!passableFor(terrainAt(surface, e), 'infantry')) continue
      if (surface.landComponent[e] !== surface.landComponent[p]) continue
      if (!findPath(surface, nodePoint(e), p, 'infantry')) continue
      return { playerNode: p, enemyNode: e }
    }
  }
  return null
}

// Where a rear force starts: `cells` steps back from the player's spot, on
// walkable ground of the same landmass, as far from the enemy's as the map
// allows. Falls back to the spot itself when there's no such ground.
export function findRearNode(surface: BodySurface, playerNode: number, enemyNode: number, cells: number): number {
  const enemy = nodePoint(enemyNode)
  const candidates = nodesAtDistance(playerNode, cells).filter(
    (n) => passableFor(terrainAt(surface, n), 'infantry') && surface.landComponent[n] === surface.landComponent[playerNode],
  )
  candidates.sort((a, b) => arc(nodePoint(b), enemy) - arc(nodePoint(a), enemy) || a - b)
  return candidates[0] ?? playerNode
}

// Puts units down around `anchor`, each on the nearest ground of `terrain`
// its type can stand on (or, for a type that can't stand on it at all, the
// nearest ground it can) — placeUnits' plain ring would drop half a force onto
// whatever the neighbours happen to be.
function placeOnTerrain(surface: BodySurface, units: GroundUnit[], anchor: number, terrain: TerrainId | null, step: number): GroundUnit[] {
  const mesh = surfaceMesh()
  const here = nodePoint(anchor)
  const byDistance = Array.from({ length: mesh.count.fine }, (_, i) => i).sort(
    (a, b) => arc(nodePoint(a), here) - arc(nodePoint(b), here) || a - b,
  )
  const taken = new Map<number, number>()
  return units.map((u) => {
    const fits = (n: number) => passableFor(terrainAt(surface, n), u.type)
    const wanted = terrain === null ? fits : (n: number) => terrainAt(surface, n) === terrain && fits(n)
    // The nearest matching node not already crowded (two to a node at most).
    const node =
      byDistance.find((n) => wanted(n) && (taken.get(n) ?? 0) < 2) ??
      byDistance.find((n) => fits(n) && (taken.get(n) ?? 0) < 2) ??
      anchor
    taken.set(node, (taken.get(node) ?? 0) + 1)
    return { ...u, position: nodePoint(node), path: [], orderedMove: false, nodeHint: node, stillSinceStep: step, objectiveNode: null, firingAtId: null }
  })
}

export interface BuiltArmyScenario {
  bodyName: string
  armies: Army[]
  battlefield: Battlefield
}

export interface ArmyScenarioOwners {
  player: string
  enemy: string
}

// Re-ids a fresh formation's units so a scenario's armies are the same on
// every run (makeUnits stamps a clock into its ids, and the ground step's
// tie-breaks go by id).
function stableUnits(units: GroundUnit[], prefix: string): GroundUnit[] {
  return units.map((u, i) => ({ ...u, id: `${prefix}-${String(i).padStart(2, '0')}` }))
}

// The scenario's armies, placed and ready. `playerTerrain` overrides where
// the player's force stands (the tests use it to compare the same forces on
// different ground); it defaults to the scenario's own. `startStep` is the
// ground step the battle starts on — units count as standing still (and so
// digging in) from then, so a scenario loaded mid-game plays out exactly as
// one run from step 0.
export function buildArmyScenario(
  scenario: ArmyScenario,
  owners: ArmyScenarioOwners,
  overrides: { playerTerrain?: TerrainId; startStep?: number } = {},
): BuiltArmyScenario | null {
  const startStep = overrides.startStep ?? 0
  // Nobody's territory: the scenario is a field battle, not a war for a world.
  const surface = groundSurface(scenario.battlefield.bodyName, {})
  if (!surface) return null
  const { gapCells } = scenario.battlefield
  const playerTerrain = overrides.playerTerrain ?? scenario.battlefield.playerTerrain
  const field = findBattlefield(surface, playerTerrain, gapCells)
  if (!field) return null

  const armies: Army[] = []
  const raise = (forces: ArmyScenarioForce[], ownerId: string, role: 'player' | 'enemy', node: number, terrain: TerrainId | null) => {
    forces.forEach((force, i) => {
      // A rear force starts back from the line, out of the enemy's way.
      const rear = force.rearCells ? findRearNode(surface, field.playerNode, field.enemyNode, force.rearCells) : null
      const prefix = `${scenario.id}-${role}${i}`
      const units = stableUnits(makeUnits(force.kind, force.strengthFraction ?? 1), prefix)
      armies.push({
        id: `${prefix}`,
        ownerId,
        kind: force.kind,
        units: rear === null ? placeOnTerrain(surface, units, node, terrain, startStep) : placeOnTerrain(surface, units, rear, null, startStep),
        location: { kind: 'body', bodyName: scenario.battlefield.bodyName },
      })
    })
  }
  raise(scenario.player, owners.player, 'player', field.playerNode, playerTerrain)
  raise(scenario.enemy, owners.enemy, 'enemy', field.enemyNode, null)

  // The enemy marches on the player's spot — every unit that can march (a
  // garrison's militia hold their post, as they always do).
  for (const army of armies) {
    if (army.ownerId !== owners.enemy) continue
    for (const unit of army.units) {
      if (UNIT_TYPES[unit.type].holdsPosition) continue
      const path = unit.position ? findPath(surface, unit.position, field.playerNode, unit.type) : null
      unit.path = path ?? []
    }
  }
  return { bodyName: scenario.battlefield.bodyName, armies, battlefield: field }
}
