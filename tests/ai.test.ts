// The strategic AI (src/ai/): the blackboard's numbers, each agent's rules,
// and a headless multi-month run where AI empires build, go to war, invade
// and make peace on their own.
//
// Run:  npx tsx tests/ai.test.ts

import { COUNTRIES } from '../src/data/countryData'
import { AI_WAR_GRACE_DAYS, AI_WAR_RATIO, AI_WAR_RATIO_AT_HATRED } from '../src/data/aiData'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore, type ShipInstance } from '../src/state/shipStore'
import { useArmyStore } from '../src/state/armyStore'
import { arc, nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'
import { useTerrainStore } from '../src/state/terrainStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useDiplomacyStore, atWar } from '../src/state/diplomacyStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipyardStore } from '../src/state/shipyardStore'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { totalHitPoints } from '../src/scene/combatResolution'
import { resolveArrivalLocation } from '../src/scene/shipPhysics'
import { applyStrategicIncome, seedStrategicResources, spawnOwnedShip } from '../src/scene/shipyardLogic'
import { setUpNewGame } from '../src/scene/gameSetup'
import { declareWarOn } from '../src/scene/peace'
import { orbitedBody } from '../src/scene/armyLogic'
import { dropCheck, groundSurface } from '../src/scene/groundLogic'
import { buildBlackboard, shipPower } from '../src/ai/blackboard'
import { captureSnapshot } from '../src/ai/snapshot'
import { requiredWarRatio, strategist } from '../src/ai/strategist'
import { diplomat } from '../src/ai/diplomat'
import { shipwright } from '../src/ai/shipwright'
import { admiral } from '../src/ai/admiral'
import { marshal, wouldTakeBody } from '../src/ai/marshal'
import { runStrategicAI } from '../src/ai/runStrategicAI'
import { useAiStore } from '../src/ai/aiStore'
import { INITIAL_AI_MEMORY, type Intent } from '../src/ai/types'
import { resolveGroundWar } from '../src/hooks/useGroundCombatResolver'
import { resolveDefenses } from '../src/hooks/useDefenseResolver'
import { resolveBombardment } from '../src/hooks/useBombardmentResolver'
import { useDefenseStore } from '../src/state/defenseStore'
import { useBombardmentStore } from '../src/state/bombardmentStore'
import { resolveShipyards } from '../src/hooks/useShipyardResolver'

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
const LALANDE = 'kingdom-of-lalande'

// A fresh world: every nation's starting forces and stockpile, all at peace.
// The player is Lalande, so Mars, Venus and Orion are all AI empires.
function freshWorld() {
  useShipStore.setState({ ships: [] })
  useArmyStore.getState().reset()
  useTerritoryStore.getState().reset()
  useDiplomacyStore.getState().reset()
  useAiStore.getState().reset()
  useShipyardStore.setState({ ordersByCountry: {} })
  useResourceStore.setState({ byCountry: {} })
  useDefenseStore.setState({ installations: [] })
  useBombardmentStore.setState({ devastation: {}, strikes: [] })
  usePlayerStore.setState({ selectedCountryId: LALANDE })
  setUpNewGame()
  for (const c of COUNTRIES) seedStrategicResources(c.id)
}

function spawnExtra(owner: string, classId: string, n: number) {
  const c = COUNTRIES.find((x) => x.id === owner)!
  for (let i = 0; i < n; i++) spawnOwnedShip(classId, owner, c.capitalStarId, c.capitalBodyName)
}

const has = (intents: Intent[], kind: Intent['kind']) => intents.some((i) => i.kind === kind)

