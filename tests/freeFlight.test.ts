// Orbital combat and Free Flight (scene/freeFlight.ts, combatArena.orbitPrimary,
// combatResolution.integrateMotion): without Free-Flight Maneuvering, or with a
// ship's own Free Flight switched off, a ship in a fight is in the gravity of every
// body with significant gravity. One rule for every nation, the AI's included.
// Run: npx tsx tests/freeFlight.test.ts
import { AI_RESEARCH_PATH } from '../src/data/aiData'
import { POWERED_GRAVITY_ACCEL_SHARE } from '../src/data/combatData'
import { findTech } from '../src/data/techData'
import {
  SIGNIFICANT_GRAVITY_MS2,
  gravitationalAcceleration,
  hasSignificantGravity,
  orbitPrimary,
  orbitalHoldVelocity,
  pointDistance,
  type CombatObstacle,
} from '../src/scene/combatArena'
import { COMBAT_STEP_DAYS, integrateMotion, obstaclesForLocation, stepEngagements, syncEngagements } from '../src/scene/combatResolution'
import { applyFreeFlight, queueFreeFlight } from '../src/scene/commsVisual'
import { FREE_FLIGHT_TECH_ID, fleetFreeFlight, freeFlightActive, freeFlightBlock, moveOrderBlock, strategyBlock, strategyNeedsFreeFlight, usableStrategy } from '../src/scene/freeFlight'
import { resolveCommsSignals } from '../src/hooks/useCommsResolver'
import { resolveSpaceCombat } from '../src/hooks/useCombatResolver'
import { useCombatStore, type CombatParticipant } from '../src/state/combatStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { pristineCombatState, useShipStore, type ShipInstance, type ShipLocation } from '../src/state/shipStore'
import { DEFAULT_RESEARCHED, useTechStore } from '../src/state/techStore'
import { TEST_ENEMY, TEST_PLAYER, ownerFor, setUpTestNations } from './testNations'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

setUpTestNations()

