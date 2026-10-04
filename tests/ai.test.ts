// The strategic AI (src/ai/): the blackboard's numbers, each agent's rules,
// and a headless multi-month run where AI empires build, go to war, invade
// and make peace on their own.
//
// Run:  npx tsx tests/ai.test.ts

import { warpCommsOnly } from './testComms'
import { applyInfluenceIncome, seedInfluence } from '../src/scene/colonies'
import { STARBASE_INFLUENCE_COST } from '../src/data/starbaseData'
import { COUNTRIES } from '../src/data/countryData'
import { AI_MAX_STARBASES, AI_WAR_GRACE_DAYS, AI_WAR_RATIO, AI_WAR_RATIO_AT_HATRED } from '../src/data/aiData'
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
import { resolveArrivalLocation, setJumpRoll } from '../src/scene/shipPhysics'
import { seededStream } from '../src/data/galaxyGen'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
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
import { expander } from '../src/ai/expander'
import { useSurveyStore } from '../src/state/surveyStore'
import { resolveSurvey } from '../src/hooks/useSurveyResolver'
import { resolveCommsSignals } from '../src/hooks/useCommsResolver'
import { systemBodies } from '../src/scene/territory'
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
import { useTechStore } from '../src/state/techStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useInternationalOrgStore } from '../src/state/internationalOrgStore'
import { useSubjectStore, isSubjectOf } from '../src/state/subjectStore'
import { useTradePolicyStore, isEmbargoed } from '../src/state/tradePolicyStore'
import { executeIntents } from '../src/ai/executor'

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
// Jump losses are rolled from a seeded stream, so every run of this file is the same.
const JUMP_SEED = Number(process.env.AI_JUMP_SEED ?? 1)
setJumpRoll(seededStream(JUMP_SEED, 'ai-test'))

function freshWorld() {
  useHyperlaneStore.setState({ lanes: {} })
  useShipStore.setState({ ships: [] })
  useArmyStore.getState().reset()
  useTerritoryStore.getState().reset()
  useDiplomacyStore.getState().reset()
  useAiStore.getState().reset()
  useShipyardStore.setState({ ordersByCountry: {} })
  useResourceStore.setState({ byCountry: {} })
  useDefenseStore.setState({ installations: [] })
  useBombardmentStore.setState({ devastation: {}, strikes: [] })
  warpCommsOnly()
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useStarbaseStore.setState({ starbases: [] })
  useInternationalOrgStore.getState().reset()
  useSubjectStore.getState().reset()
  useTradePolicyStore.getState().reset()
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

  // Every nation now runs the AI (no dormant nations): a hated, outgunned
  // neighbour is a valid war target whether or not it's the player. Lalande,
  // given a body in Sol so it's a neighbour and a grudge, is fair game.
  freshWorld()
  usePlayerStore.setState({ selectedCountryId: ORION })
  useTerritoryStore.getState().cedeBody('Titan', LALANDE)
  useDiplomacyStore.getState().adjustOpinion(MARS, LALANDE, -90)
  spawnExtra(MARS, 'cruiser', 3)
  const lal = strategist(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late))
  check('a hated, outgunned neighbour (Lalande) is now a valid AI war target', lal.intents.some((i) => i.kind === 'declare-war' && i.targetId === LALANDE))
  usePlayerStore.setState({ selectedCountryId: LALANDE })
  const lalPlayer = strategist(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late))
  check('...and just as much when it is the player', lalPlayer.intents.some((i) => i.kind === 'declare-war' && i.targetId === LALANDE))
}

