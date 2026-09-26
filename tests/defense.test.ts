// Verification of planetary defense installations (both economy modes):
// placement, fortress defense & key-node rule, capture by holding the ground,
// destruction by ground fire, shields blocking landings, batteries denying the
// orbit and firing on ships.
// Run:  npx tsx tests/defense.test.ts

import { GROUND_STEPS_PER_DAY, UNIT_TYPES, type UnitType } from '../src/data/groundData'
import { DEFENSE_DEFS, FORTRESS_DEFENSE } from '../src/data/defenseData'
import { seedBodyOwners } from '../src/scene/territory'
import { atWar, useDiplomacyStore } from '../src/state/diplomacyStore'
import { hasOrbitalSuperiority, type Army } from '../src/scene/armyLogic'
import { groundSurface, type NodeHolderMap } from '../src/scene/groundLogic'
import { stepGroundWar, type GroundWorld } from '../src/scene/groundResolution'
import { arc, nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'
import {
  applyHullDamage,
  batteryFire,
  fortressDefense,
  holderOfInstallation,
  hostileBatteries,
  placeInstallation,
  shieldBlocksLanding,
  withFortressKeys,
  type Installation,
} from '../src/scene/defenseLogic'
import { useDefenseStore, canBuildDefense } from '../src/state/defenseStore'
import { useResourceStore } from '../src/state/resourceStore'
import { seedStartingDefenses } from '../src/scene/gameSetup'
import { COUNTRIES } from '../src/data/countryData'

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
const owners = seedBodyOwners()
const venus = groundSurface('Venus', owners)!
const mesh = surfaceMesh()
useDiplomacyStore.getState().reset()
useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)

const inst = (kind: Installation['kind'], node: number, over: Partial<Installation> = {}): Installation => ({
  id: `t-${kind}-${node}`, bodyName: 'Venus', kind, node, integrity: DEFENSE_DEFS[kind].integrity, builtBy: VENUS, readySimDays: 0, ...over,
})
let n = 0
function lone(ownerId: string, type: UnitType, node: number): Army {
  const max = UNIT_TYPES[type].maxStrength
  return { id: `a${++n}`, ownerId, kind: 'assault', units: [{ id: `u${n}`, type, strength: max, maxStrength: max, position: nodePoint(node), path: [], nodeHint: node, stillSinceStep: 0 }], location: { kind: 'body', bodyName: 'Venus' } }
}
const worldOf = (armies: Army[], installations: Installation[], holders: NodeHolderMap = {}): GroundWorld => ({
  armies, owners, controllers: {}, nodeHolders: holders, atWar, isAutonomous: () => false, surfaceOf: (b) => groundSurface(b, owners), installations,
})

console.log('=== 1. Placement ===')
const fortNode = placeInstallation(venus, [], 'fortress')!
{
  check('a fortress is placed on mainland ground', fortNode !== null && venus.landComponent[fortNode] === venus.mainland)
  const cap = venus.keySlots.find((k) => k.kind === 'capital')!
  check('...next to the capital', arc(nodePoint(fortNode), nodePoint(cap.node)) < 4 * surfaceMesh().fineSpacingRad)
  const second = placeInstallation(venus, [inst('fortress', fortNode)], 'fortress')!
  check('two installations keep their distance', second !== fortNode && arc(nodePoint(second), nodePoint(fortNode)) >= 0.6 * surfaceMesh().fineSpacingRad - 1e-9)
}

console.log('\n=== 2. Fortress: defense bonus and a key point ===')
{
  const fort = inst('fortress', fortNode)
  const near = nodePoint(fortNode)
  check('the holder’s units by a fortress fight harder', fortressDefense('Venus', near, VENUS, [fort], owners, {}, 0) === FORTRESS_DEFENSE)
  check('...the enemy’s do not', fortressDefense('Venus', near, MARS, [fort], owners, {}, 0) === 1)
  check('a fortress under construction does nothing yet', fortressDefense('Venus', near, VENUS, [{ ...fort, readySimDays: 100 }], owners, {}, 0) === 1)
  const keyed = withFortressKeys(venus, [fort], 0)
  check('an active fortress is an extra key node', keyed.keySlots.length === venus.keySlots.length + 1 && keyed.keySlots.some((k) => k.kind === 'fortress' && k.node === fortNode))
}

console.log('\n=== 3. Capture: whoever holds the node holds the installation ===')
{
  const bat = inst('defenseBattery', fortNode)
  check('built and held by Venus, it serves Venus', holderOfInstallation(bat, owners, {}) === VENUS)
  const taken: NodeHolderMap = { Venus: { [fortNode]: MARS } }
  check('once Mars holds its ground, it serves Mars', holderOfInstallation(bat, owners, taken) === MARS)
  check('...so it no longer denies Mars the orbit', hostileBatteries('Venus', MARS, [bat], owners, taken, atWar, 0).length === 0)
}

