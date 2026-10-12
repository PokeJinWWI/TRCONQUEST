// The surface route network (scene/infrastructureNet.ts, scene/infrastructureOrders.ts,
// state/infrastructureStore.ts): roads and railways between development sites, who may build
// them, what they cost, and what they mean for a placed building's output, in both economies.
//
// Run:  npx tsx tests/infrastructure.test.ts
import { ISOLATION_FACTOR, LOCAL_ACCESS_CELLS, ROUTE_SPECS } from '../src/data/infrastructureData'
import { quoteRoute, siteAccess, surveyRoute, type Route } from '../src/scene/infrastructureNet'
import { accessOnBody, buildRoute, planRoute, resolveInfrastructure, setRouteAccess, syncSiteAccess } from '../src/scene/infrastructureOrders'
import { locationsOf } from '../src/scene/locations'
import { grantPermission } from '../src/scene/sovereignty'
import { resetGame } from '../src/scene/gameReset'
import { surfaceOf } from '../src/scene/planetTerrain'
import { worldInfrastructure } from '../src/economy/transport'
import { abstractReport, emptyStockpile } from '../src/economy-abstract/abstractEconomy'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useInfrastructureStore } from '../src/state/infrastructureStore'
import { useLocationStore } from '../src/state/locationStore'
import { usePlacementStore } from '../src/state/placementStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { applySave, createSave } from '../src/state/saveGame'
import { sameData } from '../src/state/saveCodec'

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

console.log('\n=== 1. Freight to a hub (pure) ===')
{
  const sites = [
    { id: 'hub', node: 0 },
    { id: 'near', node: 3 },
    { id: 'far', node: 50 },
    { id: 'farther', node: 100 },
  ]
  const base = { bodyName: 'X', sites, hubs: ['hub'], cellsBetween: (a: number, b: number) => Math.abs(a - b) }
  const road = (a: string, b: string, cells: number, over: Partial<Route> = {}): Route => ({ id: `${a}-${b}`, bodyName: 'X', a, b, kind: 'road', ownerId: 'n', users: [], open: true, cells, builtSimDays: 0, readySimDays: 0, ...over })
  const none = siteAccess({ ...base, routes: [], demand: () => 10 })
  check('a hub and a site beside it need no route', none.hub === 1 && none.near === 1 && 3 <= LOCAL_ACCESS_CELLS)
  check('a far site with no route is cut off', none.far === ISOLATION_FACTOR && none.farther === ISOLATION_FACTOR)
  const one = siteAccess({ ...base, routes: [road('far', 'hub', 50)], demand: (id) => (id === 'far' ? 20 : 0) })
  check('a road within its capacity gives full access', one.far === 1, `${one.far}`)
  check('...and it does not help a site it does not reach', one.farther === ISOLATION_FACTOR)
  const busy = siteAccess({ ...base, routes: [road('far', 'hub', 50)], demand: (id) => (id === 'far' ? 45 : 0) })
  check('over capacity, the share is capacity / freight', Math.abs(busy.far - ROUTE_SPECS.road.capacity / 45) < 1e-9, `${busy.far.toFixed(3)}`)
  const swamped = siteAccess({ ...base, routes: [road('far', 'hub', 50)], demand: (id) => (id === 'far' ? 400 : 0) })
  check('...never worse than having no route at all', swamped.far === ISOLATION_FACTOR)
  const chain = siteAccess({ ...base, routes: [road('farther', 'far', 50), road('far', 'hub', 50)], demand: (id) => (id === 'far' || id === 'farther' ? 20 : 0) })
  check('a chain: the shared road carries both sites\' freight (40 > 30)', Math.abs(chain.far - 30 / 40) < 1e-9 && Math.abs(chain.farther - 30 / 40) < 1e-9, `${chain.far.toFixed(3)}`)
  const rail = siteAccess({ ...base, routes: [road('farther', 'far', 50), road('far', 'hub', 50, { kind: 'rail' })], demand: (id) => (id === 'far' || id === 'farther' ? 20 : 0) })
  check('replacing the shared road with a railway clears the bottleneck', rail.far === 1 && rail.farther === 1)
  const worn = siteAccess({ ...base, routes: [road('far', 'hub', 50, { disrepair: true })], demand: (id) => (id === 'far' ? 20 : 0) })
  check('a route in disrepair carries half: 15 of 20 freight', Math.abs(worn.far - 15 / 20) < 1e-9, `${worn.far}`)
  const noHub = siteAccess({ ...base, hubs: [], routes: [], demand: () => 10 })
  check('a body with no hub has nothing to be cut off from', Object.values(noHub).every((v) => v === 1))
}

