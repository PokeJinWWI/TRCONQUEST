// Terrain battles inside the ground war: fights that come to close quarters
// leave the coarse sim, play out on a terrain map, and come back
// (src/scene/terrainWar.ts, the freeze in stepGroundWar, and the resolver in
// src/hooks/useGroundCombatResolver.ts).
//
// Run:  npx tsx tests/terrainWar.test.ts

import { ARMY_SCENARIOS } from '../src/data/armyScenarios'
import { PIRATES_ID, SANDBOX_PLAYER_ID } from '../src/data/countryRoster'
import { fightPace, resetFightPace } from '../src/hooks/fightPace'
import { resolveGroundWar } from '../src/hooks/useGroundCombatResolver'
import { playerFightLive, type Army, type GroundUnit } from '../src/scene/armyLogic'
import { buildArmyScenario } from '../src/scene/armyScenario'
import { groundSurface, unitRangeRad } from '../src/scene/groundLogic'
import { stepGroundWar } from '../src/scene/groundResolution'
import { fromLonLat } from '../src/scene/mapProjection'
import { startSandbox } from '../src/scene/sandboxSetup'
import { arc, nearestNode, surfaceMesh, type SurfacePoint } from '../src/scene/surfaceMesh'
import { makeFrame, toGlobal } from '../src/scene/terrainMap'
import { engagedUnitIds, stepTerrainWar } from '../src/scene/terrainWar'
import { atWar } from '../src/state/diplomacyStore'
import { useArmyStore } from '../src/state/armyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useTerrainStore } from '../src/state/terrainStore'

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
const war = (a: string, b: string) => a !== b
const earth = groundSurface('Earth', {})!
const frame = makeFrame(fromLonLat(0.4, 0.5))
const at = (x: number, y = 0): SurfacePoint => toGlobal(frame, x, y)

let counter = 0
const army = (ownerId: string, type: GroundUnit['type'], p: SurfacePoint, extra: Partial<GroundUnit> = {}): Army => {
  counter++
  return {
    id: `army-${counter}`,
    ownerId,
    kind: 'assault',
    units: [{ id: `u-${String(counter).padStart(3, '0')}`, type, strength: 25, maxStrength: 25, position: p, ...extra }],
    location: { kind: 'body', bodyName: 'Earth' },
  }
}
const world = (armies: Army[], battles = [] as ReturnType<typeof stepTerrainWar>['battles']) => ({
  armies,
  battles,
  owners: {},
  holders: {},
  atWar: war,
  isAutonomous: (id: string) => id !== ME,
  surfaceOf: () => earth,
})
const nextId = (b: string, s: number, n: number) => `t-${b}-${s}-${n}`
const units = (armies: Army[]) => armies.flatMap((a) => a.units)

console.log('\n=== 1. The coarse sim leaves engaged units alone ===')
{
  const a = army(ME, 'infantry', at(-0.3))
  const b = army(FOE, 'infantry', at(0.3))
  const base = { armies: [a, b], owners: {}, controllers: {}, nodeHolders: {}, atWar: war, isAutonomous: () => false, surfaceOf: () => earth }
  const fought = stepGroundWar(base, 0, 4)
  check('two units in contact fight on the coarse map', units(fought.armies).some((u) => u.strength < 25))
  const frozen = stepGroundWar({ ...base, engagedUnitIds: new Set(units([a, b]).map((u) => u.id)) }, 0, 4)
  check('...but not when they are in a terrain battle', units(frozen.armies).every((u) => u.strength === 25 && u.firingAtId == null))
  const oneIn = stepGroundWar({ ...base, engagedUnitIds: new Set([units([a])[0].id]) }, 0, 4)
  check('a unit outside the battle cannot shoot one inside it', units(oneIn.armies).every((u) => u.strength === 25))
  const march = army(ME, 'infantry', at(-3), { path: [at(-2)], orderedMove: true })
  const stay = stepGroundWar({ ...base, armies: [march], engagedUnitIds: new Set(units([march]).map((u) => u.id)) }, 0, 4)
  check('an engaged unit does not march on the coarse map', arc(units(stay.armies)[0].position!, at(-3)) < 1e-12)
}

