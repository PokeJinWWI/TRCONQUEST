// The ground war's terrain battles as a whole (pure): which fights move onto a
// terrain map, stepping them, and putting the units back on the planetary map
// afterwards. The rules of a single battle are in scene/terrainBattle.ts; the
// coarse sim that everything else still runs on is scene/groundResolution.ts.
// hooks/useGroundCombatResolver.ts is the store I/O around this.
//
// Everything a battle does to the world goes back through the coarse units, so
// the planetary map, the panels, "is the player fighting" (pacing) and the war
// score keep reading the same fields as ever: strength, position, route,
// focus-fire target and who each unit is firing at.
import type { AtWarFn } from '../state/diplomacyStore'
import type { Army } from './armyLogic'
import { landedUnits, type NodeHolderMap } from './groundLogic'
import type { BodySurface } from './planetTerrain'
import {
  addUnits,
  applyBattleToUnit,
  createBattle,
  findEngagements,
  shouldJoin,
  stepTerrainBattle,
  type TerrainBattle,
  type TerrainLoss,
} from './terrainBattle'
import type { OwnerMap } from './territory'

export interface TerrainWarWorld {
  armies: Army[]
  battles: TerrainBattle[]
  owners: OwnerMap
  holders: NodeHolderMap
  atWar: AtWarFn
  isAutonomous: (countryId: string) => boolean
  surfaceOf: (bodyName: string) => BodySurface | null
}

export interface TerrainWarResult {
  armies: Army[]
  battles: TerrainBattle[]
  losses: (TerrainLoss & { bodyName: string })[]
  // Battles that finished this call, and how.
  finished: { id: string; bodyName: string; how: 'eliminated' | 'disengaged' | 'gone' }[]
}

// Every unit that is in a battle.
export function engagedUnitIds(battles: TerrainBattle[]): Set<string> {
  const ids = new Set<string>()
  for (const b of battles) for (const u of b.units) ids.add(u.id)
  return ids
}

// Brings the terrain battles up to `toStep`: steps each one, writes it back to
// the coarse units, lets units that have come up join, and opens a battle for
// any new fight. `armies` is what the coarse sim just produced.
export function stepTerrainWar(world: TerrainWarWorld, toStep: number, nextId: (bodyName: string, step: number, n: number) => string): TerrainWarResult {
  const losses: TerrainWarResult['losses'] = []
  const finished: TerrainWarResult['finished'] = []
  let armies = world.armies.map((a) => ({ ...a, units: a.units.map((u) => ({ ...u })) }))
  const ctx = { atWar: world.atWar, isAutonomous: world.isAutonomous }
  const live: TerrainBattle[] = []

  const unitPlace = (id: string) => {
    for (const a of armies) {
      const u = a.units.find((x) => x.id === id)
      if (u) return { army: a, unit: u }
    }
    return null
  }

  for (const start of world.battles) {
    // Units the coarse map no longer has on this body (lost transports, removed
    // armies) leave the battle.
    let battle: TerrainBattle = {
      ...start,
      units: start.units.filter((u) => {
        const found = unitPlace(u.id)
        return !!found && found.army.location.kind === 'body' && found.army.location.bodyName === start.bodyName
      }),
    }
    // Reinforcements: idle units close to the fight are drawn in.
    const inAny = engagedUnitIds([...live, battle, ...world.battles.filter((b) => b !== start && !live.includes(b))])
    const joiners = landedUnits(armies, battle.bodyName).filter((lu) => !inAny.has(lu.unit.id) && shouldJoin(battle, lu.unit.position!))
    if (joiners.length > 0) battle = addUnits(battle, joiners, battle.resolvedThroughStep)

    const result = stepTerrainBattle(battle, ctx, toStep)
    for (const l of result.losses) losses.push({ ...l, bodyName: battle.bodyName })
    const stillThere = new Map(result.battle.units.map((u) => [u.id, u]))
    const before = new Set(battle.units.map((u) => u.id))
    const fallen = new Set([...before].filter((id) => !stillThere.has(id)))

    armies = armies.map((a) => {
      if (a.location.kind !== 'body' || a.location.bodyName !== battle.bodyName) return a
      return {
        ...a,
        units: a.units
          .filter((u) => !fallen.has(u.id))
          .map((u) => {
            const tu = stillThere.get(u.id)
            if (!tu) return u
            const back = applyBattleToUnit(u, result.battle, result.ended ? { ...tu, firingAtId: null } : tu)
            return back
          }),
      }
    })

    if (result.ended || result.battle.units.length === 0) {
      finished.push({ id: battle.id, bodyName: battle.bodyName, how: result.ended ?? 'gone' })
    } else live.push(result.battle)
  }

  // New fights, body by body.
  const taken = engagedUnitIds(live)
  const bodies = [...new Set(armies.filter((a) => a.location.kind === 'body').map((a) => (a.location as { bodyName: string }).bodyName))].sort()
  for (const body of bodies) {
    const surface = world.surfaceOf(body)
    if (!surface) continue
    const idle = landedUnits(armies, body).filter((lu) => !taken.has(lu.unit.id))
    const groups = findEngagements(idle, world.atWar)
    groups.forEach((g, n) => {
      const members = idle.filter((lu) => g.unitIds.includes(lu.unit.id))
      const battle = createBattle(nextId(body, toStep, n), surface, members, g.center, toStep, world.owners, world.holders)
      for (const u of battle.units) taken.add(u.id)
      live.push(battle)
    })
  }

  return { armies: armies.filter((a) => a.units.length > 0), battles: live, losses, finished }
}
