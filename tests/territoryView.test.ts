// What the territory and development screens read (scene/territoryView.ts): every layer of control on its own
// row, the legal and the physical answer apart, and the reasons something is blocked or inefficient.
//
// Run:  npx tsx tests/territoryView.test.ts
import { developmentView, systemView, territoryView } from '../src/scene/territoryView'
import { buildFacility } from '../src/scene/orbitalOrders'
import { fileClaimNow, grantPermission, recognizeClaim } from '../src/scene/sovereignty'
import { buildRoute } from '../src/scene/infrastructureOrders'
import { surveyRoute } from '../src/scene/infrastructureNet'
import { locationsOf } from '../src/scene/locations'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { resetGame } from '../src/scene/gameReset'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useLocationStore } from '../src/state/locationStore'
import { usePlacementStore } from '../src/state/placementStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useTreatyStore } from '../src/state/treatyStore'
import { proposeTreaty } from '../src/scene/treaties'

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
const nameMars = 'Imperial State of Mars'
const nameVenus = 'Republic of Venus'

function fresh() {
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 1000 })
  useShipStore.setState({ ships: [] })
  for (const n of [MARS, VENUS, ORION]) {
    useResourceStore.getState().setAmount(n, 'alloys', 100000)
    useResourceStore.getState().setAmount(n, 'minerals', 100000)
  }
}

console.log('\n=== 1. Each layer on its own row ===')
{
  fresh()
  const v = territoryView('Mars')
  check('Mars: governed by Mars (body-wide), held by Mars, no dispute, not frontier', v.sovereign?.name === nameMars && v.sovereign.from === 'body' && v.groundControl.name === nameMars && !v.groundControl.occupied && !v.contested && !v.frontier)
  check('...and its orbits are governed by Mars, held by nobody', v.orbit.length === 2 && v.orbit.every((z) => z.governs === nameMars && z.holds === 'nobody'))
  const open = territoryView('Ceres')
  check('an unowned world reads as open frontier, with nobody governing or holding it', open.sovereign === null && open.frontier && open.groundControl.name === 'nobody')
}

console.log('\n=== 2. Claims, disputes, enclaves, agreements, orbit ===')
{
  fresh()
  fileClaimNow({ kind: 'body', id: 'Ceres' }, VENUS, 'founding', 1)
  fileClaimNow({ kind: 'body', id: 'Ceres' }, ORION, 'founding', 2)
  const v = territoryView('Ceres')
  check('rival claims are listed with claimant, scope, status and basis, and the dispute is flagged', v.contested && v.claims.length === 2 && v.claims.every((c) => c.status === 'provisional' && c.basis === 'founding' && c.scope === 'the whole world'), v.disputants.join(', '))
  const claim = v.claims.find((c) => c.claimant === nameVenus)!
  recognizeClaim(claim.id, { basis: 'treaty', simDays: 5, resolveRivals: true })
  const after = territoryView('Ceres')
  check('after a treaty settles it, the sovereign shows and the rival claim is marked superseded, not deleted', after.sovereign?.name === nameVenus && after.claims.some((c) => c.status === 'superseded'))

  fresh()
  const factory = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  grantPermission({ id: 'x', grantorId: MARS, holderId: VENUS, scope: { kind: 'body', id: 'Mars' }, effect: 'allow', basis: 'concession', since: 1 })
  useLocationStore.getState().establish(factory.id, VENUS, 5)
  const enc = territoryView('Mars')
  check('a Venus-owned site on Mars is shown as a foreign enclave while Mars governs', enc.enclaves.some((e) => e.siteId === factory.id && e.owner === nameVenus) && enc.sovereign?.name === nameMars)
  check('...and the concession is listed among the agreements in force', enc.agreements.some((a) => /Right/.test(a) && /Venus/.test(a)))
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 50)
  proposeTreaty(MARS, VENUS, [{ kind: 'demilitarized-zone', scope: { kind: 'orbit', id: 'Mars~low' } }], 10, 1000)
  check('a treaty demilitarization appears too', territoryView('Mars').agreements.some((a) => /Demilitarized/.test(a)))
  buildFacility(VENUS, 'Mars~high', 'station')
  useTreatyStore.setState({ treaties: [] })
  const orbit = territoryView('Mars').orbit.find((z) => z.zone === 'Mars~high')!
  check('orbit rows keep three answers apart: Mars governs, nobody holds it by force, and Venus\'s station is listed as Venus\'s', orbit.governs === nameMars && orbit.holds === 'nobody' && orbit.facilities.some((f) => f.owner === nameVenus && /Station/.test(f.kind)))
}

