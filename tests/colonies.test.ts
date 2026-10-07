// Colonies, version 1 (Simple mode): Influence, the Colony Ship, founding a
// micro-colony, patrol ships and becoming a planetary colony.
//
// Run:  npx tsx tests/colonies.test.ts

import { COLONY_FOUNDING_DAYS, COLONY_PATROL_DAYS, COLONY_SHIP_SETTLERS, INFLUENCE_CAP, INFLUENCE_PER_MONTH, MICRO_COLONY_LAND, STARTING_INFLUENCE } from '../src/data/colonyData'
import { usePlayerStore } from '../src/state/playerStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useTechStore } from '../src/state/techStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
import { useArmyStore } from '../src/state/armyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useColonyStore } from '../src/state/colonyStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { groundKeySurface } from '../src/state/defenseStore'
import { canRecruitAt } from '../src/state/armyStore'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { applyShipCommand } from '../src/scene/shipCommands'
import { bodyStarId } from '../src/scene/territory'
import { applyInfluenceIncome, canColonize, embarkSettlers, foundColony, seedInfluence } from '../src/scene/colonies'
import { STARBASE_INFLUENCE_COST } from '../src/data/starbaseData'
import { readFileSync } from 'node:fs'
import { payReparations } from '../src/scene/peace'
import { landForBody } from '../src/scene/bodyLand'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resolveColonies } from '../src/hooks/useColonyResolver'
import { COUNTRIES } from '../src/data/countryData'
import { applyStrategicIncome, seedStrategicResources } from '../src/scene/shipyardLogic'
import { runStrategicAI } from '../src/ai/runStrategicAI'
import { resolveCommsSignals } from '../src/hooks/useCommsResolver'
import { resolveShipyards } from '../src/hooks/useShipyardResolver'
import { settleShips } from '../src/hooks/useShipOrderSettler'
import { resolveSurvey } from '../src/hooks/useSurveyResolver'
import { safeJumps } from './testWarp'

// Not about jump risk: ships always arrive (the roll is tested in tests/warp.test.ts).
safeJumps()

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
const influenceOf = (id: string) => useResourceStore.getState().stateFor(id).amounts.influence ?? 0
const ship = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!

// Every colony needs a finished Starbase of its nation in the system; `fresh`
// gives Mars one in Sol unless told not to.
function fresh(withBase = true) {
  useStarbaseStore.setState({ starbases: withBase ? [{ id: 'sb-sol-mars', starId: 'sol', ownerId: MARS, integrity: 50, readySimDays: 0 }] : [] })
  useGameTimeStore.setState({ simDays: 0 })
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useShipStore.setState({ ships: [] })
  useArmyStore.getState().reset()
  useTerritoryStore.getState().reset()
  useDiplomacyStore.getState().reset()
  useAbstractEconomyStore.getState().reset()
  useColonyStore.setState({ colonies: {} })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useResourceStore.setState({ byCountry: {} })
  seedInfluence(MARS)
  seedInfluence(VENUS)
}
const survey = (id: string, body: string) => useSurveyStore.getState().discover(id, { kind: 'surveyed', bodyName: body }, 0, 0)

console.log('\n=== 1. Influence ===')
{
  fresh()
  check('a nation starts with some Influence, earning a little each month', influenceOf(MARS) === STARTING_INFLUENCE && useResourceStore.getState().stateFor(MARS).monthlyDelta.influence === INFLUENCE_PER_MONTH)
  applyInfluenceIncome(MARS, 3)
  check('...+2 a month', influenceOf(MARS) === STARTING_INFLUENCE + 3 * INFLUENCE_PER_MONTH)
  useResourceStore.getState().setAmount(MARS, 'influence', INFLUENCE_CAP - 1)
  applyInfluenceIncome(MARS, 10)
  check('...never above the cap', influenceOf(MARS) === INFLUENCE_CAP)
  const venusBefore = influenceOf(VENUS)
  payReparations(VENUS, MARS, 0.5)
  check('Influence is never handed over in reparations', influenceOf(VENUS) === venusBefore && influenceOf(MARS) === INFLUENCE_CAP)
}

