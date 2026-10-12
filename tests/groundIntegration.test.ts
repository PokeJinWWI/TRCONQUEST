// The ground war and the economy are one world (scene/groundSupply.ts, infrastructureOrders.capturedBy): a site an
// enemy's ground forces hold makes nothing for its owner, a route with a captured end is cut, supply for the units
// comes from the same freight network, and none of it moves sovereignty or property.
//
// Run:  npx tsx tests/groundIntegration.test.ts
import { GROUND_STEPS_PER_DAY, UNIT_REGEN_PER_DAY, UNIT_TYPES } from '../src/data/groundData'
import { CAPTURED_FACTOR, ISOLATION_FACTOR } from '../src/data/infrastructureData'
import { atWar, useDiplomacyStore } from '../src/state/diplomacyStore'
import { accessOnBody, buildRoute, capturedBy } from '../src/scene/infrastructureOrders'
import { surveyRoute } from '../src/scene/infrastructureNet'
import { makeSupplyFn } from '../src/scene/groundSupply'
import { stepGroundWar, type GroundWorld } from '../src/scene/groundResolution'
import { groundSurface } from '../src/scene/groundLogic'
import { locationsOf } from '../src/scene/locations'
import { jurisdictionNow } from '../src/scene/sovereignty'
import { developmentView } from '../src/scene/territoryView'
import { seedBodyOwners } from '../src/scene/territory'
import { resetGame } from '../src/scene/gameReset'
import { nodePoint } from '../src/scene/surfaceMesh'
import type { Army } from '../src/scene/armyLogic'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { usePlacementStore } from '../src/state/placementStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTerritoryStore } from '../src/state/territoryStore'

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

function fresh() {
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 1000 })
  useDiplomacyStore.getState().forceWar(VENUS, MARS, 1000)
  for (const n of [MARS, VENUS]) {
    useResourceStore.getState().setAmount(n, 'minerals', 100000)
    useResourceStore.getState().setAmount(n, 'alloys', 100000)
  }
}
const mars = () => locationsOf('Mars').filter((s) => s.node !== null)
const hold = (node: number, by: string) => useTerritoryStore.getState().paintNodes('Mars', { [node]: by })
const release = (node: number) => useTerritoryStore.getState().paintNodes('Mars', { [node]: null })

console.log('\n=== 1. A captured site makes nothing for its owner ===')
{
  fresh()
  const hubs = mars().filter((s) => s.kind === 'settlement' && s.fixed)
  const sites = mars().filter((s) => (s.kind === 'industrial' || s.kind === 'resource') && !s.material)
  const a = sites[0]
  const b = sites[1]
  for (const s of [a, b]) {
    useLocationStore.getState().establish(s.id, MARS, 1)
    usePlacementStore.getState().place(s.id, s.kind === 'resource' ? 'mine' : 'civilianFactory', 1)
  }
  const before = accessOnBody('Mars', MARS)
  check('(setup) nothing is held by the enemy yet', !capturedBy('Mars', a.node!, MARS))
  hold(a.node!, VENUS)
  const during = accessOnBody('Mars', MARS)
  check('Venus\'s units hold the node of site A: the buildings there make nothing for Mars', capturedBy('Mars', a.node!, MARS) && during[a.id] === CAPTURED_FACTOR, `${before[a.id]} -> ${during[a.id]}`)
  check('...site B, elsewhere on the same world, is untouched', during[b.id] === before[b.id])
  check('the development view says why', developmentView('Mars', MARS).sites.find((s) => s.id === a.id)!.captured)
  check('the capture moved nothing else: sovereignty, ownership of the site and of the world are unchanged', jurisdictionNow({ kind: 'body', id: 'Mars' }).sovereign === MARS && siteOwner(a.id) === MARS && useTerritoryStore.getState().bodyOwner['Mars'] === MARS)
  check('a nation not at war with the holder is not affected', !atWar(VENUS, 'orion-republic') && !capturedBy('Mars', a.node!, 'orion-republic'))
  release(a.node!)
  check('when the front moves back, the site works again (it is all derived)', accessOnBody('Mars', MARS)[a.id] === before[a.id])
  void hubs
}

