// Founding a district by choosing ground (scene/siteFounding.ts rules, scene/siteFoundingOrders.ts I/O, locationStore.custom):
// the ground must suit the kind and keep clear of other sites, the builder must be allowed to build there, a founded site joins
// the body's sites under a fresh id without moving any generated one, and it survives save and load.
//
// Run:  npx tsx tests/siteFounding.test.ts
import { surfaceOf, terrainAt } from '../src/scene/planetTerrain'
import { surfaceMesh, arc, nodePoint } from '../src/scene/surfaceMesh'
import { locationById, locationsOf, generatedLocationsOf } from '../src/scene/locations'
import { FIRST_CUSTOM_INDEX, isFounded, planFounding } from '../src/scene/siteFounding'
import { foundSite, judgeFounding, removeFoundedSite } from '../src/scene/siteFoundingOrders'
import { resetGame } from '../src/scene/gameReset'
import { usePlayerStore } from '../src/state/playerStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { usePlacementStore } from '../src/state/placementStore'
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
const mesh = surfaceMesh()

// A ground node of `terrain` on `body` at least `clear` radians from every existing site.
function nodeOf(body: string, terrain: string, clear = 0.2): number {
  const wild = surfaceOf(body, 'wild')
  const sites = locationsOf(body).filter((s) => s.node !== null)
  for (let i = 0; i < mesh.count.fine; i++) {
    if (wild.landComponent[i] < 0 || terrainAt(wild, i) !== terrain) continue
    if (sites.every((s) => arc(nodePoint(i), nodePoint(s.node!)) > clear)) return i
  }
  return -1
}

resetGame()
usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })

console.log('\n=== 1. The ground rules ===')
{
  const before = generatedLocationsOf('Mars').map((s) => s.id).join()
  const plains = nodeOf('Mars', 'plains')
  check('Mars has open plains to found on', plains >= 0)
  const plan = planFounding('Mars', 'agricultural', plains, locationsOf('Mars'))
  check('farmland can be founded on plains', plan.ok, plan.ok ? plan.site.id : plan.reason)
  check('...under an id from the founded range, so no generated id is touched', plan.ok && Number(plan.site.id.split('-').pop()) >= FIRST_CUSTOM_INDEX && isFounded(plan.site.id))
  const ocean = (() => {
    const wild = surfaceOf('Earth', 'wild')
    for (let i = 0; i < mesh.count.fine; i++) if (wild.landComponent[i] < 0) return i
    return -1
  })()
  check('the sea cannot be built on', ocean >= 0 && !planFounding('Earth', 'settlement', ocean, locationsOf('Earth')).ok)
  const taken = locationsOf('Mars').find((s) => s.node !== null)!
  const crowded = planFounding('Mars', taken.kind === 'strategic' ? 'settlement' : (taken.kind as 'settlement'), taken.node!, locationsOf('Mars'))
  check('a place on top of another site is refused', !crowded.ok, crowded.ok ? '' : crowded.reason)
  check('a spaceport is not founded by clicking', !planFounding('Mars', 'infrastructure', plains, locationsOf('Mars')).ok)
  const rock = nodeOf('Mars', 'rock')
  const mine = rock >= 0 ? planFounding('Mars', 'resource', rock, locationsOf('Mars')) : null
  check('a resource site on rock holds a natural good', !mine || (mine.ok && !!mine.site.good), mine && mine.ok ? mine.site.good : '')
  check('...and what lies there is fixed by the place', !mine || !mine.ok || JSON.stringify(planFounding('Mars', 'resource', rock, locationsOf('Mars'))) === JSON.stringify(mine))
  check('planning founds nothing', generatedLocationsOf('Mars').map((s) => s.id).join() === before && Object.keys(useLocationStore.getState().custom).length === 0)
}

console.log('\n=== 2. Who may found ===')
{
  const venusPlains = nodeOf('Venus', 'plains')
  const j = judgeFounding(MARS, 'Venus', 'agricultural', venusPlains)
  check('Mars may not found a district on Venus, which another nation governs', venusPlains >= 0 && !j.allowed, j.why)
  const own = judgeFounding(MARS, 'Mars', 'agricultural', nodeOf('Mars', 'plains'))
  check('on its own world it may', own.allowed, own.why)
}

console.log('\n=== 3. Founding, finding, giving up ===')
{
  const plains = nodeOf('Mars', 'plains')
  const generated = generatedLocationsOf('Mars').length
  const r = foundSite(MARS, 'Mars', 'agricultural', plains, 100)
  check('founding on its own plains succeeds', r.ok)
  if (!r.ok) throw new Error(r.reason)
  const id = r.site.id
  check('the body now has the generated sites plus one', locationsOf('Mars').length === generated + 1 && generatedLocationsOf('Mars').length === generated)
  check('the site is found by id', locationById(id)?.node === plains)
  check('the founder holds it', siteOwner(id) === MARS)
  const again = foundSite(MARS, 'Mars', 'agricultural', plains, 100)
  check('the same spot cannot be founded twice', !again.ok, again.ok ? '' : again.reason)
  const second = foundSite(MARS, 'Mars', 'agricultural', nodeOf('Mars', 'plains', 0.3), 101)
  check('a second site gets the next id', second.ok && second.site.id !== id, second.ok ? second.site.id : second.reason)
  check('locationsOf is stable between calls (memoised)', locationsOf('Mars') === locationsOf('Mars'))

  usePlacementStore.getState().addLevel(id, 'agricultural', 1)
  check('a site with a level on it cannot be given up', !removeFoundedSite(id).ok)
  usePlacementStore.getState().removeLevel(id, 'agricultural', 1)
  check('an empty one can', removeFoundedSite(id).ok && !locationById(id) && siteOwner(id) === undefined)
  check('a generated site cannot be given up this way', !removeFoundedSite('Mars#settlement-0').ok)
}

console.log('\n=== 4. Save and load ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const r = foundSite(MARS, 'Mars', 'industrial', nodeOf('Mars', 'plains'), 5)
  if (!r.ok) throw new Error(r.reason)
  const file = JSON.parse(JSON.stringify(await createSave('founding')))
  resetGame()
  check('a reset takes the founded sites away', !locationById(r.site.id) && Object.keys(useLocationStore.getState().custom).length === 0)
  await applySave(file)
  check('they come back with a load, and are findable by id', locationById(r.site.id)?.node === r.site.node && siteOwner(r.site.id) === MARS)
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll site founding checks passed')
process.exit(failures ? 1 : 0)
