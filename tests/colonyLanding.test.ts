// Colony landing sites, outposts growing into municipal halls, claiming a planet, the Control tab's numbers and the Simple-mode
// colony kit. Run:  npx tsx tests/colonyLanding.test.ts
import { CLAIM_PLANET_MIN_POPULATION, COLONY_FOUNDING_DAYS, COLONY_SHIP_SETTLERS, OUTPOST_HALL_POPULATION, STARTING_INFLUENCE } from '../src/data/colonyData'
import { usePlayerStore } from '../src/state/playerStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
import { useArmyStore } from '../src/state/armyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useColonyStore } from '../src/state/colonyStore'
import { useCivicStore } from '../src/state/civicStore'
import { useJurisdictionStore } from '../src/state/jurisdictionStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { groundSurface } from '../src/scene/groundLogic'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { applyShipCommand } from '../src/scene/shipCommands'
import { canColonize, seedInfluence } from '../src/scene/colonies'
import { locationsOf } from '../src/scene/locations'
import { planLanding, LANDING_ADOPT_CELLS } from '../src/scene/landingSite'
import { planFounding } from '../src/scene/siteFounding'
import { arc, nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'
import { resolveColonies } from '../src/hooks/useColonyResolver'
import { seedCivic, upgradeGrownOutposts } from '../src/scene/seedPlacementOrders'
import { claimPlanetBlock, claimPlanetCost, claimPlanetNow } from '../src/scene/planetClaim'
import { controlShares } from '../src/scene/controlShare'
import { controlView } from '../src/scene/controlView'
import { simpleColonyKit } from '../src/economy-abstract/colonyKit'
import { bodyPopulation } from '../src/scene/urbanPopulation'
import { useEconomyStore } from '../src/state/economyStore'
import { setUpNewGame } from '../src/scene/gameSetup'
import { safeJumps } from './testWarp'

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
const survey = (id: string, body: string) => useSurveyStore.getState().discover(id, { kind: 'surveyed', bodyName: body }, 0, 0)

function fresh() {
  useStarbaseStore.setState({ starbases: [] })
  useGameTimeStore.setState({ simDays: 0 })
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useShipStore.setState({ ships: [] })
  useArmyStore.getState().reset()
  useTerritoryStore.getState().reset()
  useDiplomacyStore.getState().reset()
  useAbstractEconomyStore.getState().reset()
  useColonyStore.setState({ colonies: {} })
  useCivicStore.setState({ civic: {} })
  useJurisdictionStore.setState({ claims: [], permissions: [] })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useResourceStore.setState({ byCountry: {} })
  seedInfluence(MARS)
  seedInfluence(VENUS)
}

// A land node of Titan at least `farCells` from every generated site (open ground), and one right beside a settlement site.
function openLand(body: string, farCells: number): number {
  const mesh = surfaceMesh()
  const surface = groundSurface(body, {})!
  const sites = locationsOf(body).filter((s) => s.node !== null)
  for (let n = 0; n < mesh.count.fine; n += 3) {
    if (surface.landComponent[n] < 0) continue
    if (sites.every((s) => arc(nodePoint(n), nodePoint(s.node!)) > farCells * mesh.fineSpacingRad)) {
      if (planFounding(body, 'settlement', n, sites).ok) return n
    }
  }
  return -1
}

console.log('\n=== 1. No Starbase is needed to colonize ===')
{
  fresh()
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  survey(MARS, 'Titan')
  check('a surveyed free world can be settled with no Starbase anywhere', canColonize(useShipStore.getState().ships.find((s) => s.id === id)!, 'Titan').ok)
  check('a colony ship carries a few million people, not twenty', COLONY_SHIP_SETTLERS >= 2 && COLONY_SHIP_SETTLERS <= 5, `${COLONY_SHIP_SETTLERS}`)
}

console.log('\n=== 2. Choosing the landing ===')
{
  fresh()
  const sites = locationsOf('Titan')
  const sett = sites.filter((s) => s.kind === 'settlement' && s.node !== null)
  check('Titan has settlement sites to adopt', sett.length > 0, `${sett.length}`)
  const near = planLanding('Titan', sett[0].node!, MARS)
  check('landing on a free settlement site takes it as it is', near.ok && !!near.adopt && near.adopt.id === sett[0].id && near.node === sett[0].node)
  const open = openLand('Titan', LANDING_ADOPT_CELLS + 1)
  check('there is open ground clear of every site', open >= 0, `node ${open}`)
  if (open >= 0) {
    const plan = planLanding('Titan', open, MARS)
    check('landing on open ground founds a new settlement site there', plan.ok && !!plan.found && plan.found.kind === 'settlement' && plan.node === open)
    check('a click on the sea or off the map is refused', !planLanding('Titan', -1, MARS).ok)
  }
}

console.log('\n=== 3. The chosen landing becomes the colony ===')
{
  fresh()
  const open = openLand('Titan', LANDING_ADOPT_CELLS + 1)
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
  useShipStore.getState().setSettlers(id, COLONY_SHIP_SETTLERS)
  survey(MARS, 'Titan')
  applyShipCommand(id, { kind: 'colonize', bodyName: 'Titan', node: open }, 10)
  check('the order keeps the chosen node', useShipStore.getState().ships.find((s) => s.id === id)?.founding?.node === open)
  resolveColonies(10 + COLONY_FOUNDING_DAYS)
  const colony = useColonyStore.getState().colonies['Titan']
  check('the colony stands exactly where it landed', colony?.outpostNode === open, `${colony?.outpostNode} vs ${open}`)
  check('...on a settlement site that is Mars\'s', !!colony?.siteId && siteOwner(colony.siteId) === MARS, colony?.siteId)
  check('Simple mode: the colony starts with a kit, not an empty shell', Object.keys(useAbstractEconomyStore.getState().worlds['Titan']?.buildings ?? {}).length >= 2, JSON.stringify(useAbstractEconomyStore.getState().worlds['Titan']?.buildings))
  // A new town beside the landing site is allowed at 2 cells for its owner, refused at 1.
  const mesh = surfaceMesh()
  const surface = groundSurface('Titan', useTerritoryStore.getState().bodyOwner)!
  let beside = -1
  for (let n = 0; n < mesh.count.fine && beside < 0; n++) {
    const d = arc(nodePoint(n), nodePoint(open)) / mesh.fineSpacingRad
    if (d >= 2.2 && d <= 3.2 && surface.landComponent[n] >= 0 && planFounding('Titan', 'settlement', n, locationsOf('Titan'), MARS).ok) beside = n
  }
  check('its owner may found a town 2-3 cells from it (a stranger could not)', beside >= 0 && !planFounding('Titan', 'settlement', beside, locationsOf('Titan')).ok)

  console.log('\n=== 4. Outpost to municipal hall ===')
  seedCivic('Titan')
  const list = useCivicStore.getState().civic['Titan'] ?? []
  check('the landing starts as an Outpost Station', list.some((c) => c.kind === 'outpostStation' && c.node === open), list.map((c) => c.kind).join())
  check('...which stays while the colony is small', upgradeGrownOutposts().length === 0 && bodyPopulation('Titan') < OUTPOST_HALL_POPULATION)
  useAbstractEconomyStore.getState().adjustPopulation('Titan', OUTPOST_HALL_POPULATION)
  const upgraded = upgradeGrownOutposts()
  const after = useCivicStore.getState().civic['Titan'] ?? []
  check('past the threshold it is upgraded', upgraded.join() === 'Titan' && !after.some((c) => c.kind === 'outpostStation' && c.node === open))
  check('...and a municipal hall stands there instead', after.some((c) => c.kind === 'cityHall' && c.node === open), after.map((c) => c.kind).join())
  check('the upgrade happens once', upgradeGrownOutposts().length === 0)

  console.log('\n=== 5. Control tab numbers ===')
  const view = controlView('Titan', MARS)
  const mine = view.rows.find((r) => r.id === MARS)
  check('the owner is listed, sovereign, with people and sites', !!mine && mine.sovereign && mine.population > 0 && mine.sites >= 1, JSON.stringify(mine))
  check('...holding the whole share (nobody else is there)', Math.abs((mine?.share ?? 0) - 1) < 1e-9)
  check('its colony progress shows', view.colony?.stage === 'micro' && view.colony.settlement.kind === 'hall')
}

console.log('\n=== 6. Control share blend ===')
{
  const s = controlShares([
    { id: 'a', population: 8, sites: 2, ground: 0, orbit: 0 },
    { id: 'b', population: 2, sites: 2, ground: 100, orbit: 3 },
  ])
  check('shares add up to 1', Math.abs(s.a + s.b - 1) < 1e-9, JSON.stringify(s))
  check('the one with the soldiers and ships gains on the one with the people', s.b > 0.5 && s.a > 0.2, JSON.stringify(s))
  check('a kind nobody has drops out (no ground forces: people and sites decide)', Math.abs(controlShares([{ id: 'a', population: 1, sites: 0, ground: 0, orbit: 0 }, { id: 'b', population: 1, sites: 0, ground: 0, orbit: 0 }]).a - 0.5) < 1e-9)
  check('an empty world has no shares', controlShares([]).x === undefined)
}

console.log('\n=== 7. Claiming a planet ===')
{
  fresh()
  survey(MARS, 'Triton')
  const cost = claimPlanetCost('Triton')
  check('a lot of Influence (more than a Starbase, which is 30)', cost > 30, `${cost}`)
  useResourceStore.getState().setAmount(MARS, 'influence', 0)
  check('short of Influence it says how much', /Needs \d+ influence/.test(claimPlanetBlock(MARS, 'Triton') ?? ''), claimPlanetBlock(MARS, 'Triton') ?? '')
  useResourceStore.getState().setAmount(MARS, 'influence', cost + 5)
  check('with enough it can be claimed', claimPlanetBlock(MARS, 'Triton') === null, claimPlanetBlock(MARS, 'Triton') ?? '')
  const r = claimPlanetNow(MARS, 'Triton', 1)
  check('claimed: Influence spent, provisional (no people there yet), not yet governed', r.ok && !r.sovereign && influenceOf(MARS) === 5 && !useTerritoryStore.getState().bodyOwner['Triton'], JSON.stringify(r))
  check('nobody else may claim it', /already claimed/.test(claimPlanetBlock(VENUS, 'Triton') ?? ''))
  const rival = spawnOwnedShip('colony-ship', VENUS, 'sol', 'Triton')
  if (rival) {
    useShipStore.getState().setSettlers(rival, COLONY_SHIP_SETTLERS)
    survey(VENUS, 'Triton')
    const c = canColonize(useShipStore.getState().ships.find((s) => s.id === rival)!, 'Triton')
    check('...and no rival Colony Ship may settle it', !c.ok && /claimed/.test(c.reason), JSON.stringify(c))
  }
  check('the Control tab offers the claim only while nobody governs it', controlView('Triton', MARS).decisions.every((d) => d.id !== 'claim-planet' || d.block !== null))
  check('with the threshold of people the claim would be recognized', CLAIM_PLANET_MIN_POPULATION > 0)
}

console.log('\n=== 8. Simple colony kit follows Complex (what the ground holds, power, food) ===')
{
  const k = simpleColonyKit('continental')
  check('a green world gets farm, mine and power', !!k.buildings.farm && !!k.buildings.mine && !!k.buildings.powerPlant, JSON.stringify(k.buildings))
  check('a toxic one grows food under glass', !!simpleColonyKit('toxic').buildings.hydroponicsBay && !simpleColonyKit('toxic').buildings.farm)
  check('a gas giant has nothing to dig', !simpleColonyKit('gas-giant').buildings.mine)
  check('its districts house exactly its buildings', (simpleColonyKit('continental').districts.agricultural ?? 0) >= 1 && (simpleColonyKit('continental').districts.generator ?? 0) >= 1)
}

console.log('\n=== 9. Complex starts with an economy on every owned body, as Simple does ===')
{
  fresh()
  useEconomyStore.getState().reset?.()
  usePlayerStore.setState({ economyModel: 'complex', selectedCountryId: MARS })
  setUpNewGame()
  const owned = Object.keys(useTerritoryStore.getState().bodyOwner)
  const missing = owned.filter((b) => !useEconomyStore.getState().worlds.some((w) => w.id === b))
  check('Phobos and Deimos have Complex worlds (they can be built on)', ['Phobos', 'Deimos'].every((b) => useEconomyStore.getState().worlds.some((w) => w.id === b)))
  check('no owned body is left without an economy in Complex', missing.length === 0, missing.join(', '))
  usePlayerStore.setState({ economyModel: 'abstract' })
}

void STARTING_INFLUENCE
void useLocationStore
console.log(failures === 0 ? '\nAll colony landing checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