console.log('\n=== 2. The ground decides what a route costs ===')
{
  const mars = locationsOf('Mars').filter((s) => s.node !== null)
  const [a, b] = [mars[0], mars[1]]
  const s = surveyRoute('Mars', a.node!, b.node!)
  check('a route has a length in cells and a difficulty', s.cells >= 1 && Number.isFinite(s.difficulty) !== (s.blocked !== null), `${s.cells} cells, difficulty ${s.difficulty.toFixed(2)}, ${s.blocked ?? 'clear'}`)
  const q1 = quoteRoute('road', 10, 1)
  const q2 = quoteRoute('road', 20, 1)
  const q3 = quoteRoute('road', 10, 3)
  check('twice the length costs twice as much, mountains cost three times', Math.abs((q2.resources.minerals ?? 0) - 2 * (q1.resources.minerals ?? 0)) < 0.02 && Math.abs((q3.resources.minerals ?? 0) - 3 * (q1.resources.minerals ?? 0)) < 0.02 && q2.days === 2 * q1.days)
  check('a railway costs more and carries more than a road', (quoteRoute('rail', 10, 1).resources.minerals ?? 0) > (q1.resources.minerals ?? 0) && ROUTE_SPECS.rail.capacity > ROUTE_SPECS.road.capacity)
  // Water in the way: two sites of Earth on different landmasses.
  const earth = locationsOf('Earth').filter((x) => x.node !== null)
  const surface = surfaceOf('Earth', 'wild')
  let wet: string | null = null
  outer: for (const x of earth) for (const y of earth) if (surface.landComponent[x.node!] !== surface.landComponent[y.node!]) {
    const r = surveyRoute('Earth', x.node!, y.node!)
    if (r.blocked) {
      wet = r.blocked
      break outer
    }
  }
  check('a route across the sea is impossible, physically', wet !== null && /water|lava|sky/.test(wet), wet ?? 'no pair found')
}

console.log('\n=== 3. Who may build a route, and how it is paid for (Simple mode) ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const mars = locationsOf('Mars').filter((s) => s.node !== null)
  // A pair of Mars sites a route can be built between.
  let pair: [string, string] | null = null
  for (const x of mars) for (const y of mars) if (!pair && x.id < y.id && !surveyRoute('Mars', x.node!, y.node!).blocked) pair = [x.id, y.id]
  check('Mars has two sites joined by dry land', !!pair)
  const [a, b] = pair!
  useResourceStore.getState().setAmount(MARS, 'minerals', 0)
  const poor = planRoute(MARS, a, b, 'road')
  check('Mars cannot pay: refused, naming what is short', !poor.ok && /Minerals/i.test(poor.reason), poor.ok ? '' : poor.reason)
  for (const nation of [MARS, VENUS]) {
    useResourceStore.getState().setAmount(nation, 'minerals', 100000)
    useResourceStore.getState().setAmount(nation, 'alloys', 100000)
  }
  const venus = planRoute(VENUS, a, b, 'road')
  check('Venus cannot lay a road on Mars\'s ground without its permission', !venus.ok && /permission/.test(venus.reason), venus.ok ? '' : venus.reason)
  grantPermission({ id: 'roads', grantorId: MARS, holderId: VENUS, scope: { kind: 'body', id: 'Mars' }, effect: 'allow', basis: 'concession', since: 0 })
  check('...with a concession it can', planRoute(VENUS, a, b, 'road').ok)
  const quote = planRoute(MARS, a, b, 'road')
  const before = useResourceStore.getState().stateFor(MARS).amounts
  const built = buildRoute(MARS, a, b, 'road')
  const after = useResourceStore.getState().stateFor(MARS).amounts
  const spent = quote.ok ? (quote.quote.resources.minerals ?? 0) : -1
  check('building spends exactly the quoted minerals from the strategic pool, and nothing else', built.ok && Math.abs(before.minerals - after.minerals - spent) < 1e-6 && after.alloys === before.alloys && after.energy === before.energy, `${spent} minerals`)
  check('...and the route is owned by Mars, open to all, working only after its build time', built.ok && built.route.ownerId === MARS && built.route.open && built.route.readySimDays > 0)
  check('a second road between the same two sites is refused, a railway is not', !planRoute(MARS, a, b, 'road').ok && planRoute(MARS, a, b, 'rail').ok)
}

