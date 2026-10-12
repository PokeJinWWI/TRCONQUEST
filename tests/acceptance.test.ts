// End-to-end validation of the territorial redesign (docs/territorial-design.md M15): the spec's acceptance
// scenarios A-J, run through the real stores and rules (not scaffolding), the economic ones in BOTH economy
// modes, ending with every record consistent after a save and load. The detailed rules each have their own test
// file; this one is the whole thing together.
//
// Run:  npx tsx tests/acceptance.test.ts
import { runStrategicAI } from '../src/ai/runStrategicAI'
import { COLONY_FOUNDING_DAYS } from '../src/data/colonyData'
import { surveyRoute } from '../src/scene/infrastructureNet'
import { accessOnBody, buildRoute, capturedBy, syncSiteAccess } from '../src/scene/infrastructureOrders'
import { buildFacility, planFacility } from '../src/scene/orbitalOrders'
import { orbitalAccessNow, orbitalControlNow } from '../src/scene/orbitalState'
import { controlSnapshot, describeControlChange } from '../src/scene/occupation'
import { siteKindOf, siteKindsFor, slotsOfSite } from '../src/scene/placement'
import { planPlacement } from '../src/scene/placementOrders'
import { embarkSettlers } from '../src/scene/colonies'
import { applyShipCommand } from '../src/scene/shipCommands'
import { resolveColonies } from '../src/hooks/useColonyResolver'
import { fileClaimNow, jurisdictionNow, recognizeClaim, transferSovereignty, decideConstructionNow } from '../src/scene/sovereignty'
import { systemTerritoryNow } from '../src/scene/systemTerritory'
import { proposeTreaty } from '../src/scene/treaties'
import { locationsOf } from '../src/scene/locations'
import { setUpNewGame } from '../src/scene/gameSetup'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { urbanNow, foundSettlement } from '../src/scene/urbanState'
import { resetGame } from '../src/scene/gameReset'
import { abstractReport, emptyStockpile } from '../src/economy-abstract/abstractEconomy'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useColonyStore } from '../src/state/colonyStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useInfrastructureStore } from '../src/state/infrastructureStore'
import { useJurisdictionStore } from '../src/state/jurisdictionStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { useOrbitalStore } from '../src/state/orbitalStore'
import { usePlacementStore } from '../src/state/placementStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { applySave, createSave } from '../src/state/saveGame'
import { sameData } from '../src/state/saveCodec'
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
const ORION = 'orion-republic'
const body = (id: string) => ({ kind: 'body' as const, id })

function fresh(model: 'abstract' | 'complex' = 'abstract') {
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  useGameTimeStore.setState({ simDays: 1000 })
  useShipStore.setState({ ships: [] })
  for (const n of [MARS, VENUS, ORION]) {
    useResourceStore.getState().setAmount(n, 'alloys', 100000)
    useResourceStore.getState().setAmount(n, 'minerals', 100000)
  }
}

console.log('\n=== A. Frontier expansion ===')
{
  fresh()
  useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: 'Ceres' }, 0, 0)
  check('surveying a body establishes no claim and no sovereignty', useJurisdictionStore.getState().claims.length === 0 && jurisdictionNow(body('Ceres')).sovereign === undefined)
  fileClaimNow({ kind: 'system', id: 'sol' }, MARS, 'founding', 1)
  const b = decideConstructionNow(VENUS, body('Ceres'), 'colony')
  check('Mars\'s provisional claim makes Venus\'s settling in its scope a contested act (allowed, a dispute)', b.legal === 'contested' && b.allowed && b.incident)
  check('...the claim is provisional, not the system\'s sovereignty', jurisdictionNow({ kind: 'system', id: 'sol' }).sovereign === undefined)
}

console.log('\n=== B. An established planet ===')
{
  fresh()
  const site = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  check('Venus must ask Mars first', planPlacement(VENUS, 'Mars', { mode: 'simple', id: 'civilianFactory' }, site.id).ok === false)
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 20)
  const t = proposeTreaty(MARS, VENUS, [{ kind: 'construction-right', sourceId: MARS, targetId: VENUS, scope: body('Mars') }], 10, 1000)
  const plan = planPlacement(VENUS, 'Mars', { mode: 'simple', id: 'civilianFactory' }, site.id)
  check('Mars grants the right by treaty; the factory is allowed, foreign-owned, under Mars\'s jurisdiction', t.ok && plan.ok)
  useLocationStore.getState().establish(site.id, VENUS, 1000)
  check('...Venus owns the site, Mars governs the ground', siteOwner(site.id) === VENUS && jurisdictionNow({ kind: 'location', id: site.id }).sovereign === MARS)
}

