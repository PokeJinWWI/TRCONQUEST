// Rural life (scene/ruralLife.ts pure, scene/ruralState.ts live): homesteads and farmsteads on untouched ground in proportion to the
// countryside's people. Derived, never stored; they accumulate in a fixed order and a zone that grows over them absorbs them.
//
// Run:  npx tsx tests/ruralLife.test.ts
import { homesteadCells, markCount, ruralPopulation } from '../src/scene/ruralLife'
import { ruralSummary } from '../src/scene/ruralState'
import { zoneBase, paintReserve, ruralDistrict } from '../src/scene/zoneOrders'
import { brushCells } from '../src/scene/zoning'
import { resetGame } from '../src/scene/gameReset'
import { setUpNewGame } from '../src/scene/gameSetup'
import { ensureSeededFor } from '../src/scene/placementOrders'
import { usePlayerStore } from '../src/state/playerStore'
import { usePlacementStore } from '../src/state/placementStore'
import { MAX_RURAL_MARKS, RURAL_MAX_SHARE } from '../src/data/ruralData'
import { surfaceOf } from '../src/scene/planetTerrain'
import { useLocationStore } from '../src/state/locationStore'
import { locationsOf } from '../src/scene/locations'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const MARS = 'imperial-state-of-mars'

console.log('\n=== 1. How many ===')
{
  check('more farming, more people in the countryside', ruralPopulation(1000, 0.8) > ruralPopulation(1000, 0.1))
  check('...never more than the cap', ruralPopulation(1000, 1) <= 1000 * RURAL_MAX_SHARE + 1e-9)
  check('no people, no homesteads', ruralPopulation(0, 1) === 0 && markCount(0) === 0)
  check('marks grow with the people, up to the map\'s limit', markCount(100) < markCount(400) && markCount(1e9) === MAX_RURAL_MARKS)
}

console.log('\n=== 2. Where, and in what order ===')
{
  const base = surfaceOf('Mars', 'world')
  const rural = new Set<number>()
  for (let i = 0; i < base.landComponent.length; i++) if (base.landComponent[i] >= 0) rural.add(i)
  const few = homesteadCells(base, rural, 20)
  const more = homesteadCells(base, rural, 60)
  check('they ask for the count they are given', few.length === 20 && more.length === 60)
  check('a bigger count only adds: the first ones stay where they were', few.every((c, i) => more[i] === c))
  check('every one stands on rural ground', more.every((c) => rural.has(c)))
  const half = new Set([...rural].filter((c) => c % 2 === 0))
  check('ground that is no longer rural loses its marks (a zone grew over it)', homesteadCells(base, half, 60).every((c) => half.has(c)))
  check('the same marks, every time', JSON.stringify(homesteadCells(base, rural, 60)) === JSON.stringify(more))
  check('a nature reserve is left empty', homesteadCells(base, rural, 60, new Set(more)).every((c) => !more.includes(c)))
}

console.log('\n=== 3. In the live game ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  ensureSeededFor('Mars')
  const r = ruralSummary('Mars')
  check('Mars has a countryside with people and homesteads', r.cells > 1000 && r.millions > 0 && r.marks.length > 0, `${r.cells} cells, ${Math.round(r.millions)}M people, ${r.marks.length} marks`)
  const rural = new Set(ruralDistrict('Mars'))
  check('every mark is on rural ground', r.marks.every((c) => rural.has(c)))
  // Farming more of the developed land raises the countryside's share.
  const farm = locationsOf('Mars').find((s) => s.kind === 'agricultural')!
  useLocationStore.getState().establish(farm.id, MARS, 0)
  usePlacementStore.getState().addLevel(farm.id, 'agricultural', 12)
  check('more farmland, more people on the land', ruralSummary('Mars').millions > r.millions)
  const base = zoneBase('Mars')!
  const cells = brushCells(base, r.marks[0], 1)
  const wild = paintReserve(MARS, 'Mars', cells, true)
  check('a nature reserve is wild: nobody settles it', wild.ok && ruralSummary('Mars').marks.every((c) => !cells.includes(c)))
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll rural life checks passed')
process.exit(failures ? 1 : 0)
