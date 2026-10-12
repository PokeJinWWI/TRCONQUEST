// Territorial agreements and their consequences (scene/territorialAgreements.ts,
// scene/territorialIncidents.ts, scene/jurisdiction.decideAccess): rights come from treaties and end with
// them, recognition and transfer go through the claim lifecycle, a ban is law but not force, building in a
// dispute is an incident. All through the existing treaty and opinion systems.
//
// Run:  npx tsx tests/agreements.test.ts
import { DAYS_PER_YEAR } from '../src/data/treatyData'
import { OPINION_ON_DISPUTED_BUILD } from '../src/data/diplomacyData'
import { proposeTreaty, cancelTreaty } from '../src/scene/treaties'
import { buildFacility, planFacility } from '../src/scene/orbitalOrders'
import { planPlacement } from '../src/scene/placementOrders'
import { banForeignConstruction, canEnforce, decideConstructionNow, fileClaimNow, jurisdictionNow, jurisdictionState } from '../src/scene/sovereignty'
import { decideAccess } from '../src/scene/jurisdiction'
import { locationsOf } from '../src/scene/locations'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { resetGame } from '../src/scene/gameReset'
import { relationIn, useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useJurisdictionStore } from '../src/state/jurisdictionStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useTreatyStore } from '../src/state/treatyStore'
import { applySave, createSave } from '../src/state/saveGame'

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
function fresh() {
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 10 })
  useShipStore.setState({ ships: [] })
  for (const n of [MARS, VENUS, ORION]) useResourceStore.getState().setAmount(n, 'alloys', 100000)
}
const body = (id: string) => ({ kind: 'body' as const, id })
const sign = (proposer: string, receiver: string, articles: Parameters<typeof proposeTreaty>[2]) => proposeTreaty(proposer, receiver, articles, 10, 10)

console.log('\n=== 1. A construction right comes from a treaty and ends with it ===')
{
  fresh()
  const site = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  check('before: Venus needs Mars\'s permission', decideConstructionNow(VENUS, { kind: 'location', id: site.id }, 'industrial').legal === 'needs-permission')
  const wrong = sign(VENUS, MARS, [{ kind: 'construction-right', sourceId: VENUS, targetId: MARS, scope: body('Mars') }])
  check('a country cannot grant rights over ground it does not govern', !wrong.ok && /does not govern/.test(wrong.reason), wrong.ok ? '' : wrong.reason)
  const treaty = sign(MARS, VENUS, [{ kind: 'construction-right', sourceId: MARS, targetId: VENUS, scope: body('Mars') }])
  check('Mars signs the right over Mars with Venus', treaty.ok)
  const d = decideConstructionNow(VENUS, { kind: 'location', id: site.id }, 'industrial')
  check('now Venus is authorized under a treaty, and the reason says so', d.legal === 'treaty' && d.allowed && /agreement|treaty/.test(d.reason), d.reason)
  check('...a third country is not', decideConstructionNow(ORION, { kind: 'location', id: site.id }, 'industrial').legal === 'needs-permission')
  const plan = planPlacement(VENUS, 'Mars', { mode: 'simple', id: 'civilianFactory' }, site.id)
  check('Venus can place a factory on Mars\'s ground', plan.ok)
  useLocationStore.getState().establish(site.id, VENUS, 11)
  if (treaty.ok) cancelTreaty(treaty.treatyId, MARS, 20)
  check('cancelling the treaty withdraws the right at once', decideConstructionNow(ORION, { kind: 'location', id: site.id }, 'industrial').legal === 'needs-permission' && !useTreatyStore.getState().treaties.some((t) => t.articles.some((a) => a.kind === 'construction-right')))
  check('...but the factory site stays Venus\'s: withdrawing a right never erases property', siteOwner(site.id) === VENUS)
  const other = locationsOf('Mars').find((s) => s.kind === 'industrial' && s.id !== site.id && !siteOwner(s.id))
  check('...and Venus can no longer build anything new', !other || decideConstructionNow(VENUS, { kind: 'location', id: other.id }, 'industrial').legal === 'needs-permission')
}