console.log('\n=== 2. Influence costs: a Starbase 30, a colony nothing ===')
{
  fresh()
  check('a Starbase costs 30 Influence, a named constant', STARBASE_INFLUENCE_COST === 30)
  const strip = (f: string) => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')
  const colonies = strip('src/scene/colonies.ts')
  const rules = colonies.slice(colonies.indexOf('export type ColonizeResult'), colonies.indexOf('export function sendToColonize'))
  const ui = strip('src/scene/ShipColonySection.tsx') + strip('src/scene/BodyOrderMenu.tsx') + strip('src/components/InspectPanel.tsx')
  check('colonizing never reads or charges Influence (rules, menus, panels carry no cost or text)', rules.length > 500 && !/influence/i.test(rules) && !/influence/i.test(ui) && !/colonyCostFor|colonyInfluenceCost|COLONY_COST/.test(colonies + ui))
  check('the AI Expander and the player Starbase rule read the same cost (starbaseInfluenceCostFor, built on the constant)', /starbaseInfluenceCostFor/.test(strip('src/ai/expander.ts')) && /starbaseInfluenceCostFor/.test(strip('src/state/starbaseStore.ts')) && /STARBASE_INFLUENCE_COST/.test(strip('src/scene/starbaseLogic.ts')) && !/influence >= \w*[Cc]olon/.test(strip('src/ai/expander.ts')))
}

console.log('\n=== 3. When a Colony Ship can found a colony ===')
{
  fresh(false)
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
  const reason = (body = 'Titan', anywhere = false) => {
    const r = canColonize(ship(id), body, { anywhere })
    return r.ok ? 'ok' : r.reason
  }
  usePlayerStore.setState({ economyModel: 'complex' })
  check('not in Complex mode', /Simple economy mode/.test(reason()), reason())
  usePlayerStore.setState({ economyModel: 'abstract' })
  // A world of a system the nation holds nothing in needs a survey; one of its own system (Titan,
  // for Mars) is already known (the one survey rule: tests/colonySurvey.test.ts).
  check('not before the world is surveyed', /Survey Barnard b first/.test(reason('Barnard b', true)) && !/Survey/.test(reason()), reason('Barnard b', true))
  survey(MARS, 'Titan')
  // Abroad the Starbase rule holds; the nation's own home system (Sol, for Mars) needs none.
  survey(MARS, 'Barnard b')
  check('abroad: not without a Starbase of your own in the system', /Needs a Starbase of your own in Barnard/.test(reason('Barnard b', true)), reason('Barnard b', true))
  useStarbaseStore.setState({ starbases: [{ id: 'sb-barnard-venus', starId: 'barnards-star', ownerId: VENUS, integrity: 50, readySimDays: 0 }] })
  check("...someone else's won't do", /Needs a Starbase of your own/.test(reason('Barnard b', true)), reason('Barnard b', true))
  useStarbaseStore.setState({ starbases: [{ id: 'sb-barnard-mars', starId: 'barnards-star', ownerId: MARS, integrity: 50, readySimDays: 5 }] })
  check('...nor one still being built', /Needs a Starbase of your own/.test(reason('Barnard b', true)), reason('Barnard b', true))
  useStarbaseStore.setState({ starbases: [{ id: 'sb-barnard-mars', starId: 'barnards-star', ownerId: MARS, integrity: 50, readySimDays: 0 }] })
  check('...a finished one of its own does', !/Starbase/.test(reason('Barnard b', true)), reason('Barnard b', true))
  useStarbaseStore.setState({ starbases: [] })
  check('in the home system no Starbase is needed', !/Starbase/.test(reason()), reason())
  useStarbaseStore.setState({ starbases: [{ id: 'sb-sol-mars', starId: 'sol', ownerId: MARS, integrity: 50, readySimDays: 0 }] })
  check('not with no settlers aboard', /no settlers/.test(reason()), reason())
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  useResourceStore.getState().setAmount(MARS, 'influence', 0)
  check('with no Influence at all it can still colonize (it costs none)', reason() === 'ok', reason())
  useResourceStore.getState().setAmount(MARS, 'influence', STARTING_INFLUENCE)
  survey(MARS, 'Mercury')
  check('not from another orbit', /must be in orbit of Mercury/.test(reason('Mercury')), reason('Mercury'))
  check('...unless the order flies it there first', reason('Mercury', true) === 'ok' || /influence/.test(reason('Mercury', true)), reason('Mercury', true))
  survey(MARS, 'Mars')
  check('not on a world already held', /You already hold Mars/.test(reason('Mars', true)), reason('Mars', true))
  survey(MARS, 'Venus')
  check("...or someone else's", /Republic of Venus already holds Venus/.test(reason('Venus', true)), reason('Venus', true))
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  const foe = spawnOwnedShip('cruiser', VENUS, 'sol', 'Titan')!
  check('not while enemy warships hold the orbit', /Enemy warships hold the orbit/.test(reason()), reason())
  useShipStore.getState().removeShip(foe)
  const overSaturn = spawnOwnedShip('cruiser', VENUS, 'sol', 'Saturn')!
  check('otherwise, yes: a ship orbiting Titan can settle it (an enemy over Saturn is another orbit)', reason() === 'ok', reason())
  useShipStore.getState().removeShip(overSaturn)
  const saturnShip = spawnOwnedShip('colony-ship', MARS, 'sol', 'Saturn')!
  useShipStore.getState().setSettlers(saturnShip, COLONY_SHIP_SETTLERS)
  const fromSaturn = canColonize(ship(saturnShip), 'Titan')
  check('a moon has its own orbit: a ship over Saturn cannot settle Titan', !fromSaturn.ok && /must be in orbit of Titan/.test(fromSaturn.reason), JSON.stringify(fromSaturn))
  useShipStore.getState().removeShip(saturnShip)
}

