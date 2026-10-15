// Site-based buildings (scene/placement.ts, scene/placementOrders.ts, state/placementStore.ts):
// a building goes on a development site of the right kind, which the builder may build on;
// an extractor goes where its resource is. Both economies, the same rules.
//
// Run:  npx tsx tests/placement.test.ts
import { SIMPLE_BUILDING_DEFS, type SimpleBuildingId } from '../src/data/simplisticEconomyData'
import { extractsFrom, physicalFit, siteKindOf, slotsOfSite } from '../src/scene/placement'
import { planPlacement, placedOn, refOf, usedSlots } from '../src/scene/placementOrders'
import { locationsOf, type DevLocation } from '../src/scene/locations'
import { grantPermission, jurisdictionNow } from '../src/scene/sovereignty'
import { resetGame } from '../src/scene/gameReset'
import { usePlayerStore } from '../src/state/playerStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { usePlacementStore } from '../src/state/placementStore'
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

const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'
const simple = (id: string) => ({ mode: 'simple' as const, id })
const complex = (id: string) => ({ mode: 'complex' as const, id })

console.log('\n=== 1. What kind of site a building needs ===')
{
  const byDistrict = (d: string) => (Object.keys(SIMPLE_BUILDING_DEFS) as SimpleBuildingId[]).filter((b) => SIMPLE_BUILDING_DEFS[b].district === d && !SIMPLE_BUILDING_DEFS[b].noSlot)
  check('Simple: mines need resource sites', byDistrict('mining').length > 0 && byDistrict('mining').every((b) => siteKindOf(simple(b)) === 'resource'))
  check('Simple: factories and power need industrial sites', [...byDistrict('industrial'), ...byDistrict('generator')].every((b) => siteKindOf(simple(b)) === 'industrial'))
  check('Simple: a spaceport is infrastructure', (Object.keys(SIMPLE_BUILDING_DEFS) as SimpleBuildingId[]).filter((b) => SIMPLE_BUILDING_DEFS[b].noSlot).every((b) => siteKindOf(simple(b)) === 'infrastructure'))
  check('Complex: mines resource, plants and mills industrial, ports infrastructure, clinics settlement', siteKindOf(complex('ironMine')) === 'resource' && siteKindOf(complex('solarPlant')) === 'industrial' && siteKindOf(complex('steelMill')) === 'industrial' && siteKindOf(complex('spaceport')) === 'infrastructure' && siteKindOf(complex('clinic')) === 'settlement')
  check('an iron mine extracts iron ore, an oil well oil; a Simple mine takes any deposit; a steel mill extracts nothing', JSON.stringify(extractsFrom(complex('ironMine'))) === '["ironOre"]' && JSON.stringify(extractsFrom(complex('oilWell'))) === '["oil"]' && extractsFrom(simple('mine')) === 'any' && extractsFrom(complex('steelMill')) === null)
}

console.log('\n=== 2. Does it physically fit ===')
{
  const site = (over: Partial<DevLocation>): DevLocation => ({ id: 'X#resource-0', bodyName: 'X', kind: 'resource', tags: [], node: 1, terrain: 'rock', suitability: 0.5, capacity: 1, good: 'ironOre', weight: 0.5, ...over })
  check('an iron mine fits an iron ore site', physicalFit(site({}), complex('ironMine'), 0).ok)
  const wrongGood = physicalFit(site({ good: 'coal' }), complex('ironMine'), 0)
  check('...not a coal site, and says why', !wrongGood.ok && /coal/.test(wrongGood.reason), wrongGood.ok ? '' : wrongGood.reason)
  const wrongKind = physicalFit(site({ kind: 'industrial', good: undefined }), complex('ironMine'), 0)
  check('...not an industrial site', !wrongKind.ok && /needs resource ground/.test(wrongKind.reason))
  check('a hyperium deposit is not mined by a mine', !physicalFit(site({ good: undefined, material: 'hyperium' }), simple('mine'), 0).ok)
  check('a full site takes nothing more', !physicalFit(site({}), complex('ironMine'), slotsOfSite(site({}))).ok && physicalFit(site({}), complex('ironMine'), slotsOfSite(site({})) - 1).ok)
}

