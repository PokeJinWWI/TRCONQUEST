// Colonies, version 1 (Simple mode): Influence, the Colony Ship, founding a
// micro-colony, patrol ships and becoming a planetary colony.
//
// Run:  npx tsx tests/colonies.test.ts

import { COLONY_PATROL_DAYS, COLONY_SHIP_SETTLERS, INFLUENCE_CAP, INFLUENCE_PER_MONTH, MICRO_COLONY_LAND, STARTING_INFLUENCE } from '../src/data/colonyData'
import { usePlayerStore } from '../src/state/playerStore'
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
import { applyInfluenceIncome, canColonize, colonyCostFor, embarkSettlers, foundColony, seedInfluence } from '../src/scene/colonies'
import { colonyInfluenceCost } from '../src/scene/colonyLogic'
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

function fresh() {
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

console.log('\n=== 2. What a colony costs ===')
{
  fresh()
  check('a big world costs more than a small moon', colonyCostFor(MARS, 'Earth') > colonyCostFor(MARS, 'Phobos'), `Earth ${colonyCostFor(MARS, 'Earth')}, Phobos ${colonyCostFor(MARS, 'Phobos')}`)
  check('the same world costs more from farther away', colonyInfluenceCost('Titan', 'sol', 'alpha-centauri') > colonyInfluenceCost('Titan', 'sol', 'sol'))
  check('never more than the Influence cap', colonyInfluenceCost('Jupiter', 'sol', 'lalande-21185') <= INFLUENCE_CAP)
}

console.log('\n=== 3. When a Colony Ship can found a colony ===')
{
  fresh()
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Saturn')!
  const reason = (body = 'Titan', anywhere = false) => {
    const r = canColonize(ship(id), body, { anywhere })
    return r.ok ? 'ok' : r.reason
  }
  usePlayerStore.setState({ economyModel: 'complex' })
  check('not in Complex mode', /Simple economy mode/.test(reason()), reason())
  usePlayerStore.setState({ economyModel: 'abstract' })
  check('not before the world is surveyed', /Survey Titan first/.test(reason()), reason())
  survey(MARS, 'Titan')
  check('not with no settlers aboard', /no settlers/.test(reason()), reason())
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  useResourceStore.getState().setAmount(MARS, 'influence', 0)
  check('not without the Influence, saying how much', new RegExp(`Needs ${colonyCostFor(MARS, 'Titan')} influence`).test(reason()), reason())
  useResourceStore.getState().setAmount(MARS, 'influence', STARTING_INFLUENCE)
  survey(MARS, 'Earth')
  check('not from another orbit', /must be in orbit of Earth/.test(reason('Earth')), reason('Earth'))
  check('...unless the order flies it there first', reason('Earth', true) === 'ok' || /influence/.test(reason('Earth', true)), reason('Earth', true))
  survey(MARS, 'Mars')
  check('not on a world already held', /You already hold Mars/.test(reason('Mars', true)), reason('Mars', true))
  survey(MARS, 'Venus')
  check("...or someone else's", /Republic of Venus already holds Venus/.test(reason('Venus', true)), reason('Venus', true))
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  const foe = spawnOwnedShip('cruiser', VENUS, 'sol', 'Saturn')!
  check('not while enemy warships hold the orbit', /Enemy warships hold the orbit/.test(reason()), reason())
  useShipStore.getState().removeShip(foe)
  check('otherwise, yes: a ship over Saturn can settle its moon Titan (a moon\'s orbit is its planet\'s)', reason() === 'ok', reason())
}

console.log('\n=== 4. Founding a micro-colony ===')
{
  fresh()
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Saturn')!
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  survey(MARS, 'Titan')
  const cost = colonyCostFor(MARS, 'Titan')
  applyShipCommand(id, { kind: 'colonize', bodyName: 'Titan' }, 10)
  const colony = useColonyStore.getState().colonies['Titan']
  const world = useAbstractEconomyStore.getState().worlds['Titan']
  check('Titan is now Mars\'s', useTerritoryStore.getState().bodyOwner['Titan'] === MARS)
  check('...a micro-colony', colony?.stage === 'micro')
  check('...with an economy world of its settlers and a small land limit', world?.population === COLONY_SHIP_SETTLERS && world.land === Math.min(landForBody('Titan'), MICRO_COLONY_LAND), JSON.stringify(world))
  check('...paid for in Influence', influenceOf(MARS) === STARTING_INFLUENCE - cost)
  check('...the ship is used up', !useShipStore.getState().ships.some((s) => s.id === id))
  const keys = groundKeySurface('Titan')?.keySlots ?? []
  check('...its planetary outpost is a key node on the ground map', keys.some((k) => k.kind === 'outpost' && k.node === colony?.outpostNode))
  check('...held by a garrison', useArmyStore.getState().armies.some((a) => a.ownerId === MARS && a.kind === 'garrison' && a.location.kind === 'body' && a.location.bodyName === 'Titan'))
  check('...and the founding is logged', useDiplomacyStore.getState().events.some((e) => e.kind === 'colony-founded'))
  check('a micro-colony cannot raise armies', !canRecruitAt(MARS, 'Titan').ok && /micro-colony/.test((canRecruitAt(MARS, 'Titan') as { reason: string }).reason))
  check('a second Colony Ship cannot found another on the same world', (() => {
    const other = spawnOwnedShip('colony-ship', MARS, 'sol', 'Saturn')!
    useShipStore.getState().setSettlers(other, COLONY_SHIP_SETTLERS)
    return !foundColony(other, 'Titan', 11)
  })())
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
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Saturn')!
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  survey(MARS, 'Titan')
  foundColony(id, 'Titan', 0)
  const stage = () => useColonyStore.getState().colonies['Titan'].stage
  const guard = spawnOwnedShip('corvette', MARS, 'sol', 'Saturn')!
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
  const raider = spawnOwnedShip('corvette', VENUS, 'sol', 'Saturn')!
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
  let firstColony: { day: number; body: string } | null = null
  let patrolSeen = false
  for (let day = 1; day <= 1500; day++) {
    if (day % 30 === 0) for (const c of COUNTRIES) {
      applyStrategicIncome(c.id, 1)
      applyInfluenceIncome(c.id, 1)
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
  check('an AI empire builds a Colony Ship and founds a colony', !!firstColony && !!owner && owner !== LALANDE, JSON.stringify(firstColony) + ' by ' + owner)
  check('...puts a warship on patrol there', patrolSeen)
  check('...and the colony becomes planetary', colony?.stage === 'planetary', colony?.stage)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