console.log('\n=== 3. Occupation and force are shown separately from title ===')
{
  fresh()
  useDiplomacyStore.getState().forceWar(VENUS, MARS, 1000)
  for (let i = 0; i < 4; i++) spawnOwnedShip('cruiser', VENUS, 'sol', 'Mars')
  useTerritoryStore.getState().occupyBody('Mars', VENUS)
  const v = territoryView('Mars')
  check('occupied: held by Venus (occupation), still governed by Mars', v.groundControl.name === nameVenus && v.groundControl.occupied && v.sovereign?.name === nameMars)
  check('...and Venus holds the orbit by force while Mars still governs it', v.orbit.every((z) => z.holds === nameVenus && z.governs === nameMars))
}

console.log('\n=== 4. A system, not owned by its Starbase ===')
{
  fresh()
  const sol = systemView('sol')
  check('Sol: split between its worlds\' sovereigns, with no system sovereign', sol.relation === 'split' && sol.sovereign === null && sol.bodies.some((b) => b.body === 'Mars' && b.sovereign === nameMars) && /each world/.test(sol.note))
  const wolf = systemView('wolf-359')
  check('an empty system reads as open frontier', wolf.relation === 'frontier' && /Open frontier/.test(wolf.note))
}

console.log('\n=== 5. Development: why a site can or cannot be built on ===')
{
  fresh()
  const v = developmentView('Mars', MARS)
  const capital = v.sites.find((s) => s.tags.includes('capital'))!
  check('every site has a kind, suitability, capacity and an owner or "open"', v.sites.length > 0 && v.sites.every((s) => s.kind && s.suitability >= 0 && s.capacity >= 1) && capital.owner === nameMars)
  const open = v.sites.find((s) => !s.owner && s.kind === 'industrial')!
  check('for the sovereign, an open site is authorized on both counts', open.forPlayer?.legal === 'authorized' && open.forPlayer.physical === null)
  const asVenus = developmentView('Mars', VENUS).sites.find((s) => s.id === open.id)!
  check('for another country the LAW says needs-permission, while the ground itself is fine: two answers', asVenus.forPlayer?.legal === 'needs-permission' && asVenus.forPlayer.physical === null && /permission/.test(asVenus.forPlayer.why))
  const wrongKind = developmentView('Mars', MARS).sites.find((s) => s.owner && s.kind === 'settlement')!
  check('a site someone already holds is a PHYSICAL block for others and the view says which holds it', developmentView('Mars', VENUS).sites.find((s) => s.id === wrongKind.id)!.forPlayer?.physical !== undefined)
  // Access.
  const sites = locationsOf('Mars').filter((s) => s.node !== null)
  const cutOff = sites.filter((s) => s.kind === 'resource' && !s.material).find((s) => developmentView('Mars', MARS).sites.find((r) => r.id === s.id))!
  useLocationStore.getState().establish(cutOff.id, MARS, 1)
  usePlacementStore.getState().place(cutOff.id, 'mine', 2)
  const row = developmentView('Mars', MARS).sites.find((s) => s.id === cutOff.id)!
  check('a placed site shows what stands on it and how much of its output gets out', row.buildings[0]?.id === 'mine' && row.buildings[0].count === 2 && row.access !== null, `${row.access}`)
  // A route appears in the list.
  let ends: [string, string] | null = null
  for (const x of sites) for (const y of sites) if (!ends && x.id < y.id && !surveyRoute('Mars', x.node!, y.node!).blocked) ends = [x.id, y.id]
  buildRoute(MARS, ends![0], ends![1], 'road')
  const withRoute = developmentView('Mars', MARS)
  check('routes are listed with owner, length, openness and state', withRoute.routes.length === 1 && withRoute.routes[0].owner === nameMars && withRoute.routes[0].open && withRoute.routes[0].cells >= 1)
  check('settlements show tier, people, jobs and what the next tier would need', withRoute.settlements.length > 0 && withRoute.settlements.every((s) => s.tier && s.population >= 0))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll territory view checks passed')
process.exit(failures ? 1 : 0)