console.log('\n=== 1. The blackboard ===')
{
  freshWorld()
  const snap = captureSnapshot(0)
  const bb = buildBlackboard(MARS, snap)
  const expected = useShipStore
    .getState()
    .ships.filter((s) => s.ownerId === MARS)
    .reduce((sum, s) => {
      const c = resolveShipClass(s.classId)!
      return sum + (c.combat.weapons.length > 0 ? totalHitPoints(c.combat) : 0)
    }, 0)
  check("power is the armed hit points of the empire's ships", bb.power === expected && expected > 0, `${bb.power}`)
  check('an unarmed transport adds no power', shipPower(useShipStore.getState().ships.find((s) => s.classId === 'troop-transport')!) === 0)
  check('power is also counted per body', bb.powerAt(MARS, 'Mars') === bb.power)
  check('Mars and Venus are neighbours (they share Sol)', bb.neighbours.includes(VENUS) && !bb.neighbours.includes(ORION))
  check("Orion's theatre is Alpha Centauri", buildBlackboard(ORION, snap).theatreStars.has('alpha-centauri'))
  check('Orion has no neighbours', buildBlackboard(ORION, snap).neighbours.length === 0)
  check('nothing is threatened at peace', bb.threats.length === 0)
  check('the starting assault armies are home', bb.assaultArmiesHome.length === 2)
}

console.log('\n=== 2. The Strategist ===')
{
  check('the power edge wanted shrinks with hatred', requiredWarRatio(-25) === AI_WAR_RATIO && requiredWarRatio(-100) === AI_WAR_RATIO_AT_HATRED && requiredWarRatio(-55) < AI_WAR_RATIO)

  freshWorld()
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, -60)
  spawnExtra(MARS, 'cruiser', 3)
  const late = AI_WAR_GRACE_DAYS + 1
  const out = strategist(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late))
  check('stronger and hostile, Mars declares war on Venus', out.intents.some((i) => i.kind === 'declare-war' && i.targetId === VENUS))
  check('...but not during the opening grace period', !has(strategist(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10)).intents, 'declare-war'))

  const venusOut = strategist(buildBlackboard(VENUS, captureSnapshot(late)), captureSnapshot(late))
  check('the weaker side does not declare', !has(venusOut.intents, 'declare-war'))
  check('...but it is building up', venusOut.memory?.posture === 'buildup')

  freshWorld()
  spawnExtra(MARS, 'cruiser', 3)
  const noGrudge = strategist(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late))
  check('strength alone is no reason — no war without hostility', !has(noGrudge.intents, 'declare-war') && noGrudge.memory?.posture === 'peace')

  freshWorld()
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, -60)
  spawnExtra(MARS, 'cruiser', 3)
  declareWarOn(MARS, VENUS, 0)
  const war = useDiplomacyStore.getState().wars[0]
  useDiplomacyStore.getState().endWar(war.id, 50)
  const truce = strategist(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late))
  check('no war during a truce', !has(truce.intents, 'declare-war'))

  // Lalande: give it a body in Sol so it's a neighbour, and make Mars hate it.
  freshWorld()
  usePlayerStore.setState({ selectedCountryId: ORION }) // Lalande is dormant, not the player
  useTerritoryStore.getState().cedeBody('Titan', LALANDE)
  useDiplomacyStore.getState().adjustOpinion(MARS, LALANDE, -90)
  spawnExtra(MARS, 'cruiser', 3)
  const lal = strategist(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late))
  check('a dormant nation (Lalande) is never an AI war target', !lal.intents.some((i) => i.kind === 'declare-war' && i.targetId === LALANDE))
  usePlayerStore.setState({ selectedCountryId: LALANDE })
  const lalPlayer = strategist(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late))
  check('...unless it is the player', lalPlayer.intents.some((i) => i.kind === 'declare-war' && i.targetId === LALANDE))
}