console.log('\n=== 2. Access: transit, docking, basing ===')
{
  fresh()
  const st = () => jurisdictionState()
  const at = (nation: string, access: 'transit' | 'dock' | 'basing', scope = body('Mars')) => decideAccess({ nationId: nation, scope, access }, st())
  check('a peaceful sovereign lets others transit and dock', at(VENUS, 'transit').allowed && at(VENUS, 'dock').allowed)
  check('...but not station forces: basing is its own decision', !at(VENUS, 'basing').allowed && at(VENUS, 'basing').legal === 'needs-permission')
  sign(MARS, VENUS, [{ kind: 'access-right', sourceId: MARS, targetId: VENUS, scope: body('Mars'), access: 'basing' }])
  check('a basing right by treaty opens it to Venus alone', at(VENUS, 'basing').legal === 'treaty' && !at(ORION, 'basing').allowed)
  check('open frontier needs nobody\'s leave', decideAccess({ nationId: ORION, scope: body('Ceres'), access: 'basing' }, st()).allowed)
  useDiplomacyStore.getState().forceWar(MARS, ORION, 10)
  check('at war with the sovereign, even docking is refused', at(ORION, 'dock').legal === 'prohibited')
  banForeignConstruction(MARS, body('Mars'), 11)
  useJurisdictionStore.getState().addPermission({ id: 'closed', grantorId: MARS, holderId: '*', action: 'dock', scope: body('Mars'), effect: 'deny', basis: 'decree', since: 11 })
  check('a sovereign can close docking to everyone else, and never to itself', !at(VENUS, 'dock').allowed && at(MARS, 'dock').allowed)
}

console.log('\n=== 3. Recognition and transfer go through the claims ===')
{
  fresh()
  const ceres = body('Ceres')
  fileClaimNow(ceres, VENUS, 'founding', 1)
  fileClaimNow(ceres, ORION, 'founding', 2)
  check('two provisional claims on Ceres: contested, nobody governs', jurisdictionNow(ceres).contested && !jurisdictionNow(ceres).sovereign)
  const rec = sign(VENUS, ORION, [{ kind: 'territorial-recognition', sourceId: VENUS, targetId: ORION, scope: ceres }])
  check('Venus recognizes Orion\'s claim by treaty', rec.ok)
  check('...Venus\'s own claim is given up and Orion governs Ceres (bodyOwner agrees)', jurisdictionNow(ceres).sovereign === ORION && useTerritoryStore.getState().bodyOwner['Ceres'] === ORION)
  const claims = useJurisdictionStore.getState().claims.filter((c) => c.scope.id === 'Ceres')
  check('...and the history is kept: Venus withdrawn, Orion recognized by recognition', claims.find((c) => c.claimantId === VENUS)!.status === 'withdrawn' && claims.find((c) => c.claimantId === ORION)!.basis === 'recognition')
  const again = sign(ORION, VENUS, [{ kind: 'territorial-recognition', sourceId: ORION, targetId: VENUS, scope: ceres }])
  check('a sovereign cannot "recognize" a claim on its own ground: that is a transfer', !again.ok && /transfer/.test(again.reason), again.ok ? '' : again.reason)
  // Third party keeps the dispute alive.
  fresh()
  fileClaimNow(ceres, VENUS, 'founding', 1)
  fileClaimNow(ceres, ORION, 'founding', 2)
  fileClaimNow(ceres, MARS, 'founding', 3)
  sign(VENUS, ORION, [{ kind: 'territorial-recognition', sourceId: VENUS, targetId: ORION, scope: ceres }])
  check('with a third claimant still standing, the recognition is evidence and the dispute remains', jurisdictionNow(ceres).contested && !jurisdictionNow(ceres).sovereign && useJurisdictionStore.getState().claims.find((c) => c.claimantId === ORION)!.evidence.some((e) => e.kind === 'recognition'))

  // Transfer keeps what stands there.
  fresh()
  const phobos = locationsOf('Phobos').find((s) => s.kind === 'settlement')!
  useLocationStore.getState().establish(phobos.id, MARS, 5)
  const t = sign(MARS, VENUS, [{ kind: 'territorial-transfer', fromId: MARS, toId: VENUS, scope: body('Phobos') }])
  check('Mars transfers Phobos to Venus by treaty', t.ok && jurisdictionNow(body('Phobos')).sovereign === VENUS && useTerritoryStore.getState().bodyOwner['Phobos'] === VENUS)
  check('...the settlement site Mars established there is still Mars\'s: sovereignty moved, property did not', siteOwner(phobos.id) === MARS)
  check('...only the country that governs can hand it over', !sign(ORION, VENUS, [{ kind: 'territorial-transfer', fromId: ORION, toId: VENUS, scope: body('Phobos') }]).ok)
}

