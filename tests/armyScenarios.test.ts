// Proves the difficulty label on every ground-battle scenario in
// src/data/armyScenarios.ts against the REAL ground resolver
// (`stepGroundWar`), not author judgment — see that file's own header for what
// each tier means. The ground war has no randomness, so each configuration is
// run once; what the suite guards is that a balance change to unit stats,
// terrain or the ground AI can't silently make a scenario easier, harder, or
// unwinnable.
//
// The "player" here is a scripted pilot issuing the same orders the UI does
// (a unit's path with orderedMove, exactly what armyStore.orderUnits writes):
//   hold      no orders — units hold, dig in, and fire on what's in range
//   bring up  order the reserve up to the front army's position, once, at the
//             start (the one order the medium scenarios are about)
//   link up   once a day: while the front army and the reserve are apart, the
//             front army falls back onto the reserve; once they're together,
//             every unit advances on the nearest enemy and halts to fire
//             whenever one is in range (the plan the hard scenarios need)
//
// Run:  npx tsx tests/armyScenarios.test.ts
//
// Outside `src/` like every test, so it never enters the app typecheck or the
// production bundle.

import { UNIT_TYPES } from '../src/data/groundData'
import { ARMY_SCENARIOS, type ArmyScenario } from '../src/data/armyScenarios'
import { PIRATES_ID, SANDBOX_PLAYER_ID } from '../src/data/countryRoster'
import { armyStrength, type Army } from '../src/scene/armyLogic'
import { buildArmyScenario, type ArmyScenarioOwners } from '../src/scene/armyScenario'
import { findPath, groundSurface, landedUnits, unitRangeRad } from '../src/scene/groundLogic'
import { stepGroundWar } from '../src/scene/groundResolution'
import { arc, nearestNode } from '../src/scene/surfaceMesh'
import { atWar } from '../src/state/diplomacyStore'
import { usePlayerStore } from '../src/state/playerStore'
import { setUpTestNations, TEST_ENEMY, TEST_PLAYER } from './testNations'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// The sandbox's two owners: the player's own faction against the pirates, who
// are at war with everyone (no diplomacy state needed).
usePlayerStore.getState().startSandbox()
const SANDBOX: ArmyScenarioOwners = { player: SANDBOX_PLAYER_ID, enemy: PIRATES_ID }

type Plan = 'hold' | 'bring-up' | 'link-up'

interface Outcome {
  winner: 'player' | 'enemy' | 'draw' | 'stalemate'
  days: number
  // Strength left standing on each side, and what the player started with.
  playerLeft: number
  enemyLeft: number
  playerMax: number
  // Strength of the player's reserve armies at the end, and how many of the
  // front (line) armies survive — the "left alone" claims in the descriptions.
  reserveLeft: number
  reserveMax: number
  frontArmiesLeft: number
}

const MAX_DAYS = 1200
// Front army and reserve count as linked up when this close (radians) — about
// one and a half map cells.
const LINKED_UP_RAD = 0.12

const sum = (armies: Army[]) => armies.reduce((s, a) => s + armyStrength(a).strength, 0)

