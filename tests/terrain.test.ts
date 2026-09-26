// The terrain battle: relief, the fine-scale ground sim, and finding the fights
// that should move onto a terrain map (src/scene/terrainMap.ts,
// src/scene/terrainBattle.ts).
//
// Run:  npx tsx tests/terrain.test.ts

import {
  GROUND_STEPS_PER_DAY,
  HIGH_GROUND_BONUS,
  TERRAIN_GROUP_CELLS,
  TERRAIN_RELEASE_DAYS,
  TERRAIN_TRIGGER_CELLS,
  UNIT_TYPES,
  type TerrainId,
  type UnitType,
} from '../src/data/groundData'
import type { Army, GroundUnit } from '../src/scene/armyLogic'
import { groundSurface, type LandedUnit } from '../src/scene/groundLogic'
import { TERRAIN_IDS } from '../src/scene/planetTerrain'
import { arc, surfaceMesh, type SurfacePoint } from '../src/scene/surfaceMesh'
import { buildRelief, gridSize, heightAtLocal, makeFrame, terrainAtLocal, toGlobal, toLocal } from '../src/scene/terrainMap'
import {
  applyBattleToUnit,
  createBattle,
  findEngagements,
  findLocalPath,
  haltUnits,
  heightFactor,
  orderUnitsTo,
  rangeCells,
  shouldJoin,
  slopeFactor,
  stepTerrainBattle,
  targetUnits,
  unitToGlobal,
  type TerrainBattle,
  type TerrainContext,
  type TerrainUnit,
} from '../src/scene/terrainBattle'
import { fromLonLat } from '../src/scene/mapProjection'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const ME = 'me'
const FOE = 'foe'
const atWar = (a: string, b: string) => a !== b
const ctx: TerrainContext = { atWar, isAutonomous: (id) => id !== ME }
const STEPS_PER_DAY = GROUND_STEPS_PER_DAY
const idx = (t: TerrainId) => TERRAIN_IDS.indexOf(t)

const earth = groundSurface('Earth', {})!
const frame = makeFrame(fromLonLat(0.4, 0.5))

// A battle on a flat, uniform patch of `terrain`, with these units.
function flatBattle(terrain: TerrainId, units: Partial<TerrainUnit>[]): TerrainBattle {
  const grid = buildRelief(earth, frame)
  grid.terrain.fill(idx(terrain))
  grid.height.fill(0)
  return {
    id: 'b',
    bodyName: 'Earth',
    radiusKm: earth.radiusKm,
    frame,
    grid,
    keys: [],
    units: units.map((u, i) => ({
      id: `u${String(i).padStart(2, '0')}`,
      ownerId: ME,
      type: 'infantry' as UnitType,
      strength: 25,
      maxStrength: 25,
      x: 0,
      y: 0,
      path: [],
      orderedMove: false,
      targetUnitId: null,
      firingAtId: null,
      ...u,
    })),
    startedStep: 0,
    resolvedThroughStep: 0,
    quietSinceStep: null,
  }
}
const unit = (b: TerrainBattle, id: string) => b.units.find((u) => u.id === id)!

console.log('\n=== 1. The local frame ===')
{
  let worst = 0
  for (let i = 0; i < 200; i++) {
    const x = (((i * 0.618) % 1) - 0.5) * 7
    const y = (((i * 0.377) % 1) - 0.5) * 7
    const back = toLocal(frame, toGlobal(frame, x, y))
    worst = Math.max(worst, Math.hypot(back.x - x, back.y - y))
  }
  check('a local point maps to the globe and back', worst < 1e-9, `worst ${worst.toExponential(1)} cells`)
  const c = toLocal(frame, frame.center)
  check('the centre is the origin', Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9)
  check('east is +x and north is +y', toLocal(frame, fromLonLat(0.4 + 0.02, 0.5)).x > 0 && toLocal(frame, fromLonLat(0.4, 0.52)).y > 0)
  const spot = toGlobal(frame, 2, 0)
  const cells = arc(frame.center, spot) / surfaceMesh().fineSpacingRad
  check('a cell in the patch is about a cell on the globe', Math.abs(cells - 2) < 0.08, `${cells.toFixed(3)} cells for 2`)
}

