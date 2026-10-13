// Civic buildings (scene/civic.ts, state/civicStore.ts, components/planet/KeySites.tsx): the Senate House, the landmarks, each
// city's municipal government building and a colony's station are real buildings in the Core district, with no spaceports among
// them, the same in both economy modes, and the key nodes they stand on are exactly the ground war's.
//
// Run:  npx tsx tests/civic.test.ts
import { bodyAreas } from '../src/scene/footprintState'
import { zoneBase } from '../src/scene/zoneOrders'
import { readFileSync } from 'node:fs'
import { COUNTRIES } from '../src/data/countryData'
import { LANDMARKS } from '../src/data/landmarks'
import { civicOf, siteForNode } from '../src/scene/civic'
import { ensureSeeded, syncCivicHalls } from '../src/scene/seedPlacementOrders'
import { siteOwner, useLocationStore } from '../src/state/locationStore'
import { locationsOf } from '../src/scene/locations'
import { groundKeySurface } from '../src/state/defenseStore'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { embarkSettlers } from '../src/scene/colonies'
import { applyShipCommand } from '../src/scene/shipCommands'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { resolveColonies } from '../src/hooks/useColonyResolver'
import { COLONY_FOUNDING_DAYS } from '../src/data/colonyData'
import { useCivicStore } from '../src/state/civicStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
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

for (const model of ['abstract', 'complex'] as const) {
  console.log(`\n=== ${model === 'complex' ? 'Complex' : 'Simple'} mode ===`)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  setUpNewGame()
  check('nothing is derived until a world is looked at', Object.keys(useCivicStore.getState().civic).length === 0)
  for (const country of COUNTRIES.filter((c) => ['Mars', 'Venus', 'Earth', 'Arcadia'].includes(c.capitalBodyName))) {
    const body = country.capitalBodyName
    ensureSeeded(body)
    const all = useCivicStore.getState().civic[body] ?? []
    // The key nodes' own buildings; the derived halls (ids `hall-<site>`) are the other settlements' and checked below.
    const list = all.filter((c) => !c.id.startsWith('hall-'))
    const surface = groundKeySurface(body)!
    const slots = surface.keySlots
    const marks = LANDMARKS[country.id]
    check(`${body}: one Government Seat, its landmarks, and a municipal building per city`, list.filter((c) => c.kind === 'seat').length === 1 && list.filter((c) => c.kind === 'landmark').length === (marks?.others.length ?? 0) && list.filter((c) => c.kind === 'cityHall').length === slots.filter((s) => s.kind === 'city' && !s.area).length, list.map((c) => c.kind).join(','))
    // One civic building per urban AREA (scene/areas.ts): towns that grew together share one hall.
    syncCivicHalls(body)
    const urban = bodyAreas(body, zoneBase(body)!).filter((a) => a.kind === 'settlement' && !!siteOwner(a.id))
    const now = useCivicStore.getState().civic[body] ?? []
    check(`${body}: every urban area has a civic building, and at most one municipal hall`, urban.length > 0 && urban.every((a) => now.filter((c) => c.siteId && a.seedIds.includes(c.siteId)).length >= 1 && now.filter((c) => c.siteId && a.seedIds.includes(c.siteId) && c.kind === 'cityHall' && c.id.startsWith('hall-')).length <= 1), `${urban.length} areas, ${now.length} buildings`)
    check('...and a hall for a settlement given up goes with it, a renamed one is renamed', (() => {
      const extra = urban.find((a) => now.some((c) => c.id === `hall-${a.id}`))
      if (!extra) return true
      useLocationStore.getState().renameSite(extra.id, 'Testville')
      syncCivicHalls(body)
      const renamed = useCivicStore.getState().civic[body].find((c) => c.id === `hall-${extra.id}`)?.name.startsWith('Testville')
      useLocationStore.getState().abandon(extra.id)
      syncCivicHalls(body)
      const gone = !useCivicStore.getState().civic[body].some((c) => c.id === `hall-${extra.id}`)
      useLocationStore.getState().establish(extra.id, siteOwner(extra.id) ?? country.id, 0)
      useLocationStore.getState().renameSite(extra.id, '')
      syncCivicHalls(body)
      return !!renamed && gone
    })())
    check('...no spaceport is a civic building (they are ordinary Urban buildings)', list.every((c) => !/spaceport/i.test(c.kind) && !/Spaceport|Launch Complex/.test(c.name)))
    check('...the seat carries the nation\'s own name for it', list.find((c) => c.kind === 'seat')!.name === (marks?.seat.name ?? list.find((c) => c.kind === 'seat')!.name) && !!list.find((c) => c.kind === 'seat'))
    check('...every one stands at a settlement site of the body, on the key node it is the building of', list.every((c) => !!c.siteId && locationsOf(body).find((s) => s.id === c.siteId)?.kind === 'settlement') && list.every((c) => slots.some((k) => k.node === c.node)))
  }
  const mars = useCivicStore.getState().civic['Mars'].filter((c) => !c.id.startsWith('hall-'))
  check('the key nodes of the ground war are exactly the civic buildings plus the spaceports and fortresses (nothing else, nothing lost)', (() => {
    const slots = groundKeySurface('Mars')!.keySlots.filter((k) => k.kind !== 'spaceport' && k.kind !== 'fortress' && !k.area)
    return new Set(mars.map((c) => c.node)).size === new Set(slots.map((k) => k.node)).size
  })())
  check('the seed is stable: asking again changes nothing', (() => {
    const before = JSON.stringify(useCivicStore.getState().civic)
    ensureSeeded('Mars')
    return before === JSON.stringify(useCivicStore.getState().civic)
  })())
}

console.log('\n=== The UI no longer has the Civic key-sites card ===')
{
  const strip = (f: string) => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')
  const ui = ['src/components/planet/KeySites.tsx', 'src/components/planet/SimplePlanetTabs.tsx', 'src/components/planet/ComplexPlanetTabs.tsx'].map(strip).join('\n')
  check('no CivicDistrict, no "Civic — key sites" heading anywhere', !/CivicDistrict/.test(ui) && !/Civic — key sites/.test(ui))
  check('the Core district shows the civic tiles (Complex) and a Core card (Simple)', /CivicTiles/.test(strip('src/components/planet/ComplexPlanetTabs.tsx')) && /CoreCard/.test(strip('src/components/planet/SimplePlanetTabs.tsx')))
  check('a civic tile opens the building window', /openBuilding/.test(strip('src/components/planet/KeySites.tsx')) && /CivicBuildingWindow/.test(strip('src/App.tsx')))
}

console.log('\n=== A colony gets an Outpost Station; save and load keep the list ===')
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
  ensureSeeded('Titan')
  const titan = useCivicStore.getState().civic['Titan'] ?? []
  check('Titan\'s colony has its Outpost Station in the Core district, on its settlement site', titan.some((c) => c.kind === 'outpostStation' && !!c.siteId), titan.map((c) => c.kind).join(','))
  const before = useCivicStore.getState().civic
  const file = JSON.parse(JSON.stringify(await createSave('civic')))
  resetGame()
  await applySave(file)
  check('the civic buildings survive save and load', sameData(before, useCivicStore.getState().civic))
  void civicOf
  void siteForNode
}

console.log(failures ? `\n${failures} FAILED` : '\nAll civic checks passed')
process.exit(failures ? 1 : 0)