console.log('\n=== 2. Which fights open a terrain battle ===')
{
  const open = (list: Army[]) => stepTerrainWar(world(list), 0, nextId)
  check('hostile line units 1.4 cells apart open one', open([army(ME, 'infantry', at(-0.7)), army(FOE, 'infantry', at(0.7))]).battles.length === 1)
  check('1.6 cells apart do not', open([army(ME, 'infantry', at(-0.8)), army(FOE, 'infantry', at(0.8))]).battles.length === 0)
  check('an artillery duel does not', open([army(ME, 'artillery', at(-0.7)), army(FOE, 'artillery', at(0.7))]).battles.length === 0)
  check('nor do friends', open([army(ME, 'infantry', at(-0.2)), army(ME, 'infantry', at(0.2))]).battles.length === 0)
  const three = open([army(ME, 'infantry', at(-0.7)), army(FOE, 'infantry', at(0.7)), army(ME, 'armour', at(-2.6)), army(FOE, 'infantry', at(9))])
  check('nearby units are drawn in, distant ones are not', three.battles.length === 1 && three.battles[0].units.length === 3)
  const started = open([army(ME, 'infantry', at(-0.7)), army(FOE, 'infantry', at(0.7))])
  check('the units are still on the coarse map (the battle only borrows them)', units(started.armies).length === 2 && engagedUnitIds(started.battles).size === 2)
  check('the battle records where it is and when it began', started.battles[0].bodyName === 'Earth' && started.battles[0].startedStep === 0 && started.battles[0].id === 't-Earth-0-0')
}

console.log('\n=== 3. Playing a battle out ===')
{
  const start = stepTerrainWar(world([army(ME, 'infantry', at(-0.45)), army(FOE, 'infantry', at(0.45), { strength: 8 })]), 0, nextId)
  const mid = stepTerrainWar(world(start.armies, start.battles), 32, nextId)
  const midUnits = units(mid.armies)
  check('after two days both sides are hurt and firing', midUnits.every((u) => u.strength < 25 && u.firingAtId != null), midUnits.map((u) => u.strength.toFixed(2)).join(' / '))
  const bu = mid.battles[0].units
  check('the coarse units carry the battle\'s strengths', midUnits.every((u) => Math.abs(u.strength - bu.find((x) => x.id === u.id)!.strength) < 1e-12))
  check('...and the fight is live for the player (pacing reads firingAtId)', playerFightLive(mid.armies, ME))

  let w = mid
  let guard = 0
  while (w.battles.length > 0 && guard++ < 400) w = stepTerrainWar(world(w.armies, w.battles), (32 + guard * 16), nextId)
  const left = units(w.armies)
  check('it plays out: the beaten side is gone, the winner is left', left.length === 1 && left[0].strength > 0 && w.battles.length === 0)
  const lastLosses = mid.losses.length + w.losses.length
  check('a loss is reported with who caused it', lastLosses >= 1)
  check('the survivor is free again: no target, no fire, plans afresh', left[0].firingAtId == null && left[0].objectiveNode === null)
  check('the battle is reported finished', mid.finished.length + w.finished.length >= 1)

  // A unit that is removed from the coarse map leaves the battle.
  const s2 = stepTerrainWar(world([army(ME, 'infantry', at(-0.6)), army(FOE, 'infantry', at(0.6))]), 0, nextId)
  const gone = stepTerrainWar(world([s2.armies[0]], s2.battles), 16, nextId)
  check('a unit lost from its army leaves the battle', gone.battles.every((b) => b.units.every((u) => u.id === s2.armies[0].units[0].id)))

  // Reinforcements join.
  const s3 = stepTerrainWar(world([army(ME, 'infantry', at(-0.6)), army(FOE, 'infantry', at(0.6))]), 0, nextId)
  const extra = army(ME, 'armour', at(-2.4, 0.4))
  const joined = stepTerrainWar(world([...s3.armies, extra], s3.battles), 8, nextId)
  check('a unit that comes up to the fight joins it', joined.battles[0].units.some((u) => u.id === extra.units[0].id))
  const far = army(ME, 'armour', at(-6, 0))
  const notJoined = stepTerrainWar(world([...s3.armies, far], s3.battles), 8, nextId)
  check('one that is far away does not', !notJoined.battles[0].units.some((u) => u.id === far.units[0].id))

  const before = JSON.stringify(s3.armies)
  stepTerrainWar(world(s3.armies, s3.battles), 64, nextId)
  check('stepping never changes the armies it is given', JSON.stringify(s3.armies) === before)
}