console.log('\n=== 2. Relief ===')
{
  const a = buildRelief(earth, frame)
  const b = buildRelief(earth, frame)
  check('the patch is a square of gridSize() points', a.n === gridSize() && a.terrain.length === a.n * a.n)
  check('building it twice gives the same ground', a.height.every((h, i) => h === b.height[i]) && a.terrain.every((t, i) => t === b.terrain[i]))
  let min = Infinity, max = -Infinity
  for (const h of a.height) {
    min = Math.min(min, h)
    max = Math.max(max, h)
  }
  check('heights are sensible (no negatives, under 6 km)', min >= 0 && max < 6000, `${min.toFixed(0)}-${max.toFixed(0)} m`)
  const water = Array.from(a.height).filter((_, i) => TERRAIN_IDS[a.terrain[i]] === 'ocean')
  check('water is level', water.every((h) => h === 0))

  // Mountains stand higher than plains, across the world.
  const sums: Partial<Record<TerrainId, { s: number; n: number }>> = {}
  for (const [lon, lat] of [[0.4, 0.5], [1.5, 0.6], [-1.6, 0.4], [2.6, 0.3], [1.5, -0.3], [-0.4, 0.2], [3.0, 0.6], [-2.2, -0.3]]) {
    const g = buildRelief(earth, makeFrame(fromLonLat(lon, lat)))
    for (let i = 0; i < g.n * g.n; i++) {
      const t = TERRAIN_IDS[g.terrain[i]]
      const e = (sums[t] ??= { s: 0, n: 0 })
      e.s += g.height[i]
      e.n++
    }
  }
  const mean = (t: TerrainId) => (sums[t] ? sums[t]!.s / sums[t]!.n : NaN)
  check('mountains stand higher than forest, forest higher than plains', mean('mountains') > mean('forest') && mean('forest') > mean('plains'), `m ${mean('mountains').toFixed(0)} f ${mean('forest').toFixed(0)} p ${mean('plains').toFixed(0)}`)
  check('height is smooth between points', heightAtLocal(a, 0.01, 0.01) >= Math.min(...a.height) && heightAtLocal(a, 0, 0) <= Math.max(...a.height))
  check('the terrain under a point reads back', TERRAIN_IDS.includes(terrainAtLocal(a, 0.3, -0.2)))
}