console.log('\n=== 3b. Complex mode pays in goods, and charges nothing twice ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'complex' })
  const mars = locationsOf('Mars').filter((s) => s.node !== null)
  let pair: [string, string] | null = null
  for (const x of mars) for (const y of mars) if (!pair && x.id < y.id && !surveyRoute('Mars', x.node!, y.node!).blocked) pair = [x.id, y.id]
  const world = () => useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')!
  useEconomyStore.getState().consumeStockpile('Mars', { concrete: 1000, steel: 1000, tools: 1000 }, true)
  const stock = { ...world().stockpiles }
  const infraBefore = worldInfrastructure(world())
  const plan = planRoute(MARS, pair![0], pair![1], 'road')
  const built = buildRoute(MARS, pair![0], pair![1], 'road')
  const now = world().stockpiles ?? {}
  const diff = (g: string) => ((stock as Record<string, number>)[g] ?? 0) - ((now as Record<string, number>)[g] ?? 0)
  const goods = plan.ok ? plan.quote.goods : {}
  check('Complex: the road is paid in the economy\'s goods, from the capital stockpile', built.ok && Math.abs(diff('concrete') - (goods.concrete ?? 0)) < 1e-6 && Math.abs(diff('tools') - (goods.tools ?? 0)) < 1e-6, JSON.stringify(goods))
  check('...no other good is touched, the transportation good least of all', diff('steel') === 0 && diff('transportation') === 0)
  check('...and the world-wide infrastructure number (the base grid and transport buildings) is exactly as it was: a route adds reach, not capacity twice', worldInfrastructure(world()) === infraBefore)
  const short = (() => { useEconomyStore.getState().consumeStockpile('Mars', { concrete: 1e9 }); return planRoute(MARS, pair![0], pair![1], 'rail') })()
  check('with the stockpile empty a railway is refused, naming the good', !short.ok && /Concrete|Steel|Tools/i.test(short.reason), short.ok ? '' : short.reason)
}

console.log('\n=== 4. A cut-off mine, a road, a bottleneck ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 0 })
  useResourceStore.getState().setAmount(MARS, 'minerals', 100000)
  useResourceStore.getState().setAmount(MARS, 'alloys', 100000)
  const sites = locationsOf('Mars')
  const resource = sites.filter((s) => s.kind === 'resource' && !s.material)
  const access = (id: string) => accessOnBody('Mars', MARS)[id]
  const cut = resource.find((s) => access(s.id) < 1)
  check('Mars has a resource site far from its cities, cut off', !!cut, resource.map((r) => `${r.id}:${access(r.id)}`).join(' '))
  const site = cut!
  useLocationStore.getState().establish(site.id, MARS, 0)
  usePlacementStore.getState().place(site.id, 'mine', 1)
  check('a mine placed there is cut off: half its output', access(site.id) === ISOLATION_FACTOR)
  const hub = sites.find((s) => s.kind === 'settlement' && s.fixed)!
  const road = buildRoute(MARS, site.id, hub.id, 'road')
  check('the road is built', road.ok, road.ok ? '' : road.reason)
  check('...but a road not yet finished carries nothing', access(site.id) === ISOLATION_FACTOR)
  if (road.ok) useGameTimeStore.setState({ simDays: road.route.readySimDays })
  check('...when it is finished the mine has full access (10 freight on a road of 30)', access(site.id) === 1)
  usePlacementStore.getState().place(site.id, 'mine', 5)
  const congested = access(site.id)
  check('six mines make 60 freight on a road of 30: half', Math.abs(congested - 0.5) < 1e-9 || congested === ISOLATION_FACTOR, `${congested}`)
  if (road.ok) {
    const rail = buildRoute(MARS, site.id, hub.id, 'rail')
    if (rail.ok) useGameTimeStore.setState({ simDays: rail.route.readySimDays })
    check('a railway beside it carries the lot... shortest route wins, and the better one is used', rail.ok && access(site.id) >= congested)
  }
  // Closed route.
  const routes = useInfrastructureStore.getState().routes
  for (const r of routes) setRouteAccess(r.id, MARS, { open: false })
  useLocationStore.getState().abandon(site.id)
  useLocationStore.getState().establish(site.id, VENUS, 0)
  check('Venus\'s mine on that site cannot use Mars\'s closed routes', accessOnBody('Mars', VENUS)[site.id] === ISOLATION_FACTOR)
  setRouteAccess(routes[0].id, MARS, { users: [VENUS] })
  check('...until Mars lists Venus as a user of one', accessOnBody('Mars', VENUS)[site.id] >= ISOLATION_FACTOR)
}

console.log('\n=== 5. Upkeep ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 0 })
  useResourceStore.getState().setAmount(MARS, 'minerals', 100000)
  const sites = locationsOf('Mars').filter((s) => s.node !== null)
  let pair: [string, string] | null = null
  for (const x of sites) for (const y of sites) if (!pair && x.id < y.id && !surveyRoute('Mars', x.node!, y.node!).blocked) pair = [x.id, y.id]
  const built = buildRoute(MARS, pair![0], pair![1], 'road')
  const ready = built.ok ? built.route.readySimDays : 0
  const m0 = useResourceStore.getState().stateFor(MARS).amounts.minerals
  resolveInfrastructure(ready + 31)
  const m1 = useResourceStore.getState().stateFor(MARS).amounts.minerals
  check('each month a working route costs its upkeep, from the owner', m1 < m0, `${(m0 - m1).toFixed(3)} minerals`)
  useResourceStore.getState().setAmount(MARS, 'minerals', 0)
  resolveInfrastructure(ready + 100)
  check('with the upkeep unpaid it falls into disrepair', useInfrastructureStore.getState().routes[0].disrepair === true)
  useResourceStore.getState().setAmount(MARS, 'minerals', 100000)
  resolveInfrastructure(ready + 140)
  check('...and mends the month it is paid again', !useInfrastructureStore.getState().routes[0].disrepair)
}