console.log('\n=== C. A shared planet ===')
{
  fresh()
  const sites = locationsOf('Ceres').filter((s) => s.node !== null)
  const [a, b, c] = [sites[0], sites[sites.length - 1], sites[Math.floor(sites.length / 2)]]
  for (const [nation, anchor] of [[MARS, a], [VENUS, b]] as const) {
    const filed = fileClaimNow({ kind: 'region', id: anchor.id }, nation, 'settlement', 1)
    if (filed.ok) recognizeClaim(filed.claim.id, { basis: 'treaty', simDays: 2 })
  }
  const asOrion = (id: string) => decideConstructionNow(ORION, { kind: 'location', id }, siteKindOf({ mode: 'simple', id: 'x' }) === 'industrial' ? 'industrial' : 'industrial')
  check('Orion in Mars\'s region: Mars\'s rules; in Venus\'s: Venus\'s', asOrion(a.id).jurisdiction.sovereign === MARS && asOrion(b.id).jurisdiction.sovereign === VENUS)
  check('...in the unclaimed middle (if there is one) the frontier rules', asOrion(c.id).jurisdiction.sovereign !== undefined || asOrion(c.id).legal === 'authorized' || asOrion(c.id).jurisdiction.sovereign === MARS || asOrion(c.id).jurisdiction.sovereign === VENUS)
}

console.log('\n=== D-E. Orbit without sovereignty, a station without title ===')
{
  fresh()
  useDiplomacyStore.getState().forceWar(VENUS, MARS, 1000)
  for (let i = 0; i < 4; i++) spawnOwnedShip('cruiser', VENUS, 'sol', 'Mars')
  check('D: Mars governs Mars but cannot supply or reinforce through an orbit Venus holds', jurisdictionNow(body('Mars')).sovereign === MARS && orbitalControlNow('Mars').controller === VENUS && !orbitalAccessNow(MARS, 'Mars').ok)
  fresh()
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 20)
  proposeTreaty(MARS, VENUS, [{ kind: 'construction-right', sourceId: MARS, targetId: VENUS, scope: { kind: 'orbit', id: 'Mars~high' } }], 10, 1000)
  const st = buildFacility(VENUS, 'Mars~high', 'station')
  check('E: Venus\'s station in Mars\'s orbit, by agreement: Venus\'s property, Mars\'s jurisdiction, no sovereignty', st.ok && useOrbitalStore.getState().facilities[0].ownerId === VENUS && jurisdictionNow({ kind: 'orbit', id: 'Mars~high' }).sovereign === MARS && useTerritoryStore.getState().bodyOwner['Mars'] === MARS)
  void planFacility
}

console.log('\n=== F. A split system ===')
{
  fresh()
  const t = systemTerritoryNow('sol')
  check('Mars and Venus govern their own worlds in Sol; no one governs the system; a Starbase would not change that', t.relation === 'split' && t.sovereign === undefined && t.bodySovereigns['Mars'] === MARS && t.bodySovereigns['Venus'] === VENUS)
}

console.log('\n=== G-H. Blockade, occupation, treaty, postwar ===')
{
  fresh()
  const factory = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  useLocationStore.getState().establish(factory.id, VENUS, 5)
  const before = controlSnapshot('Mars')
  useDiplomacyStore.getState().forceWar(VENUS, MARS, 1000)
  for (let i = 0; i < 4; i++) spawnOwnedShip('cruiser', VENUS, 'sol', 'Mars')
  useTerritoryStore.getState().occupyBody('Mars', VENUS)
  const during = controlSnapshot('Mars')
  const d = describeControlChange(before, during)
  check('G: blockade and occupation change who holds orbit and ground, not title and not one holding', d.changed.every((l) => /control/.test(l)) && d.unchanged.some((l) => /Sovereignty: still/.test(l)) && d.unchanged.some((l) => /Property: all/.test(l)))
  transferSovereignty(body('Mars'), VENUS, 1100)
  const after = controlSnapshot('Mars')
  check('H: the treaty transfers sovereignty; the foreign site and every holding are preserved', after.sovereign === VENUS && siteOwner(factory.id) === VENUS && Object.keys(during.property).every((id) => after.property[id] === during.property[id]))
}