console.log('\n=== 3. The Diplomat ===')
{
  freshWorld()
  // Earth starts wary of Mars and Venus by design (seedStartingRelations: -15);
  // that seeded grievance would make the Diplomat mellow it, which is a different
  // behaviour. This check is about proximity ALONE not creating drift, so put
  // Earth's opinions back to neutral first.
  useDiplomacyStore.getState().adjustOpinion('earth', MARS, 15)
  useDiplomacyStore.getState().adjustOpinion('earth', VENUS, 15)
  const fresh = diplomat(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), INITIAL_AI_MEMORY)
  check(
    "sharing a system alone isn't a grievance — no opinion drift for anyone at a fresh start",
    !fresh.intents.some((i) => i.kind === 'adjust-opinion'),
  )

  freshWorld()
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, -10)
  const recovering = diplomat(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), INITIAL_AI_MEMORY)
  check(
    'a real grievance (already negative) mellows back toward neutral',
    recovering.intents.some((i) => i.kind === 'adjust-opinion' && i.otherId === VENUS && i.delta > 0),
  )
  check('...capped so recovery never overshoots past neutral', recovering.intents.every((i) => i.kind !== 'adjust-opinion' || i.delta <= 10))

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

  // Won the battles, but Venus's only world is its capital and none of it is held.
  freshWorld()
  declareWarOn(MARS, VENUS, 0)
  useDiplomacyStore.setState((s) => ({ wars: s.wars.map((w) => ({ ...w, battleBalance: 3440 })) }))
  const early = diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check('winning battles early with Venus still in reach, Mars presses on', !has(early.intents, 'propose-peace'))
  const later = diplomat(buildBlackboard(MARS, captureSnapshot(400)), captureSnapshot(400), INITIAL_AI_MEMORY)
  check('...a year in, with no world it can claim, it demands reparations', later.intents.some((i) => i.kind === 'propose-peace' && i.terms.kind === 'reparations' && i.terms.share > 0))
}

console.log('\n=== 3c. The Diplomat: organizations, subjects and trade policy ===')
{
  // At war, the Diplomat embargoes the enemy (once).
  freshWorld()
  declareWarOn(MARS, VENUS, 0)
  const atWarOut = diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check('an empire embargoes a nation it is at war with', atWarOut.intents.some((i) => i.kind === 'declare-embargo' && i.targetId === VENUS))
  useTradePolicyStore.getState().declareEmbargo(MARS, VENUS)
  const already = diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check('...and does not repeat an embargo already in place', !already.intents.some((i) => i.kind === 'declare-embargo'))

  // A friendly neighbour at peace → found an organization.
  freshWorld()
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 40)
  const friendly = diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check('with a friendly neighbour, an empire founds an organization', friendly.intents.some((i) => i.kind === 'found-org'))
  // Executing it, then re-planning Venus joins Mars's org.
  executeIntents(MARS, friendly.intents, 10, LALANDE)
  const venusJoins = diplomat(buildBlackboard(VENUS, captureSnapshot(12)), captureSnapshot(12), INITIAL_AI_MEMORY)
  check('a friendly neighbour joins an organization that already exists', venusJoins.intents.some((i) => i.kind === 'join-org'))
  executeIntents(VENUS, venusJoins.intents, 12, LALANDE)
  check('both nations are now in the organization', useInternationalOrgStore.getState().orgs[0]?.memberIds.includes(VENUS))

  // Fellow political-forum members keep each other's opinion up.
  const topUp = diplomat(buildBlackboard(MARS, captureSnapshot(14)), captureSnapshot(14), INITIAL_AI_MEMORY)
  check('org members top up each other\'s opinion', topUp.intents.some((i) => i.kind === 'adjust-opinion' && i.otherId === VENUS && i.delta > 0))

  // A much weaker, well-liked neighbour → an offer of subjection.
  freshWorld()
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 10)
  spawnExtra(MARS, 'cruiser', 6)
  const dominant = diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  const offer = dominant.intents.find((i) => i.kind === 'offer-subjection')
  check('a dominant empire offers subjection to a weak neighbour', !!offer)
  if (offer && offer.kind === 'offer-subjection') {
    executeIntents(MARS, [offer], 10, LALANDE)
    check('...and executing it makes that neighbour a subject of Mars', isSubjectOf(offer.targetId, MARS))
  }

  // A defense pact drags a member into its ally's war.
  freshWorld()
  const orgId = useInternationalOrgStore.getState().founded(MARS, 'defense-alliance', 'Pact', 0)
  useInternationalOrgStore.getState().join(orgId, VENUS)
  declareWarOn(ORION, VENUS, 5) // Orion attacks Venus, Mars's defense-pact ally
  const pactOut = diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check('a defense-pact member answers the call against the attacker', pactOut.intents.some((i) => i.kind === 'join-war-as-ally' && i.allyId === VENUS && i.enemyId === ORION))
  executeIntents(MARS, pactOut.intents.filter((i) => i.kind === 'join-war-as-ally'), 10, LALANDE)
  check('...and Mars goes to war with the attacker', useDiplomacyStore.getState().wars.some((w) => (w.attackerId === MARS && w.defenderId === ORION) || (w.attackerId === ORION && w.defenderId === MARS)))

  // A skirmish being won is escalated to a real war.
  freshWorld()
  declareWarOn(MARS, VENUS, 0, 'skirmish')
  useTerritoryStore.getState().occupyBody('Venus', MARS)
  const skirmish = diplomat(buildBlackboard(MARS, captureSnapshot(10)), captureSnapshot(10), INITIAL_AI_MEMORY)
  check('a skirmish being won is escalated to a limited war', skirmish.intents.some((i) => i.kind === 'escalate-conflict'))
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

  freshWorld()
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperdrive-mk1', 'hyperspace-theory', 'orbital-construction']) } } })
  check('the Shipwright no longer plans Starbases (the Expander does)', !has(shipwright(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), INITIAL_AI_MEMORY).intents, 'build-starbase'))
}