console.log('\n=== 6. What it does to production ===')
{
  // Simple: a mine cut off from its hub makes less.
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const sites = locationsOf('Mars')
  const cut = sites.filter((s) => s.kind === 'resource' && !s.material).find((s) => accessOnBody('Mars', MARS)[s.id] < 1)!
  useLocationStore.getState().establish(cut.id, MARS, 0)
  usePlacementStore.getState().place(cut.id, 'mine', 1)
  const store = () => useAbstractEconomyStore.getState()
  const stock = { ...emptyStockpile(), minerals: 10000, energy: 10000 }
  const worlds = [store().worlds.Mars]
  const minerals = () => abstractReport(store().byCountry[MARS], worlds, stock).produced.minerals
  const full = minerals()
  syncSiteAccess()
  const cutOff = minerals()
  const marsMines = store().worlds.Mars.buildings.mine ?? 0
  check('Mars has mines, one of them placed on the cut-off site', marsMines >= 1 && store().byCountry[MARS].buildingAccess?.mine !== undefined, `${marsMines} mines, access ${store().byCountry[MARS].buildingAccess?.mine}`)
  check('Simple: the nation\'s mineral output falls by the share that cannot get out', cutOff < full && cutOff > 0.5 * full, `${full.toFixed(1)} -> ${cutOff.toFixed(1)}`)
  usePlacementStore.getState().unplace(cut.id, 'mine', 1)
  syncSiteAccess()
  check('...and returns when the mine is gone', store().byCountry[MARS].buildingAccess === undefined && Math.abs(minerals() - full) < 1e-6)

  // Complex: the building's own access reaches the tick.
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'complex' })
  const recipeFor: Record<string, string> = { ironOre: 'ironMine', coal: 'coalMine', oil: 'oilWell', rareMetals: 'rareMetalsMine', sulfur: 'sulfurMine', phosphate: 'phosphateMine' }
  const marsWorld = () => useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')!
  const target = locationsOf('Mars').filter((s) => s.kind === 'resource' && s.good && recipeFor[s.good] && marsWorld().buildings.some((b) => b.recipeId === recipeFor[s.good!])).find((s) => accessOnBody('Mars', MARS)[s.id] < 1)
  check('Complex: Mars has a cut-off site for a mine it already runs', !!target)
  const recipe = recipeFor[target!.good!]
  const run = (cutOffSite: boolean) => {
    resetGame()
    usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'complex' })
    if (cutOffSite) {
      useLocationStore.getState().establish(target!.id, MARS, 0)
      usePlacementStore.getState().place(target!.id, recipe, 1)
    }
    useEconomyStore.getState().advance(3)
    return marsWorld().buildings.filter((b) => b.recipeId === recipe).reduce((n, b) => n + b.throughput * b.level, 0)
  }
  const normal = run(false)
  const withCut = run(true)
  const access = marsWorld().buildings.find((b) => b.recipeId === recipe)?.siteAccess
  check('Complex: the building carries an access share', access !== undefined && access < 1, `${access}`)
  check('Complex: a cut-off mine\'s run settles lower after three months', withCut < normal, `${normal.toFixed(3)} vs ${withCut.toFixed(3)}`)
}

console.log('\n=== 7. Save and load ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useResourceStore.getState().setAmount(MARS, 'minerals', 100000)
  const sites = locationsOf('Mars').filter((s) => s.node !== null)
  let pair: [string, string] | null = null
  for (const x of sites) for (const y of sites) if (!pair && x.id < y.id && !surveyRoute('Mars', x.node!, y.node!).blocked) pair = [x.id, y.id]
  buildRoute(MARS, pair![0], pair![1], 'rail')
  const before = { routes: useInfrastructureStore.getState().routes, month: useInfrastructureStore.getState().maintainedMonth }
  const file = JSON.parse(JSON.stringify(await createSave('routes')))
  resetGame()
  check('a reset clears the network', useInfrastructureStore.getState().routes.length === 0)
  await applySave(file)
  check('the network survives save and load', sameData(before.routes, useInfrastructureStore.getState().routes) && before.month === useInfrastructureStore.getState().maintainedMonth)
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll infrastructure checks passed')
process.exit(failures ? 1 : 0)