console.log('\n=== 2. A route with a captured end is cut ===')
{
  fresh()
  const sites = mars()
  const hubs = sites.filter((s) => s.kind === 'settlement' && s.fixed)
  const spaceport = sites.filter((s) => s.kind === 'infrastructure')
  let pick: { x: (typeof sites)[number]; h: (typeof sites)[number] } | null = null
  for (const x of sites.filter((s) => (s.kind === 'industrial' || s.kind === 'resource') && !s.material && accessOnBody('Mars', MARS)[s.id] < 1)) {
    for (const h of hubs) if (!pick && !surveyRoute('Mars', x.node!, h.node!).blocked) pick = { x, h }
  }
  check('Mars has a cut-off site that a road can join to a hub', !!pick)
  const { x, h } = pick!
  useLocationStore.getState().establish(x.id, MARS, 1)
  usePlacementStore.getState().place(x.id, x.kind === 'resource' ? 'mine' : 'civilianFactory', 1)
  const road = buildRoute(MARS, x.id, h.id, 'road')
  useGameTimeStore.setState({ simDays: road.ok ? road.route.readySimDays + 1 : 1000 })
  check('the road works: the site has full access', road.ok && accessOnBody('Mars', MARS)[x.id] === 1)
  hold(h.node!, VENUS)
  const cut = accessOnBody('Mars', MARS)[x.id]
  void spaceport
  check('Venus takes the hub the road ends at: the road is cut and the site falls back to what it had without a road', cut < 1 && cut >= ISOLATION_FACTOR, `${cut}`)
  release(h.node!)
  check('...and when the hub is retaken the road carries again', accessOnBody('Mars', MARS)[x.id] === 1)
}

console.log('\n=== 3. Supply from the same network ===')
{
  fresh()
  const surface = groundSurface('Mars', seedBodyOwners())!
  const cutSite = mars().find((s) => s.kind === 'resource' && !s.material && accessOnBody('Mars', MARS)[s.id] < 1)!
  const supply = makeSupplyFn()
  const farSupply = supply(MARS, 'Mars', cutSite.node!)
  check('a unit resting beside a cut-off site is poorly supplied; beside a hub, fully', farSupply === ISOLATION_FACTOR && supply(MARS, 'Mars', mars().find((s) => s.kind === 'settlement')!.node!) === 1, `${farSupply}`)
  const occupied = useTerritoryStore.getState()
  occupied.occupyBody('Mars', VENUS)
  check('under an enemy occupation a nation\'s units are as poorly supplied as its freight', makeSupplyFn()(MARS, 'Mars', mars()[0].node!) === ISOLATION_FACTOR)
  occupied.liberateBody('Mars')

  // The ground war: a hurt unit at rest recovers at the supplied share.
  const type = 'infantry' as const
  const max = UNIT_TYPES[type].maxStrength
  const node = cutSite.node!
  const mk = (): Army => ({ id: 'a1', ownerId: MARS, kind: 'assault', units: [{ id: 'u1', type, strength: max * 0.5, maxStrength: max, position: nodePoint(node), path: [], nodeHint: node, stillSinceStep: 0 }], location: { kind: 'body', bodyName: 'Mars' } })
  const world = (supplyOf?: GroundWorld['supplyOf']): GroundWorld => ({ armies: [mk()], owners: seedBodyOwners(), controllers: {}, nodeHolders: {}, atWar, isAutonomous: () => false, surfaceOf: () => surface, supplyOf })
  const days = 10
  const full = stepGroundWar(world(), 0, days).armies[0].units[0].strength
  const half = stepGroundWar(world(() => 0.5), 0, days).armies[0].units[0].strength
  const none = stepGroundWar(world(() => 0), 0, days).armies[0].units[0].strength
  const gainFull = full - max * 0.5
  const gainHalf = half - max * 0.5
  check('the default is unchanged: full recovery', Math.abs(gainFull - max * UNIT_REGEN_PER_DAY * days) < 1e-6 && GROUND_STEPS_PER_DAY > 0, `${gainFull.toFixed(2)}`)
  check('a half-supplied unit recovers half as fast, an unsupplied one not at all', Math.abs(gainHalf - gainFull / 2) < 1e-6 && none === max * 0.5)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll ground integration checks passed')
process.exit(failures ? 1 : 0)