console.log('\n=== 4. Demilitarized zones ===')
{
  fresh()
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 50)
  const zone = 'Ceres~low'
  const treaty = sign(MARS, VENUS, [{ kind: 'demilitarized-zone', scope: { kind: 'orbit', id: zone } }])
  check('Mars and Venus demilitarize Ceres\'s low orbit', treaty.ok)
  const m = planFacility(MARS, zone, 'defense')
  check('neither may put a defense platform there', !m.ok && /demilitarizes/.test(m.reason) && !planFacility(VENUS, zone, 'defense').ok, m.ok ? '' : m.reason)
  check('...a civilian station is fine', planFacility(MARS, zone, 'station').ok)
  check('...and a country that signed nothing may arm it', planFacility(ORION, zone, 'defense').ok)
}

console.log('\n=== 5. Building in a dispute is an incident ===')
{
  fresh()
  fileClaimNow(body('Ceres'), VENUS, 'founding', 1)
  const before = relationIn(useDiplomacyStore.getState().relations, MARS, VENUS).opinion
  const built = buildFacility(MARS, 'Ceres~low', 'station')
  const after = relationIn(useDiplomacyStore.getState().relations, MARS, VENUS).opinion
  check('Mars may build in orbit over a world Venus claims, as a dispute', built.ok)
  check('...Venus\'s opinion of Mars falls by the incident cost', after - before === OPINION_ON_DISPUTED_BUILD, `${before} -> ${after}`)
  check('...and the player is told', useDiplomacyStore.getState().events.some((e) => e.kind === 'territorial-incident'))
  const quiet = relationIn(useDiplomacyStore.getState().relations, MARS, ORION).opinion
  buildFacility(MARS, 'Ceres~high', 'station')
  check('a third country with no claim is not offended', relationIn(useDiplomacyStore.getState().relations, MARS, ORION).opinion === quiet)
}

console.log('\n=== 6. A ban is law, not force ===')
{
  fresh()
  banForeignConstruction(MARS, body('Mars'), 10)
  const site = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  const banned = decideConstructionNow(VENUS, { kind: 'location', id: site.id }, 'industrial')
  check('Mars bans foreign construction on Mars: Venus is prohibited', banned.legal === 'prohibited' && !banned.allowed, banned.reason)
  check('...Mars itself is not', decideConstructionNow(MARS, { kind: 'location', id: site.id }, 'industrial').legal === 'authorized')
  check('Mars can enforce the ban while its orbit is its own', canEnforce(MARS, 'Mars'))
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 10)
  for (let i = 0; i < 3; i++) spawnOwnedShip('cruiser', VENUS, 'sol', 'Mars')
  check('with an enemy fleet holding the orbit the ban cannot be enforced...', !canEnforce(MARS, 'Mars'))
  check('...though it is still the standing law (the decree stays on the books)', jurisdictionState().permissions.some((p) => p.holderId === '*' && p.effect === 'deny' && p.grantorId === MARS))
}

console.log('\n=== 7. Save and load ===')
{
  fresh()
  sign(MARS, VENUS, [{ kind: 'construction-right', sourceId: MARS, targetId: VENUS, scope: body('Mars') }, { kind: 'demilitarized-zone', scope: { kind: 'orbit', id: 'Ceres~low' } }])
  const site = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  const file = JSON.parse(JSON.stringify(await createSave('agreements')))
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  check('a reset ends the treaties and their rights', decideConstructionNow(VENUS, { kind: 'location', id: site.id }, 'industrial').legal === 'needs-permission')
  await applySave(file)
  check('after loading the right and the zone are back, derived from the saved treaties', decideConstructionNow(VENUS, { kind: 'location', id: site.id }, 'industrial').legal === 'treaty' && !planFacility(MARS, 'Ceres~low', 'defense').ok)
  void DAYS_PER_YEAR
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll agreement checks passed')
process.exit(failures ? 1 : 0)