console.log('\n=== 4. Founding a micro-colony ===')
{
  fresh()
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  survey(MARS, 'Titan')
  applyShipCommand(id, { kind: 'colonize', bodyName: 'Titan' }, 10)
  check('the order starts the founding; no colony yet', ship(id).founding?.bodyName === 'Titan' && !useColonyStore.getState().colonies['Titan'] && !useTerritoryStore.getState().bodyOwner['Titan'])
  resolveColonies(10 + COLONY_FOUNDING_DAYS - 1)
  check(`...still none a day short of ${COLONY_FOUNDING_DAYS} days`, !useColonyStore.getState().colonies['Titan'] && influenceOf(MARS) === STARTING_INFLUENCE)
  resolveColonies(10 + COLONY_FOUNDING_DAYS)
  const colony = useColonyStore.getState().colonies['Titan']
  const world = useAbstractEconomyStore.getState().worlds['Titan']
  check('Titan is now Mars\'s', useTerritoryStore.getState().bodyOwner['Titan'] === MARS)
  check('...a micro-colony', colony?.stage === 'micro')
  check('...with an economy world of its settlers and a small land limit', world?.population === COLONY_SHIP_SETTLERS && world.land === Math.min(landForBody('Titan'), MICRO_COLONY_LAND), JSON.stringify(world))
  check('...and no Influence is charged', influenceOf(MARS) === STARTING_INFLUENCE)
  check('...the ship is used up', !useShipStore.getState().ships.some((s) => s.id === id))
  const keys = groundKeySurface('Titan')?.keySlots ?? []
  check('...its planetary outpost is a key node on the ground map', keys.some((k) => k.kind === 'outpost' && k.node === colony?.outpostNode))
  check('...held by a garrison', useArmyStore.getState().armies.some((a) => a.ownerId === MARS && a.kind === 'garrison' && a.location.kind === 'body' && a.location.bodyName === 'Titan'))
  check('...and the founding is logged', useDiplomacyStore.getState().events.some((e) => e.kind === 'colony-founded'))
  check('a micro-colony cannot raise armies', !canRecruitAt(MARS, 'Titan').ok && /micro-colony/.test((canRecruitAt(MARS, 'Titan') as { reason: string }).reason))
  check('a second Colony Ship cannot found another on the same world', (() => {
    const other = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
    useShipStore.getState().setSettlers(other, COLONY_SHIP_SETTLERS)
    return !foundColony(other, 'Titan', 11)
  })())
}