console.log('\n=== 4b. The Expander ===')
{
  const plan = (id: string, memory = INITIAL_AI_MEMORY) => expander(buildBlackboard(id, captureSnapshot(0)), captureSnapshot(0), memory)
  const setTech = (id: string, extra: string[], points = 0) =>
    useTechStore.setState({ byCountry: { [id]: { researchPoints: { physics: points, society: 0, engineering: points }, researched: new Set(['warp-theory', 'hyperdrive-mk1', 'hyperspace-theory', 'hyperdrive-mk2', ...extra]) } } })
  // (Hyperdrive Mk II is what the AI researches last: with it every hop in the neighbourhood is under the 5% line
  // it will jump at, so these checks about WHERE it goes see the whole neighbourhood.)

  freshWorld()
  setTech(MARS, [])
  check('with no science ship it queues one', plan(MARS).intents.some((i) => i.kind === 'build-ship' && i.classId === 'science-ship'))
  check('...but not a Construction Ship before Orbital Construction', !plan(MARS).intents.some((i) => i.kind === 'build-ship' && i.classId === 'construction-ship'))
  check('with no research points it researches nothing', !has(plan(MARS).intents, 'research-tech'))
  setTech(MARS, [], 90)
  check('with the points it goes straight to the road to Orbital Construction (Warp Comms costs exotic matter and is not on its path)', !plan(MARS).intents.some((i) => i.kind === 'research-tech' && i.techId === 'warp-comms'))
  setTech(MARS, [], 40)
  check('...then the first step on the road to Orbital Construction', plan(MARS).intents.some((i) => i.kind === 'research-tech' && i.techId === 'classical-mechanics'))
  setTech(MARS, ['classical-mechanics'], 40)
  check('...and will not skip ahead to a step it cannot afford', !plan(MARS).intents.some((i) => i.kind === 'research-tech' && i.techId === 'orbital-construction'))

  spawnExtra(MARS, 'science-ship', 1)
  check('with a science ship queued or owned it builds no second', !plan(MARS).intents.some((i) => i.kind === 'build-ship' && i.classId === 'science-ship'))
  const sci = plan(MARS).intents.find((i) => i.kind === 'move-ship')
  check('the science ship heads for the nearest star it has not surveyed (Alpha Centauri)', sci?.kind === 'move-ship' && sci.systemId === 'alpha-centauri' && sci.bodyName === null, JSON.stringify(sci))

  // At an unexplored star it just surveys: being there explores it.
  {
    const sciShip = useShipStore.getState().ships.find((s) => s.ownerId === MARS && s.classId === 'science-ship')!
    useShipStore.setState({ ships: useShipStore.getState().ships.map((s) => (s.id === sciShip.id ? { ...s, location: { kind: 'star' as const, starId: 'alpha-centauri', offset: [0, 0, 0] as [number, number, number] } } : s)) })
    const there = plan(MARS).intents
    check('at an unexplored star it orders a survey, without waiting for the exploring', there.some((i) => i.kind === 'survey-system' && i.shipId === sciShip.id))
    useShipStore.setState({ ships: useShipStore.getState().ships.map((s) => (s.id === sciShip.id ? { ...s, location: { kind: 'orbiting' as const, systemId: 'sol', bodyName: 'Mars', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 } } : s)) })
  }

  setTech(MARS, ['orbital-construction'])
  check('once it can build Starbases it wants a Construction Ship', plan(MARS).intents.some((i) => i.kind === 'build-ship' && i.classId === 'construction-ship'))

  // A surveyed, unclaimed star with a Construction Ship at home: it loads a kit.
  freshWorld()
  setTech(MARS, ['orbital-construction'])
  spawnExtra(MARS, 'science-ship', 1)
  spawnExtra(MARS, 'construction-ship', 1)
  spawnExtra(MARS, 'cargo-ship', 1)
  for (const id of ['alloys', 'energy', 'exoticMatter'] as const) useResourceStore.getState().setAmount(MARS, id, 1000)
  useResourceStore.getState().setAmount(MARS, 'influence', 100)
  const sv = useSurveyStore.getState()
  sv.discover(MARS, { kind: 'explored', starId: 'barnards-star' }, 0, 0)
  for (const body of systemBodies('barnards-star')) sv.discover(MARS, { kind: 'surveyed', bodyName: body }, 0, 0)
  const claim = plan(MARS)
  check('it picks the surveyed, unclaimed star as its target', claim.memory?.expansionTarget === 'barnards-star')
  const conShip = useShipStore.getState().ships.find((s) => s.ownerId === MARS && s.classId === 'construction-ship')!
  check('the Construction Ship at the capital loads a Starbase kit', claim.intents.some((i) => i.kind === 'load-cargo' && i.shipId === conShip.id))
  useShipStore.getState().setShipCargo(conShip.id, { alloys: 220 })
  const go = expander(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), { ...INITIAL_AI_MEMORY, expansionTarget: 'barnards-star' })
  check('...once loaded it flies to the star', go.intents.some((i) => i.kind === 'move-ship' && i.shipId === conShip.id && i.systemId === 'barnards-star' && i.bodyName === null))
  useShipStore.setState({ ships: useShipStore.getState().ships.map((s) => (s.id === conShip.id ? { ...s, location: { kind: 'star' as const, starId: 'barnards-star', offset: [0, 0, 0] as [number, number, number] } } : s)) })
  const build = expander(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), { ...INITIAL_AI_MEMORY, expansionTarget: 'barnards-star' })
  check('...and builds the Starbase when it arrives', build.intents.some((i) => i.kind === 'build-starbase' && i.shipId === conShip.id))
  // The wait for Influence is the named constant (30), the same one the player's rule charges.
  const planAt = (influence: number) => { useResourceStore.getState().setAmount(MARS, 'influence', influence); return expander(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), { ...INITIAL_AI_MEMORY, expansionTarget: 'barnards-star' }).intents.some((i) => i.kind === 'build-starbase') }
  check(`a Starbase waits for ${STARBASE_INFLUENCE_COST} influence (30): one short, it waits`, STARBASE_INFLUENCE_COST === 30 && !planAt(STARBASE_INFLUENCE_COST - 1))
  check('...and goes ahead at exactly the cost', planAt(STARBASE_INFLUENCE_COST))
  useResourceStore.getState().setAmount(MARS, 'influence', 100)
  // Resupply: the Construction Ship is away and empty, the Cargo Ship hauls the kit.
  {
    const ships = useShipStore.getState().ships
    const con = ships.find((s) => s.ownerId === MARS && s.classId === 'construction-ship')!
    const car = ships.find((s) => s.ownerId === MARS && s.classId === 'cargo-ship')!
    const at = (id: string, starId: string, cargo: Record<string, number> = {}) =>
      useShipStore.setState({ ships: useShipStore.getState().ships.map((s) => (s.id === id ? { ...s, cargo: cargo as never, location: { kind: 'star' as const, starId, offset: [0, 0, 0] as [number, number, number] } } : s)) })
    const kit = { alloys: 220 }
    const run = () => expander(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), { ...INITIAL_AI_MEMORY, expansionTarget: 'barnards-star' }).intents
    at(con.id, 'wolf-359') // away, empty
    useShipStore.setState({ ships: useShipStore.getState().ships.map((s) => (s.id === car.id ? { ...s, cargo: {} as never } : s)) })
    check('empty Cargo Ship at the capital loads a kit for it', run().some((i) => i.kind === 'load-cargo' && i.shipId === car.id))
    at(car.id, 'sol', kit)
    check('a loaded Cargo Ship flies to where the Construction Ship waits', run().some((i) => i.kind === 'move-ship' && i.shipId === car.id && i.systemId === 'wolf-359'))
    at(car.id, 'wolf-359', kit)
    check('...and hands the kit over when they meet', run().some((i) => i.kind === 'transfer-cargo' && i.fromShipId === car.id && i.toShipId === con.id))
    useShipStore.setState({ ships: useShipStore.getState().ships.filter((s) => s.id !== car.id) })
    check('with no Cargo Ship, an empty Construction Ship goes home to load', run().some((i) => i.kind === 'move-ship' && i.shipId === con.id && i.bodyName === 'Mars'))
  }
  // A star somebody already claims is not a target.
  check('it will not target its own capital system', pickTargetFor('sol') === false)
  function pickTargetFor(starId: string): boolean {
    const bbx = buildBlackboard(MARS, captureSnapshot(0))
    return expander(bbx, captureSnapshot(0), { ...INITIAL_AI_MEMORY, expansionTarget: starId }).memory?.expansionTarget === starId
  }
}