const orbit = (bodyName: string): ShipLocation => ({ kind: 'orbiting', systemId: 'sol', bodyName, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
function makeShip(classId: string, id: string, role: string, bodyName = 'Earth'): ShipInstance {
  const cls = resolveShipClass(classId)!
  return {
    id,
    classId,
    name: `${cls.name} ${id}`,
    ownerId: ownerFor(role),
    location: orbit(bodyName),
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: false,
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(cls.combat),
    stance: 'balanced',
    fleetId: `solo-${id}`,
  }
}
function participant(position: { x: number; y: number; z: number }, path: { x: number; y: number; z: number }[] = []): CombatParticipant {
  return { shipId: 'p', side: 0, position, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0, path, weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: true, ramming: false }
}
const radiusFrom = (p: CombatParticipant, body: CombatObstacle) => pointDistance(p.position, body.position)
const speedOf = (p: CombatParticipant) => Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z)

console.log('\n=== 1. Which bodies have significant gravity ===')
const earthFight = obstaclesForLocation(orbit('Earth'), 0)
const earth = earthFight.find((o) => o.name === 'Earth')!
const luna = earthFight.find((o) => o.name === 'Luna')!
{
  const at = (body: string) => obstaclesForLocation(orbit(body), 0)[0]
  check('the line is a real surface gravity of 0.5 m/s2', SIGNIFICANT_GRAVITY_MS2 === 0.5)
  check('stars and planets count: Sol, Jupiter, Earth, Mars', ['Sol', 'Jupiter', 'Earth', 'Mars'].every((b) => hasSignificantGravity(at(b))))
  check('so do Luna (1.6 m/s2) and Pluto (0.6 m/s2)', hasSignificantGravity(luna) && hasSignificantGravity(at('Pluto')))
  check('Phobos and Deimos do not', !hasSignificantGravity(at('Phobos')) && !hasSignificantGravity(at('Deimos')))
  check('a body under the line pulls nothing', gravitationalAcceleration({ x: 2, y: 0, z: 0 }, [at('Phobos')]).length() === 0)
  check('...and is not orbited', orbitPrimary({ x: 2, y: 0, z: 0 }, [at('Phobos')]) === null)
  check('deep space has nothing to orbit', orbitPrimary({ x: 2, y: 0, z: 0 }, []) === null)
  const nearEarth = { x: earth.position.x + earth.radiusUnits + 1, y: 0, z: 0 }
  const nearLuna = { x: luna.position.x + luna.radiusUnits + 0.3, y: luna.position.y, z: luna.position.z }
  check('in an Earth fight a ship near Earth orbits Earth', orbitPrimary(nearEarth, earthFight)?.name === 'Earth')
  check('...and a ship close to Luna orbits Luna: the body pulling hardest where it is', orbitPrimary(nearLuna, earthFight)?.name === 'Luna')
}

console.log('\n=== 2. Idle without Free Flight: a circular orbit ===')
{
  const start = participant({ x: earth.radiusUnits + 2, y: 0, z: 0 })
  const r0 = radiusFrom(start, earth)
  const want = orbitalHoldVelocity(start.position, earth).length()
  let p = start
  let swept = 0
  let minR = r0
  let maxR = r0
  // A corvette's numbers, 120 s of fight.
  for (let i = 0; i < 1200; i++) {
    const before = Math.atan2(p.position.z, p.position.x)
    p = integrateMotion(p, 0.418, 0.139, 0.1, i, [earth], false)
    let d = Math.atan2(p.position.z, p.position.x) - before
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    swept += d
    minR = Math.min(minR, radiusFrom(p, earth))
    maxR = Math.max(maxR, radiusFrom(p, earth))
  }
  check('it circles the body', Math.abs(swept) > 1, `${Math.abs(swept).toFixed(2)} rad in 120 s`)
  check('...at the circular-orbit speed for its radius (the orbitalHoldVelocity math)', Math.abs(speedOf(p) - orbitalHoldVelocity(p.position, earth).length()) < 1e-3 && Math.abs(speedOf(p) - want) < 0.01, `${speedOf(p).toFixed(4)} against ${want.toFixed(4)}`)
  check('...keeping its radius', maxR - minR < 0.05 * r0, `${minR.toFixed(3)} to ${maxR.toFixed(3)} from ${r0.toFixed(3)}`)
  check('...and never touching the body', minR > earth.radiusUnits)
  const still = integrateMotion(start, 0.418, 0.139, 0.1, 1, [earth], true)
  check('with Free Flight the same ship stays exactly where it is', pointDistance(still.position, start.position) === 0)
}

console.log('\n=== 3. Under way without Free Flight: gravity bends the path, capped by the engine ===')
{
  // Flying past Earth along +z, the planet off to the -x side.
  const from = { x: earth.radiusUnits + 1.5, y: 0, z: -6 }
  const to = { x: earth.radiusUnits + 1.5, y: 0, z: 6 }
  const fly = (free: boolean, accel = 0.0239, speed = 0.167) => {
    let p = participant(from, [to])
    let minX = from.x
    let steps = 0
    while (p.path.length > 0 && steps < 20000) {
      p = integrateMotion(p, speed, accel, 0.1, steps, [earth], free)
      minX = Math.min(minX, p.position.x)
      steps++
    }
    return { p, minX, steps }
  }
  const free = fly(true)
  const orbital = fly(false)
  check('with Free Flight a cruiser flies the straight line', Math.abs(free.minX - from.x) < 1e-9)
  check('without it the path bends toward the planet', orbital.minX < from.x - 0.01, `pulled ${(from.x - orbital.minX).toFixed(3)} units toward Earth`)
  check('...yet the ship still gets where it was ordered', orbital.p.path.length === 0 && pointDistance(orbital.p.position, to) < 1e-6)
  check('...and never falls into the body', orbital.minX > earth.radiusUnits)

  // The cap: one step from rest right beside the Sun, where the real pull is far over any engine.
  const sol = obstaclesForLocation(orbit('Sol'), 0)[0]
  const beside = { x: sol.radiusUnits + 1, y: 0, z: 0 }
  const real = gravitationalAcceleration(beside, [sol]).length()
  const accel = 0.0129
  const step = integrateMotion(participant(beside, [{ x: sol.radiusUnits + 1, y: 0, z: 50 }]), 0.129, accel, 0.1, 0, [sol], false)
  check('beside the Sun the real pull dwarfs a battleship\'s engine', real > 10 * accel, `${real.toFixed(3)} against ${accel}`)
  check(`...but a powered ship feels at most ${POWERED_GRAVITY_ACCEL_SHARE * 100}% of its own acceleration`, Math.abs(-step.velocity.x - accel * POWERED_GRAVITY_ACCEL_SHARE * 0.1) < 1e-9, `${(-step.velocity.x).toFixed(6)} units/s toward the Sun after one step`)
  // A battleship ordered straight away from the Sun, from just above it, climbs.
  let climb = participant(beside, [{ x: sol.radiusUnits + 4, y: 0, z: 0 }])
  let lowest = beside.x
  for (let i = 0; i < 3000 && climb.path.length > 0; i++) {
    climb = integrateMotion(climb, 0.129, accel, 0.1, i, [sol], false)
    lowest = Math.min(lowest, climb.position.x)
  }
  check('so a working drive is never dragged into a star: it climbs away', climb.path.length === 0 && lowest > sol.radiusUnits + 0.9, `lowest ${(lowest - sol.radiusUnits).toFixed(3)} units above the surface`)
  // A dead drive is another matter: the full pull, as before.
  const dead = integrateMotion(participant(beside), 0, 0, 0.1, 0, [sol], false)
  check('a ship with no thrust still falls at the full pull', Math.abs(-dead.velocity.x - real * 0.1) < 1e-9)
}

console.log('\n=== 4. The gate: the tech, then the ship\'s own toggle ===')
{
  const none = new Set(DEFAULT_RESEARCHED)
  const has = new Set([...DEFAULT_RESEARCHED, FREE_FLIGHT_TECH_ID])
  check('the tech exists and nobody starts with it', !!findTech(FREE_FLIGHT_TECH_ID) && !none.has(FREE_FLIGHT_TECH_ID))
  check('without the tech there is no free flight, whatever the toggle says', !freeFlightActive(none, {}) && !freeFlightActive(none, { freeFlight: true }))
  check('once researched it is ON by default', freeFlightActive(has, {}))
  check('...and off for a ship that switched it off', !freeFlightActive(has, { freeFlight: false }) && freeFlightActive(has, { freeFlight: true }))
  check('a fleet reads on / off / mixed', fleetFreeFlight([{}, { freeFlight: true }]) === 'on' && fleetFreeFlight([{ freeFlight: false }, { freeFlight: false }]) === 'off' && fleetFreeFlight([{}, { freeFlight: false }]) === 'mixed')
  check('the AI\'s research path leads to it, with Hyperdrive Mk II still last', (AI_RESEARCH_PATH as readonly string[]).includes(FREE_FLIGHT_TECH_ID) && AI_RESEARCH_PATH[AI_RESEARCH_PATH.length - 1] === 'hyperdrive-mk2')
}

console.log('\n=== 5. stepEngagements: an AI ship is in the same gravity, by the same gate ===')
{
  const run = (aiFree: boolean) => {
    useCombatStore.setState({ engagements: [], viewedEngagementId: null })
    let ships = [makeShip('cruiser', 'p1', 'player', 'Earth'), makeShip('cruiser', 'ai1', 'hostile', 'Earth')]
    let engagements = syncEngagements(ships, [], 100)
    const ai0 = engagements[0].participants.find((p) => p.shipId === 'ai1')!
    // The AI ship is sent on a pass by the planet; the player's ship holds.
    const waypoint = { x: ai0.position.x, y: ai0.position.y, z: ai0.position.z + (ai0.position.z > 0 ? -8 : 8) }
    engagements = engagements.map((e) => ({ ...e, participants: e.participants.map((p) => (p.shipId === 'ai1' ? { ...p, path: [waypoint], holdPosition: true } : { ...p, path: [], holdPosition: true })) }))
    let cursor = 100
    let closest = Infinity
    for (let i = 0; i < 400; i++) {
      cursor += COMBAT_STEP_DAYS
      // Every ship's gate is its own nation's: only the AI's differs between the two runs.
      const result = stepEngagements(engagements, ships, cursor, () => 0.999, [], (s) => (s.ownerId === TEST_ENEMY ? aiFree : true))
      engagements = result.engagements
      ships = ships.map((s) => (result.shipCombat[s.id] ? { ...s, combat: result.shipCombat[s.id] } : s))
      const ai = engagements[0]?.participants.find((p) => p.shipId === 'ai1')
      if (ai) closest = Math.min(closest, pointDistance(ai.position, engagements[0].obstacles[0].position))
    }
    return { ai: engagements[0].participants.find((p) => p.shipId === 'ai1')!, ships, closest, radius: engagements[0].obstacles[0].radiusUnits }
  }
  const free = run(true)
  const orbital = run(false)
  check('without Free Flight the AI ship is pulled closer to the planet on its pass', orbital.closest < free.closest - 1e-3, `${orbital.closest.toFixed(3)} against ${free.closest.toFixed(3)} units from Earth's centre`)
  check('...and survives it (a working drive is never dragged in)', orbital.closest > orbital.radius && orbital.ships.some((s) => s.id === 'ai1' && s.combat.componentHp.core > 0))
  const idle = (aiFree: boolean) => {
    useCombatStore.setState({ engagements: [], viewedEngagementId: null })
    let ships = [makeShip('cruiser', 'p1', 'player', 'Earth'), makeShip('cruiser', 'ai1', 'hostile', 'Earth')]
    let engagements = syncEngagements(ships, [], 100).map((e) => ({ ...e, participants: e.participants.map((p) => ({ ...p, path: [], holdPosition: true })) }))
    const start = { ...engagements[0].participants.find((p) => p.shipId === 'ai1')!.position }
    let cursor = 100
    for (let i = 0; i < 100; i++) {
      cursor += COMBAT_STEP_DAYS
      const result = stepEngagements(engagements, ships, cursor, () => 0.999, [], (s) => (s.ownerId === TEST_ENEMY ? aiFree : true))
      engagements = result.engagements
      ships = ships.map((s) => (result.shipCombat[s.id] ? { ...s, combat: result.shipCombat[s.id] } : s))
    }
    const ai = engagements[0].participants.find((p) => p.shipId === 'ai1')!
    return { moved: pointDistance(ai.position, start), r0: Math.hypot(start.x, start.y, start.z), r1: Math.hypot(ai.position.x, ai.position.y, ai.position.z) }
  }
  const idleOrbital = idle(false)
  check('an idle AI ship without it circles the planet', idleOrbital.moved > 0.05 && Math.abs(idleOrbital.r1 - idleOrbital.r0) < 0.05 * idleOrbital.r0, `moved ${idleOrbital.moved.toFixed(3)} units at radius ${idleOrbital.r0.toFixed(2)} -> ${idleOrbital.r1.toFixed(2)}`)
  check('...and with it holds still', idle(true).moved < 1e-6)
}

console.log('\n=== 6. The toggle, through the stores (the live resolver reads it for every nation) ===')
{
  const grant = (id: string, withTech: boolean) =>
    useTechStore.setState((s) => ({ byCountry: { ...s.byCountry, [id]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(withTech ? [...DEFAULT_RESEARCHED, FREE_FLIGHT_TECH_ID] : DEFAULT_RESEARCHED) } } }))
  const shipNow = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!
  const part = (id: string) => useCombatStore.getState().engagements.flatMap((e) => e.participants).find((p) => p.shipId === id)!
  const setUp = () => {
    useGameTimeStore.setState({ simDays: 100, paused: false })
    useCombatStore.setState({ engagements: [], viewedEngagementId: null })
    const ships = [makeShip('cruiser', 'p1', 'player', 'Earth'), makeShip('cruiser', 'ai1', 'hostile', 'Earth')]
    useShipStore.setState({ ships })
    const engagements = syncEngagements(ships, [], 100).map((e) => ({ ...e, participants: e.participants.map((p) => ({ ...p, path: [], holdPosition: true })) }))
    useCombatStore.getState().replaceEngagements(engagements)
  }
  const advance = (seconds: number) => {
    const days = useGameTimeStore.getState().simDays + seconds * (COMBAT_STEP_DAYS / 0.1)
    useGameTimeStore.setState({ simDays: days })
    resolveSpaceCombat(days)
  }
  grant(TEST_PLAYER, true)
  grant(TEST_ENEMY, true)
  setUp()
  resolveSpaceCombat(100)
  const p0 = { ...part('p1').position }
  const a0 = { ...part('ai1').position }
  advance(3)
  check('both nations have the tech, toggles untouched: both ships hold still', pointDistance(part('p1').position, p0) < 1e-6 && pointDistance(part('ai1').position, a0) < 1e-6)

  // Off: the ship is told to fly somewhere first, to see the order dropped.
  useCombatStore.getState().setParticipant(useCombatStore.getState().engagements[0].id, { ...part('p1'), holdPosition: false, path: [{ x: 0, y: 5, z: 0 }] })
  applyFreeFlight('p1', false)
  check('switching it off drops what the ship was flying to and holds', shipNow('p1').freeFlight === false && part('p1').path.length === 0 && part('p1').holdPosition)
  const r0 = Math.hypot(part('p1').position.x, part('p1').position.y, part('p1').position.z)
  const before = { ...part('p1').position }
  advance(10)
  const r1 = Math.hypot(part('p1').position.x, part('p1').position.y, part('p1').position.z)
  check('...and it settles into a circular orbit where it is', pointDistance(part('p1').position, before) > 0.05 && Math.abs(r1 - r0) < 0.05 * r0, `moved ${pointDistance(part('p1').position, before).toFixed(3)} units, radius ${r0.toFixed(2)} -> ${r1.toFixed(2)}`)
  check('the other nation\'s ship is unaffected', pointDistance(part('ai1').position, a0) < 1e-6)
  applyFreeFlight('p1', true)
  advance(5)
  const rest = { ...part('p1').position }
  advance(3)
  check('switched back on, it comes to rest and holds', shipNow('p1').freeFlight === true && pointDistance(part('p1').position, rest) < 1e-3)

  // An AI nation without the tech: its ship circles, by the same resolver.
  grant(TEST_ENEMY, false)
  const aBefore = { ...part('ai1').position }
  advance(5)
  check('an AI nation without the tech: its ship circles the planet in the live resolver', pointDistance(part('ai1').position, aBefore) > 0.02)

  // The signal: at once in direct contact, delayed otherwise.
  queueFreeFlight(shipNow('ai1'), false)
  const pending = shipNow('ai1').pendingFreeFlight
  if (pending) {
    check('from outside the arena the change is a signal with comms delay', shipNow('ai1').freeFlight === undefined && pending.arrivesSimDays > useGameTimeStore.getState().simDays)
    resolveCommsSignals(pending.arrivesSimDays)
    check('...applied when it arrives', shipNow('ai1').freeFlight === false && !shipNow('ai1').pendingFreeFlight)
  } else {
    check('with no comms delay to the ship the change is immediate', shipNow('ai1').freeFlight === false)
  }
}