{
  // Founding is abandoned when the ship leaves or enemy warships take the orbit.
  fresh()
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  survey(MARS, 'Titan')
  applyShipCommand(id, { kind: 'colonize', bodyName: 'Titan' }, 0)
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  const raider = spawnOwnedShip('cruiser', VENUS, 'sol', 'Titan')!
  resolveColonies(20)
  check('enemy warships in orbit abandon the founding, and say why', !ship(id).founding && useDiplomacyStore.getState().events.some((e) => e.kind === 'colony-abandoned' && /Enemy warships/.test(e.text)))
  useShipStore.getState().removeShip(raider)
  applyShipCommand(id, { kind: 'colonize', bodyName: 'Titan' }, 30)
  useShipStore.getState().setShipLocation(id, { kind: 'orbiting', systemId: 'sol', bodyName: 'Saturn', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 })
  check('a manual order ends it too', !ship(id).founding)
  resolveColonies(30 + COLONY_FOUNDING_DAYS)
  check('...and no colony comes of it', !useColonyStore.getState().colonies['Titan'])
}

console.log('\n=== 5. Settlers come from the capital ===')
{
  fresh()
  const before = useAbstractEconomyStore.getState().worlds['Mars'].population
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Mars')!
  embarkSettlers(id, MARS)
  check('a new Colony Ship takes its settlers out of the capital\'s population', ship(id).settlers === COLONY_SHIP_SETTLERS && Math.abs(useAbstractEconomyStore.getState().worlds['Mars'].population - (before - COLONY_SHIP_SETTLERS)) < 1e-9)
  const cruiser = spawnOwnedShip('cruiser', MARS, 'sol', 'Mars')!
  embarkSettlers(cruiser, MARS)
  check('...other hulls take nobody', ship(cruiser).settlers === undefined)
}

console.log('\n=== 6. Patrol ships make it a planetary colony ===')
{
  fresh()
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  survey(MARS, 'Titan')
  foundColony(id, 'Titan', 0)
  const stage = () => useColonyStore.getState().colonies['Titan'].stage
  const overSaturn = spawnOwnedShip('corvette', MARS, 'sol', 'Saturn')!
  useShipStore.getState().setPatrol(overSaturn, true)
  resolveColonies(5)
  check("a patrol over Saturn does not hold Titan's orbit", useColonyStore.getState().colonies['Titan'].orbitSecureSinceSimDays === null)
  useShipStore.getState().removeShip(overSaturn)
  const guard = spawnOwnedShip('corvette', MARS, 'sol', 'Titan')!
  resolveColonies(10)
  check('a warship merely orbiting is not a patrol', useColonyStore.getState().colonies['Titan'].orbitSecureSinceSimDays === null)
  useShipStore.getState().setPatrol(guard, true)
  resolveColonies(10)
  check('a patrol ship starts the clock', useColonyStore.getState().colonies['Titan'].orbitSecureSinceSimDays === 10)
  resolveColonies(10 + COLONY_PATROL_DAYS - 1)
  check('a day short, it is still a micro-colony', stage() === 'micro')
  resolveColonies(10 + COLONY_PATROL_DAYS)
  check(`after ${COLONY_PATROL_DAYS} days of patrol it becomes a planetary colony`, stage() === 'planetary')
  check('...its land limit lifted', useAbstractEconomyStore.getState().worlds['Titan'].land === landForBody('Titan'))
  check('...it can raise armies now', canRecruitAt(MARS, 'Titan').ok)
  check('...and it is logged', useDiplomacyStore.getState().events.some((e) => e.kind === 'colony-promoted'))

  // A hostile warship resets the clock; a hostile army on the ground holds it back.
  useColonyStore.getState().setColonies({ ...useColonyStore.getState().colonies, Titan: { ...useColonyStore.getState().colonies['Titan'], stage: 'micro', orbitSecureSinceSimDays: 200 } })
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  const raider = spawnOwnedShip('corvette', VENUS, 'sol', 'Titan')!
  resolveColonies(250)
  check('a hostile warship in orbit resets the patrol clock', useColonyStore.getState().colonies['Titan'].orbitSecureSinceSimDays === null)
  useShipStore.getState().removeShip(raider)
  resolveColonies(300)
  useArmyStore.getState().addArmy({ ownerId: VENUS, kind: 'assault', location: { kind: 'body', bodyName: 'Titan' } })
  resolveColonies(300 + COLONY_PATROL_DAYS + 10)
  check('a hostile army on the ground keeps it a micro-colony, however long the patrol', stage() === 'micro')
}