console.log('\n=== 5. The Admiral ===')
{
  freshWorld()
  declareWarOn(MARS, VENUS, 0)
  spawnExtra(MARS, 'cruiser', 3)
  const attack = admiral(buildBlackboard(MARS, captureSnapshot(1)), captureSnapshot(1), INITIAL_AI_MEMORY)
  check('stronger, it sends the navy at Venus', attack.memory?.targetBody === 'Venus' && attack.intents.filter((i) => i.kind === 'move-ship').every((i) => i.kind === 'move-ship' && i.bodyName === 'Venus') && has(attack.intents, 'move-ship'))

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
  check('an attack on its own world comes first: it defends Luna', has(defend.intents, 'move-ship') && defend.intents.filter((i) => i.kind === 'move-ship').every((i) => i.kind === 'move-ship' && i.bodyName === 'Luna'))

  freshWorld()
  const settled = admiral(buildBlackboard(MARS, captureSnapshot(1)), captureSnapshot(1), INITIAL_AI_MEMORY)
  check('at peace, a starting navy (already one fleet) stays put and has nothing to gather', !has(settled.intents, 'move-ship') && !has(settled.intents, 'merge-fleets'))
  const straggler = useShipStore.getState().ships.find((s) => s.ownerId === MARS && s.classId === 'corvette')!
  useShipStore.getState().splitFleet([straggler.id])
  const home = admiral(buildBlackboard(MARS, captureSnapshot(1)), captureSnapshot(1), INITIAL_AI_MEMORY)
  check('with a warship split off at home, it stays put and gathers itself into one fleet', !has(home.intents, 'move-ship') && has(home.intents, 'merge-fleets'))
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
  let marsArmiesOnVenus = 0
  const seenShips = new Set(useShipStore.getState().ships.map((s) => s.id))
  for (let day = 1; day <= (Number(process.env.AI_STOP) || 1100); day++) {
    if (day % 30 === 0) for (const c of COUNTRIES) applyStrategicIncome(c.id, 1)
    runStrategicAI(day)
    resolveCommsSignals(day)
    resolveShipyards(day)
    marsArmiesOnVenus = Math.max(marsArmiesOnVenus, useArmyStore.getState().armies.filter((a) => a.ownerId === MARS && a.location.kind === 'body' && a.location.bodyName === 'Venus').length)
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
  // Venus is the real Venus now (bodyTopography.ts): its main continent wraps
  // half-way round the planet and its cities are spread along it (the user's
  // choice), so taking all of Venus takes longer than one war lasts — Mars
  // lands and fights for it, and the war ends in a peace.
  check('Mars invaded Venus (landed armies and fought for it)', marsArmiesOnVenus >= 3, `${marsArmiesOnVenus} armies at most`)
  check('...and the war ended in a peace', events.some((e) => e.kind === 'peace-signed' && e.countryIds.includes(MARS) && e.countryIds.includes(VENUS)))
  check('Orion, with no neighbours, stayed at peace', !events.some((e) => e.kind === 'war-declared' && e.countryIds.includes(ORION)))
  check('Lalande (the player here, sharing no system) was left alone', !events.some((e) => e.kind === 'war-declared' && e.countryIds.includes(LALANDE)))
}

console.log('\n=== 8. Headless expansion: AI empires research, survey, haul and build Starbases ===')
{
  const runExpansion = (label: string, grantResearch: boolean, days: number) => {
    freshWorld()
    // Every hull jumps by hyperdrive, and an uncharted jump can lose the ship. The
    // roll is seeded so the run is repeatable (AI_JUMP_SEED tries another), and
    // nothing fights here, so every ship that disappears was lost in hyperspace.
    setJumpRoll(seededStream(JUMP_SEED, `ai-expansion:${label}`))
    const lost: Record<string, number> = {}
    const jumped = { lanes: 0 }
    const stopCounting = useShipStore.subscribe((now, before) => {
      for (const sh of before.ships) if (!now.ships.some((x) => x.id === sh.id)) lost[sh.classId] = (lost[sh.classId] ?? 0) + 1
    })
    const settle = (simDays: number) => {
      for (const s of useShipStore.getState().ships) {
        if (s.order && simDays >= s.order.arrivalSimDays) {
          useShipStore.getState().setShipLocation(s.id, resolveArrivalLocation(s.order.destination, s.id), undefined, true)
        }
      }
    }
    const aiIds = [MARS, VENUS, ORION]
    for (const c of COUNTRIES) seedInfluence(c.id)
    // Starbases that come with the starting map (Earth's pre-built Ring of Heaven
    // over Sol) are not AI expansion — this section only judges the ones the
    // Expander builds, so baseline them out.
    const seeded = new Set(useStarbaseStore.getState().starbases.map((b) => b.id))
    const builtStarbases = () => useStarbaseStore.getState().starbases.filter((b) => !seeded.has(b.id))
    let firstStarbaseDay = -1
    let surveyedBodies = 0
    for (let day = 1; day <= days; day++) {
      if (day % 30 === 0) {
        for (const c of COUNTRIES) {
          applyStrategicIncome(c.id, 1)
          applyInfluenceIncome(c.id, 1)
        }
        // Simple mode's labs feed every nation's tech trees; Complex mode has none.
        if (grantResearch) for (const id of aiIds) {
          useTechStore.getState().grantResearch(id, 'physics', 25)
          useTechStore.getState().grantResearch(id, 'engineering', 25)
        }
      }
      runStrategicAI(day)
      resolveCommsSignals(day)
      resolveShipyards(day)
      settle(day)
      resolveSurvey(day)
      if (firstStarbaseDay < 0 && builtStarbases().length > 0) firstStarbaseDay = day
      if (process.env.AI_TRACE && day % 180 === 0) {
        const sv = useSurveyStore.getState().discovered
        console.log(`    ${label} d${day}: starbases=${useStarbaseStore.getState().starbases.map((b) => `${b.ownerId.slice(0, 5)}@${b.starId}`).join(',') || '-'} surveyed=${aiIds.map((id) => `${id.slice(0, 5)}:${sv[id]?.surveyed.size ?? 0}`).join(' ')} tech=${aiIds.map((id) => [...useTechStore.getState().stateFor(id).researched].filter((t) => !['warp-theory', 'hyperspace-theory'].includes(t)).join('+') || '-').join(' | ')}`)
      }
    }
    const sv = useSurveyStore.getState().discovered
    for (const id of aiIds) surveyedBodies += sv[id]?.surveyed.size ?? 0
    const commandsInFlight = useShipStore.getState().ships.reduce((n, sh) => n + (sh.pendingCommands?.length ?? 0), 0)
    stopCounting()
    setJumpRoll(seededStream(JUMP_SEED, 'ai-test'))
    jumped.lanes = useHyperlaneStore.getState().allLanes().length
    const lostTotal = Object.values(lost).reduce((n, x) => n + x, 0)
    console.log(`    ${label}: ${lostTotal} ship(s) lost in hyperspace over ${days} days${lostTotal ? ` (${Object.entries(lost).map(([c, n]) => `${n} ${c}`).join(', ')})` : ''}; ${jumped.lanes} lane(s) charted`)
    return { firstStarbaseDay, surveyedBodies, starbases: builtStarbases(), commandsInFlight, lostTotal }
  }

  const simple = runExpansion('simple', true, 3000)
  check('with research income, an AI empire surveys other systems', simple.surveyedBodies > 10, `${simple.surveyedBodies} bodies`)
  check('...and ends up with a Starbase of its own building', simple.starbases.length > 0, `first on day ${simple.firstStarbaseDay}: ${simple.starbases.map((b) => `${b.ownerId}@${b.starId}`).join(', ')}`)
  check('...no two empires pile onto the same system', new Set(simple.starbases.map((b) => b.starId)).size === simple.starbases.length, simple.starbases.map((b) => b.starId).join(','))
  check('...never more than the cap per empire', ['imperial-state-of-mars', 'republic-of-venus', 'orion-republic'].every((id) => simple.starbases.filter((b) => b.ownerId === id).length <= AI_MAX_STARBASES))
  check('...each in a system nobody else owned', simple.starbases.every((b) => !systemBodies(b.starId).some((body) => useTerritoryStore.getState().bodyOwner[body])))

  // No research income, but every nation starts with Warp Comms, so orders to
  // ships in other systems arrive in days, not years.
  const complex = runExpansion('complex', false, 1200)
  check('with no research income (Complex mode) nothing is built and nothing breaks', complex.starbases.length === 0)
  check('...yet its science ships explore and survey within a few years (orders cross at warp-comms speed)', complex.surveyedBodies > 0, `${complex.surveyedBodies} bodies surveyed`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