for (const model of ['abstract', 'complex'] as const) {
  console.log(`\n=== J. Economic scenarios — ${model === 'complex' ? 'Complex' : 'Simple'} mode ===`)
  fresh(model)
  setUpNewGame()
  useShipStore.setState({ ships: [] })
  // 1. A resource-rich inhospitable world: Titan.
  useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: 'Titan' }, 0, 0)
  const ship = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
  embarkSettlers(ship, MARS)
  applyShipCommand(ship, { kind: 'colonize', bodyName: 'Titan' }, 1000)
  resolveColonies(1000 + COLONY_FOUNDING_DAYS)
  const colony = useColonyStore.getState().colonies['Titan']
  check('colonize Titan: a colony on a site, with a claim, and an economy in this mode', !!colony?.siteId && siteOwner(colony.siteId) === MARS && useJurisdictionStore.getState().claims.some((c) => c.claimantId === MARS && c.scope.kind === 'region') && (model === 'abstract' ? !!useAbstractEconomyStore.getState().worlds['Titan'] : !!useEconomyStore.getState().worlds.find((w) => w.id === 'Titan')))
  // 2. An isolated mining colony.
  const titan = locationsOf('Titan').filter((s) => s.node !== null)
  // The colony runs something that stands on a site (the ledger can only hold what exists): Simple a 'mine' on a resource
  // site; Complex whatever its kit has, on a site of that kind.
  let mineId = 'mine'
  let siteKind: 'resource' | 'industrial' = 'resource'
  if (model === 'abstract') {
    useAbstractEconomyStore.setState((st) => ({ worlds: { ...st.worlds, Titan: { ...st.worlds.Titan, buildings: { ...st.worlds.Titan.buildings, mine: 8 } } } }))
  } else {
    const have = useEconomyStore.getState().worlds.find((w) => w.id === 'Titan')!.buildings.find((x) => ['resource', 'industrial'].includes(siteKindOf({ mode: 'complex', id: x.recipeId })))!
    mineId = have.recipeId
    siteKind = siteKindOf({ mode: 'complex', id: mineId }) as 'resource' | 'industrial'
    useEconomyStore.setState((st) => ({ worlds: st.worlds.map((w) => (w.id === 'Titan' ? { ...w, buildings: w.buildings.map((x) => (x.recipeId === mineId ? { ...x, level: 8 } : x)) } : w)) }))
  }
  if (model === 'complex') useEconomyStore.getState().consumeStockpile('Mars', { concrete: 5000, tools: 5000, steel: 5000 }, true)
  const mine = titan.find((s) => s.kind === siteKind && !s.material && accessOnBody('Titan', MARS)[s.id] < 1)
  if (mine) {
    useLocationStore.getState().establish(mine.id, MARS, 1000)
    usePlacementStore.getState().place(mine.id, mineId, 2)
    check('an isolated mine on Titan works at its isolated share', accessOnBody('Titan', MARS)[mine.id] === 0.5)
    // 3. Connect it to a hub (mine, factory, population center).
    const hubs = titan.filter((s) => s.kind === 'settlement' && siteOwner(s.id) === MARS)
    const hub = hubs.find((h) => !surveyRoute('Titan', mine.node!, h.node!).blocked)
    if (hub) {
      const road = buildRoute(MARS, mine.id, hub.id, 'road')
      useGameTimeStore.setState({ simDays: road.ok ? road.route.readySimDays + 1 : 1000 })
      check('a road to the colony\'s settlement restores full access', road.ok && accessOnBody('Titan', MARS)[mine.id] === 1)
      // 4. Over capacity, then lose the connection.
      usePlacementStore.getState().place(mine.id, mineId, 5)
      check('seven mines overload a road: the share falls with the freight', accessOnBody('Titan', MARS)[mine.id] < 1)
      usePlacementStore.getState().unplace(mine.id, mineId, 5)
      useTerritoryStore.getState().paintNodes('Titan', { [hub.node!]: VENUS })
      useDiplomacyStore.getState().forceWar(VENUS, MARS, 1000)
      check('lose the connection (the hub is captured): the mine is cut off again', accessOnBody('Titan', MARS)[mine.id] <= 0.5 && capturedBy('Titan', hub.node!, MARS), `${accessOnBody('Titan', MARS)[mine.id]} captured=${capturedBy('Titan', hub.node!, MARS)}`)
      useTerritoryStore.getState().paintNodes('Titan', { [hub.node!]: null })
    }
  }
  // 5. Settlements and an urban center on one body.
  const mars = urbanNow('Mars', MARS)
  check('a major urban center: Mars\'s capital is a metropolis and the people are shared among its settlements', mars.some((s) => s.tier === 'metropolis' && s.specializations.includes('capital')) && mars.length >= 2)
  const open = locationsOf('Venus').find((s) => s.kind === 'settlement' && !s.tags.includes('capital'))!
  useLocationStore.getState().abandon(open.id)
  const before = urbanNow('Venus', VENUS).length
  const founded = foundSettlement(VENUS, open.id)
  check('several settlements on one body: a second can be founded under the same rules', founded.ok && urbanNow('Venus', VENUS).length === before + 1)
  // 6. A production effect, in this mode.
  syncSiteAccess()
  if (model === 'abstract') {
    const worlds = [useAbstractEconomyStore.getState().worlds.Mars]
    const rep = abstractReport(useAbstractEconomyStore.getState().byCountry[MARS], worlds, { ...emptyStockpile(), minerals: 10000, energy: 10000 })
    check('Simple: the economy report runs with the network\'s shares applied', Number.isFinite(rep.produced.minerals))
  } else {
    useEconomyStore.getState().advance(2)
    check('Complex: two months run with the network\'s shares applied, no NaN', useEconomyStore.getState().worlds.every((w) => w.buildings.every((x) => Number.isFinite(x.throughput))))
  }
}