console.log('\n=== 3. Range, damage and cover ===')
{
  const range = rangeCells('infantry')
  check('a line unit\'s range is one cell, artillery\'s nearly two', Math.abs(range - 1) < 0.01 && Math.abs(rangeCells('artillery') - 1.87) < 0.05, `${range.toFixed(3)}, ${rangeCells('artillery').toFixed(3)}`)

  const far = stepTerrainBattle(flatBattle('plains', [{ x: -0.6, ownerId: ME }, { x: 0.6, ownerId: FOE }]), ctx, 8).battle
  check('units 1.2 cells apart do not fire', unit(far, 'u00').firingAtId === null && unit(far, 'u00').strength === 25)
  const near = stepTerrainBattle(flatBattle('plains', [{ x: -0.4, ownerId: ME }, { x: 0.4, ownerId: FOE }]), ctx, 8).battle
  check('units 0.8 cells apart fire on each other', unit(near, 'u00').firingAtId === 'u01' && unit(near, 'u01').firingAtId === 'u00')
  const step = stepTerrainBattle(flatBattle('plains', [{ x: -0.4, ownerId: ME }, { x: 0.4, ownerId: FOE }]), ctx, 1).battle
  check('damage on open ground is the coarse sim\'s (25 x 1 x 0.02 / 16)', Math.abs(25 - unit(step, 'u01').strength - (25 * UNIT_TYPES.infantry.attack * 0.02) / STEPS_PER_DAY) < 1e-9, `${(25 - unit(step, 'u01').strength).toFixed(5)}`)

  const shell = stepTerrainBattle(flatBattle('plains', [{ x: -1.6, ownerId: ME, type: 'artillery' }, { x: 0, ownerId: FOE }]), ctx, 8).battle
  check('artillery outranges the line and takes no fire back', unit(shell, 'u01').strength < 25 && unit(shell, 'u00').strength === 25)

  // Cover: the same shot at a unit in the mountains does less.
  const open = stepTerrainBattle(flatBattle('plains', [{ x: -0.3, ownerId: ME }, { x: 0.3, ownerId: FOE }]), ctx, 16).battle
  const hills = stepTerrainBattle(flatBattle('mountains', [{ x: -0.3, ownerId: ME }, { x: 0.3, ownerId: FOE }]), ctx, 16).battle
  check('the same fight does less damage in the mountains', 25 - unit(hills, 'u01').strength < 25 - unit(open, 'u01').strength)

  // Height: shooting downhill is stronger, uphill weaker.
  const level = flatBattle('plains', [{ x: -0.3, ownerId: ME }, { x: 0.3, ownerId: FOE }])
  const raised = { ...level, grid: { ...level.grid, height: level.grid.height.map((_, i) => ((i % level.grid.n) < level.grid.n / 2 ? 1000 : 0)) as unknown as Float32Array } }
  raised.grid.height = Float32Array.from(raised.grid.height)
  const dLevel = 25 - unit(stepTerrainBattle(level, ctx, 1).battle, 'u01').strength
  const dHigh = 25 - unit(stepTerrainBattle(raised, ctx, 1).battle, 'u01').strength // shooter u00 on the 1000 m side
  const dLow = 25 - unit(stepTerrainBattle(raised, ctx, 1).battle, 'u00').strength
  check('the unit on the hill hits harder than on the flat', Math.abs(dHigh / dLevel - (1 + HIGH_GROUND_BONUS)) < 1e-6, `x${(dHigh / dLevel).toFixed(3)}`)
  check('...and the unit below hits softer', Math.abs(dLow / dLevel - (1 - HIGH_GROUND_BONUS)) < 1e-6, `x${(dLow / dLevel).toFixed(3)}`)
  check('the height factor is symmetric and bounded', heightFactor(2000, 0) === 1 + HIGH_GROUND_BONUS && heightFactor(0, 2000) === 1 - HIGH_GROUND_BONUS && heightFactor(500, 500) === 1)

  // Focus fire.
  const three = flatBattle('plains', [{ x: -0.3, ownerId: ME }, { x: 0.2, ownerId: FOE }, { x: 0.5, ownerId: FOE }])
  const nearest = stepTerrainBattle(three, ctx, 4).battle
  check('with no orders a unit fires at the nearest', unit(nearest, 'u00').firingAtId === 'u01')
  const focused = stepTerrainBattle(targetUnits(three, ['u00'], 'u02'), ctx, 4).battle
  check('an ordered target in range is fired on instead', unit(focused, 'u00').firingAtId === 'u02')
  const outOfRange = stepTerrainBattle(targetUnits(flatBattle('plains', [{ x: -0.6, ownerId: ME }, { x: 0.2, ownerId: FOE }, { x: 0.7, ownerId: FOE }]), ['u00'], 'u02'), ctx, 4).battle
  check('an ordered target out of range is ignored', unit(outOfRange, 'u00').firingAtId === 'u01')

  // Digging in.
  const dug = flatBattle('plains', [{ x: -0.3, ownerId: ME, stillSinceStep: 0 }, { x: 0.3, ownerId: FOE, stillSinceStep: 0 }])
  const before = stepTerrainBattle(dug, ctx, 2).battle
  const fresh = 25 - unit(before, 'u00').strength
  const later = stepTerrainBattle({ ...dug, units: dug.units.map((u) => ({ ...u, stillSinceStep: -1000 })) }, ctx, 2).battle
  check('a unit dug in for a week takes less damage', 25 - unit(later, 'u00').strength < fresh)
}