console.log('\n=== 3. The Diplomat ===')
{
  freshWorld()
  const out = diplomat(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), INITIAL_AI_MEMORY)
  check('friction with the neighbour sharing its system', out.intents.some((i) => i.kind === 'adjust-opinion' && i.otherId === VENUS && i.delta < 0))
  check('none with nations elsewhere', !out.intents.some((i) => i.kind === 'adjust-opinion' && i.otherId === ORION))

  freshWorld()
  declareWarOn(MARS, VENUS, 0)
  useTerritoryStore.getState().occupyBody('Venus', MARS)
  const winning = diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check('holding all of Venus, Mars demands it', winning.intents.some((i) => i.kind === 'propose-peace' && i.terms.kind === 'cede' && i.terms.bodies.includes('Venus')))
  const losing = diplomat(buildBlackboard(VENUS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check("Venus, losing, won't offer a white peace Mars would refuse", !losing.intents.some((i) => i.kind === 'propose-peace'))

  const recent = { ...INITIAL_AI_MEMORY, lastPeaceOfferSimDays: { [useDiplomacyStore.getState().wars[0].id]: 5 } }
  check('offers are rate-limited', !has(diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), recent).intents, 'propose-peace'))

  freshWorld()
  declareWarOn(MARS, VENUS, 0)
  useTerritoryStore.getState().occupyBody('Phobos', VENUS)
  const pressing = diplomat(buildBlackboard(VENUS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check('fresh, with Mars still in reach, Venus presses on rather than settle for Phobos', !has(pressing.intents, 'propose-peace'))
  const tired = diplomat(buildBlackboard(VENUS, captureSnapshot(400)), captureSnapshot(400), INITIAL_AI_MEMORY)
  check('...but a year in, it takes what it holds', tired.intents.some((i) => i.kind === 'propose-peace' && i.terms.kind === 'cede' && i.terms.bodies.includes('Phobos')))
}

console.log('\n=== 4. The Shipwright ===')
{
  freshWorld()
  const peace = shipwright(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), { ...INITIAL_AI_MEMORY, posture: 'peace' })
  check('at peace with a full starting navy, it builds warships toward its target', peace.intents.some((i) => i.kind === 'build-ship' && i.classId !== 'troop-transport'))
  const war = shipwright(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), { ...INITIAL_AI_MEMORY, posture: 'war' })
  check('at war it wants more transports and armies', war.intents.some((i) => i.kind === 'build-ship' && i.classId === 'troop-transport') && has(war.intents, 'recruit-army'))

  useResourceStore.setState({ byCountry: {} })
  const broke = shipwright(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), { ...INITIAL_AI_MEMORY, posture: 'war' })
  check('with an empty stockpile it builds nothing', broke.intents.length === 0)
}

console.log('\n=== 5. The Admiral ===')
{
  freshWorld()
  declareWarOn(MARS, VENUS, 0)
  spawnExtra(MARS, 'cruiser', 3)
  const attack = admiral(buildBlackboard(MARS, captureSnapshot(1)), captureSnapshot(1), INITIAL_AI_MEMORY)
  check('stronger, it sends the navy at Venus', attack.memory?.targetBody === 'Venus' && attack.intents.every((i) => i.kind === 'move-ship' && i.bodyName === 'Venus') && attack.intents.length > 0)

  const venusSide = admiral(buildBlackboard(VENUS, captureSnapshot(1)), captureSnapshot(1), INITIAL_AI_MEMORY)
  check("the weaker side doesn't throw its navy at Mars's main fleet", venusSide.memory?.targetBody !== 'Mars' && !venusSide.intents.some((i) => i.kind === 'move-ship' && i.bodyName === 'Mars'))
  check('...it goes for an undefended Martian world instead', ['Luna', 'Phobos', 'Deimos'].includes(venusSide.memory?.targetBody ?? ''), `${venusSide.memory?.targetBody}`)

  // Mars's navy sits at Venus; Venus's weaker fleet appears over Luna.
  const ships = useShipStore.getState().ships
  useShipStore.setState({
    ships: ships.map((s) =>
      s.ownerId === VENUS && s.location.kind === 'orbiting' ? { ...s, location: { ...s.location, bodyName: 'Luna' } } : s,
    ),
  })
  const defend = admiral(buildBlackboard(MARS, captureSnapshot(2)), captureSnapshot(2), INITIAL_AI_MEMORY)
  check('an attack on its own world comes first: it defends Luna', defend.intents.length > 0 && defend.intents.every((i) => i.kind === 'move-ship' && i.bodyName === 'Luna'))

  freshWorld()
  const home = admiral(buildBlackboard(MARS, captureSnapshot(1)), captureSnapshot(1), INITIAL_AI_MEMORY)
  check('at peace, a navy already home stays put', home.intents.length === 0)
}

