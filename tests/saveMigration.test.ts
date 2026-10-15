// Saves from before the territorial model, and the versioning strategy (state/saveGame.ts): an old file
// loads, keeps what it had, and gets the records the new model keeps for what already exists; store
// migrations chain; derived state is recomputed, never trusted from the file.
//
// Run:  npx tsx tests/saveMigration.test.ts
import { COLONY_FOUNDING_DAYS } from '../src/data/colonyData'
import { STARBASE_COST } from '../src/data/starbaseData'
import { findStar } from '../src/data/starData'
import { applyShipCommand } from '../src/scene/shipCommands'
import { embarkSettlers } from '../src/scene/colonies'
import { resolveColonies } from '../src/hooks/useColonyResolver'
import { jurisdictionNow } from '../src/scene/sovereignty'
import { orbitalControlNow } from '../src/scene/orbitalState'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { siteOwner } from '../src/state/locationStore'
import { useColonyStore } from '../src/state/colonyStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useJurisdictionStore } from '../src/state/jurisdictionStore'
import { usePlacementStore } from '../src/state/placementStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { STORE_REGISTRY } from '../src/state/gameStores'
import { SAVE_VERSION, SaveError, applySave, createSave } from '../src/state/saveGame'
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
const NEW_STORES = ['locations', 'jurisdiction', 'placement', 'infrastructure', 'orbital']

console.log('\n=== 1. A save from before the territorial model ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  useShipStore.setState({ ships: [] })
  useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: 'Titan' }, 0, 0)
  const ship = spawnOwnedShip('colony-ship', MARS, 'sol', 'Titan')!
  embarkSettlers(ship, MARS)
  applyShipCommand(ship, { kind: 'colonize', bodyName: 'Titan' }, 10)
  resolveColonies(10 + COLONY_FOUNDING_DAYS)
  useStarbaseStore.setState({ starbases: [{ id: 'sb-w', starId: 'wolf-359', ownerId: MARS, integrity: 50, readySimDays: 5 }] })
  void STARBASE_COST
  void findStar
  const colonyBefore = useColonyStore.getState().colonies['Titan']
  const file = JSON.parse(JSON.stringify(await createSave('old')))
  // Make it look like a file written before the territorial stores existed.
  file.version = 1
  for (const key of NEW_STORES) delete file.stores[key]
  const colony = file.stores.colonies.data.colonies.Titan
  delete colony.siteId
  check('the file really is old: no territorial stores, a colony with no site, no claims', NEW_STORES.every((k) => !(k in file.stores)) && !('siteId' in colony))
  resetGame()
  await applySave(file)
  const colonyAfter = useColonyStore.getState().colonies['Titan']
  check('it loads, and the colony is still there with its owner and stage', !!colonyAfter && colonyAfter.stage === colonyBefore.stage && useTerritoryStore.getState().bodyOwner['Titan'] === MARS)
  check('...the colony now stands on a settlement site Mars holds, with its settlement claim', !!colonyAfter.siteId && siteOwner(colonyAfter.siteId) === MARS && useJurisdictionStore.getState().claims.some((c) => c.scope.kind === 'region' && c.claimantId === MARS && c.basis === 'settlement'))
  check('...the old Starbase got its provisional system claim, and no sovereignty over the system', useJurisdictionStore.getState().claims.some((c) => c.scope.kind === 'system' && c.scope.id === 'wolf-359' && c.status === 'provisional') && jurisdictionNow({ kind: 'system', id: 'wolf-359' }).sovereign === undefined)
  check('legacy body ownership is still body-wide sovereignty only: Titan is Mars\'s, Saturn is not (nothing widened)', jurisdictionNow({ kind: 'body', id: 'Titan' }).sovereign === MARS && jurisdictionNow({ kind: 'body', id: 'Saturn' }).sovereign === undefined && jurisdictionNow({ kind: 'system', id: 'sol' }).sovereign === undefined)
  const claims = useJurisdictionStore.getState().claims.length
  const again = JSON.parse(JSON.stringify(file))
  await applySave(again)
  check('loading the same old file again gives the same records (the upgrade is idempotent)', useJurisdictionStore.getState().claims.length === claims)
}

console.log('\n=== 2. Versions ===')
{
  check('the envelope is version 3, and a version-1 file is accepted', SAVE_VERSION === 3)
  resetGame()
  const file = JSON.parse(JSON.stringify(await createSave('v')))
  await applySave({ ...file, version: 1 })
  check('a file from the first save format loads', true)
  let err = ''
  try { await applySave({ ...file, version: SAVE_VERSION + 1 }) } catch (e) { err = e instanceof SaveError ? e.message : String(e) }
  check('a file from a newer build is refused with a readable message', /newer version/.test(err), err)
  // Store migrations chain, one version at a time.
  const entry = STORE_REGISTRY.find((e) => e.key === 'gameTime')!
  const originalVersion = entry.version
  const originalMigrate = entry.migrate
  const steps: number[] = []
  entry.version = 3
  entry.migrate = (saved, from) => {
    steps.push(from)
    return { ...(saved as object), simDays: ((saved as { simDays: number }).simDays ?? 0) + 1 }
  }
  resetGame()
  useGameTimeStore.setState({ simDays: 100 })
  const old = JSON.parse(JSON.stringify(await createSave('m')))
  old.stores.gameTime.version = 1
  await applySave(old)
  check('a store several versions behind is migrated one step at a time, in order', steps.join() === '1,2' && useGameTimeStore.getState().simDays === 102, steps.join())
  entry.migrate = undefined
  let missing = ''
  try { await applySave(old) } catch (e) { missing = e instanceof SaveError ? e.message : String(e) }
  check('with no migration written, an old store is a hard, readable error, never a silent partial load', /no migration/.test(missing), missing)
  entry.version = originalVersion
  entry.migrate = originalMigrate
}

console.log('\n=== 2b. A save from before districts were placed on sites ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const file = JSON.parse(JSON.stringify(await createSave('pre-levels')))
  file.stores.placement = { version: 1, data: { placed: {} } }
  resetGame()
  await applySave(file)
  check('an old save with nothing placed starts seeding its worlds on sites, like a new game', usePlacementStore.getState().autoSeed)
  const placed = JSON.parse(JSON.stringify(file))
  placed.stores.placement = { version: 1, data: { placed: { 'Mars#industrial-0': { civilianFactory: 2 } } } }
  resetGame()
  await applySave(placed)
  check('...but one that already has placements keeps them and the old room rule (seeding on top would count buildings twice)', !usePlacementStore.getState().autoSeed && usePlacementStore.getState().placed['Mars#industrial-0']?.civilianFactory === 2)
}

console.log('\n=== 3. Derived state is recomputed, not trusted ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useShipStore.setState({ ships: [] })
  useDiplomacyStore.getState().forceWar(VENUS, MARS, 10)
  for (let i = 0; i < 4; i++) spawnOwnedShip('cruiser', VENUS, 'sol', 'Mars')
  const file = JSON.parse(JSON.stringify(await createSave('war')))
  check('the file stores no orbital control (it is derived)', !JSON.stringify(file).includes('orbitController'))
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  await applySave(file)
  check('after loading, the blockade is there again, recomputed from the fleets', orbitalControlNow('Mars').controller === VENUS)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll save migration checks passed')
process.exit(failures ? 1 : 0)