console.log('\n=== 4. Movement and paths ===')
{
  // A distant enemy keeps the battle alive while the march is measured.
  const bystander: Partial<TerrainUnit> = { x: 3.4, y: 3.4, ownerId: FOE, type: 'militia' }
  const flat = flatBattle('plains', [{ x: -2, y: 0, ownerId: ME }, bystander])
  const ordered = orderUnitsTo(flat, ['u00'], { x: 2, y: 0 }, false, 0)
  check('an order gives a route ending on the spot', ordered.ok && ordered.battle.units[0].path.length > 0 && Math.abs(ordered.battle.units[0].path.at(-1)!.x - 2) < 1e-9)
  const moved = stepTerrainBattle(ordered.battle, ctx, 32).battle
  const advance = unit(moved, 'u00').x + 2
  const expected = (UNIT_TYPES.infantry.speedKmPerDayRef / 6371 / surfaceMesh().fineSpacingRad) * 2 * 1 // 2 days at the size factor of Earth (1)
  check('two days\' march covers the coarse sim\'s distance', Math.abs(advance - expected) < 0.02, `${advance.toFixed(3)} vs ${expected.toFixed(3)} cells`)

  const steep = flatBattle('plains', [{ x: -2, y: 0, ownerId: ME }, bystander])
  steep.grid.height = Float32Array.from(steep.grid.height, (_, i) => (i % steep.grid.n) * 500)
  const climbed = stepTerrainBattle(orderUnitsTo(steep, ['u00'], { x: 2, y: 0 }, false, 0).battle, ctx, 32).battle
  check('climbing steep ground is slower', unit(climbed, 'u00').x + 2 < advance, `${(unit(climbed, 'u00').x + 2).toFixed(3)} < ${advance.toFixed(3)}`)
  check('the slope factor slows a step by its share', slopeFactor(0, 0) === 1 && slopeFactor(0, 500) < slopeFactor(0, 100) && slopeFactor(0, 5000) === slopeFactor(0, 500))

  // Water blocks a wall, so the path goes round.
  const wall = flatBattle('plains', [{ x: -2, y: 0, ownerId: ME }])
  const n = wall.grid.n
  for (let j = 10; j < n; j++) for (let i = n / 2 - 1; i <= n / 2; i++) wall.grid.terrain[j * n + i] = idx('ocean')
  const route = findLocalPath(wall.grid, 'infantry', { x: -2, y: 0 }, { x: 2, y: 0 })
  check('a wall of water is walked round, not through', !!route && route.some((p) => p.y < -1.4))
  check('nobody walks into the sea (but marines can)', findLocalPath(wall.grid, 'infantry', { x: -2, y: 0 }, { x: 0, y: 1 }) === null && findLocalPath(wall.grid, 'marines', { x: -2, y: 0 }, { x: 0, y: 1 }) !== null)
  const armour = flatBattle('plains', [{ x: -2, y: 0, ownerId: ME, type: 'armour' }])
  armour.grid.terrain.fill(idx('mountains'))
  check('armour cannot enter mountains', orderUnitsTo(armour, ['u00'], { x: 0, y: 0 }, false, 0).ok === false)
  const queued = orderUnitsTo(orderUnitsTo(flat, ['u00'], { x: 0, y: 0 }, false, 0).battle, ['u00'], { x: 2, y: 2 }, true, 0)
  check('Shift queues a leg after the current route', queued.battle.units[0].path.length > ordered.battle.units[0].path.length / 2 && Math.abs(queued.battle.units[0].path.at(-1)!.y - 2) < 1e-9)
  check('halting clears the route', haltUnits(ordered.battle, ['u00'], 0).units[0].path.length === 0)
  const garrison = orderUnitsTo(flatBattle('plains', [{ x: 0, y: 0, ownerId: ME, type: 'militia' }]), ['u00'], { x: 2, y: 0 }, false, 0)
  check('garrison militia hold their post', garrison.ok === false)

  // An ordered move carries on under fire; the AI halts to fight.
  const marching = flatBattle('plains', [{ x: -0.6, ownerId: ME, path: [{ x: 3, y: 0 }], orderedMove: true }, { x: 0.3, ownerId: FOE }])
  const under = stepTerrainBattle(marching, ctx, 8).battle
  check('an ordered move goes on under fire', unit(under, 'u00').x > -0.6 && unit(under, 'u00').firingAtId !== null)
  const aiMarch = flatBattle('plains', [{ x: -0.6, ownerId: FOE, path: [{ x: 3, y: 0 }] }, { x: 0.3, ownerId: ME }])
  const halted = stepTerrainBattle(aiMarch, ctx, 8).battle
  check('an AI move halts to fight', unit(halted, 'u00').x === -0.6)
}

console.log('\n=== 5. The AI, endings and determinism ===')
{
  const meet = flatBattle('plains', [{ x: -1.4, ownerId: ME }, { x: 1.4, ownerId: FOE }])
  const after = stepTerrainBattle(meet, ctx, 30 * STEPS_PER_DAY).battle
  check('the AI advances on an enemy until in range', unit(after, 'u01').x < 1.4 && unit(after, 'u01').firingAtId !== null)
  check('the player\'s unit never moves on its own', unit(after, 'u00').x === -1.4)

  const kill = stepTerrainBattle(flatBattle('plains', [{ x: -0.3, ownerId: ME }, { x: 0.3, ownerId: FOE, strength: 0.6 }]), ctx, 200)
  check('a unit that falls is removed and reported', kill.losses.length === 1 && kill.losses[0].ownerId === FOE && kill.losses[0].killers.includes(ME) && kill.battle.units.length === 1)
  check('the battle ends when one side is gone', kill.ended === 'eliminated')

  const apart = flatBattle('plains', [{ x: -3, ownerId: ME }, { x: 3, ownerId: FOE, type: 'militia' }])
  const quiet = stepTerrainBattle(apart, ctx, (TERRAIN_RELEASE_DAYS + 1) * STEPS_PER_DAY)
  check('it ends, disengaged, once the sides stay apart', quiet.ended === 'disengaged')
  const soon = stepTerrainBattle(apart, ctx, STEPS_PER_DAY)
  check('...but not the moment they part', soon.ended === null)

  const chop = (b: TerrainBattle, cuts: number[]) => cuts.reduce((acc, c) => stepTerrainBattle(acc, ctx, c).battle, b)
  const start = flatBattle('plains', [{ x: -0.5, ownerId: ME, path: [{ x: 1, y: 1 }], orderedMove: true }, { x: 0.5, ownerId: FOE }, { x: 0.9, ownerId: FOE, type: 'armour' }])
  const one = stepTerrainBattle(start, ctx, 300).battle
  const many = chop(start, [1, 7, 30, 31, 100, 200, 300])
  check('the same result however the clock is chopped', JSON.stringify(one.units) === JSON.stringify(many.units))
  const original = JSON.stringify(start.units)
  stepTerrainBattle(start, ctx, 50)
  check('stepping never changes its input', JSON.stringify(start.units) === original)
}