console.log('\n=== 6. The Marshal ===')
{
  freshWorld()
  const snap0 = captureSnapshot(0)
  const load = marshal(buildBlackboard(MARS, snap0), snap0, INITIAL_AI_MEMORY)
  check('it loads the assault armies waiting at home', load.intents.some((i) => i.kind === 'embark' && i.armyIds.length === 2))

  declareWarOn(MARS, VENUS, 0)
  const marsT = useShipStore.getState().ships.find((s) => s.ownerId === MARS && s.classId === 'troop-transport')!
  const home = useArmyStore.getState().armies.filter((a) => a.ownerId === MARS && a.kind === 'assault').map((a) => a.id)
  useArmyStore.getState().embark(home, marsT.id)
  const memory = { ...INITIAL_AI_MEMORY, posture: 'war' as const, targetBody: 'Venus' }
  const blocked = marshal(buildBlackboard(MARS, captureSnapshot(1)), captureSnapshot(1), memory)
  check("orbit not secured: the transport doesn't sail", !blocked.intents.some((i) => i.kind === 'move-ship' || i.kind === 'land'))

  // Mars's navy takes Venus's orbit; Venus's fleet is gone.
  useShipStore.setState({
    ships: useShipStore
      .getState()
      .ships.filter((s) => s.ownerId !== VENUS)
      .map((s) => (s.ownerId === MARS && s.location.kind === 'orbiting' && s.classId !== 'troop-transport' ? { ...s, location: { ...s.location, bodyName: 'Venus' } } : s)),
  })
  // Venus's capital defenses still stand (a battery denies the landing), so
  // Mars bombards them first and the transport waits.
  const bombard = marshal(buildBlackboard(MARS, captureSnapshot(2)), captureSnapshot(2), memory)
  check('defenses stand: the warships in orbit bombard them', bombard.intents.some((i) => i.kind === 'set-bombard' && i.stance === 'limited'))
  check("...and the transport doesn't sail yet", !bombard.intents.some((i) => i.kind === 'move-ship' && i.shipId === marsT.id))
  for (const i of bombard.intents) if (i.kind === 'set-bombard') useShipStore.getState().setBombardStance(i.shipId, i.stance)
  // The bombardment has done its work.
  useDefenseStore.setState({ installations: useDefenseStore.getState().installations.filter((i) => i.bodyName !== 'Venus') })
  const go = marshal(buildBlackboard(MARS, captureSnapshot(2)), captureSnapshot(2), memory)
  check('orbit secured: the loaded transport heads for Venus', go.intents.some((i) => i.kind === 'move-ship' && i.shipId === marsT.id && i.bodyName === 'Venus'))
  check('...and the bombardment stops', go.intents.some((i) => i.kind === 'set-bombard' && i.stance === 'off'))

  useShipStore.setState({
    ships: useShipStore.getState().ships.map((s) => (s.id === marsT.id && s.location.kind === 'orbiting' ? { ...s, location: { ...s.location, bodyName: 'Venus' } } : s)),
  })
  const snap = captureSnapshot(3)
  const cargo = useArmyStore.getState().armies.filter((a) => a.location.kind === 'embarked')
  check("the estimate says 2 armies can't take a capital defended by garrisons and two field armies", !wouldTakeBody(MARS, 'Venus', cargo, snap, atWar))
  const wait = marshal(buildBlackboard(MARS, snap), snap, memory)
  check('...so it holds them in orbit instead of throwing them away', !has(wait.intents, 'land'))

  // Venus's own assault armies ship out, leaving the garrisons; a third
  // Martian army arrives aboard.
  useArmyStore.setState({ armies: useArmyStore.getState().armies.filter((a) => !(a.ownerId === VENUS && a.kind === 'assault')) })
  useArmyStore.getState().addArmy({ ownerId: MARS, kind: 'assault', location: { kind: 'embarked', shipId: marsT.id } })
  const snap4 = captureSnapshot(4)
  check('three armies would win', wouldTakeBody(MARS, 'Venus', useArmyStore.getState().armies.filter((a) => a.location.kind === 'embarked'), snap4, atWar))
  const landing = marshal(buildBlackboard(MARS, snap4), snap4, memory).intents.find((i) => i.kind === 'land' && i.shipId === marsT.id)
  check('...so it lands them', !!landing)
  const venus = groundSurface('Venus', useTerritoryStore.getState().bodyOwner)!
  const types = useArmyStore.getState().armies.filter((a) => a.location.kind === 'embarked').flatMap((a) => a.units.map((u) => u.type))
  check('...at a landing site that is walkable and clear of the enemy', !!landing && landing.kind === 'land' && landing.dropNode !== undefined &&
    dropCheck(venus, landing.dropNode, types, MARS, useArmyStore.getState().armies, atWar).ok)
}