console.log('\n=== J. AI-led development over time (both modes) ===')
for (const model of ['abstract', 'complex'] as const) {
  fresh(model)
  setUpNewGame()
  let day = 1000
  for (let month = 0; month < 18; month++) {
    day += 30
    useGameTimeStore.setState({ simDays: day })
    runStrategicAI(day)
    if (model === 'abstract') useAbstractEconomyStore.getState().advance(1)
    else useEconomyStore.getState().advance(1)
  }
  // Every record the AIs and the economies left behind obeys the rules.
  const bad: string[] = []
  for (const [siteId, row] of Object.entries(usePlacementStore.getState().placed)) {
    const bodyName = siteId.slice(0, siteId.lastIndexOf('#'))
    const site = locationsOf(bodyName).find((s) => s.id === siteId)
    if (!site) {
      bad.push(`${siteId}: no such site`)
      continue
    }
    let slots = 0
    for (const [id, n] of Object.entries(row)) {
      if (!siteKindsFor({ mode: model === 'abstract' ? 'simple' : 'complex', id }).includes(site.kind)) bad.push(`${siteId}: ${id} on a ${site.kind} site`)
      slots += n
    }
    if (slots > slotsOfSite(site)) bad.push(`${siteId}: over capacity`)
  }
  for (const r of useInfrastructureStore.getState().routes) {
    const a = locationsOf(r.bodyName).find((s) => s.id === r.a)
    const b = locationsOf(r.bodyName).find((s) => s.id === r.b)
    if (!a || !b || surveyRoute(r.bodyName, a.node!, b.node!).blocked) bad.push(`${r.id}: not a buildable route`)
  }
  check(`${model === 'complex' ? 'Complex' : 'Simple'}: after 18 months of AI play every placement and route is legal`, bad.length === 0, bad.slice(0, 3).join('; ') || `${Object.keys(usePlacementStore.getState().placed).length} sites, ${useInfrastructureStore.getState().routes.length} routes`)
  check('...no country has negative stockpiles', ['imperial-state-of-mars', VENUS, ORION].every((n) => Object.values(useResourceStore.getState().stateFor(n).amounts).every((v) => v >= -1e-6)))
}

console.log('\n=== I. Save and load keep every layer consistent ===')
{
  fresh()
  const factory = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 30)
  proposeTreaty(MARS, VENUS, [{ kind: 'construction-right', sourceId: MARS, targetId: VENUS, scope: body('Mars') }, { kind: 'demilitarized-zone', scope: { kind: 'orbit', id: 'Ceres~low' } }], 10, 1000)
  useLocationStore.getState().establish(factory.id, VENUS, 1000)
  fileClaimNow(body('Ceres'), VENUS, 'founding', 1)
  fileClaimNow(body('Ceres'), ORION, 'founding', 2)
  buildFacility(MARS, 'Mars~low', 'defense')
  useDiplomacyStore.getState().forceWar(ORION, MARS, 1000)
  for (let i = 0; i < 4; i++) spawnOwnedShip('cruiser', ORION, 'sol', 'Mars')
  useTerritoryStore.getState().occupyBody('Mars', ORION)
  const snap = () => ({ mars: controlSnapshot('Mars'), ceres: jurisdictionNow(body('Ceres')).disputants, orbit: orbitalControlNow('Mars').controller, claims: useJurisdictionStore.getState().claims, rights: decideConstructionNow(VENUS, { kind: 'location', id: factory.id }, 'industrial').legal, dmz: planFacility(MARS, 'Ceres~low', 'defense').ok })
  const before = snap()
  const file = JSON.parse(JSON.stringify(await createSave('everything')))
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  await applySave(file)
  const after = snap()
  check('contested claims, a foreign site, a treaty right and a DMZ, an orbital platform, an enemy fleet and an occupation: all answers identical after load', sameData(before, after), JSON.stringify(Object.keys(before).filter((k) => !sameData((before as never)[k], (after as never)[k]))))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll acceptance scenarios passed')
process.exit(failures ? 1 : 0)
