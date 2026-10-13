// Rural structures (scene/ruralStructures.ts, scene/ruralOrders.ts, state/structureStore.rural): buildings that stand on a node of
// their own, outside any site. Space-elevator anchors: equatorial band, land or sea, key node on land only, kept when a settlement
// is founded on top of them.
//
// Run:  npx tsx tests/rural.test.ts
import { RECIPES, isRural } from '../src/economy/recipes'
import { RING_ANCHORS } from '../src/data/earthEconomicGeography'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { groundKeySurface, portBaseSurface } from '../src/state/defenseStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useStructureStore } from '../src/state/structureStore'
import { useTechStore } from '../src/state/techStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useLocationStore } from '../src/state/locationStore'
import { capturableByGround, EQUATORIAL_BAND_DEG, judgeRuralNode, latitudeDeg, ruralSiteFor } from '../src/scene/ruralStructures'
import { placeRural, ruralOf, judgeRural } from '../src/scene/ruralOrders'
import { surfaceMesh } from '../src/scene/surfaceMesh'
import { applySave, createSave } from '../src/state/saveGame'
import { sameData } from '../src/state/saveCodec'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. The anchor is a rural building that may stand at sea ===')
check('spaceElevatorAnchor is flagged rural and allows the sea', isRural('spaceElevatorAnchor') && RECIPES.spaceElevatorAnchor.allowSea === true)
check('ordinary buildings are not rural', !isRural('steelMill') && !isRural('spaceport'))

console.log('\n=== 2. Earth opens with its Ring anchors ===')
for (const model of ['complex', 'abstract'] as const) {
  console.log(`  -- ${model}`)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'earth', sandbox: false, economyModel: model })
  setUpNewGame()
  const surface = portBaseSurface('Earth')!
  const list = ruralOf('Earth')
  check('four relic anchors stand: two on land, two at sea', list.length === RING_ANCHORS.length && list.filter((r) => capturableByGround(surface, r.node)).length === 2, `${list.length}`)
  check('every one is within the equatorial band', list.every((r) => Math.abs(latitudeDeg(r.node)) <= EQUATORIAL_BAND_DEG), list.map((r) => latitudeDeg(r.node).toFixed(1)).join(' '))
  const keys = groundKeySurface('Earth')!.keySlots
  check('the land anchors are key nodes of the ground map, the platforms at sea are not', list.filter((r) => capturableByGround(surface, r.node)).every((r) => keys.some((k) => k.node === r.node)) && list.filter((r) => !capturableByGround(surface, r.node)).every((r) => !keys.some((k) => k.node === r.node)))
  check('Earth starts with Orbital Tethers researched', useTechStore.getState().stateFor('earth').researched.has('orbital-tethers'))
  check('the relics stay whatever the economy counts', ruralOf('Earth').length === RING_ANCHORS.length)
}

console.log('\n=== 3. The rules for a node ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'earth', sandbox: false, economyModel: 'complex' })
  setUpNewGame()
  const surface = portBaseSurface('Earth')!
  const mesh = surfaceMesh()
  const rules = { equatorial: true, allowSea: true }
  let off = -1
  let eq = -1
  for (let i = 0; i < mesh.count.fine; i++) {
    if (off < 0 && Math.abs(latitudeDeg(i)) > 40 && surface.landComponent[i] >= 0) off = i
    if (eq < 0 && Math.abs(latitudeDeg(i)) < 2 && surface.landComponent[i] < 0 && !ruralOf('Earth').some((r) => Math.abs(r.node - i) < 1)) eq = i
  }
  check('off the equator is refused', !judgeRuralNode(surface, off, [], rules).ok)
  check('open sea on the equator is allowed for an anchor', judgeRuralNode(surface, eq, [], rules).ok)
  check('...but not for a building that may not stand at sea', !judgeRuralNode(surface, eq, [], { equatorial: true, allowSea: false }).ok)
  check('a second structure on the same node is too close', !judgeRuralNode(surface, eq, [{ node: eq }], rules).ok)
  check('judgeRural asks the same rules', judgeRural('Earth', 'spaceElevatorAnchor', off).ok === false)
}

