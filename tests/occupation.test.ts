// Blockade, occupation, transfer: three different things (scene/occupation.ts and what it connects to).
// Acceptance G and H: A tries to remove B from a planet; a blockade disrupts supply, an occupation changes
// military control, a treaty may transfer sovereignty, and assets are never silently erased.
//
// Run:  npx tsx tests/occupation.test.ts
import { ISOLATION_FACTOR } from '../src/data/infrastructureData'
import { describeControlChange, controlSnapshot, type ControlSnapshot } from '../src/scene/occupation'
import { surveyRoute } from '../src/scene/infrastructureNet'
import { accessOnBody, buildRoute } from '../src/scene/infrastructureOrders'
import { buildFacility } from '../src/scene/orbitalOrders'
import { orbitalAccessNow, orbitalControlNow, orbitalForcesAt } from '../src/scene/orbitalState'
import { decideConstructionNow, grantPermission, jurisdictionNow, transferSovereignty } from '../src/scene/sovereignty'
import { locationsOf } from '../src/scene/locations'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { resetGame } from '../src/scene/gameReset'
import { canRecruitAt } from '../src/state/armyStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useInfrastructureStore } from '../src/state/infrastructureStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { useOrbitalStore } from '../src/state/orbitalStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
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
const body = { kind: 'body' as const, id: 'Mars' }

console.log('\n=== 1. The diff tells what moved and what did not (pure) ===')
{
  const a: ControlSnapshot = { bodyName: 'X', sovereign: 'a', controller: 'a', orbitController: undefined, property: { s1: 'a', s2: 'b' } }
  const b: ControlSnapshot = { ...a, controller: 'b', orbitController: 'b' }
  const d = describeControlChange(a, b)
  check('a change of ground and orbital control is listed as changed, sovereignty and property as unchanged', d.changed.length === 2 && d.unchanged.some((l) => /Sovereignty: still a/.test(l)) && d.unchanged.some((l) => /Property: all 2 holdings/.test(l)), JSON.stringify(d))
  const moved = describeControlChange(a, { ...a, property: { s1: 'b', s2: 'b' } })
  check('property that changed hands is named, not hidden', moved.changed.length === 1 && /s1: a -> b/.test(moved.changed[0]))
}

