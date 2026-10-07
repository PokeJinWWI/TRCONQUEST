// Regression: "surveyed" is ONE rule (surveyLogic.isBodySurveyed). A nation knows
// every body of a system it owns a world in, so there is nothing to survey there
// (Pluto, for a nation living in Sol); colonizing must accept exactly that, not ask
// for a survey that cannot be made.
// Run: npx tsx tests/colonySurvey.test.ts
import { STARBASE_INTEGRITY } from '../src/data/starbaseData'
import { colonizeCandidates, canColonize, loadSettlersFree } from '../src/scene/colonies'
import { readFileSync } from 'node:fs'
import { COLONY_SHIP_SETTLERS } from '../src/data/colonyData'
import { getCountry } from '../src/data/countryData'
import { spawnBuiltShip } from '../src/scene/shipyardLogic'
import type { ShipBuildOrder } from '../src/state/shipyardStore'
import { pickColonyTarget } from '../src/ai/expander'
import { buildBlackboard } from '../src/ai/blackboard'
import { captureSnapshot } from '../src/ai/snapshot'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { isBodySurveyed, knownSurveyedBodies, unsurveyedBodies } from '../src/scene/surveyLogic'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useSurveyStore } from '../src/state/surveyStore'
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
usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
useGameTimeStore.setState({ simDays: 100, paused: false })
useShipStore.setState({ ships: [] })
useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
useTerritoryStore.getState().reset()
const owners = useTerritoryStore.getState().bodyOwner
const ship = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!

console.log('\n=== Pluto, for a nation that lives in Sol ===')
check('nobody owns Pluto at the start', !owners['Pluto'])
check('Mars has surveyed nothing by ship', !useSurveyStore.getState().discovered[MARS]?.surveyed.has('Pluto'))
check('yet Pluto counts as surveyed: Mars owns worlds in Sol', isBodySurveyed(undefined, MARS, 'Pluto', owners))
check('...so there is nothing left to survey in Sol (the survey order is refused)', unsurveyedBodies(undefined, MARS, 'sol', owners).length === 0)
check('the bodies it knows include Pluto, and nothing of a system it holds nothing in', knownSurveyedBodies(undefined, MARS, owners).has('Pluto') && !knownSurveyedBodies(undefined, MARS, owners).has('Sirius b'))

const colonist = spawnOwnedShip('colony-ship', MARS, 'sol', 'Mars')!
useShipStore.getState().setSettlers(colonist, 20)
const before = canColonize(ship(colonist), 'Pluto', { anywhere: true })
check('colonizing Pluto is NOT refused for want of a survey', before.ok || !/Survey/.test(before.reason), before.ok ? 'ok' : before.reason)
check('...and needs no Starbase either: Sol is Mars\'s home system (colonies.isHomeSystem)', before.ok, before.ok ? '' : before.reason)
useStarbaseStore.setState({ starbases: [{ id: 'sb-test', starId: 'sol', ownerId: MARS, integrity: STARBASE_INTEGRITY, readySimDays: 0, tier: 'starbase', modules: [] }] })
const after = canColonize(ship(colonist), 'Pluto', { anywhere: true })
check('with a Starbase in Sol it can be colonized just the same', after.ok, after.ok ? '' : after.reason)
check('...and is offered in the Colony Ship\'s list', colonizeCandidates(ship(colonist)).some((c) => c.bodyName === 'Pluto'))
check('a body of a system it holds nothing in still needs a survey', (() => { const r = canColonize(ship(colonist), 'Sirius b', { anywhere: true }); return !r.ok && /Survey/.test(r.reason) })())

console.log('\n=== The AI reads the same rule ===')
useStarbaseStore.setState({ starbases: [{ id: 'sb-venus', starId: 'sol', ownerId: VENUS, integrity: STARBASE_INTEGRITY, readySimDays: 0, tier: 'starbase', modules: [] }] })
const snap = captureSnapshot(100)
const target = pickColonyTarget(buildBlackboard(VENUS, snap), snap)
check('an AI nation living in Sol, with a Starbase there, sees a world of Sol to colonize without surveying it', !!target && target.starId === 'sol', target?.bodyName ?? 'none')

console.log('\n=== Settlers aboard ===')
{
  const built = spawnBuiltShip({ classId: 'colony-ship' } as ShipBuildOrder, getCountry(MARS)!)!
  check('a Colony Ship built at the yard (Simple mode) takes its settlers from the capital', ship(built).settlers === COLONY_SHIP_SETTLERS, `${ship(built).settlers}`)
  const placed = spawnOwnedShip('colony-ship', MARS, 'sol', 'Mars')!
  check('one merely placed has none...', !ship(placed).settlers)
  loadSettlersFree(placed)
  check('...until the cheat spawn loads it (Debug Console / Sandbox panel)', ship(placed).settlers === COLONY_SHIP_SETTLERS)
  const scout = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  loadSettlersFree(scout)
  check('a ship that carries no settlers is left alone', !ship(scout).settlers)
  check('both cheat spawns call it', /loadSettlersFree\(spawnedId\)/.test(readFileSync(new URL('../src/components/DebugConsole.tsx', import.meta.url), 'utf8')) && /loadSettlersFree\(id\)/.test(readFileSync(new URL('../src/components/SandboxPanel.tsx', import.meta.url), 'utf8')))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