console.log('\n=== 7. Positioning tactics need Free Flight; the rest stays controllable ===')
{
  const none = new Set<string>()
  const has = new Set([FREE_FLIGHT_TECH_ID])
  check('Swarm, Kite, Stall and the coordinated strategies need it; Balanced and Flee do not', ['swarm', 'kite', 'stall', 'divide', 'condense', 'screen'].every(strategyNeedsFreeFlight) && !['balanced', 'flee', 'fleet'].some(strategyNeedsFreeFlight))
  check('without free flight they run as Balanced; with it they are untouched', usableStrategy('kite', false) === 'balanced' && usableStrategy('screen', false) === 'balanced' && usableStrategy('flee', false) === 'flee' && usableStrategy('balanced', false) === 'balanced' && usableStrategy('kite', true) === 'kite')
  check('a greyed button says why: no tech', /Free-Flight Maneuvering/.test(freeFlightBlock(none, {}) ?? '') && /Free-Flight Maneuvering/.test(strategyBlock('swarm', none, {}) ?? ''))
  check('...or the ship\'s own toggle is off', /switched off/.test(freeFlightBlock(has, { freeFlight: false }) ?? ''))
  check('with free flight nothing is blocked', freeFlightBlock(has, {}) === null && strategyBlock('kite', has, {}) === null && moveOrderBlock(has, {}) === null)
  check('Balanced and Flee are never blocked', strategyBlock('balanced', none, {}) === null && strategyBlock('flee', none, {}) === null)
  check('sending a ship to a point is blocked without it', /sent to a point/.test(moveOrderBlock(none, {}) ?? '') && /sent to a point/.test(moveOrderBlock(has, { freeFlight: false }) ?? ''))

  // The live resolver: a Swarm ship without free flight steers exactly like a Balanced one; with it, it swarms.
  const final = (stance: ShipInstance['stance'], free: boolean) => {
    useCombatStore.setState({ engagements: [], viewedEngagementId: null })
    const a = { ...makeShip('cruiser', 'p1', 'player', 'Earth'), stance }
    const b = makeShip('cruiser', 'ai1', 'hostile', 'Earth')
    const ships = [a, b]
    let engagements = syncEngagements(ships, [], 100).map((e) => ({ ...e, participants: e.participants.map((p) => ({ ...p, path: [], holdPosition: false })) }))
    engagements = stepEngagements(engagements, ships, 100 + COMBAT_STEP_DAYS, () => 0.999, [], () => free).engagements
    const p = engagements[0].participants.find((x) => x.shipId === 'p1')!
    return p.path[p.path.length - 1] ?? null
  }
  const swarmFree = final('swarm', true)
  const swarmNo = final('swarm', false)
  const balNo = final('balanced', false)
  const same = (x: { x: number; y: number; z: number } | null, y: { x: number; y: number; z: number } | null) => (x === null && y === null) || (!!x && !!y && pointDistance(x, y) < 1e-9)
  check('without free flight a Swarm ship goes where a Balanced one does', same(swarmNo, balNo))
  check('...and with free flight Swarm is really different from Balanced', !same(swarmFree, balNo))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
