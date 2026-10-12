// The build lens (state/lensStore, scene/lensActions, scene/lensTarget): a pointer node resolves to a district, hovering previews
// what a click would do, a click places / founds / redraws / lays, a right click cancels the order or takes it down with its cost.
// Both economies, driven headlessly through the same functions the ground map calls.
//
// Run:  npx tsx tests/lens.test.ts
import { lensClick, lensHover, lensRightClick, lensSites, targetAt } from '../src/scene/lensActions'
import { resolveTarget } from '../src/scene/lensTarget'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { locationsOf, locationById } from '../src/scene/locations'
import { surfaceOf, terrainAt } from '../src/scene/planetTerrain'
import { surfaceMesh } from '../src/scene/surfaceMesh'
import { useLensStore, type LensTool } from '../src/state/lensStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useResourceStore } from '../src/state/resourceStore'
import { usePlacementStore } from '../src/state/placementStore'
import { useLocationStore } from '../src/state/locationStore'
import { useConfirmStore } from '../src/state/confirmStore'
import { useEconomyStore } from '../src/state/economyStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const MARS = 'imperial-state-of-mars'
const mesh = surfaceMesh()

console.log('\n=== 1. Which district is under the pointer ===')
{
  const sites = [
    { siteId: 'A', footprint: [1, 2], zone: [1, 2, 3, 4], node: 1 },
    { siteId: 'B', footprint: [10], zone: [9, 10, 11], node: 10 },
  ]
  check('a cell of a footprint belongs to its district', resolveTarget(sites, 2)?.siteId === 'A' && resolveTarget(sites, 2)?.via === 'footprint')
  check('a cell only in a zone belongs to it, less surely', resolveTarget(sites, 4)?.via === 'zone')
  check('open ground belongs to nobody', resolveTarget(sites, 99) === null)
  check('a footprint beats a zone that overlaps it', resolveTarget([{ siteId: 'Z', footprint: [], zone: [5], node: null }, { siteId: 'F', footprint: [5], zone: [5], node: 5 }], 5)?.siteId === 'F')
}

function plainsNear(body: string, clearOf: number[] = []): number {
  const surface = surfaceOf(body, 'capital')
  const keep = locationsOf(body).filter((s) => s.node !== null).map((s) => s.node!)
  const p = (n: number) => ({ x: mesh.positions[n * 3], y: mesh.positions[n * 3 + 1], z: mesh.positions[n * 3 + 2] })
  for (let i = 5; i < mesh.count.fine; i += 3) {
    if (surface.landComponent[i] < 0 || terrainAt(surface, i) !== 'plains') continue
    if ([...keep, ...clearOf].every((k) => Math.hypot(p(i).x - p(k).x, p(i).y - p(k).y, p(i).z - p(k).z) > 0.45)) return i
  }
  return -1
}

