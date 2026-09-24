// The spatial ground war (src/scene/groundResolution.ts, groundLogic.ts,
// groundAI.ts): movement over terrain, range-gated fighting, taking ground,
// the key-node rule, determinism, and the ground AI.
//
// Run:  npx tsx tests/ground.test.ts

import { CONTACT_RANGE_KM_REF, GROUND_REFERENCE_RADIUS_KM, GROUND_SPEED_FACTOR_MAX, GROUND_STEPS_PER_DAY, UNIT_TYPES, type UnitType } from '../src/data/groundData'
import type { ArmyKind } from '../src/data/armyData'
import { seedBodyOwners } from '../src/scene/territory'
import { atWar, useDiplomacyStore } from '../src/state/diplomacyStore'
import { makeUnits, type Army } from '../src/scene/armyLogic'
import { defaultDropNode, findPath, groundSurface, musterNode, placeUnits, unitSpeedRadPerDay, type NodeHolderMap } from '../src/scene/groundLogic'
import { stepGroundWar, type GroundWorld } from '../src/scene/groundResolution'
import { terrainAt, passableFor } from '../src/scene/planetTerrain'
import { arc, nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'
import { useArmyStore } from '../src/state/armyStore'
import { wouldTakeBody } from '../src/ai/marshal'
import { captureSnapshot } from '../src/ai/snapshot'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'
const ORION = 'orion-republic'
const PLAYER = 'test-player-not-in-these-fights'
const owners = seedBodyOwners()
const DT = 1 / GROUND_STEPS_PER_DAY
const mesh = surfaceMesh()

function war(...pairs: [string, string][]) {
  useDiplomacyStore.getState().reset()
  for (const [a, b] of pairs) useDiplomacyStore.getState().forceWar(a, b, 0)
}

let armyN = 0
function army(ownerId: string, kind: ArmyKind, body: string, node: number, strengthFraction = 1): Army {
  const surface = groundSurface(body, owners)!
  return { id: `a${++armyN}`, ownerId, kind, units: placeUnits(surface, makeUnits(kind, strengthFraction), node), location: { kind: 'body', bodyName: body } }
}
// A one-unit "army" of the given type, exactly at `node`.
function lone(ownerId: string, type: UnitType, body: string, node: number): Army {
  const max = UNIT_TYPES[type].maxStrength
  return {
    id: `a${++armyN}`,
    ownerId,
    kind: 'assault',
    units: [{ id: `u${armyN}`, type, strength: max, maxStrength: max, position: nodePoint(node), path: [], nodeHint: node, stillSinceStep: 0 }],
    location: { kind: 'body', bodyName: body },
  }
}

function world(armies: Army[], controllers: Record<string, string> = {}, nodeHolders: NodeHolderMap = {}, autonomous = true): GroundWorld {
  return {
    armies,
    owners,
    controllers,
    nodeHolders,
    atWar,
    isAutonomous: (id) => autonomous && id !== PLAYER,
    surfaceOf: (b) => groundSurface(b, owners),
  }
}

// Runs the war for `days`, applying paints and occupations between calls the
// way the resolver does. `chunks` splits the span into uneven pieces.
function run(w: GroundWorld, days: number, chunks: number[] = [days]) {
  let armies = w.armies
  const controllers = { ...w.controllers }
  const holders: NodeHolderMap = JSON.parse(JSON.stringify(w.nodeHolders))
  const occupations: { bodyName: string; countryId: string; simDays: number }[] = []
  const losses: string[] = []
  let step = 0
  let now = 0
  for (const c of chunks) {
    now = Math.min(days, now + c)
    const r = stepGroundWar({ ...w, armies, controllers: { ...controllers }, nodeHolders: holders }, step, now)
    armies = r.armies
    step = r.resolvedThroughStep
    for (const [body, changes] of Object.entries(r.paints)) {
      holders[body] = { ...(holders[body] ?? {}) }
      for (const [node, h] of Object.entries(changes)) {
        if (h === null) delete holders[body][Number(node)]
        else holders[body][Number(node)] = h
      }
    }
    for (const o of r.occupations) {
      occupations.push(o)
      if (owners[o.bodyName] === o.countryId) delete controllers[o.bodyName]
      else controllers[o.bodyName] = o.countryId
    }
    losses.push(...r.losses.map((l) => l.ownerId))
  }
  return { armies, controllers, holders, occupations, losses, step }
}

const units = (armies: Army[]) => armies.flatMap((a) => a.units)

console.log('\n=== 1. Moving over terrain ===')
{
  const mars = groundSurface('Mars', owners)!
  // Two neighbouring nodes of the same walkable terrain.
  let a = -1
  let b = -1
  for (let i = 0; i < mesh.count.fine && a < 0; i++) {
    const t = terrainAt(mars, i)
    if (!passableFor(t, 'infantry') || t === 'urban') continue
    const j = [...mesh.neighbors.fine[i]].find((n) => terrainAt(mars, n) === t)
    if (j !== undefined) {
      a = i
      b = j
    }
  }
  war()
  const walker = lone(MARS, 'infantry', 'Mars', a)
  walker.units[0].path = [nodePoint(b)]
  walker.units[0].orderedMove = true
  const r = stepGroundWar(world([walker], {}, {}, false), 0, DT)
  const moved = arc(nodePoint(a), r.armies[0].units[0].position!)
  const expected = unitSpeedRadPerDay('infantry', mars.radiusKm, terrainAt(mars, a)) * DT
  check('a unit covers exactly speed × terrain factor per step', Math.abs(moved - expected) < 1e-12, `${moved.toExponential(3)} vs ${expected.toExponential(3)}`)
  const armour = unitSpeedRadPerDay('armour', mars.radiusKm, 'plains')
  const infantry = unitSpeedRadPerDay('infantry', mars.radiusKm, 'plains')
  check('armour is twice as fast as infantry in the open', Math.abs(armour / infantry - 2) < 1e-9)
  check('...and slowed in forest', unitSpeedRadPerDay('armour', mars.radiusKm, 'forest') < armour / 2)
  const phobos = groundSurface('Phobos', owners)!
  check('small moons fall faster (size factor)', unitSpeedRadPerDay('infantry', phobos.radiusKm, 'rock') > unitSpeedRadPerDay('infantry', mars.radiusKm, 'rock'))
  const maxStep = 2 * (UNIT_TYPES.armour.speedKmPerDayRef / GROUND_REFERENCE_RADIUS_KM) * GROUND_SPEED_FACTOR_MAX * DT
  check('no two units can pass through each other between steps', maxStep < CONTACT_RANGE_KM_REF / GROUND_REFERENCE_RADIUS_KM, `${maxStep.toFixed(4)} rad per step`)
}

console.log('\n=== 2. Paths across terrain ===')
{
  const venus = groundSurface('Venus', owners)!
  const ocean = [...Array(mesh.count.fine).keys()].find((i) => terrainAt(venus, i) === 'ocean')!
  const land = venus.keySlots[0].node
  check('infantry has no path into the ocean', findPath(venus, nodePoint(land), ocean, 'infantry') === null)
  check('marines do', findPath(venus, nodePoint(land), ocean, 'marines') !== null)
  const far = venus.keySlots[venus.keySlots.length - 1].node
  const path = findPath(venus, nodePoint(land), far, 'infantry')
  check('a path between key nodes exists and ends on the goal', !!path && arc(path[path.length - 1], nodePoint(far)) < 1e-12)
  check('...and never steps onto water', !!path && path.every((p) => passableFor(terrainAt(venus, mesh.count.fine > 0 ? nearest(p) : 0), 'infantry')))
}
function nearest(p: { x: number; y: number; z: number }) {
  let best = 0
  let bestArc = Infinity
  for (let i = 0; i < mesh.count.fine; i++) {
    const a = arc(p, nodePoint(i))
    if (a < bestArc) {
      bestArc = a
      best = i
    }
  }
  return best
}

console.log('\n=== 3. Units fight only when close enough ===')
{
  war([MARS, VENUS])
  const mars = groundSurface('Mars', owners)!
  const start = mars.keySlots[0].node
  // Walk the neighbour graph to find a node well outside infantry range, and
  // one inside it.
  const range = CONTACT_RANGE_KM_REF / GROUND_REFERENCE_RADIUS_KM
  const walkable = [...Array(mesh.count.fine).keys()].filter((i) => passableFor(terrainAt(mars, i), 'infantry'))
  const farNode = walkable.find((i) => arc(nodePoint(i), nodePoint(start)) > range * 3)!
  const nearNode = walkable.find((i) => i !== start && arc(nodePoint(i), nodePoint(start)) < range * 0.95)!
  check('neighbouring nodes are within line contact range', nearNode !== undefined)
  const far = stepGroundWar(world([lone(MARS, 'infantry', 'Mars', start), lone(VENUS, 'infantry', 'Mars', farNode)], {}, {}, false), 0, 1)
  check('out of range: no damage at all', units(far.armies).every((u) => u.strength === u.maxStrength))
  const near = stepGroundWar(world([lone(MARS, 'infantry', 'Mars', start), lone(VENUS, 'infantry', 'Mars', nearNode)], {}, {}, false), 0, 1)
  check('in range: both take damage', units(near.armies).every((u) => u.strength < u.maxStrength))
  const art = stepGroundWar(world([lone(MARS, 'artillery', 'Mars', start), lone(VENUS, 'infantry', 'Mars', walkable.find((i) => {
    const d = arc(nodePoint(i), nodePoint(start))
    return d > range * 1.1 && d < UNIT_TYPES.artillery.rangeKmRef / GROUND_REFERENCE_RADIUS_KM
  })!)], {}, {}, false), 0, 1)
  const [artU, infU] = [art.armies[0].units[0], art.armies[1].units[0]]
  check('artillery outranges the line: it hits, and takes nothing back', infU.strength < infU.maxStrength && artU.strength === artU.maxStrength)
  war()
  const peace = stepGroundWar(world([lone(MARS, 'infantry', 'Mars', start), lone(VENUS, 'infantry', 'Mars', nearNode)], {}, {}, false), 0, 1)
  check('nations at peace share ground without fighting', units(peace.armies).every((u) => u.strength === u.maxStrength))
}

console.log('\n=== 4. Terrain and key nodes defend ===')
{
  war([MARS, VENUS])
  const mars = groundSurface('Mars', owners)!
  const walk = (t: string) => [...Array(mesh.count.fine).keys()].filter((i) => terrainAt(mars, i) === t)
  const neighbourOf = (i: number, t: (n: number) => boolean) => [...mesh.neighbors.fine[i]].find(t)
  const hitOn = (terrain: string) => {
    for (const node of walk(terrain)) {
      const attackerNode = neighbourOf(node, (n) => terrainAt(mars, n) !== 'ocean' && passableFor(terrainAt(mars, n), 'artillery'))
      if (attackerNode === undefined) continue
      // Artillery vs a lone armour (can't shoot back at this range? it can —
      // compare damage taken by the defender only).
      const r = stepGroundWar(world([lone(MARS, 'artillery', 'Mars', attackerNode), lone(VENUS, 'infantry', 'Mars', node)], {}, {}, false), 0, DT)
      const v = r.armies[1].units[0]
      return v.maxStrength - v.strength
    }
    return NaN
  }
  const open = hitOn('rock') || hitOn('desert') || hitOn('plains')
  const mountains = hitOn('mountains')
  check('a unit in the mountains takes less damage than one in the open', mountains < open, `${mountains.toFixed(4)} vs ${open.toFixed(4)}`)
}

console.log('\n=== 5. Taking ground, and the key-node rule ===')
{
  war([MARS, VENUS])
  const phobos = groundSurface('Phobos', owners)!
  const key = phobos.keySlots[0].node
  const lonely = run(world([army(VENUS, 'assault', 'Phobos', key)]), 2)
  check('an undefended outpost falls to the first army on its key node', lonely.occupations.length === 1 && lonely.occupations[0].countryId === VENUS)
  check('...and the ground under the invaders changes hands', Object.values(lonely.holders['Phobos'] ?? {}).includes(VENUS))
  check('painting is sparse — only nodes that changed hands are stored', Object.keys(lonely.holders['Phobos'] ?? {}).length < 30)

  const defended = run(world([army(MARS, 'garrison', 'Phobos', key), army(VENUS, 'assault', 'Phobos', key)]), 60)
  check('a garrisoned outpost is fought for — and taken by a full assault army', defended.occupations.some((o) => o.countryId === VENUS), `${defended.occupations.map((o) => o.simDays.toFixed(1)).join(',')}`)
  check('...the garrison dies in the process', defended.losses.includes(MARS))

  // Liberation: Venus holds Phobos; Mars lands on the key.
  const liberated = run(world([army(MARS, 'assault', 'Phobos', key)], { Phobos: VENUS }, { Phobos: { [key]: VENUS } }), 3)
  check('retaking your own world ends the occupation', liberated.occupations.some((o) => o.countryId === MARS) && !('Phobos' in liberated.controllers))

  // Two rival invaders splitting Venus's key nodes flip nothing.
  war([MARS, VENUS], [ORION, VENUS])
  const venus = groundSurface('Venus', owners)!
  const split: NodeHolderMap = { Venus: Object.fromEntries(venus.keySlots.map((k, i) => [k.node, i % 2 === 0 ? MARS : ORION])) }
  const rivals = stepGroundWar(world([lone(MARS, 'infantry', 'Venus', venus.keySlots[0].node)], {}, split, false), 0, 1)
  check('two invaders splitting the key nodes flip nothing', rivals.occupations.length === 0)
}

console.log('\n=== 6. Determinism: same result however the clock is chopped ===')
{
  war([MARS, VENUS])
  const phobos = groundSurface('Phobos', owners)!
  const key = phobos.keySlots[0].node
  // One starting world, copied, so both runs see identical ids.
  const start = world([army(MARS, 'garrison', 'Phobos', key), army(VENUS, 'assault', 'Phobos', musterNode(phobos))])
  const copy = () => ({ ...start, armies: JSON.parse(JSON.stringify(start.armies)) as Army[] })
  const whole = run(copy(), 20)
  const pieces = run(copy(), 20, [0.3, 1.7, 0.05, 4, 2.2, 11.75])
  // Fighting and movement run in fixed steps and match exactly; recovery
  // during quiet stretches is summed per call, so strengths can differ by
  // floating-point rounding only.
  const shape = (r: ReturnType<typeof run>) => JSON.stringify({ a: r.armies.map((a) => a.units.map((u) => ({ id: u.id, p: u.position }))), o: r.occupations, h: r.holders })
  const strengths = (r: ReturnType<typeof run>) => r.armies.flatMap((a) => a.units.map((u) => u.strength))
  check('one call and many uneven calls: identical positions, fights and territory', shape(whole) === shape(pieces))
  check('...and strengths equal to within rounding', strengths(whole).every((v, i) => Math.abs(v - strengths(pieces)[i]) < 1e-9))
}

console.log('\n=== 7. Recruits muster; wounded recover on their own ground ===')
{
  war()
  const venus = groundSurface('Venus', owners)!
  const recruit: Army = { id: 'rec', ownerId: VENUS, kind: 'assault', units: makeUnits('assault'), location: { kind: 'recruiting', bodyName: 'Venus', readySimDays: 5 } }
  const early = stepGroundWar(world([recruit]), 0, 4)
  check('still training before its day', early.armies[0].location.kind === 'recruiting')
  const done = stepGroundWar(world([recruit]), 0, 6)
  const placed = done.armies[0]
  check('on its day it stands around the muster node', placed.location.kind === 'body' && placed.units.every((u) => !!u.position && arc(u.position, nodePoint(musterNode(venus))) <= mesh.fineSpacingRad * 1.2))

  const hurt = army(VENUS, 'assault', 'Venus', musterNode(venus), 0.5)
  const healed = stepGroundWar(world([hurt]), 0, 10)
  check('wounded units at home recover strength', healed.armies[0].units.every((u) => u.strength > u.maxStrength * 0.5))
}

console.log('\n=== 8. The ground AI, and the player\'s units ===')
{
  war([MARS, VENUS])
  const venus = groundSurface('Venus', owners)!
  const drop = defaultDropNode(venus, ['infantry', 'infantry', 'armour', 'artillery'], MARS, [], owners, {}, atWar)!
  check('a landing site can be found on Venus', drop !== null)
  // Land a few cells away from every key node, and watch it advance.
  const cell = mesh.fineSpacingRad
  const away = [...Array(mesh.count.fine).keys()].find((i) =>
    venus.landComponent[i] === venus.mainland && passableFor(terrainAt(venus, i), 'armour') &&
    venus.keySlots.every((k) => arc(nodePoint(i), nodePoint(k.node)) > 4 * cell) &&
    venus.keySlots.some((k) => arc(nodePoint(i), nodePoint(k.node)) < 8 * cell))!
  const ai = stepGroundWar(world([army(MARS, 'assault', 'Venus', away)]), 0, 3)
  const nearestKey = (p: { x: number; y: number; z: number }) => Math.min(...venus.keySlots.map((k) => arc(p, nodePoint(k.node))))
  const before = nearestKey(nodePoint(away))
  const after = Math.min(...units(ai.armies).map((u) => nearestKey(u.position!)))
  check('an AI invasion advances on the enemy key nodes', after < before, `${before.toFixed(3)} → ${after.toFixed(3)} rad`)

  const mine = army(PLAYER, 'assault', 'Venus', drop)
  useDiplomacyStore.getState().forceWar(PLAYER, VENUS, 0)
  const idle = stepGroundWar(world([mine]), 0, 3)
  check("the player's units never move on their own", units(idle.armies).every((u, i) => arc(u.position!, mine.units[i].position!) === 0))

  const garrison = army(VENUS, 'garrison', 'Venus', venus.keySlots[0].node)
  const held = stepGroundWar(world([garrison, army(MARS, 'assault', 'Venus', drop)]), 0, 3)
  const g = held.armies.find((a) => a.id === garrison.id)!
  check('garrison militia never leave their posts', g.units.every((u, i) => arc(u.position!, garrison.units[i].position!) === 0))
}

console.log('\n=== 9. Performance ===')
{
  war([MARS, VENUS])
  const venus = groundSurface('Venus', owners)!
  const keys = venus.keySlots.map((k) => k.node)
  const armies: Army[] = []
  for (let i = 0; i < 5; i++) armies.push(army(VENUS, 'garrison', 'Venus', keys[i % keys.length]))
  const drop = defaultDropNode(venus, ['infantry'], MARS, armies, owners, {}, atWar)!
  for (let i = 0; i < 6; i++) armies.push(army(MARS, 'assault', 'Venus', drop))
  const t0 = performance.now()
  const r = run(world(armies), 200)
  const ms = performance.now() - t0
  check(`${units(armies).length} units over 200 days runs quickly`, ms < 3000, `${ms.toFixed(0)} ms`)
  console.log(`    (outcome: ${r.occupations.map((o) => `${o.countryId} day ${o.simDays.toFixed(1)}`).join(', ') || 'no change of hands'})`)
}

console.log('\n=== 10. The AI\'s invasion estimate agrees with the real fight ===')
{
  // For each case the estimate calls a win, the real (spatial, AI-driven)
  // fight must take the world within 200 days.
  const results: string[] = []
  let disagreements = 0
  for (const [body, garrisons] of [['Phobos', 1], ['Venus', 3]] as const) {
    for (let n = 1; n <= 5; n++) {
      war([MARS, VENUS])
      const surface = groundSurface(body, owners)!
      const keys = surface.keySlots.map((k) => k.node)
      const defenders = Array.from({ length: garrisons }, (_, i) => army(VENUS === owners[body] ? VENUS : MARS, 'garrison', body, keys[i % keys.length]))
      const invader = owners[body] === MARS ? VENUS : MARS
      useArmyStore.setState({ armies: defenders })
      const snap = captureSnapshot(0)
      const cargo = Array.from({ length: n }, () => ({ id: 'x', ownerId: invader, kind: 'assault' as const, units: makeUnits('assault'), location: { kind: 'embarked' as const, shipId: 's' } }))
      const says = wouldTakeBody(invader, body, cargo, snap, atWar)
      const drop = defaultDropNode(surface, ['infantry', 'armour', 'artillery'], invader, defenders, owners, {}, atWar)!
      const landed = cargo.map(() => army(invader, 'assault', body, drop))
      const r = run(world([...defenders, ...landed]), 200)
      const took = r.occupations.some((o) => o.countryId === invader)
      results.push(`${body} ${n}: est ${says ? 'win' : 'lose'}, real ${took ? 'win' : 'lose'}`)
      if (says && !took) disagreements++
    }
  }
  console.log('    ' + results.join('\n    '))
  check('whenever the estimate says "win", the real fight is won', disagreements === 0)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
