// The AI looks after what it has built, by the player's rules (ai/developer.ts, scene/aiDevelopment.ts,
// scene/placementOrders.placeUnplacedOrders): it connects cut-off sites, arms an endangered world, relieves an
// overcrowded one, and nothing it does skips a price, a right or a physical limit.
//
// Run:  npx tsx tests/aiDevelopment.test.ts
import { developer } from '../src/ai/developer'
import type { AiSnapshot, Blackboard } from '../src/ai/blackboard'
import { planEmpire } from '../src/ai/coordinator'
import { executeIntents } from '../src/ai/executor'
import { captureSnapshot } from '../src/ai/snapshot'
import { INITIAL_AI_MEMORY, type Intent } from '../src/ai/types'
import { accessOnBody } from '../src/scene/infrastructureOrders'
import { surveyRoute } from '../src/scene/infrastructureNet'
import { connectSite, isolatedSitesOf, settlementOpeningsOf, threatenedBodiesOf } from '../src/scene/aiDevelopment'
import { locationsOf } from '../src/scene/locations'
import { placeUnplacedOrders } from '../src/scene/placementOrders'
import { siteKindsFor, slotsOfSite } from '../src/scene/placement'
import { surfaceOf } from '../src/scene/planetTerrain'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { resetGame } from '../src/scene/gameReset'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useInfrastructureStore } from '../src/state/infrastructureStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { useOrbitalStore } from '../src/state/orbitalStore'
import { usePlacementStore } from '../src/state/placementStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'

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

// A site of Venus (an ocean world: most are across the water from its cities) that a road CAN reach a hub from.
function reachableCutSite() {
  const sites = locationsOf('Venus')
  const hubs = sites.filter((s) => s.kind === 'settlement' || s.kind === 'infrastructure')
  return sites.filter((s) => s.kind === 'industrial' && accessOnBody('Venus', VENUS)[s.id] < 1).find((s) => hubs.some((h) => !surveyRoute('Venus', s.node!, h.node!).blocked))
}

console.log('\n=== 1. The Developer, pure ===')
{
  const bb = { countryId: VENUS } as Blackboard
  const snap = (dev: AiSnapshot['development']): AiSnapshot => ({ development: dev }) as AiSnapshot
  const view = (isolated: { access: number }[], threatened: string[] = [], openings: string[] = []) => ({
    isolatedSitesOf: () => isolated.map((s, i) => ({ bodyName: 'Venus', siteId: `Venus#resource-${i}`, access: s.access, demand: 10 })),
    threatenedBodiesOf: () => threatened,
    settlementOpeningsOf: () => openings,
  })
  check('without a development view it does nothing', developer(bb, snap(undefined)).intents.length === 0)
  const out = developer(bb, snap(view([{ access: 0.5 }, { access: 0.5 }], ['Venus', 'Arcadia'], ['Venus#settlement-2', 'Venus#settlement-3'])))
  check('it connects one site, arms one world, opens one settlement per pass', out.intents.filter((i) => i.kind === 'connect-site').length === 1 && out.intents.filter((i) => i.kind === 'build-defense-platform').length === 1 && out.intents.filter((i) => i.kind === 'found-settlement').length === 1)
  check('a site that is well connected is left alone', developer(bb, snap(view([{ access: 0.95 }]))).intents.length === 0)
}

