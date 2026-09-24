// The ground AI for units nobody is commanding directly — every nation's
// except the player's. Runs inside the ground simulation (see
// groundResolution.ts) once a sim-day per active world, so it behaves the
// same headless as in the game.
//
//   - Garrison militia never move; they hold their posts and fight.
//   - Mobile units go for the nearest key node held by an enemy (attacking,
//     or retaking their own), and stay on it once there.
//   - With no enemy key node to take, they reinforce the nearest own key
//     node with enemy units near it, or return to their nearest key node.
//   - They only plan a new path when their objective changes; paths come
//     from the same A* the player's orders use.
//
// The player's own units never move on their own: they hold where they are
// and fire at whatever comes into range.
import { UNIT_TYPES } from '../data/groundData'
import type { AtWarFn } from '../state/diplomacyStore'
import type { BodySurface } from './planetTerrain'
import { arc, nodePoint } from './surfaceMesh'
import { cellsToRad, findPath, holderOf, hostilesWithin, type LandedUnit, type NodeHolderMap } from './groundLogic'
import type { OwnerMap } from './territory'

const THREAT_RADIUS_CELLS = 3
const AT_KEY_CELLS = 1

// Mutates the given (already cloned) units' plans in place.
export function planAutonomous(
  surface: BodySurface,
  units: LandedUnit[],
  owners: OwnerMap,
  holders: NodeHolderMap,
  atWar: AtWarFn,
  isAutonomous: (countryId: string) => boolean,
): void {
  const body = surface.bodyName
  const keys = surface.keySlots.map((k) => k.node)
  if (keys.length === 0) return
  const holder = (node: number) => holderOf(body, node, owners, holders)

  for (const { army, unit } of units) {
    if (!isAutonomous(army.ownerId) || UNIT_TYPES[unit.type].holdsPosition || !unit.position) continue
    const me = army.ownerId
    const pos = unit.position
    const enemyHeld = (node: number) => {
      const h = holder(node)
      return !!h && atWar(h, me)
    }
    const threatened = (node: number) => hostilesWithin(nodePoint(node), cellsToRad(THREAT_RADIUS_CELLS), me, units, atWar).length > 0

    const enemyKeys = keys.filter(enemyHeld)
    // Keep going for a still-valid objective. Guarding an own key is only
    // worth it once there's nothing left to take — otherwise a lone enemy
    // unit near a taken key would hold the whole force there forever.
    const current = unit.objectiveNode
    if (current !== null && current !== undefined) {
      const stillValid = enemyHeld(current) || (enemyKeys.length === 0 && holder(current) === me && threatened(current))
      if (stillValid) continue
    }

    const byDistance = (list: number[]) => [...list].sort((a, b) => arc(pos, nodePoint(a)) - arc(pos, nodePoint(b)) || a - b)
    const ownThreatened = keys.filter((k) => holder(k) === me && threatened(k))
    const ownKeys = keys.filter((k) => holder(k) === me)

    let chosen: number | null = null
    let path: ReturnType<typeof findPath> = null
    for (const candidate of [...byDistance(enemyKeys), ...byDistance(ownThreatened)]) {
      path = findPath(surface, pos, candidate, unit.type)
      if (path) {
        chosen = candidate
        break
      }
    }
    if (chosen === null && ownKeys.length > 0) {
      const home = byDistance(ownKeys)[0]
      if (arc(pos, nodePoint(home)) > cellsToRad(AT_KEY_CELLS)) {
        path = findPath(surface, pos, home, unit.type)
        if (path) chosen = home
      }
    }
    unit.objectiveNode = chosen
    if (chosen !== null && path) {
      unit.path = path
      unit.orderedMove = false
    }
  }
}
