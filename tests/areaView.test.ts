// The by-area view model (scene/areaView.ts): a world as its settlements and sites, each with its districts, buildings, civic buildings
// and what is on order, and what can be built or developed there. Same data as the master list, seen by place.
//
// Run:  npx tsx tests/areaView.test.ts
import { areaView } from '../src/scene/areaView'
import { locationsOf } from '../src/scene/locations'
import { levelRoomAt } from '../src/scene/placementOrders'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { worldBuildings } from '../src/scene/worldDistricts'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useLocationStore } from '../src/state/locationStore'
import { usePlayerStore } from '../src/state/playerStore'
import { usePlacementStore } from '../src/state/placementStore'

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

for (const model of ['abstract', 'complex'] as const) {
  console.log(`\n=== ${model === 'complex' ? 'Complex' : 'Simple'} mode ===`)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  setUpNewGame()
  const mode = model === 'abstract' ? ('simple' as const) : ('complex' as const)
  const v = areaView('Mars', MARS)
  const all = v.sections.flatMap((s) => s.sites)
  check('Mars is shown as settlements, industrial, resource and port sites, each with sites', v.sections.map((s) => s.kind).join() === 'settlement,industrial,resource,agricultural,infrastructure', v.sections.map((s) => `${s.title}:${s.sites.length}`).join(' '))
  check('every building the world has stands on exactly one site: nothing is left over', v.unplaced.length === 0)
  const shown = new Map<string, number>()
  for (const s of all) for (const b of s.buildings) shown.set(b.id, (shown.get(b.id) ?? 0) + b.count)
  check('...and the cards add up to the world\'s buildings, building by building', worldBuildings('Mars', mode).every((b) => shown.get(b.id) === b.count))
  check('no site shows more buildings in a district than its developed slots', all.every((s) => s.districts.every((d) => d.used <= d.slots)))
  const capital = all.find((s) => s.civic.some((c) => c.kind === 'seat'))!
  check('the capital settlement holds the Government Seat as a civic building, among its own buildings', !!capital && capital.kind === 'settlement' && capital.civic.length >= 2)
  check('a site Mars owns offers its developed districts\' buildings and the districts it can develop', capital.mine && capital.canBuild.length > 0 && capital.canDevelop.length > 0)
  const open = all.find((s) => !s.owner)
  check('an open site offers no buildings (nothing is developed there) but can be developed', !open || (open.canBuild.length === 0 && open.canDevelop.length > 0))
  const asVenus = areaView('Mars', VENUS).sections.flatMap((s) => s.sites)
  check('for another country no site of Mars offers a building', asVenus.every((s) => s.canBuild.length === 0))
  // A foreign site and an order.
  const site = locationsOf('Mars').find((s) => s.kind === 'industrial' && !usePlacementStore.getState().levels[s.id])
  if (site) useLocationStore.getState().establish(site.id, VENUS, 5)
  const withEnclave = areaView('Mars', MARS).sections.flatMap((s) => s.sites)
  check('a site another country owns is labelled with its owner', !site || withEnclave.find((s) => s.siteId === site.id)?.owner === 'Republic of Venus')
  const target = locationsOf('Mars').find((s) => s.kind === 'industrial' && levelRoomAt(s) > 0 && (usePlacementStore.getState().levels[s.id]?.industrial ?? 0) > 0)!
  if (model === 'abstract') useAbstractEconomyStore.setState((st) => ({ worlds: { ...st.worlds, Mars: { ...st.worlds.Mars, land: 60 } } }))
  else useEconomyStore.setState((st) => ({ worlds: st.worlds.map((w) => (w.id === 'Mars' ? { ...w, land: 60 } : w)) }))
  if (model === 'abstract') useAbstractEconomyStore.getState().queueDistrict(MARS, 'Mars', 'industrial', target.id)
  else useEconomyStore.getState().queueDistrict('Mars', 'industrial', target.id)
  const ordered = areaView('Mars', MARS).sections.flatMap((s) => s.sites).find((s) => s.siteId === target.id)!
  check('a level ordered at a site shows on that site\'s card as on order', ordered.onOrder.some((o) => o.what === 'level'))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll area view checks passed')
process.exit(failures ? 1 : 0)