console.log('\n=== 4. Destroyed by ground fire ===')
{
  const bat = inst('defenseBattery', fortNode)
  // A Mars unit parked right next to the battery with nothing else to shoot at.
  const neighbour = mesh.neighbors.fine[fortNode][0]
  const w = worldOf([lone(MARS, 'infantry', neighbour)], [bat])
  let res = stepGroundWar(w, 0, 1)
  check('an enemy unit in range damages it', (res.installations?.[0]?.integrity ?? bat.integrity) < bat.integrity, `${bat.integrity} → ${res.installations?.[0]?.integrity.toFixed(2)}`)
  const days = 400
  res = stepGroundWar(w, 0, days)
  check('given time it is destroyed and reported', (res.installations?.length ?? 1) === 0 && (res.destroyedInstallations?.length ?? 0) === 1)
  const own = stepGroundWar(worldOf([lone(VENUS, 'infantry', neighbour)], [bat]), 0, 5)
  check('its own side does not shoot it', own.installations?.[0]?.integrity === bat.integrity)
  const none = stepGroundWar({ ...w, installations: undefined }, 0, 2)
  check('without installations the result carries none (old callers unchanged)', none.installations === undefined)
}

console.log('\n=== 5. Shield blocks landings ===')
{
  const shield = inst('shieldGenerator', fortNode)
  check('no enemy landing under the shield', shieldBlocksLanding('Venus', fortNode, MARS, [shield], owners, {}, atWar, 0))
  const far = venus.keySlots.map((k) => k.node).sort((a, b) => arc(nodePoint(b), nodePoint(fortNode)) - arc(nodePoint(a), nodePoint(fortNode)))[0]
  check('...but outside its radius is open', !shieldBlocksLanding('Venus', far, MARS, [shield], owners, {}, atWar, 0))
  check('the owner may land under its own shield', !shieldBlocksLanding('Venus', fortNode, VENUS, [shield], owners, {}, atWar, 0))
}

console.log('\n=== 6. Battery: denies the orbit, fires on ships ===')
{
  const bat = inst('defenseBattery', fortNode)
  const ship = { id: 's1', ownerId: MARS, classId: 'corvette', location: { kind: 'orbiting', bodyName: 'Venus' } } as never
  const denial = (c: string, b: string) => hostileBatteries(b, c, [bat], owners, {}, atWar, 0).length > 0
  check('an enemy battery denies orbital superiority', !hasOrbitalSuperiority(MARS, 'Venus', [ship], atWar, denial))
  check('...not to its owner', hasOrbitalSuperiority(VENUS, 'Venus', [], atWar, denial))
  const combat = { componentHp: { core: 10, weapons: 5, utility: 5 } as never, shieldHp: 20, armorHp: 20, ftlCharge: null, chaffRemaining: 2, chaffActiveUntilSimDays: null }
  const orb = [
    { id: 'hostile', ownerId: MARS, bodyName: 'Venus', armed: true, combat },
    { id: 'unarmed', ownerId: MARS, bodyName: 'Venus', armed: false, combat },
    { id: 'own', ownerId: VENUS, bodyName: 'Venus', armed: true, combat },
    { id: 'elsewhere', ownerId: MARS, bodyName: 'Mars', armed: true, combat },
  ]
  const fire = batteryFire(1, [bat], orb, owners, {}, atWar, 0)
  check('it hits hostile armed ships in its orbit only', Object.keys(fire.damaged).join(',') === 'hostile')
  check('a day of fire (30) empties the 20-point shield, then 10 goes to armor', fire.damaged.hostile.shieldHp === 0 && fire.damaged.hostile.armorHp === 10)
  const long = batteryFire(10, [bat], orb, owners, {}, atWar, 0)
  check('enough fire destroys a ship', long.destroyedIds.includes('hostile'))
  const h = applyHullDamage(combat, 45)
  check('damage runs shield → armor → core', h.combat.shieldHp === 0 && h.combat.armorHp === 0 && (h.combat.componentHp as { core: number }).core === 5 && !h.destroyed)
}

console.log('\n=== 7. Building and starting defenses ===')
{
  useDefenseStore.setState({ installations: [] })
  useResourceStore.getState().setAmount(VENUS, 'alloys', 1000)
  useResourceStore.getState().setAmount(VENUS, 'energy', 1000)
  const ok = useDefenseStore.getState().build(VENUS, 'Venus', 'fortress', 100)
  const built = useDefenseStore.getState().installations
  check('building places it and charges the stockpile', ok.ok && built.length === 1 && useResourceStore.getState().stateFor(VENUS).amounts.alloys === 1000 - DEFENSE_DEFS.fortress.cost.alloys!)
  check('it is under construction until its deadline', built[0].readySimDays === 100 + DEFENSE_DEFS.fortress.buildDays)
  check("can't build on someone else's world", !canBuildDefense(MARS, 'Venus', 'fortress', built).ok)
  check('per-world limits hold', !canBuildDefense(VENUS, 'Venus', 'shieldGenerator', [...built, inst('shieldGenerator', 1)]).ok)
  useDefenseStore.setState({ installations: [] })
  seedStartingDefenses(0)
  const start = useDefenseStore.getState().installations
  check('every capital starts with a fortress and a battery', COUNTRIES.every((c) => start.some((i) => i.bodyName === c.capitalBodyName && i.kind === 'fortress') && start.some((i) => i.bodyName === c.capitalBodyName && i.kind === 'defenseBattery')))
  seedStartingDefenses(0)
  check('seeding again does not double them', useDefenseStore.getState().installations.length === start.length)
}

void GROUND_STEPS_PER_DAY
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