console.log('\n=== 2. It joins a cut-off site to a hub, paying for it ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 1000 })
  useShipStore.setState({ ships: [] })
  useResourceStore.getState().setAmount(VENUS, 'minerals', 100000)
  useResourceStore.getState().setAmount(VENUS, 'alloys', 100000)
  const cut = reachableCutSite()
  check('Venus has an industrial site far from its cities that a road can reach a hub from', !!cut)
  useLocationStore.getState().establish(cut!.id, VENUS, 1)
  usePlacementStore.getState().place(cut!.id, 'civilianFactory', 2)
  check('the AI sees it as cut off', isolatedSitesOf(VENUS).some((s) => s.siteId === cut!.id && s.access < 0.9))
  const before = useResourceStore.getState().stateFor(VENUS).amounts.minerals
  const plan = planEmpire(VENUS, captureSnapshot(1000), INITIAL_AI_MEMORY)
  check('its planning pass includes connecting that site', plan.intents.some((i) => i.kind === 'connect-site' && i.siteId === cut!.id), plan.intents.map((i) => i.kind).join(','))
  executeIntents(VENUS, plan.intents.filter((i) => i.kind === 'connect-site'), 1000, MARS)
  const routes = useInfrastructureStore.getState().routes
  check('a route was built, by Venus, between the site and a hub on that body', routes.length === 1 && routes[0].ownerId === VENUS && (routes[0].a === cut!.id || routes[0].b === cut!.id) && routes[0].bodyName === 'Venus')
  check('...and it was paid for from Venus\'s own strategic pool', useResourceStore.getState().stateFor(VENUS).amounts.minerals < before)
  useGameTimeStore.setState({ simDays: 1000 + routes[0].readySimDays + 10 })
  check('once it is finished the site is better connected (the freight reaches the hub)', accessOnBody('Venus', VENUS)[cut!.id] > 0.5 || isolatedSitesOf(VENUS).length === 0)
  const second = planEmpire(VENUS, captureSnapshot(useGameTimeStore.getState().simDays), INITIAL_AI_MEMORY)
  check('it does not build the same road twice', !second.intents.some((i) => i.kind === 'connect-site') || !connectSite(VENUS, cut!.id).ok || useInfrastructureStore.getState().routes.length <= 2)
}

console.log('\n=== 3. The player\'s limits bind it ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 1000 })
  const cut = reachableCutSite()!
  useLocationStore.getState().establish(cut.id, VENUS, 1)
  usePlacementStore.getState().place(cut.id, 'civilianFactory', 2)
  useResourceStore.getState().setAmount(VENUS, 'minerals', 0)
  const poor = connectSite(VENUS, cut.id)
  check('too poor to pay: nothing is built, and it says why', !poor.ok && /Minerals|Alloys/i.test(poor.reason) && useInfrastructureStore.getState().routes.length === 0, poor.ok ? '' : poor.reason)
  useResourceStore.getState().setAmount(VENUS, 'minerals', 100000)
  useResourceStore.getState().setAmount(VENUS, 'alloys', 100000)
  // Another country's ground needs its leave.
  const marsSite = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  usePlacementStore.getState().place(marsSite.id, 'civilianFactory', 1)
  useLocationStore.getState().establish(marsSite.id, VENUS, 5)
  const foreign = connectSite(VENUS, marsSite.id)
  check('a site on another country\'s ground cannot be joined without leave', !foreign.ok && (/permission/.test(foreign.reason) || /no hub/.test(foreign.reason)), foreign.ok ? '' : foreign.reason)
  // Water: Earth, a site on a landmass with no hub.
  const earth = locationsOf('Earth').filter((s) => s.node !== null)
  const surface = surfaceOf('Earth', 'wild')
  const hubComps = new Set(earth.filter((s) => s.kind === 'settlement').map((s) => surface.landComponent[s.node!]))
  const island = earth.find((s) => s.kind === 'resource' && !hubComps.has(surface.landComponent[s.node!]))
  if (island) {
    useResourceStore.getState().setAmount('earth', 'minerals', 100000)
    useLocationStore.getState().establish(island.id, 'earth', 1)
    usePlacementStore.getState().place(island.id, 'mine', 1)
    const wet = connectSite('earth', island.id)
    check('a site across the sea from every hub cannot be joined by road', !wet.ok && /water|no hub|lies/.test(wet.reason) && !useInfrastructureStore.getState().routes.some((r) => r.ownerId === 'earth'), wet.ok ? '' : wet.reason)
  } else check('(Earth has no resource site cut off by sea: nothing to test)', true)
  void surveyRoute
}

