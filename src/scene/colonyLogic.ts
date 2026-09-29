// Colonies, the pure rules: what founding costs, where a planetary outpost
// stands, and when a micro-colony becomes a planetary colony. Store I/O is in
// scene/colonies.ts; data in data/colonyData.ts.
import { COLONY_COST_BASE, COLONY_COST_PER_LY, COLONY_COST_PER_SIZE, COLONY_PATROL_DAYS, INFLUENCE_CAP } from '../data/colonyData'
import { STARS } from '../data/starData'
import { TERRAIN } from '../data/groundData'
import type { AtWarFn } from '../state/diplomacyStore'
import type { Colony } from '../state/colonyStore'
import { armiesOnBody, hostileWarshipsAt, isArmed, orbitedBody, type Army, type ShipLike } from './armyLogic'
import { estimateSize } from './bodyStats'
import { cellsToRad } from './groundLogic'
import { bodyGroundInfo, terrainAt, type BodySurface } from './planetTerrain'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'
import { orbitBodyOf } from './territory'

export type PatrolShipLike = ShipLike & { patrol?: boolean }

export function lightYearsBetween(starA: string, starB: string): number {
  const a = STARS.find((s) => s.id === starA)
  const b = STARS.find((s) => s.id === starB)
  if (!a || !b) return 0
  return Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2])
}

// Influence to found a colony on `bodyName` (in `bodyStarId`), for a nation
// whose capital is at `capitalStarId`: bigger and farther costs more.
export function colonyInfluenceCost(bodyName: string, bodyStarId: string, capitalStarId: string): number {
  const radiusKm = bodyGroundInfo(bodyName)?.radiusKm
  const size = radiusKm ? estimateSize(radiusKm).districts : 3
  const cost = COLONY_COST_BASE + COLONY_COST_PER_SIZE * size + COLONY_COST_PER_LY * lightYearsBetween(capitalStarId, bodyStarId)
  return Math.min(INFLUENCE_CAP, Math.round(cost))
}

// Keeps a planetary outpost clear of the other key nodes.
const OUTPOST_SPACING_CELLS = 1.5

// Where a colony's planetary outpost stands: on the terrain's own outpost key
// node if it has one, else on open mainland near its capital or first city.
export function placeOutpostNode(surface: BodySurface): number | null {
  const own = surface.keySlots.find((k) => k.kind === 'outpost')
  if (own) return own.node
  const mesh = surfaceMesh()
  const usable = (n: number) => surface.landComponent[n] === surface.mainland && TERRAIN[terrainAt(surface, n)].paintable
  const anchor = surface.keySlots.find((k) => k.kind === 'capital') ?? surface.keySlots.find((k) => k.kind === 'city') ?? surface.keySlots[0]
  if (!anchor) {
    for (let n = 0; n < mesh.count.fine; n++) if (usable(n)) return n
    return null
  }
  const spacing = cellsToRad(OUTPOST_SPACING_CELLS)
  const goal = nodePoint(anchor.node)
  const keys = surface.keySlots.map((k) => nodePoint(k.node))
  let best = -1
  let bestDist = Infinity
  for (let n = 0; n < mesh.count.fine; n++) {
    if (!usable(n)) continue
    const p = nodePoint(n)
    if (keys.some((k) => arc(k, p) < spacing)) continue
    const d = arc(p, goal)
    if (d < bestDist) {
      bestDist = d
      best = n
    }
  }
  return best >= 0 ? best : null
}

// The surface with the colony's planetary outpost as a key node (unless a key
// node already stands there).
export function withOutpostKey(surface: BodySurface, outpostNode: number | undefined): BodySurface {
  if (outpostNode === undefined || surface.keySlots.some((k) => k.node === outpostNode)) return surface
  return { ...surface, keySlots: [...surface.keySlots, { node: outpostNode, kind: 'outpost' }] }
}

// The owner's patrol ships hold the orbit (a moon's is its planet's), and no
// hostile warship is there.
export function orbitSecure(ownerId: string, bodyName: string, ships: PatrolShipLike[], atWarFn: AtWarFn): boolean {
  const orbit = orbitBodyOf(bodyName)
  const patrolled = ships.some((s) => s.ownerId === ownerId && s.patrol && orbitedBody(s) === orbit && isArmed(s))
  return patrolled && hostileWarshipsAt(ownerId, orbit, ships, atWarFn).length === 0
}

// Nobody is fighting the owner for the colony: it holds the world, no one else
// holds ground there, and no army at war with it stands on it.
export function colonyUncontested(ownerId: string, bodyName: string, controllerId: string | undefined, groundHeldByOthers: boolean, armies: Army[], atWarFn: AtWarFn): boolean {
  if (controllerId !== ownerId || groundHeldByOthers) return false
  return !armiesOnBody(armies, bodyName).some((a) => a.ownerId !== ownerId && atWarFn(ownerId, a.ownerId))
}

export interface ColonyContext {
  ownerOf: (bodyName: string) => string | undefined
  controllerOf: (bodyName: string) => string | undefined
  groundHeldByOthers: (bodyName: string) => boolean
  ships: PatrolShipLike[]
  armies: Army[]
  atWar: AtWarFn
}

// One pass: the patrol clock of every colony, and the micro-colonies that
// become planetary colonies now (patrolled for COLONY_PATROL_DAYS, uncontested).
export function stepColonies(colonies: Record<string, Colony>, ctx: ColonyContext, simDays: number): { colonies: Record<string, Colony>; promoted: string[] } {
  const promoted: string[] = []
  let changed = false
  const next: Record<string, Colony> = {}
  for (const [body, colony] of Object.entries(colonies)) {
    const owner = ctx.ownerOf(body)
    let c = colony
    if (owner && c.stage === 'micro') {
      const secure = orbitSecure(owner, body, ctx.ships, ctx.atWar)
      const since = secure ? (c.orbitSecureSinceSimDays ?? simDays) : null
      if (since !== c.orbitSecureSinceSimDays) c = { ...c, orbitSecureSinceSimDays: since }
      const patrolled = since !== null && simDays - since >= COLONY_PATROL_DAYS
      if (patrolled && colonyUncontested(owner, body, ctx.controllerOf(body), ctx.groundHeldByOthers(body), ctx.armies, ctx.atWar)) {
        c = { ...c, stage: 'planetary', orbitSecureSinceSimDays: null }
        promoted.push(body)
      }
    }
    if (c !== colony) changed = true
    next[body] = c
  }
  return { colonies: changed ? next : colonies, promoted }
}
