// System sovereignty is separate from Starbases (scene/systemTerritory.ts, scene/sovereignty.ts):
// a Starbase is presence and a provisional claim, never sovereignty; bodies keep their own
// sovereigns inside a system; the map's border drawing is a drawing, not a legal answer.
//
// Run:  npx tsx tests/systemSovereignty.test.ts
import { STARBASE_COST } from '../src/data/starbaseData'
import { findStar } from '../src/data/starData'
import { systemTerritory, systemTerritoryNow } from '../src/scene/systemTerritory'
import { decideConstruction, type JurisdictionState } from '../src/scene/jurisdiction'
import { claimSystemForStarbase, decideConstructionNow, fileClaimNow, jurisdictionNow, jurisdictionState, recognizeClaim } from '../src/scene/sovereignty'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { systemBodies, systemClaim } from '../src/scene/territory'
import { resetGame } from '../src/scene/gameReset'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTechStore, DEFAULT_RESEARCHED } from '../src/state/techStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useJurisdictionStore } from '../src/state/jurisdictionStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'

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

console.log('\n=== 1. Layers, pure ===')
{
  // Sol: Mars and Venus own worlds; Orion has a Starbase there.
  const state: JurisdictionState = { ...jurisdictionState(), claims: [], permissions: [] }
  resetGame()
  const t = systemTerritory('sol', jurisdictionState(), [ORION])
  check('a Starbase is presence: Orion is listed, and is not the sovereign', t.presence.join() === ORION && t.sovereign !== ORION)
  check('Sol is split: Mars and Venus each govern their own worlds, nobody governs the system', t.relation === 'split' && t.sovereign === undefined && t.bodySovereigns['Mars'] === MARS && t.bodySovereigns['Venus'] === VENUS)
  check('the map still draws it as contested by all three (a drawing, not a ruling)', t.drawn.kind === 'contested' && (t.drawn as { countryIds: string[] }).countryIds.includes(ORION))
  void state
  const solo = systemTerritory('barnards-star', jurisdictionState(), [ORION])
  check('an empty system with only a Starbase: drawn as Orion\'s, legally open frontier', solo.drawn.kind === 'owned' && solo.relation === 'frontier' && solo.sovereign === undefined)
  check('...and building there is open to anyone', decideConstruction({ builderId: MARS, scope: { kind: 'system', id: 'barnards-star' }, asset: 'starbase' }, jurisdictionState()).legal === 'authorized')
}

console.log('\n=== 2. A recognized system claim is sovereignty; bodies keep their own ===')
{
  resetGame()
  const filed = fileClaimNow({ kind: 'system', id: 'sol' }, MARS, 'founding', 1)
  check('a provisional system claim leaves the system without a sovereign', filed.ok && jurisdictionNow({ kind: 'system', id: 'sol' }).sovereign === undefined)
  const t0 = systemTerritoryNow('sol')
  check('...and the system is contested while Venus owns worlds there', t0.relation === 'contested' && t0.claimants.includes(MARS))
  const rec = filed.ok ? recognizeClaim(filed.claim.id, { basis: 'treaty', simDays: 5 }) : { ok: false as const, reason: '' }
  const t = systemTerritoryNow('sol')
  check('recognized by treaty, Mars is the system\'s sovereign', rec.ok && t.sovereign === MARS && t.relation === 'sovereign')
  check('...but Venus still governs Venus: a body\'s own sovereign outranks the system\'s', jurisdictionNow({ kind: 'body', id: 'Venus' }).sovereign === VENUS && t.bodySovereigns['Venus'] === VENUS)
  const d = decideConstructionNow(ORION, { kind: 'system', id: 'sol' }, 'starbase')
  check('Orion\'s Starbase in Mars\'s system now needs permission', d.legal === 'needs-permission' && !d.allowed, d.reason)
  const inVenus = decideConstructionNow(ORION, { kind: 'body', id: 'Venus' }, 'colony')
  check('...a colony on Venus is Venus\'s decision, not Mars\'s', inVenus.jurisdiction.sovereign === VENUS)
  check('the system claim is not recorded as body ownership: bodyOwner is untouched', useTerritoryStore.getState().bodyOwner['Venus'] === VENUS && !Object.values(useTerritoryStore.getState().bodyOwner).some((o) => o === 'none'))
}