console.log('\n=== 3. Simple mode: orders carry a site ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const store = () => useAbstractEconomyStore.getState()
  const marsSites = locationsOf('Mars')
  // Room: develop a mining and an industrial district level on Mars so slots are free.
  for (const d of ['mining', 'industrial'] as const) store().queueDistrict(MARS, 'Mars', d)
  useAbstractEconomyStore.setState((s) => ({ worlds: { ...s.worlds, Mars: { ...s.worlds.Mars, land: 40, districts: { ...(s.worlds.Mars.districts ?? {}), mining: (s.worlds.Mars.districts?.mining ?? 0) + 3, industrial: (s.worlds.Mars.districts?.industrial ?? 0) + 3 } } } }))
  const mine = store().queueBuilding(MARS, 'Mars', 'mine')
  const order = store().byCountry[MARS].queue.find((o) => o.building === 'mine')
  const site = marsSites.find((s) => s.id === order?.siteId)
  check('a mine is accepted and its order names a resource site on Mars', mine.ok && !!order?.siteId && site?.kind === 'resource' && !site.material, order?.siteId)
  check('the site now belongs to Mars and the ledger holds the mine', siteOwner(order!.siteId!) === MARS && placedOn(order!.siteId!)['mine'] === 1 && usedSlots(order!.siteId!) === 1)
  const industrial = marsSites.find((s) => s.kind === 'industrial')!
  const refused = store().queueBuilding(MARS, 'Mars', 'mine', industrial.id)
  check('a mine on an industrial site of Mars is refused, with the physical reason', !refused.ok && /for industrial use/.test(refused.reason), refused.ok ? '' : refused.reason)
  const factory = store().queueBuilding(MARS, 'Mars', 'civilianFactory', industrial.id)
  check('...a factory on that industrial site is accepted', factory.ok && store().byCountry[MARS].queue.some((o) => o.siteId === industrial.id))
  const qBefore = store().byCountry[MARS].queue.length
  check('an unknown site id is refused', !store().queueBuilding(MARS, 'Mars', 'civilianFactory', 'Mars#industrial-99').ok && store().byCountry[MARS].queue.length === qBefore)
  // Cancel: the ledger gives it back.
  store().cancelOrder(MARS, order!.id)
  check('cancelling the order frees its place on the site', (placedOn(order!.siteId!)['mine'] ?? 0) === 0 && usedSlots(order!.siteId!) === 0)

  // Foreign builder (acceptance B): Mars governs, Venus needs permission; the facility stays Venus's.
  const open = marsSites.find((s) => s.kind === 'industrial' && s.id !== industrial.id && !siteOwner(s.id))!
  const foreign = planPlacement(VENUS, 'Mars', simple('civilianFactory'), open.id)
  check('Venus building on Mars\'s open ground needs Mars\'s permission', !foreign.ok && /permission/.test(foreign.reason), foreign.ok ? '' : foreign.reason)
  grantPermission({ id: 'conc', grantorId: MARS, holderId: VENUS, scope: { kind: 'body', id: 'Mars' }, effect: 'allow', basis: 'concession', since: 1 })
  const allowed = planPlacement(VENUS, 'Mars', simple('civilianFactory'), open.id)
  check('...with a concession it may', allowed.ok && !!allowed.site)
  useLocationStore.getState().establish(open.id, VENUS, 5)
  check('...the site is Venus\'s property while Mars still governs the ground', siteOwner(open.id) === VENUS && jurisdictionNow({ kind: 'location', id: open.id }).sovereign === MARS)
  const mars2 = planPlacement(MARS, 'Mars', simple('civilianFactory'), open.id)
  check('...and Mars itself cannot build on a site Venus holds', !mars2.ok && /already holds/.test(mars2.reason), mars2.ok ? '' : mars2.reason)
}