console.log('\n=== 7. Headless campaign: AI empires on their own ===')
{
  freshWorld()
  // Seed a grudge and an edge: Mars and Venus have hated each other for a
  // while, and Mars's navy is bigger.
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, -60)
  spawnExtra(MARS, 'cruiser', 3)

  // Test stand-in for the space combat resolver (covered by combat.test.ts):
  // at any body where nations at war both have ships, the side with less
  // armed power loses every ship there.
  const crudeSpaceCombat = () => {
    const ships = useShipStore.getState().ships
    const byBody = new Map<string, ShipInstance[]>()
    for (const s of ships) {
      const b = orbitedBody(s)
      if (b && !s.order) byBody.set(b, [...(byBody.get(b) ?? []), s])
    }
    const doomed = new Set<string>()
    for (const here of byBody.values()) {
      const owners = [...new Set(here.map((s) => s.ownerId))]
      for (const a of owners) {
        for (const b of owners) {
          if (a >= b || !atWar(a, b)) continue
          const power = (o: string) => here.filter((s) => s.ownerId === o).reduce((sum, s) => sum + shipPower(s), 0)
          const pa = power(a)
          const pb = power(b)
          if (pa === pb) continue
          const loser = pa < pb ? a : b
          for (const s of here) if (s.ownerId === loser) doomed.add(s.id)
        }
      }
    }
    if (doomed.size > 0) useShipStore.setState({ ships: ships.filter((s) => !doomed.has(s.id)) })
  }
  const settleOrders = (simDays: number) => {
    for (const s of useShipStore.getState().ships) {
      if (s.order && simDays >= s.order.arrivalSimDays) {
        useShipStore.getState().setShipLocation(s.id, resolveArrivalLocation(s.order.destination, s.id), undefined, true)
      }
    }
  }

  let firstWar: { day: number; attacker: string; defender: string } | null = null
  let marsBuilt = 0
  const seenShips = new Set(useShipStore.getState().ships.map((s) => s.id))
  for (let day = 1; day <= (Number(process.env.AI_STOP) || 1100); day++) {
    if (day % 30 === 0) for (const c of COUNTRIES) applyStrategicIncome(c.id, 1)
    runStrategicAI(day)
    resolveShipyards(day)
    for (const s of useShipStore.getState().ships) {
      if (!seenShips.has(s.id)) {
        seenShips.add(s.id)
        if (s.ownerId === MARS) marsBuilt++
      }
    }
    settleOrders(day)
    crudeSpaceCombat()
    resolveGroundWar(day)
    resolveDefenses(day - 1, day)
    resolveBombardment(day - 1, day)
    // AI_TRACE=1 prints a monthly snapshot of Mars vs Venus, for tuning.
    if (process.env.AI_TRACE && day % 30 === 0) {
      const armies = useArmyStore.getState().armies
      const ships = useShipStore.getState().ships
      const where = (o: string) => ships.filter((s) => s.ownerId === o).map((s) => `${s.classId[0]}${s.classId[1]}@${orbitedBody(s) ?? (s.order ? '→' : '?')}`).join(' ')
      const arm = (o: string) => armies.filter((a) => a.ownerId === o && a.kind === 'assault').map((a) => `${a.location.kind === 'body' ? a.location.bodyName : a.location.kind}:${a.units.length}u`).join(',')
      console.log(`    d${day} mem=${JSON.stringify(useAiStore.getState().memory[MARS]?.targetBody)} post=${useAiStore.getState().memory[MARS]?.posture} res=${JSON.stringify(useResourceStore.getState().stateFor(MARS).amounts)}`)
      console.log(`      MARS ships: ${where(MARS)} | armies: ${arm(MARS)} | q=${useShipyardStore.getState().ordersFor(MARS).length}`)
      console.log(`      TERRAIN battles: ${useTerrainStore.getState().battles.map((b) => `${b.bodyName}[${b.units.map((u) => `${u.ownerId[0]}${u.type[0]}${Math.round(u.strength)}@${u.x.toFixed(1)},${u.y.toFixed(1)}${u.path.length ? '>' : ''}`).join(' ')}] quiet=${b.quietSinceStep}`).join(' | ') || 'none'}`)
      console.log(`      VENUS ships: ${where(VENUS)} | armies: ${arm(VENUS)} | onVenus=${armies.filter((a) => a.location.kind === 'body' && a.location.bodyName === 'Venus').length}`)
    }
    const wars = useDiplomacyStore.getState().wars
    if (!firstWar && wars.length > 0) firstWar = { day, attacker: wars[0].attackerId, defender: wars[0].defenderId }
  }

  if (process.env.AI_STOP) {
    for (const b of useTerrainStore.getState().battles) {
      const ids = b.units.map((u) => u.id)
      console.log('BATTLE', b.id, 'units', ids.length, 'unique', new Set(ids).size, 'started', b.startedStep, 'at', b.resolvedThroughStep)
    }
    const all = useArmyStore.getState().armies.flatMap((a) => a.units.map((u) => u.id))
    console.log('ARMY units', all.length, 'unique', new Set(all).size)
    const vs = groundSurface('Venus', useTerritoryStore.getState().bodyOwner)!
    console.log('KEYS', vs.keySlots.map((k) => k.node + ':' + k.kind).join(' '), 'holders', JSON.stringify(useTerritoryStore.getState().nodeHolders['Venus'] ?? {}).slice(0, 200), 'controller', useTerritoryStore.getState().bodyController['Venus'])
    for (const a of useArmyStore.getState().armies) if (a.location.kind === 'body' && a.location.bodyName === 'Venus') for (const u of a.units) console.log(' ', a.ownerId.slice(0, 6), u.type, Math.round(u.strength), 'key-dists', vs.keySlots.map((k) => (arc(u.position!, nodePoint(k.node)) / surfaceMesh().fineSpacingRad).toFixed(1)).join(','), 'path', u.path?.length ?? 0, 'obj', u.objectiveNode, 'fire', u.firingAtId ? 1 : 0)
  }
  const events = useDiplomacyStore.getState().events
  const log = events.map((e) => `d${Math.round(e.simDays)} ${e.text}`)
  console.log('    event log:\n      ' + log.join('\n      '))
  check('Mars declared war on Venus after the grace period', !!firstWar && firstWar.attacker === MARS && firstWar.defender === VENUS && firstWar.day >= AI_WAR_GRACE_DAYS, JSON.stringify(firstWar))
  check('the AI built ships through its shipyard', marsBuilt > 0, `Mars built ${marsBuilt}`)
  check('Mars invaded and occupied Venus', events.some((e) => e.kind === 'body-occupied' && e.countryIds[0] === MARS && e.text.includes('Venus')))
  check('...and made peace taking it', useTerritoryStore.getState().bodyOwner['Venus'] === MARS && events.some((e) => e.kind === 'peace-signed'))
  check('Orion, with no neighbours, stayed at peace', !events.some((e) => e.kind === 'war-declared' && e.countryIds.includes(ORION)))
  check('Lalande (the player here, sharing no system) was left alone', !events.some((e) => e.kind === 'war-declared' && e.countryIds.includes(LALANDE)))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