console.log('\n=== 2. A war over Mars: blockade, then occupation, then a treaty ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 10 })
  useShipStore.setState({ ships: [] })
  for (const n of [MARS, VENUS]) {
    useResourceStore.getState().setAmount(n, 'alloys', 100000)
    useResourceStore.getState().setAmount(n, 'minerals', 100000)
  }
  // What stands on Mars: Mars's defense platform and a route, and a Venus-owned site (a concession).
  const platform = buildFacility(MARS, 'Mars~low', 'defense')
  useGameTimeStore.setState({ simDays: 1000 })
  const sites = locationsOf('Mars').filter((s) => s.node !== null)
  const factory = sites.find((s) => s.kind === 'industrial')!
  let ends: [string, string] | null = null
  for (const x of sites) for (const y of sites) if (!ends && x.id < y.id && !surveyRoute('Mars', x.node!, y.node!).blocked) ends = [x.id, y.id]
  const route = buildRoute(MARS, ends![0], ends![1], 'road')
  const portSite = sites.find((s) => s.kind === 'infrastructure')!
  const venusSite = sites.find((s) => s.kind === 'resource' && !s.material)!
  grantPermission({ id: 'c', grantorId: MARS, holderId: VENUS, scope: body, effect: 'allow', basis: 'concession', since: 1 })
  useLocationStore.getState().establish(venusSite.id, VENUS, 5)
  check('Mars has a defense platform and a route; Venus has a site there', platform.ok && route.ok && siteOwner(venusSite.id) === VENUS)
  const s0 = controlSnapshot('Mars')
  check('peacetime: Mars governs and holds Mars, and its working platform holds the orbit', s0.sovereign === MARS && s0.controller === MARS && s0.orbitController === MARS)

  // Blockade.
  useDiplomacyStore.getState().forceWar(VENUS, MARS, 1000)
  for (let i = 0; i < 4; i++) spawnOwnedShip('cruiser', VENUS, 'sol', 'Mars')
  const s1 = controlSnapshot('Mars')
  const blockade = describeControlChange(s0, s1)
  check('a blockade changes who holds the ORBIT and nothing else', s1.orbitController === VENUS && blockade.changed.length === 1 && /Orbital control: .* -> /.test(blockade.changed[0]) && blockade.unchanged.some((l) => /Sovereignty: still/.test(l)) && blockade.unchanged.some((l) => /Ground control: still/.test(l)) && blockade.unchanged.some((l) => /Property/.test(l)), JSON.stringify(blockade))
  const supply = orbitalAccessNow(MARS, 'Mars')
  const recruit = canRecruitAt(MARS, 'Mars')
  check('...but it cuts Mars\'s supply and reinforcement', !supply.ok && !recruit.ok && /Blockaded/.test(recruit.reason))
  check('...and Mars\'s own platform is outnumbered, not captured', (orbitalForcesAt('Mars')[MARS] ?? 0) === 3 && useOrbitalStore.getState().facilities.some((f) => f.ownerId === MARS))

  // Occupation.
  useTerritoryStore.getState().occupyBody('Mars', VENUS)
  const s2 = controlSnapshot('Mars')
  const occupation = describeControlChange(s1, s2)
  check('an occupation changes GROUND control; sovereignty and property are unchanged', s2.controller === VENUS && s2.sovereign === MARS && occupation.changed.length === 1 && /Ground control/.test(occupation.changed[0]) && occupation.unchanged.some((l) => /Property: all/.test(l)), JSON.stringify(occupation))
  check('...Mars is still the sovereign: jurisdiction and bodyOwner both say so', jurisdictionNow(body).sovereign === MARS && useTerritoryStore.getState().bodyOwner['Mars'] === MARS)
  const cut = accessOnBody('Mars', MARS)
  check('Mars\'s supply connections on the occupied world are cut: every site is isolated for it', Object.values(cut).every((f) => f === ISOLATION_FACTOR))
  check('Mars\'s defense platform is cut off from its owner while the world is occupied', (orbitalForcesAt('Mars')[MARS] ?? 0) === 0)

  const infra = decideConstructionNow(VENUS, { kind: 'location', id: portSite.id }, 'infrastructure')
  const settle = decideConstructionNow(VENUS, { kind: 'location', id: sites.find((s) => s.kind === 'settlement' && !s.fixed)?.id ?? factory.id }, 'settlement')
  check('the occupier may build what the occupation needs: the LAW gives it a limited right (whether the site is free is a separate, physical question)...', infra.legal === 'limited-right', infra.reason)
  check('...but not settle the ground it holds by force', !settle.allowed && settle.legal === 'prohibited', settle.reason)
  check('the sovereign cannot build on its own occupied ground', decideConstructionNow(MARS, { kind: 'location', id: factory.id }, 'industrial').legal === 'military-restricted')

  // Treaty transfer.
  const t = transferSovereignty(body, VENUS, 1100)
  const s3 = controlSnapshot('Mars')
  const treaty = describeControlChange(s2, s3)
  check('a treaty transfer changes SOVEREIGNTY', t.ok && s3.sovereign === VENUS && treaty.changed.some((l) => /Sovereignty: .* -> /.test(l)))
  check('...and not one holding changes hands: the route, the platform and both sites are still their owners\'', Object.keys(s2.property).every((id) => s3.property[id] === s2.property[id]) && Object.keys(s2.property).length >= 3, Object.keys(s2.property).length + ' holdings')
  check('Mars still owns its platform and its route on ground that is now Venus\'s', useOrbitalStore.getState().facilities.some((f) => f.ownerId === MARS) && useInfrastructureStore.getState().routes.every((r) => r.ownerId === MARS))
  check('...Venus\'s site, held under Mars\'s concession, is still Venus\'s', siteOwner(venusSite.id) === VENUS)

  // Liberation: a different outcome of the same war.
  useTerritoryStore.getState().cedeBody('Mars', MARS)
  useTerritoryStore.getState().occupyBody('Mars', VENUS)
  useTerritoryStore.getState().liberateBody('Mars')
  check('liberation hands ground control back without touching sovereignty or property', controlSnapshot('Mars').controller === MARS && controlSnapshot('Mars').sovereign === MARS && controlSnapshot('Mars').property[venusSite.id] === VENUS)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll occupation checks passed')
process.exit(failures ? 1 : 0)