function simulate(scenario: ArmyScenario, plan: Plan, owners: ArmyScenarioOwners = SANDBOX, isAutonomous?: (id: string) => boolean): Outcome | null {
  const built = buildArmyScenario(scenario, owners)
  if (!built) return null
  const body = built.bodyName
  const surfaceOf = (b: string) => groundSurface(b, {})
  const surface = surfaceOf(body)!
  // Which of the player's armies are the reserve — the scenario's rear forces.
  const reserveIds = new Set<string>()
  scenario.player.forEach((force, i) => {
    if (force.rearCells) reserveIds.add(`${scenario.id}-player${i}`)
  })
  let armies: Army[] = built.armies
  const playerMax = built.armies.filter((a) => a.ownerId === owners.player).reduce((s, a) => s + armyStrength(a).max, 0)
  const reserveMax = built.armies.filter((a) => reserveIds.has(a.id)).reduce((s, a) => s + armyStrength(a).max, 0)
  const mine = (list: Army[]) => list.filter((a) => a.ownerId === owners.player)
  const theirs = (list: Army[]) => list.filter((a) => a.ownerId === owners.enemy)
  const auto = isAutonomous ?? ((id: string) => id !== owners.player)

  const order = (unit: (typeof armies)[number]['units'][number], toNode: number) => {
    const path = unit.position ? findPath(surface, unit.position, toNode, unit.type) : null
    if (path) {
      unit.path = path
      unit.orderedMove = true
    }
  }

  const act = (day: number) => {
    if (plan === 'hold') return
    const units = landedUnits(armies, body)
    const player = units.filter((u) => u.army.ownerId === owners.player)
    const enemy = units.filter((u) => u.army.ownerId === owners.enemy)
    const front = player.filter((u) => !reserveIds.has(u.army.id))
    const reserve = player.filter((u) => reserveIds.has(u.army.id))
    if (plan === 'bring-up') {
      if (day !== 0 || front.length === 0) return
      const goal = nearestNode(front[0].unit.position!, 'fine')
      for (const r of reserve) if (!UNIT_TYPES[r.unit.type].holdsPosition) order(r.unit, goal)
      return
    }
    // link-up
    if (enemy.length === 0) return
    const apart = front.length > 0 && reserve.length > 0 && arc(front[0].unit.position!, reserve[0].unit.position!) >= LINKED_UP_RAD
    if (apart) {
      const goal = nearestNode(reserve[0].unit.position!, 'fine')
      for (const f of front) if (!UNIT_TYPES[f.unit.type].holdsPosition) order(f.unit, goal)
      return
    }
    for (const p of player) {
      if (UNIT_TYPES[p.unit.type].holdsPosition) continue
      const range = unitRangeRad(p.unit.type)
      if (enemy.some((e) => arc(e.unit.position!, p.unit.position!) <= range)) {
        p.unit.path = []
        p.unit.orderedMove = false
        continue
      }
      const nearest = [...enemy].sort((a, b) => arc(a.unit.position!, p.unit.position!) - arc(b.unit.position!, p.unit.position!))[0]
      order(p.unit, nearestNode(nearest.unit.position!, 'fine'))
    }
  }

  let step = 0
  for (let day = 0; day < MAX_DAYS; day++) {
    // Orders go onto copies — stepGroundWar never mutates its input.
    armies = armies.map((a) => ({ ...a, units: a.units.map((u) => ({ ...u })) }))
    act(day)
    const result = stepGroundWar(
      { armies, owners: {}, controllers: {}, nodeHolders: {}, atWar, isAutonomous: auto, surfaceOf },
      step,
      day + 1,
    )
    armies = result.armies
    step = result.resolvedThroughStep
    const p = mine(armies)
    const e = theirs(armies)
    if (p.length === 0 || e.length === 0) {
      const winner = p.length === 0 && e.length === 0 ? 'draw' : e.length === 0 ? 'player' : 'enemy'
      return outcome(winner, day + 1)
    }
  }
  return outcome('stalemate', MAX_DAYS)

  function outcome(winner: Outcome['winner'], days: number): Outcome {
    return {
      winner,
      days,
      playerLeft: sum(mine(armies)),
      enemyLeft: sum(theirs(armies)),
      playerMax,
      reserveLeft: sum(armies.filter((a) => reserveIds.has(a.id))),
      reserveMax,
      frontArmiesLeft: mine(armies).filter((a) => !reserveIds.has(a.id)).length,
    }
  }
}

const fmt = (o: Outcome) => `${o.winner} after ${o.days}d (yours ${o.playerLeft.toFixed(0)}/${o.playerMax}, theirs ${o.enemyLeft.toFixed(0)})`

// Minimum share of the player's starting strength a scenario's winning plan
// must keep, so a win is a real win and not a coin-flip a tiny balance change
// could flip.
const MIN_WIN_MARGIN = 0.08

console.log('\n=== 1. The scenarios are well-formed ===')
{
  const ids = ARMY_SCENARIOS.map((s) => s.id)
  check('scenario ids are unique', new Set(ids).size === ids.length)
  check('there are scenarios at every tier', (['easy', 'medium', 'hard'] as const).every((t) => ARMY_SCENARIOS.some((s) => s.difficulty === t)))
  for (const sc of ARMY_SCENARIOS) {
    check(`${sc.id}: has both forces`, sc.player.length > 0 && sc.enemy.length > 0)
    const built = buildArmyScenario(sc, SANDBOX)
    check(`${sc.id}: finds a battlefield on ${sc.battlefield.bodyName}`, !!built)
    if (!built) continue
    const line = built.armies.filter((a) => a.ownerId === SANDBOX.player).length
    check(`${sc.id}: raises every army`, line === sc.player.length && built.armies.length === sc.player.length + sc.enemy.length)
    check(
      `${sc.id}: every unit is on the map`,
      built.armies.every((a) => a.units.every((u) => !!u.position)),
    )
    check(
      `${sc.id}: only the enemy is marching, and only the units that can`,
      built.armies.every((a) => a.units.every((u) => (u.path?.length ?? 0) === 0 || (a.ownerId === SANDBOX.enemy && !UNIT_TYPES[u.type].holdsPosition))),
    )
    // Reserves start behind the line, out of range of everything.
    const back = sc.player.map((f, i) => (f.rearCells ? built.armies.find((a) => a.id === `${sc.id}-player${i}`)! : null)).filter((a): a is Army => !!a)
    const lineArmy = built.armies.find((a) => a.id === `${sc.id}-player0`)!
    check(
      `${sc.id}: reserves start well back from the line`,
      back.every((r) => arc(r.units[0].position!, lineArmy.units[0].position!) > 0.25),
    )
  }
}

