// Colonization is the same chain in both economy modes (docs/territorial-design.md section 3):
// settlers leave the capital, a Colony Ship founds the colony, the nation gets a World in
// whichever economy runs, the colony stands on a settlement SITE with a settlement claim.
//
// Run:  npx tsx tests/colonyUnified.test.ts
import { COLONY_FOUNDING_DAYS, COLONY_SHIP_SETTLERS, MICRO_COLONY_LAND } from '../src/data/colonyData'
import { resetGame } from '../src/scene/gameReset'
import { setUpNewGame } from '../src/scene/gameSetup'
import { canColonize, embarkSettlers } from '../src/scene/colonies'
import { applyShipCommand } from '../src/scene/shipCommands'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { resolveColonies } from '../src/hooks/useColonyResolver'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useColonyStore } from '../src/state/colonyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useJurisdictionStore } from '../src/state/jurisdictionStore'
import { siteOwner } from '../src/state/locationStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { jurisdictionNow } from '../src/scene/sovereignty'
import { locationById } from '../src/scene/locations'
import { sameData } from '../src/state/saveCodec'
import { createSave, applySave } from '../src/state/saveGame'
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
const BODY = 'Titan'
const complexPop = (world: string) => useEconomyStore.getState().worlds.find((w) => w.id === world)?.pops.reduce((n, p) => n + p.populationSize, 0) ?? 0

async function found(model: 'complex' | 'abstract') {
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  setUpNewGame()
  useShipStore.setState({ ships: [] })
  useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: BODY }, 0, 0)
  const capitalBefore = model === 'complex' ? complexPop('Mars') : useAbstractEconomyStore.getState().worlds['Mars'].population
  const id = spawnOwnedShip('colony-ship', MARS, 'sol', BODY)!
  embarkSettlers(id, MARS)
  const settlers = useShipStore.getState().ships.find((s) => s.id === id)!.settlers ?? 0
  const capitalAfter = model === 'complex' ? complexPop('Mars') : useAbstractEconomyStore.getState().worlds['Mars'].population
  const can = canColonize(useShipStore.getState().ships.find((s) => s.id === id)!, BODY)
  applyShipCommand(id, { kind: 'colonize', bodyName: BODY }, 10)
  resolveColonies(10 + COLONY_FOUNDING_DAYS)
  return { id, settlers, capitalBefore, capitalAfter, can }
}

const results: Record<string, { site?: string; owner?: string; claims: number }> = {}
for (const model of ['abstract', 'complex'] as const) {
  console.log(`\n=== ${model === 'complex' ? 'Complex' : 'Simple'} mode: settlers, founding, world ===`)
  const r = await found(model)
  check('the Colony Ship takes settlers out of the capital (the same number of people leave it)', r.settlers > 0 && Math.abs(r.capitalBefore - r.capitalAfter - r.settlers) < 1e-6, `${r.settlers}M of ${Math.round(r.capitalBefore)}M`)
  check('canColonize says yes in this mode too', r.can.ok, r.can.ok ? '' : r.can.reason)
  check('Titan became Mars\'s and the colony exists', useTerritoryStore.getState().bodyOwner[BODY] === MARS && useColonyStore.getState().colonies[BODY]?.stage === 'micro')
  if (model === 'complex') {
    const world = useEconomyStore.getState().worlds.find((w) => w.id === BODY)
    check('Complex: Mars has a World on Titan with the settlers as its people', !!world && world.ownerId === MARS && Math.abs(complexPop(BODY) - r.settlers) < 1e-6, `${complexPop(BODY).toFixed(1)}M`)
    check('...with buildings, jobs for its people and a land limit of a micro-colony', !!world && world.buildings.length > 0 && (world.land ?? 99) <= MICRO_COLONY_LAND, `${world?.buildings.length} buildings, land ${world?.land}`)
    check('...its people are the capital\'s culture and species', !!world && world.cultureId === useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')!.cultureId)
  } else {
    const world = useAbstractEconomyStore.getState().worlds[BODY]
    check('Simple: a world of the settlers and the micro-colony land limit', world?.population === r.settlers && world.land !== undefined && world.land <= MICRO_COLONY_LAND)
  }
  const colony = useColonyStore.getState().colonies[BODY]
  check('the colony stands on a settlement SITE, which Mars has established', !!colony?.siteId && locationById(colony.siteId)?.kind === 'settlement' && siteOwner(colony.siteId) === MARS, colony?.siteId)
  const claims = useJurisdictionStore.getState().claims
  check('...with a settlement claim over the site and its surroundings (a region, never the system)', claims.length === 1 && claims[0].claimantId === MARS && claims[0].scope.kind === 'region' && claims[0].basis === 'settlement' && claims[0].evidence[0]?.kind === 'settlement')
  check('...and jurisdiction there is Mars\'s', jurisdictionNow({ kind: 'location', id: colony!.siteId! }).sovereign === MARS)
  results[model] = { site: colony?.siteId, owner: useTerritoryStore.getState().bodyOwner[BODY], claims: claims.length }
}

console.log('\n=== Both modes make the same physical and political facts ===')
check('the same site, owner and claim records in Simple and Complex', results.abstract.site === results.complex.site && results.abstract.owner === results.complex.owner && results.abstract.claims === results.complex.claims, `${results.abstract.site}`)

console.log('\n=== Complex colony lives in the economy ===')
{
  await found('complex')
  const econ = useEconomyStore.getState()
  const before = complexPop(BODY)
  econ.advance(12)
  const after = useEconomyStore.getState().worlds.find((w) => w.id === BODY)
  const finite = !!after && after.pops.every((p) => Number.isFinite(p.populationSize) && p.populationSize > 0) && after.buildings.every((b) => Number.isFinite(b.throughput))
  check('a year of months runs on the colony without NaN or collapse', finite && complexPop(BODY) > before * 0.5, `${before.toFixed(1)}M -> ${complexPop(BODY).toFixed(1)}M`)
  check('...the nation\'s capital world is still there and populated', complexPop('Mars') > 100)
  // Promotion lifts the land limit in Complex too.
  useColonyStore.setState((s) => ({ colonies: { ...s.colonies, [BODY]: { ...s.colonies[BODY], orbitSecureSinceSimDays: 0 } } }))
  useEconomyStore.getState().setWorldLand(BODY, 9)
  check('the land of a Complex colony can be raised (promotion to a planetary colony)', useEconomyStore.getState().worlds.find((w) => w.id === BODY)!.land === 9)

  // Save and load keep the colony, its world, site and claim together.
  const before2 = { world: useEconomyStore.getState().worlds.find((w) => w.id === BODY), claims: useJurisdictionStore.getState().claims, colonies: useColonyStore.getState().colonies }
  const file = JSON.parse(JSON.stringify(await createSave('colony')))
  resetGame()
  await applySave(file)
  check('save and load keep the colony, its World, its site and its claim', sameData(before2.world, useEconomyStore.getState().worlds.find((w) => w.id === BODY)) && sameData(before2.claims, useJurisdictionStore.getState().claims) && sameData(before2.colonies, useColonyStore.getState().colonies))
  useGameTimeStore.setState({ simDays: 0 })
}

console.log('\n=== The shipyard no longer refuses colony ships in Complex mode ===')
{
  const { useShipyardStore } = await import('../src/state/shipyardStore')
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'complex' })
  const res = useShipyardStore.getState().queueBuild(MARS, 'colony-ship', 0)
  check('queueBuild does not say "Simple economy mode"', !('reason' in res) || !/Simple economy mode/.test(res.reason ?? ''), JSON.stringify(res))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll unified colonization checks passed')
process.exit(failures ? 1 : 0)