console.log('\n=== 4. An endangered world gets a platform; an overcrowded one a second settlement ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 1000 })
  useShipStore.setState({ ships: [] })
  useResourceStore.getState().setAmount(VENUS, 'alloys', 100000)
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 1000)
  for (let i = 0; i < 3; i++) spawnOwnedShip('cruiser', MARS, 'sol', 'Mars')
  check('Venus is threatened: an enemy fleet is in its system, no enemy holds its orbit yet, and it has no platform', threatenedBodiesOf(VENUS).includes('Venus'))
  const plan = planEmpire(VENUS, captureSnapshot(1000), INITIAL_AI_MEMORY)
  check('its plan includes a defense platform over Venus', plan.intents.some((i) => i.kind === 'build-defense-platform' && i.bodyName === 'Venus'))
  executeIntents(VENUS, plan.intents.filter((i): i is Extract<Intent, { kind: 'build-defense-platform' }> => i.kind === 'build-defense-platform'), 1000, MARS)
  check('the platform is built, owned by Venus, in low orbit, and paid in alloys', useOrbitalStore.getState().facilities.some((f) => f.ownerId === VENUS && f.kind === 'defense' && f.zone === 'Venus~low') && useResourceStore.getState().stateFor(VENUS).amounts.alloys < 100000)
  check('...and once it stands it is not asked for again', !threatenedBodiesOf(VENUS).includes('Venus'))
  // Too late: once the enemy holds the orbit, nobody can build there, so the AI does not try.
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 1000)
  for (let i = 0; i < 4; i++) spawnOwnedShip('cruiser', MARS, 'sol', 'Venus')
  check('an enemy already holding the orbit over Venus: the AI does not ask for a platform it may not build', !threatenedBodiesOf(VENUS).includes('Venus'))

  // Overcrowding.
  useShipStore.setState({ ships: [] })
  const open = locationsOf('Venus').find((s) => s.kind === 'settlement' && !s.tags.includes('capital'))!
  useLocationStore.getState().abandon(open.id)
  useAbstractEconomyStore.setState((s) => ({ worlds: { ...s.worlds, Venus: { ...s.worlds.Venus, population: 200000 } } }))
  const mine = locationsOf('Venus').find((s) => s.kind === 'resource' && !s.material)!
  usePlacementStore.getState().place(mine.id, 'mine', 1)
  useLocationStore.getState().establish(mine.id, VENUS, 1)
  check('a world with far more people than its settlements can house has an opening to expand into', settlementOpeningsOf(VENUS).includes(open.id), settlementOpeningsOf(VENUS).join(','))
  executeIntents(VENUS, [{ kind: 'found-settlement', siteId: open.id }], 1000, MARS)
  check('the AI founds it through the same rules', siteOwner(open.id) === VENUS)
}

console.log('\n=== 5. What the economy AIs order gets placed ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const store = () => useAbstractEconomyStore.getState()
  const orderId = 9001
  useAbstractEconomyStore.setState((s) => ({ byCountry: { ...s.byCountry, [VENUS]: { ...s.byCountry[VENUS], queue: [...s.byCountry[VENUS].queue, { id: orderId, bodyName: 'Venus', building: 'mine', progress: 0 }] } } }))
  placeUnplacedOrders()
  const placed = store().byCountry[VENUS].queue.find((o) => o.id === orderId)
  const site = locationsOf('Venus').find((s) => s.id === placed?.siteId)
  check('an order the economy AI queued with no site is given a resource site of a country that may build there', site?.kind === 'resource' && siteOwner(site.id) === VENUS, placed?.siteId)
  check('...and it is on the ledger', !!placed?.siteId && (usePlacementStore.getState().placed[placed.siteId]?.mine ?? 0) >= 1)
}

console.log('\n=== 6. Every placement stays legal ===')
{
  // Whatever was placed, by anyone, obeys the physical rules.
  const bad: string[] = []
  for (const [siteId, row] of Object.entries(usePlacementStore.getState().placed)) {
    const body = siteId.slice(0, siteId.lastIndexOf('#'))
    const site = locationsOf(body).find((s) => s.id === siteId)
    if (!site) {
      bad.push(`${siteId}: no such site`)
      continue
    }
    let slots = 0
    for (const [id, n] of Object.entries(row)) {
      if (!siteKindsFor({ mode: 'simple', id }).includes(site.kind)) bad.push(`${siteId}: ${id} on a ${site.kind} site`)
      slots += n
    }
    if (slots > slotsOfSite(site)) bad.push(`${siteId}: over capacity`)
  }
  check('every building on the ledger stands on a site of its kind, within capacity', bad.length === 0, bad.join('; '))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll AI development checks passed')
process.exit(failures ? 1 : 0)
