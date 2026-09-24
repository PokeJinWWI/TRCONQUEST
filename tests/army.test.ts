// Armies and transports: formations of units, embarking, the invasion gates
// (war + orbital superiority + a clear, walkable landing site), cargo lost
// with a destroyed transport, recruiting, starting garrisons, and the
// player's unit orders (src/scene/armyLogic.ts, src/state/armyStore.ts,
// src/scene/groundLogic.ts). The fighting itself is tests/ground.test.ts.
//
// Run:  npx tsx tests/army.test.ts

import { SHIP_CLASSES } from '../src/data/shipData'
import { ARMY_KINDS, armyKindMaxStrength } from '../src/data/armyData'
import { UNIT_TYPES } from '../src/data/groundData'
import {
  armyStrength,
  canEmbark,
  hasOrbitalSuperiority,
  landingCheck,
  makeUnits,
  reapLostCargo,
  unitPersonnel,
  type Army,
  type ArmyLocation,
} from '../src/scene/armyLogic'
import { armyInContact, dropCheck, groundSurface, musterNode, placeUnits } from '../src/scene/groundLogic'
import { terrainAt, passableFor } from '../src/scene/planetTerrain'
import { arc, nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'
import { seedBodyOwners } from '../src/scene/territory'
import { atWar, useDiplomacyStore } from '../src/state/diplomacyStore'
import { useArmyStore } from '../src/state/armyStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useShipStore, type ShipInstance } from '../src/state/shipStore'
import { seedStartingArmies } from '../src/scene/gameSetup'
import { seedStrategicResources } from '../src/scene/shipyardLogic'

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
const owners = seedBodyOwners()
const mesh = surfaceMesh()

type ShipLike = Pick<ShipInstance, 'id' | 'ownerId' | 'classId' | 'location'>
function orbiting(id: string, ownerId: string, classId: string, bodyName: string): ShipLike {
  return { id, ownerId, classId, location: { kind: 'orbiting', systemId: 'sol', bodyName, periodDays: 1, phaseDeg: 0, inclinationDeg: 0 } }
}

let armyN = 0
function army(ownerId: string, kind: 'assault' | 'garrison' | 'marine', location: ArmyLocation, node?: number): Army {
  let units = makeUnits(kind)
  if (location.kind === 'body') {
    const surface = groundSurface(location.bodyName, owners)!
    units = placeUnits(surface, units, node ?? musterNode(surface))
  }
  return { id: `a${++armyN}`, ownerId, kind, units, location }
}
const onBody = (bodyName: string) => ({ kind: 'body' as const, bodyName })
const aboard = (shipId: string) => ({ kind: 'embarked' as const, shipId })
const noContact = () => false

function peaceAll() {
  useDiplomacyStore.getState().reset()
}
function war(a: string, b: string) {
  useDiplomacyStore.getState().forceWar(a, b, 0)
}

console.log('\n=== 1. Armies are formations of units ===')
{
  const assault = makeUnits('assault')
  check('an assault army is two infantry, armour and artillery', assault.map((u) => u.type).join() === 'infantry,infantry,armour,artillery')
  check('...totalling the old army strength (100)', armyKindMaxStrength('assault') === 100)
  check('a garrison is two militia (80)', makeUnits('garrison').every((u) => u.type === 'militia') && armyKindMaxStrength('garrison') === 80)
  check('marines are amphibious', ARMY_KINDS.marine.units.some((u) => UNIT_TYPES[u].amphibious))
  const a: Army = { id: 'x', ownerId: MARS, kind: 'assault', units: makeUnits('assault', 0.5), location: aboard('t') }
  check('army strength is the sum of its units', armyStrength(a).strength === 50 && armyStrength(a).max === 100)
  check('each unit stands for many people', unitPersonnel({ ...assault[0] }) === UNIT_TYPES.infantry.personnel && unitPersonnel(a.units[0]) === UNIT_TYPES.infantry.personnel / 2)
}

console.log('\n=== 2. The troop transport hull ===')
{
  const transport = SHIP_CLASSES.find((c) => c.id === 'troop-transport')!
  const corvette = SHIP_CLASSES.find((c) => c.id === 'corvette')!
  check('exists as a transport role', transport?.role === 'transport')
  check('carries armies', (transport.armyCapacity ?? 0) >= 2, `${transport.armyCapacity}`)
  check('is unarmed', transport.combat.weapons.length === 0)
  check('is highly evasive', transport.combat.defenses.evasion >= 0.4)
  check('outpaces even a corvette', transport.combat.maneuverUnitsPerSecond > corvette.combat.maneuverUnitsPerSecond)
  check('no other hull carries armies', SHIP_CLASSES.every((c) => c.id === 'troop-transport' || !c.armyCapacity))
}

console.log('\n=== 3. Embarking ===')
{
  peaceAll()
  const t = orbiting('t1', MARS, 'troop-transport', 'Mars')
  const a1 = army(MARS, 'assault', onBody('Mars'))
  const a2 = army(MARS, 'assault', onBody('Mars'))
  const a3 = army(MARS, 'assault', onBody('Mars'))
  const g = army(MARS, 'garrison', onBody('Mars'))
  const away = army(MARS, 'assault', onBody('Luna'))
  const venusian = army(VENUS, 'assault', onBody('Mars'))
  const armies = [a1, a2, a3, g, away, venusian]
  check('two assault armies board a transport at their world', canEmbark([a1.id, a2.id], t, armies, noContact).ok)
  check('...but not three — capacity is 2', !canEmbark([a1.id, a2.id, a3.id], t, armies, noContact).ok)
  check("garrisons can't embark", !canEmbark([g.id], t, armies, noContact).ok)
  check("an army on another body can't", !canEmbark([away.id], t, armies, noContact).ok)
  check("another nation's army can't", !canEmbark([venusian.id], t, armies, noContact).ok)
  check("a warship can't carry armies", !canEmbark([a1.id], orbiting('w', MARS, 'cruiser', 'Mars'), armies, noContact).ok)
  const refused = canEmbark([a1.id], t, armies, () => true)
  check("an army in contact with the enemy can't pull out", !refused.ok, refused.ok ? '' : refused.reason)

  war(MARS, VENUS)
  check('contact is real: a Venusian army standing on the Martian one is in contact', armyInContact(a1, armies, atWar))
  check('...but one on another world is not', !armyInContact(away, armies, atWar))
}

console.log('\n=== 4. Landing: war, orbital superiority, and a clear site ===')
{
  peaceAll()
  const t = orbiting('t1', MARS, 'troop-transport', 'Venus')
  const cargo = [army(MARS, 'assault', aboard('t1')), army(MARS, 'assault', aboard('t1'))]
  const r1 = landingCheck(t, cargo, [t], owners, {}, atWar)
  check("can't invade a nation you're at peace with", !r1.ok, r1.ok ? '' : r1.reason)

  war(MARS, VENUS)
  const venusCruiser = orbiting('vc', VENUS, 'cruiser', 'Venus')
  const r2 = landingCheck(t, cargo, [t, venusCruiser], owners, {}, atWar)
  check("can't invade while an enemy warship holds the orbit", !r2.ok, r2.ok ? '' : r2.reason)
  check('...which is orbital superiority denied', !hasOrbitalSuperiority(MARS, 'Venus', [t, venusCruiser], atWar))
  check("an unarmed enemy hull doesn't deny the orbit", landingCheck(t, cargo, [t, orbiting('vt', VENUS, 'troop-transport', 'Venus')], owners, {}, atWar).ok)
  check("a neutral nation's warship doesn't deny it either", landingCheck(t, cargo, [t, orbiting('oc', ORION, 'cruiser', 'Venus')], owners, {}, atWar).ok)
  const home = landingCheck(orbiting('t1', MARS, 'troop-transport', 'Mars'), cargo, [], owners, {}, atWar)
  check('landing at home is unloading, not an invasion', home.ok && home.kind === 'disembark')
  check('an empty transport has nothing to land', !landingCheck(t, [], [t], owners, {}, atWar).ok)
  check("an unclaimed body can't be invaded", !landingCheck(orbiting('t1', MARS, 'troop-transport', 'Earth'), cargo, [], owners, {}, atWar).ok)

  // Where on the surface.
  const venus = groundSurface('Venus', owners)!
  const ocean = [...Array(mesh.count.fine).keys()].find((i) => terrainAt(venus, i) === 'ocean')!
  const types = cargo.flatMap((a) => a.units.map((u) => u.type))
  const wet = dropCheck(venus, ocean, types, MARS, [], atWar)
  check("an assault army can't land in the ocean", !wet.ok, wet.ok ? '' : wet.reason)
  check('...marines can', dropCheck(venus, ocean, ['marines'], MARS, [], atWar).ok)
  const key = venus.keySlots[0].node
  const defended = [army(VENUS, 'garrison', onBody('Venus'), key)]
  const hot = dropCheck(venus, key, types, MARS, defended, atWar)
  check("can't land right on top of enemy units", !hot.ok, hot.ok ? '' : hot.reason)
  const clear = [...Array(mesh.count.fine).keys()].find(
    (i) => types.every((t) => passableFor(terrainAt(venus, i), t)) && arc(nodePoint(i), nodePoint(key)) > mesh.fineSpacingRad * 4,
  )!
  check('...but can land clear of them on walkable ground', dropCheck(venus, clear, types, MARS, defended, atWar).ok)
}

console.log('\n=== 5. A destroyed transport takes its armies with it ===')
{
  const cargo = [army(MARS, 'assault', aboard('t1')), army(MARS, 'assault', aboard('t1')), army(MARS, 'assault', onBody('Mars'))]
  const kept = reapLostCargo(cargo, new Set(['other-ship']))
  check('embarked armies on a missing ship are lost', kept.length === 1 && kept[0].location.kind === 'body')
  check('nothing lost when the ship is alive (same array back)', reapLostCargo(cargo, new Set(['t1'])) === cargo)
}

console.log('\n=== 6. Recruiting, through the store ===')
{
  peaceAll()
  useTerritoryStore.getState().reset()
  useArmyStore.getState().reset()
  useShipStore.setState({ ships: [] })
  seedStrategicResources(MARS)
  const before = useResourceStore.getState().stateFor(MARS).amounts.minerals
  const ok = useArmyStore.getState().recruitArmy(MARS, 'Mars', 'assault', 100)
  check('Mars can recruit an assault army at its capital', ok.ok)
  const spent = before - useResourceStore.getState().stateFor(MARS).amounts.minerals
  check('...and pays for it up front', spent === ARMY_KINDS.assault.recruitCost!.minerals, `${spent}`)
  check('...and a formation of fresh units is in training', useArmyStore.getState().armies[0].units.length === 4 && useArmyStore.getState().armies[0].location.kind === 'recruiting')
  check('marine armies can be recruited too', useArmyStore.getState().recruitArmy(MARS, 'Mars', 'marine', 100).ok)
  check("can't recruit a garrison", !useArmyStore.getState().recruitArmy(MARS, 'Mars', 'garrison', 100).ok)
  check("can't recruit on someone else's world", !useArmyStore.getState().recruitArmy(MARS, 'Venus', 'assault', 100).ok)
  check("can't recruit on an uninhabited rock", !useArmyStore.getState().recruitArmy(MARS, 'Phobos', 'assault', 100).ok)
  useTerritoryStore.getState().occupyBody('Luna', VENUS)
  check("can't recruit on an occupied world", !useArmyStore.getState().recruitArmy(MARS, 'Luna', 'assault', 100).ok)
  war(MARS, VENUS)
  useShipStore.setState({ ships: [orbiting('blockader', VENUS, 'cruiser', 'Mars') as ShipInstance] })
  const blocked = useArmyStore.getState().recruitArmy(MARS, 'Mars', 'assault', 100)
  check("can't recruit at a world blockaded by enemy warships", !blocked.ok && /Blockaded/.test(blocked.reason), blocked.ok ? '' : blocked.reason)
  useShipStore.setState({ ships: [] })
}

console.log('\n=== 7. Starting forces, embark and land through the store ===')
{
  peaceAll()
  war(MARS, VENUS)
  useTerritoryStore.getState().reset()
  useArmyStore.getState().reset()
  seedStartingArmies()
  const { armies } = useArmyStore.getState()
  const marsSurface = groundSurface('Mars', owners)!
  const marsAssault = armies.filter((a) => a.ownerId === MARS && a.kind === 'assault')
  check('every nation starts with two assault armies at its capital', marsAssault.length === 2 && marsAssault.every((a) => a.location.kind === 'body' && a.location.bodyName === 'Mars'))
  check("...standing around the capital's muster point (the spaceport)", marsAssault.every((a) => a.units.every((u) => arc(u.position!, nodePoint(musterNode(marsSurface))) <= mesh.fineSpacingRad * 1.2)))
  const capitalGarrisons = armies.filter((a) => a.ownerId === MARS && a.kind === 'garrison' && a.location.kind === 'body' && a.location.bodyName === 'Mars')
  check('the capital has three garrisons', capitalGarrisons.length === 3)
  const keyPoints = marsSurface.keySlots.map((k) => nodePoint(k.node))
  check('...standing on its key nodes', capitalGarrisons.every((g) => g.units.every((u) => keyPoints.some((p) => arc(p, u.position!) <= mesh.fineSpacingRad * 1.2))))
  seedStartingArmies()
  check('seeding twice never doubles anyone', useArmyStore.getState().armies.length === armies.length)

  const t = orbiting('store-t', MARS, 'troop-transport', 'Mars') as ShipInstance
  useShipStore.setState({ ships: [t] })
  const e = useArmyStore.getState().embark(marsAssault.map((a) => a.id), 'store-t')
  const boarded = useArmyStore.getState().armies.filter((a) => a.location.kind === 'embarked')
  check('embark through the store', e.ok && boarded.length === 2)
  check('...their units leave the map', boarded.every((a) => a.units.every((u) => !u.position)))

  useShipStore.setState({ ships: [{ ...t, location: { ...t.location, bodyName: 'Venus' } as ShipInstance['location'] }] })
  const venus = groundSurface('Venus', owners)!
  const site = [...Array(mesh.count.fine).keys()].find(
    (i) => venus.landComponent[i] === venus.mainland && ['plains', 'desert', 'rock', 'forest'].includes(terrainAt(venus, i)) &&
      venus.keySlots.every((k) => arc(nodePoint(i), nodePoint(k.node)) > mesh.fineSpacingRad * 4),
  )!
  const r = useArmyStore.getState().land('store-t', site)
  check('invading Venus at a chosen site', r.ok && r.kind === 'invade', r.ok ? '' : r.reason)
  const landed = useArmyStore.getState().armies.filter((a) => a.ownerId === MARS && a.location.kind === 'body' && a.location.bodyName === 'Venus')
  check('...puts the units down around that site', landed.length === 2 && landed.every((a) => a.units.every((u) => arc(u.position!, nodePoint(site)) <= mesh.fineSpacingRad * 1.2)))
}

console.log("\n=== 8. The player's orders to individual units ===")
{
  usePlayerStore.setState({ selectedCountryId: MARS })
  const st = () => useArmyStore.getState()
  const venus = groundSurface('Venus', owners)!
  const mine = st().armies.find((a) => a.ownerId === MARS && a.location.kind === 'body' && a.location.bodyName === 'Venus')!
  const [first, second] = mine.units
  const goal = venus.keySlots[0].node
  const r = st().orderUnits([first.id], goal)
  const after = () => st().armies.find((a) => a.id === mine.id)!.units
  check('ordering one unit gives it (only it) a path', r.ok && (after()[0].path?.length ?? 0) > 0 && !(after()[1].path?.length))
  check("...and it's an order, carried out under fire", after()[0].orderedMove === true)
  st().orderUnits([first.id, second.id], goal)
  check('a multi-selection moves together', after().slice(0, 2).every((u) => (u.path?.length ?? 0) > 0))
  st().haltUnits([first.id])
  check('halt clears the path', !(after()[0].path?.length))
  const venusGarrison = st().armies.find((a) => a.ownerId === VENUS && a.kind === 'garrison')!
  check("the enemy's units can't be ordered", !st().orderUnits([venusGarrison.units[0].id], goal).ok)
  const marsGarrison = st().armies.find((a) => a.ownerId === MARS && a.kind === 'garrison')!
  check('militia hold their posts even when ordered', !st().orderUnits([marsGarrison.units[0].id], goal).ok)
  st().targetUnit([first.id], venusGarrison.units[0].id)
  check('focus fire can be set on an enemy unit', after()[0].targetUnitId === venusGarrison.units[0].id)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