console.log('\n=== 7. The starting worlds are colonies, and colonies follow their world ===')
{
  fresh()
  setUpNewGame()
  const colonies = useColonyStore.getState().colonies
  const owned = Object.keys(useTerritoryStore.getState().bodyOwner)
  check('every world owned at the start is a planetary colony', owned.length > 0 && owned.every((b) => colonies[b]?.stage === 'planetary'), owned.filter((b) => !colonies[b]).join(','))
  check('...each with a planetary outpost on its ground map', owned.every((b) => (groundKeySurface(b)?.keySlots ?? []).some((k) => k.node === colonies[b].outpostNode)))
  useTerritoryStore.getState().cedeBody('Luna', VENUS)
  check('ceding a world by treaty hands its colony over with it', useColonyStore.getState().colonies['Luna'] && useTerritoryStore.getState().bodyOwner['Luna'] === VENUS)
}

console.log('\n=== 8. AI empires colonize and patrol by the same rules (headless, Simple mode) ===')
{
  fresh()
  const LALANDE = 'kingdom-of-lalande'
  usePlayerStore.setState({ selectedCountryId: LALANDE })
  setUpNewGame()
  for (const c of COUNTRIES) {
    seedStrategicResources(c.id)
    seedInfluence(c.id)
  }
  useStarbaseStore.setState({ starbases: [] })
  let firstColony: { day: number; body: string } | null = null
  let patrolSeen = false
  for (let day = 1; day <= 3000; day++) {
    useGameTimeStore.setState({ simDays: day })
    if (day % 30 === 0) for (const c of COUNTRIES) {
      applyStrategicIncome(c.id, 1)
      applyInfluenceIncome(c.id, 1)
      // Roughly the starting research rate (Simple mode's labs; no economy runs here).
      useTechStore.getState().grantResearch(c.id, 'physics', 5)
      useTechStore.getState().grantResearch(c.id, 'engineering', 2.5)
    }
    runStrategicAI(day)
    resolveCommsSignals(day)
    resolveShipyards(day)
    settleShips(day)
    resolveSurvey(day)
    resolveColonies(day)
    const founded = useDiplomacyStore.getState().events.find((e) => e.kind === 'colony-founded')
    if (!firstColony && founded) firstColony = { day, body: founded.text.split(' on ').pop()! }
    if (useShipStore.getState().ships.some((s) => s.patrol && s.ownerId !== LALANDE)) patrolSeen = true
    if (firstColony && useColonyStore.getState().colonies[firstColony.body]?.stage === 'planetary') break
  }
  const colony = firstColony ? useColonyStore.getState().colonies[firstColony.body] : undefined
  const owner = firstColony ? useTerritoryStore.getState().bodyOwner[firstColony.body] : undefined
  check('...only where it has a Starbase (or in its own home system)', !!firstColony && useStarbaseStore.getState().starbases.some((sb) => sb.ownerId === owner && sb.starId === bodyStarId(firstColony!.body)) || bodyStarId(firstColony!.body) === COUNTRIES.find((c) => c.id === owner)?.capitalStarId)
  check('an AI empire builds a Colony Ship and founds a colony', !!firstColony && !!owner && owner !== LALANDE, JSON.stringify(firstColony) + ' by ' + owner)
  check('...puts a warship on patrol there', patrolSeen)
  check('...and the colony becomes planetary', colony?.stage === 'planetary', colony?.stage)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