console.log('\n=== 6. Finding fights on the planetary map ===')
{
  const land = (ownerId: string, type: UnitType, p: SurfacePoint, id: string): LandedUnit => {
    const u: GroundUnit = { id, type, strength: 25, maxStrength: 25, position: p }
    const army: Army = { id: `a-${id}`, ownerId, kind: 'assault', units: [u], location: { kind: 'body', bodyName: 'Earth' } }
    return { army, unit: u }
  }
  const cell = surfaceMesh().fineSpacingRad
  const at = (x: number, y = 0) => toGlobal(frame, x, y)
  const groups = (list: LandedUnit[]) => findEngagements(list, atWar)

  check('hostile line units 1.4 cells apart trigger a terrain battle', groups([land(ME, 'infantry', at(-0.7), 'a'), land(FOE, 'infantry', at(0.7), 'b')]).length === 1)
  check('1.6 cells apart do not', groups([land(ME, 'infantry', at(-0.8), 'a'), land(FOE, 'infantry', at(0.8), 'b')]).length === 0)
  check('the trigger is just outside the coarse contact range', TERRAIN_TRIGGER_CELLS > rangeCells('infantry') && TERRAIN_TRIGGER_CELLS < rangeCells('artillery'))
  check('two artillery duelling across the map do not', groups([land(ME, 'artillery', at(-0.7), 'a'), land(FOE, 'artillery', at(0.7), 'b')]).length === 0)
  check('artillery beside a line unit of the enemy does', groups([land(ME, 'artillery', at(-0.7), 'a'), land(FOE, 'infantry', at(0.7), 'b')]).length === 1)
  check('friends do not trigger a fight', groups([land(ME, 'infantry', at(-0.2), 'a'), land(ME, 'infantry', at(0.2), 'b')]).length === 0)

  const crowd = groups([
    land(ME, 'infantry', at(-0.5), 'a'),
    land(FOE, 'infantry', at(0.5), 'b'),
    land(ME, 'armour', at(-2.5), 'c'), // linked within 2.5 of a
    land(FOE, 'infantry', at(6), 'd'), // far away
    land(ME, 'artillery', at(-4.8), 'e'), // linked to c
  ])
  check('units linked within the group radius are drawn in', crowd.length === 1 && ['a', 'b', 'c', 'e'].every((id) => crowd[0].unitIds.includes(id)) && !crowd[0].unitIds.includes('d'), crowd[0]?.unitIds.join())
  check('two separate fights are two groups', groups([land(ME, 'infantry', at(-0.5, -3), 'a'), land(FOE, 'infantry', at(0.5, -3), 'b'), land(ME, 'infantry', at(-0.5, 5), 'c'), land(FOE, 'infantry', at(0.5, 5), 'd')]).length === 2)
  check('the group radius is wider than the trigger', TERRAIN_GROUP_CELLS > TERRAIN_TRIGGER_CELLS)

  // Lifting units into a battle and back keeps them where they were.
  const a = land(ME, 'infantry', at(-0.5), 'a')
  const b = land(FOE, 'armour', at(0.5, 0.3), 'b')
  const battle = createBattle('t1', earth, [a, b], at(0, 0.1), 0, {}, {})
  check('a battle starts with every unit in it, where it stood', battle.units.length === 2 && arc(unitToGlobal(battle, battle.units[0]).position, a.unit.position!) < 1e-9)
  const back = applyBattleToUnit(a.unit, battle, { ...battle.units[0], strength: 12 })
  check('its state is copied back onto the coarse unit', back.strength === 12 && arc(back.position!, a.unit.position!) < 1e-9 && back.id === 'a')
  check('a unit near a fight joins it; one far off does not', shouldJoin(battle, at(1.5)) && !shouldJoin(battle, at(8)))
  void cell
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