console.log('\n=== 4. Complex mode: an extractor goes where its resource is ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'complex' })
  const recipeFor: Record<string, string> = { ironOre: 'ironMine', coal: 'coalMine', oil: 'oilWell', rareMetals: 'rareMetalsMine', sulfur: 'sulfurMine', phosphate: 'phosphateMine' }
  const deposits = locationsOf('Mars').filter((s) => s.kind === 'resource' && s.good && recipeFor[s.good])
  check('Mars has resource sites holding goods Complex can extract', deposits.length > 0, deposits.map((d) => `${d.good}`).join(', '))
  const target = deposits[0]
  const recipe = recipeFor[target.good!]
  // Room in the resource district.
  useEconomyStore.setState((s) => ({ worlds: s.worlds.map((w) => (w.id === 'Mars' ? { ...w, districtCapacity: { ...w.districtCapacity, mining: w.districtCapacity.mining + 16 }, land: (w.land ?? 0) + 8 } : w)) }))
  const queue = () => useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')!.constructionQueue
  const n0 = queue().length
  useEconomyStore.getState().queueConstruction('Mars', recipe)
  const placed = queue().filter((o) => o.recipeId === recipe).at(-1)
  const chosen = locationsOf('Mars').find((s) => s.id === placed?.siteId)
  check(`a ${recipe} is accepted and placed on a site that holds ${target.good}`, queue().length === n0 + 1 && chosen?.kind === 'resource' && chosen.good === target.good, placed?.siteId)
  check('...and the ledger and ownership agree', !!placed?.siteId && placedOn(placed.siteId)[recipe] === 1 && siteOwner(placed.siteId) === MARS)
  const other = ['coalMine', 'oilWell', 'ironMine'].find((r) => r !== recipe && !deposits.some((d) => recipeFor[d.good!] === r))
  if (other) {
    const n1 = queue().length
    useEconomyStore.getState().queueConstruction('Mars', other)
    check(`a ${other} is refused: Mars has no site with that resource`, queue().length === n1)
  }
  const n2 = queue().length
  useEconomyStore.getState().queueConstruction('Mars', recipe, { kind: 'state' }, locationsOf('Mars').find((s) => s.kind === 'industrial')!.id)
  check('an extractor named onto an industrial site is refused', queue().length === n2)
  useEconomyStore.getState().cancelConstruction('Mars', placed!.id)
  check('cancelling frees the place', (placedOn(placed!.siteId!)[recipe] ?? 0) === 0)
}

console.log('\n=== 5. Both modes pick the same ground ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  const a = planPlacement(MARS, 'Venus', simple('civilianFactory'))
  usePlayerStore.setState({ economyModel: 'complex' })
  const b = planPlacement(MARS, 'Venus', complex('steelMill'))
  // (Mars does not govern Venus: both modes give the same legal answer, whatever it is.)
  check('Simple and Complex give the same answer about the same industrial ground', a.ok === b.ok && (a.ok && b.ok ? a.site?.id === b.site?.id : true), a.ok ? a.site?.id : (a as { reason: string }).reason)
  void refOf
}

console.log('\n=== 6. Save and load ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  usePlacementStore.getState().place('Mars#industrial-0', 'civilianFactory', 2)
  const before = usePlacementStore.getState().placed
  const file = JSON.parse(JSON.stringify(await createSave('placement')))
  resetGame()
  check('a reset clears the ledger', Object.keys(usePlacementStore.getState().placed).length === 0)
  await applySave(file)
  check('the ledger survives save and load', sameData(before, usePlacementStore.getState().placed))
  resetGame()
}

console.log('\n=== 9. A spaceport stands on its own ===')
{
  for (const model of ['abstract', 'complex'] as const) {
    resetGame()
    usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
    const ref = model === 'abstract' ? simple('spaceport') : complex('spaceport')
    const clinic = model === 'abstract' ? simple('entertainmentCenter') : complex('clinic')
    const noSite = 'Mars#infrastructure-999'
    const port = planPlacement(MARS, 'Mars', ref, noSite)
    check(`${model}: a spaceport is accepted with no site at all, and books none`, port.ok && !port.site)
    check(`${model}: any other building still needs a real site`, !planPlacement(MARS, 'Mars', clinic, noSite).ok)
    const open = planPlacement(MARS, 'Mars', ref)
    check(`${model}: even with sites about a spaceport books none: it is a key node on its own ground`, open.ok && !open.site)
  }
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll placement checks passed')
process.exit(failures ? 1 : 0)