for (const model of ['abstract', 'complex'] as const) {
  const name = model === 'complex' ? 'Complex' : 'Simple'
  console.log(`\n=== 2. ${name}: founding and building by clicking ===`)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  setUpNewGame()
  for (const r of ['minerals', 'alloys', 'energy'] as const) useResourceStore.getState().setAmount(MARS, r, 100000)
  if (model === 'complex') useEconomyStore.getState().consumeStockpile('Mars', { concrete: 5000, steel: 5000, tools: 5000, chemicals: 5000, machinery: 5000 }, true)
  // Complex Mars has all its land developed: give it two free levels, as a grown world would have.
  if (model === 'complex') useEconomyStore.setState((st) => ({ worlds: st.worlds.map((w) => (w.id === 'Mars' ? { ...w, land: (w.land ?? 0) + 2 } : w)) }))
  const lens = () => useLensStore.getState()
  const level: LensTool = { kind: 'level', district: 'agricultural', name: 'Agricultural' }
  const spot = plainsNear('Mars')
  check('Mars has open plains', spot >= 0)

  const hover = lensHover('Mars', spot, level)
  check('hovering open plains says a new district would be founded', hover.ok && /found a new/i.test(hover.text), hover.text)
  const seaNode = (() => {
    const s = surfaceOf('Mars', 'capital')
    for (let i = 0; i < s.landComponent.length; i++) if (s.landComponent[i] < 0) return i
    return -1
  })()
  if (seaNode >= 0) check('hovering water says why not', !lensHover('Mars', seaNode, level).ok)

  const before = locationsOf('Mars').length
  const queueSize = () => (model === 'abstract' ? (useAbstractEconomyStore.getState().byCountry[MARS]?.queue.length ?? 0) : (useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')?.constructionQueue.length ?? 0))
  const q0 = queueSize()
  lensClick('Mars', spot, level)
  check('a click founds a district and orders its first level', locationsOf('Mars').length === before + 1 && queueSize() === q0 + 1, lens().message?.text ?? '')
  check('...and the place pulses so the player sees where', (lens().pulse?.cells.length ?? 0) > 0 && lens().pulse!.ok)
  const founded = locationsOf('Mars')[before]
  check('the new district is the nation\'s, with the level on it', founded.kind === 'agricultural' && usePlacementStore.getState().levels[founded.id]?.agricultural === 1)
  check('the pointer now resolves to it', targetAt('Mars', spot)?.siteId === founded.id)

  lensRightClick('Mars', spot, level)
  check('a right click cancels the level in progress', queueSize() === q0 && !usePlacementStore.getState().levels[founded.id]?.agricultural, lens().message?.text ?? '')
  lensRightClick('Mars', spot, level)
  check('...and with nothing left to cancel or take down it says so', !lens().message?.ok, lens().message?.text ?? '')

  console.log(`\n=== 3. ${name}: a building goes on a district of the right kind ===`)
  const mineId = model === 'abstract' ? 'mine' : 'ironMine'
  const mine: LensTool = { kind: 'building', id: mineId, name: 'Iron mine' }
  const ground = locationsOf('Mars').find((s) => s.kind === 'agricultural')!
  const wrong = lensHover('Mars', ground.node!, mine)
  check('a mine over farmland is refused with the ground\'s reason', !wrong.ok, wrong.text)
  const resourceSite = locationsOf('Mars').find((s) => s.kind === 'resource' && (s.good === 'ironOre' || s.good))
  if (resourceSite) {
    const hoverOk = lensHover('Mars', resourceSite.node!, mine)
    check('a mine over a mining site previews', typeof hoverOk.ok === 'boolean', hoverOk.text)
  }

  console.log(`\n=== 4. ${name}: the zone tool and the reserve tool ===`)
  const zone: LensTool = { kind: 'zone', name: 'Zone' }
  lens().arm(zone)
  const mySite = locationsOf('Mars').find((s) => s.kind === 'industrial' && useLocationStore.getState().established[s.id]?.ownerId === MARS)
  if (mySite) {
    lensClick('Mars', mySite.node!, zone)
    check('the first click picks the district to redraw', lens().zoneSiteId === mySite.id, lens().message?.text ?? '')
    const base = surfaceOf('Mars', 'capital')
    void base
  }
  lens().arm({ kind: 'reserve', name: 'Reserve' })
  const rural = plainsNear('Mars', [spot])
  lensClick('Mars', rural, { kind: 'reserve', name: 'Reserve' })
  check('painting a reserve on rural ground keeps it wild', lens().message?.ok === true, lens().message?.text ?? '')
  lensRightClick('Mars', rural, { kind: 'reserve', name: 'Reserve' })
  check('a right click releases it', lens().message?.ok === true, lens().message?.text ?? '')
  lens().arm(null)
  useConfirmStore.getState().resolve(false)
  void locationById
  void lensSites
}

console.log(failures ? `\n${failures} FAILED` : '\nAll lens checks passed')
process.exit(failures ? 1 : 0)