console.log('\n=== 3. Building a Starbase files a provisional claim, nothing more ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const star = 'wolf-359'
  useGameTimeStore.setState({ simDays: 100 })
  useTechStore.setState((s) => ({ byCountry: { ...s.byCountry, [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, 'orbital-construction']) } } }))
  useResourceStore.getState().addAmount(MARS, 'influence', 1000)
  for (const body of systemBodies(star)) useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: body }, 0, 0)
  useSurveyStore.getState().discover(MARS, { kind: 'explored', starId: star }, 0, 0)
  const builder = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setShipCargo(builder, { ...STARBASE_COST })
  useShipStore.getState().setShipLocation(builder, { kind: 'orbiting', systemId: star, bodyName: findStar(star)!.name, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
  const built = useStarbaseStore.getState().build(MARS, star, 100, builder)
  check('Mars builds a Starbase at Wolf 359', built.ok, built.ok ? '' : built.reason)
  const claims = useJurisdictionStore.getState().claims.filter((c) => c.scope.kind === 'system' && c.scope.id === star)
  check('it files ONE provisional system claim, with the Starbase as administration evidence', claims.length === 1 && claims[0].claimantId === MARS && claims[0].status === 'provisional' && claims[0].evidence.some((e) => e.kind === 'administration'))
  check('Mars has presence there and is not its sovereign', systemTerritoryNow(star).presence.includes(MARS) === false /* still being built */ && jurisdictionNow({ kind: 'system', id: star }).sovereign === undefined)
  useGameTimeStore.setState({ simDays: 100 + 10000 })
  check('...finished, it is presence and still no sovereignty', systemTerritoryNow(star).presence.includes(MARS) && systemTerritoryNow(star).sovereign === undefined && systemTerritoryNow(star).relation === 'frontier')
  // A rival's Starbase files its own: contested, not anyone's.
  claimSystemForStarbase(VENUS, star, 200)
  check('a rival\'s Starbase at the same star makes the system contested', jurisdictionNow({ kind: 'system', id: star }).contested)
  // Losing the Starbase does not change who governs.
  useStarbaseStore.setState({ starbases: [] })
  check('destroying every Starbase changes presence but not the claims or the sovereign', systemTerritoryNow(star).presence.length === 0 && useJurisdictionStore.getState().claims.filter((c) => c.scope.id === star).length === 2 && systemTerritoryNow(star).sovereign === undefined)
  // The treaty can settle it.
  const mine = useJurisdictionStore.getState().claims.find((c) => c.scope.id === star && c.claimantId === MARS)!
  const settled = recognizeClaim(mine.id, { basis: 'treaty', simDays: 300, resolveRivals: true })
  check('a treaty recognizes one and supersedes the other', settled.ok && systemTerritoryNow(star).sovereign === MARS && useJurisdictionStore.getState().claims.find((c) => c.claimantId === VENUS)!.status === 'superseded')
}

console.log('\n=== 4. The legal layer never reads a Starbase ===')
{
  const keys = Object.keys(jurisdictionState())
  check('the jurisdiction state has claims, permissions, owners, control, war and geography: no Starbases', !keys.some((k) => /starbase/i.test(k)), keys.join(', '))
  const fs = await import('node:fs')
  const legal = ['src/scene/claims.ts', 'src/scene/jurisdiction.ts'].map((f) => fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')).join('\n')
  check('claims.ts and jurisdiction.ts import nothing about Starbases (only the asset-kind name)', !/starbaseStore|starbaseLogic|starbaseOwnersOf|useStarbase/.test(legal))
  void systemClaim
}

console.log(failures ? `\n${failures} FAILED` : '\nAll system sovereignty checks passed')
process.exit(failures ? 1 : 0)