console.log('\n=== 4. Ordering an anchor ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'earth', sandbox: false, economyModel: 'complex' })
  setUpNewGame()
  useResourceStore.getState().setAmount('earth', 'alloys', 1e6)
  const surface = portBaseSurface('Earth')!
  const mesh = surfaceMesh()
  const taken = ruralOf('Earth').map((r) => r.node)
  let node = -1
  for (let i = 0; i < mesh.count.fine && node < 0; i++) if (Math.abs(latitudeDeg(i)) < 2 && surface.landComponent[i] >= 0 && judgeRural('Earth', 'spaceElevatorAnchor', i).ok && !taken.includes(i)) node = i
  const queueBefore = useEconomyStore.getState().worlds.find((w) => w.id === 'Earth')!.constructionQueue.length
  const r = placeRural('earth', 'Earth', 'spaceElevatorAnchor', node, 'Test Anchor')
  const queueAfter = useEconomyStore.getState().worlds.find((w) => w.id === 'Earth')!.constructionQueue.length
  check('Earth can order an anchor at a legal node', r.ok, r.ok ? '' : r.reason)
  if (r.ok) {
    check('the order is in the construction queue with no site booked', queueAfter === queueBefore + 1 && !useEconomyStore.getState().worlds.find((w) => w.id === 'Earth')!.constructionQueue.at(-1)!.siteId)
    check('the ledger records it at that node under its name', ruralOf('Earth').some((x) => x.node === node && x.name === 'Test Anchor' && !x.seeded))
    useEconomyStore.setState((st) => ({ worlds: st.worlds.map((w) => (w.id === 'Earth' ? { ...w, constructionQueue: [] } : w)) }))
    check('cancelling the order gives the place back', !ruralOf('Earth').some((x) => x.node === node))
  }
  check('someone who does not govern the world is refused', !placeRural('republic-of-venus', 'Earth', 'spaceElevatorAnchor', node).ok)
  check('a site building is refused', !placeRural('earth', 'Earth', 'steelMill', node).ok)
}

console.log('\n=== 5. A settlement founded on an anchor does not delete it ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'earth', sandbox: false, economyModel: 'complex' })
  setUpNewGame()
  const surface = portBaseSurface('Earth')!
  const anchor = ruralOf('Earth').find((r) => capturableByGround(surface, r.node))!
  const before = JSON.stringify(anchor)
  // A settlement founded right on it (the founding rules keep a new site a cell from the old ones, so the site is written directly).
  const site = { id: 'Earth#settlement-900', bodyName: 'Earth', kind: 'settlement' as const, tags: [], node: anchor.node, terrain: 'plains' as const, suitability: 0.9, capacity: 3, name: 'Overgrown' }
  useLocationStore.getState().addCustom(site)
  useLocationStore.getState().establish(site.id, 'earth', 1)
  check('it is now listed inside the new settlement', ruralSiteFor(anchor.node, [], [site]) === site.id)
  useLocationStore.getState().removeCustom(site.id)
  check('giving the settlement up returns it to rural', ruralSiteFor(anchor.node, [], []) === null)
  check('the anchor keeps its id, owner, node and name', JSON.stringify(ruralOf('Earth').find((r) => r.id === anchor.id)) === before)
  check('...and is still a key node of the ground map', groundKeySurface('Earth')!.keySlots.some((k) => k.node === anchor.node))
  check('ruralSiteFor reads a footprint', ruralSiteFor(5, [{ siteId: 's', kind: 'settlement', cells: [4, 5] }]) === 's' && ruralSiteFor(5, [{ siteId: 'm', kind: 'resource', cells: [5] }]) === null)
}

console.log('\n=== 6. Saves ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'earth', sandbox: false, economyModel: 'complex' })
  setUpNewGame()
  const before = useStructureStore.getState().rural
  const file = JSON.parse(JSON.stringify(await createSave('rural')))
  resetGame()
  await applySave(file)
  check('the rural ledger survives save and load', sameData(before, useStructureStore.getState().rural) && Object.keys(before).length > 0)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll rural checks passed')
process.exit(failures ? 1 : 0)