console.log('\n=== 2. Determinism ===')
{
  const sc = ARMY_SCENARIOS.find((s) => s.difficulty === 'medium')!
  const a = buildArmyScenario(sc, SANDBOX)!
  const b = buildArmyScenario(sc, SANDBOX)!
  check('building a scenario twice gives identical armies', JSON.stringify(a.armies) === JSON.stringify(b.armies))
  const r1 = simulate(sc, 'bring-up')!
  const r2 = simulate(sc, 'bring-up')!
  check('running it twice gives an identical result', JSON.stringify(r1) === JSON.stringify(r2), fmt(r1))
  // The same battle between two nations at war comes out the same.
  setUpTestNations()
  const nations: ArmyScenarioOwners = { player: TEST_PLAYER, enemy: TEST_ENEMY }
  const rn = simulate(sc, 'bring-up', nations)!
  check('...and the same between two nations at war as between sandbox factions', JSON.stringify({ ...rn }) === JSON.stringify({ ...r1 }), fmt(rn))
  usePlayerStore.getState().startSandbox()
}

console.log('\n=== 3. Easy: leaving your army alone wins ===')
for (const sc of ARMY_SCENARIOS.filter((s) => s.difficulty === 'easy')) {
  const hold = simulate(sc, 'hold')!
  check(`${sc.name}: hold wins`, hold.winner === 'player', fmt(hold))
  check(`${sc.name}: ...with room to spare`, hold.playerLeft / hold.playerMax >= 0.3, `${((hold.playerLeft / hold.playerMax) * 100).toFixed(0)}% of strength left`)
}

console.log('\n=== 4. Medium: hold loses, bringing up the reserve wins ===')
for (const sc of ARMY_SCENARIOS.filter((s) => s.difficulty === 'medium')) {
  const hold = simulate(sc, 'hold')!
  check(`${sc.name}: hold does not win`, hold.winner !== 'player', fmt(hold))
  check(`${sc.name}: ...the front army is destroyed`, hold.frontArmiesLeft === 0)
  check(`${sc.name}: ...and the reserve never fights`, Math.abs(hold.reserveLeft - hold.reserveMax) < 1e-9, `${hold.reserveLeft.toFixed(0)}/${hold.reserveMax}`)
  const bring = simulate(sc, 'bring-up')!
  check(`${sc.name}: bringing up the reserve wins`, bring.winner === 'player', fmt(bring))
  check(`${sc.name}: ...by a real margin`, bring.playerLeft / bring.playerMax >= MIN_WIN_MARGIN, `${((bring.playerLeft / bring.playerMax) * 100).toFixed(0)}% of strength left`)
}

console.log('\n=== 5. Hard: hold loses, bringing up the reserve loses, falling back and linking up wins ===')
for (const sc of ARMY_SCENARIOS.filter((s) => s.difficulty === 'hard')) {
  const hold = simulate(sc, 'hold')!
  check(`${sc.name}: hold does not win`, hold.winner !== 'player', fmt(hold))
  check(`${sc.name}: ...the front army is destroyed`, hold.frontArmiesLeft === 0)
  const bring = simulate(sc, 'bring-up')!
  check(`${sc.name}: bringing up the reserve does not win`, bring.winner !== 'player', fmt(bring))
  const link = simulate(sc, 'link-up')!
  check(`${sc.name}: falling back, linking up and counter-attacking wins`, link.winner === 'player', fmt(link))
  check(`${sc.name}: ...by a real margin`, link.playerLeft / link.playerMax >= MIN_WIN_MARGIN, `${((link.playerLeft / link.playerMax) * 100).toFixed(0)}% of strength left`)
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