console.log('\n=== 4. Through the resolver, in a game ===')
{
  startSandbox()
  resetFightPace()
  useTerrainStore.getState().setBattles([])
  useGameTimeStore.setState({ simDays: 0, mode: 'normal', paused: false })
  const scenario = ARMY_SCENARIOS.find((s) => s.id === 'army-easy-landing-party')!
  const built = buildArmyScenario(scenario, { player: SANDBOX_PLAYER_ID, enemy: PIRATES_ID })!
  useArmyStore.getState().setArmies(built.armies, 0)
  const cell = surfaceMesh().fineSpacingRad
  void cell

  let openedOn = -1
  let day = 0
  for (; day < 400 && useTerrainStore.getState().battles.length === 0; day++) {
    useGameTimeStore.setState({ simDays: day })
    resolveGroundWar(day)
  }
  openedOn = day
  const battle = useTerrainStore.getState().battles[0]
  check('the enemy marches in and a terrain battle opens', !!battle, `on day ${openedOn}`)
  const mine = battle.units.find((u) => u.ownerId === SANDBOX_PLAYER_ID)!
  const order = useArmyStore.getState().orderUnits([mine.id], 0)
  check('a coarse-map order to an engaged unit is refused', !order.ok && /terrain/i.test(order.ok ? '' : order.reason))
  const terrainOrder = useTerrainStore.getState().orderUnits(battle.id, [mine.id], { x: mine.x + 0.3, y: mine.y })
  check('...but the terrain map takes it', terrainOrder.ok && useTerrainStore.getState().battles[0].units.find((u) => u.id === mine.id)!.path.length > 0)

  for (let d = 0; d < 400 && useTerrainStore.getState().battles.length > 0; d++) {
    day += 1
    useGameTimeStore.setState({ simDays: day })
    resolveGroundWar(day)
    if (d === 3) {
      check('once they fire, the ground fight is live and the clock drops to operational', fightPace.groundLive && useGameTimeStore.getState().mode === 'operational')
    }
  }
  const survivors = units(useArmyStore.getState().armies)
  check('the fight ends and the battle is closed', useTerrainStore.getState().battles.length === 0, `day ${day}`)
  const mineLeft = useArmyStore.getState().armies.filter((a) => a.ownerId === SANDBOX_PLAYER_ID).flatMap((a) => a.units).length
  const theirsLeft = useArmyStore.getState().armies.filter((a) => a.ownerId === PIRATES_ID).flatMap((a) => a.units).length
  check('the easy scenario is still won by the player\'s two armies', mineLeft > 0 && theirsLeft === 0, `${mineLeft} of yours, ${theirsLeft} of theirs`)
  check('the survivors are free again', survivors.every((u) => u.firingAtId == null))
}

console.log('\n=== 5. The scenarios still play as designed on real relief ===')
{
  // The same scripted plans as tests/armyScenarios.test.ts, but through the
  // whole resolver, so the fights go through terrain battles.
  const play = (id: string, plan: 'hold' | 'bring-up') => {
    startSandbox()
    resetFightPace()
    useTerrainStore.getState().setBattles([])
    useGameTimeStore.setState({ simDays: 0, mode: 'normal', paused: false })
    const sc = ARMY_SCENARIOS.find((x) => x.id === id)!
    const built = buildArmyScenario(sc, { player: SANDBOX_PLAYER_ID, enemy: PIRATES_ID })!
    useArmyStore.getState().setArmies(built.armies, 0)
    const isReserve = (a: Army) => !!sc.player[Number(a.id.split('player')[1])]?.rearCells
    if (plan === 'bring-up') {
      const front = built.armies.find((a) => a.ownerId === SANDBOX_PLAYER_ID && !isReserve(a))!
      const node = nearestNode(front.units[0].position!, 'fine')
      for (const r of built.armies.filter((a) => a.ownerId === SANDBOX_PLAYER_ID && isReserve(a))) useArmyStore.getState().orderUnits(r.units.map((u) => u.id), node)
    }
    for (let day = 0; day < 700; day++) {
      useGameTimeStore.setState({ simDays: day })
      resolveGroundWar(day)
      const a = useArmyStore.getState().armies
      if (!a.some((x) => x.ownerId === SANDBOX_PLAYER_ID) || !a.some((x) => x.ownerId === PIRATES_ID)) break
    }
    const a = useArmyStore.getState().armies
    return { mine: a.filter((x) => x.ownerId === SANDBOX_PLAYER_ID).flatMap((x) => x.units).length, theirs: a.filter((x) => x.ownerId === PIRATES_ID).flatMap((x) => x.units).length }
  }
  for (const id of ['army-medium-split-command', 'army-medium-reserve-in-the-timber', 'army-medium-outnumbered-on-the-ice']) {
    const name = ARMY_SCENARIOS.find((x) => x.id === id)!.name
    const hold = play(id, 'hold')
    check(`${name}: left alone, the player does not win`, hold.theirs > 0, `${hold.mine} v ${hold.theirs}`)
    const bring = play(id, 'bring-up')
    check(`${name}: bringing up the reserve wins`, bring.theirs === 0 && bring.mine > 0, `${bring.mine} v ${bring.theirs}`)
  }
  const woods = play('army-hard-fall-back-to-the-woods', 'bring-up')
  check('Fall Back to the Woods: bringing up the reserve still loses', woods.mine === 0 && woods.theirs > 0, `${woods.mine} v ${woods.theirs}`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
