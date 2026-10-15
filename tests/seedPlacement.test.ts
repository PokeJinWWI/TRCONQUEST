import { STANDALONE_BUILDINGS } from '../src/scene/placement'
// A new game's starting districts and buildings stand on sites (scene/seedPlacement.ts, seedPlacementOrders.ts, placement.ts):
// every starting building has a site, every level a place, the numbers of the economy do not move, and from then on
// a building needs a developed slot at the site it is built on.
//
// Run:  npx tsx tests/seedPlacement.test.ts
import { assignSeed } from '../src/scene/seedPlacement'
import { placeUnplacedOrders } from '../src/scene/placementOrders'
import { ensureSeeded, seedBodyPlacement } from '../src/scene/seedPlacementOrders'
import { districtUsedAt, developedSlotsAt, levelRoomAt, planDistrictLevel, planPlacement, reconcileBody, recordLevel, recordPlacement } from '../src/scene/placementOrders'
import { districtOfBuilding, slotsPerLevel } from '../src/scene/districtSites'
import { accessOnBody, syncSiteAccess } from '../src/scene/infrastructureOrders'
import { locationsOf, type DevLocation } from '../src/scene/locations'
import { siteKindOf } from '../src/scene/placement'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { worldBuildings, worldLevels } from '../src/scene/worldDistricts'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { usePlacementStore } from '../src/state/placementStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
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

const site = (id: string, kind: DevLocation['kind'], capacity: number, suitability = 0.5, over: Partial<DevLocation> = {}): DevLocation => ({ id, bodyName: 'X', kind, tags: [], node: 1, terrain: 'plains', suitability, capacity, ...over })

console.log('\n=== 1. The assignment, pure ===')
{
  const sites = [site('X#settlement-0', 'settlement', 4, 1), site('X#industrial-0', 'industrial', 3, 0.9), site('X#industrial-1', 'industrial', 3, 0.6), site('X#resource-0', 'resource', 2, 0.5, { good: 'ironOre' }), site('X#resource-1', 'resource', 2, 0.9, { good: 'coal' }), site('X#resource-2', 'resource', 2, 1, { material: 'hyperium' })]
  const r = assignSeed({ mode: 'complex', sites, eligible: () => true, districts: { core: 1, urban: 1, industrial: 4, mining: 2, military: 1 }, buildings: [{ id: 'steelMill', count: 10 }, { id: 'ironMine', count: 3 }, { id: 'coalMine', count: 3 }, { id: 'clinic', count: 2 }, { id: 'governmentOffice', count: 3 }] })
  const levelsOn = (id: string, d: string) => r.levels[id]?.[d] ?? 0
  check('industrial levels go to the best industrial site first, up to its capacity', levelsOn('X#industrial-0', 'industrial') === 3 && levelsOn('X#industrial-1', 'industrial') === 1)
  check('no levels on a deposit of hyperium (it is drawn by technology, not by buildings)', !r.levels['X#resource-2'])
  check('military levels are not placed on sites', Object.values(r.levels).every((l) => !('military' in l)))
  check('every unit of every building found a site', Object.keys(r.unplaced).length === 0, JSON.stringify(r.unplaced))
  check('an iron mine is on the iron site and a coal mine on the coal site', (r.placed['X#resource-0']?.ironMine ?? 0) === 3 && (r.placed['X#resource-1']?.coalMine ?? 0) === 3, JSON.stringify(r.placed['X#resource-0']))
  const slots = (id: string, d: string) => Object.entries(r.placed[id] ?? {}).filter(([b]) => districtOfBuilding({ mode: 'complex', id: b }) === d).reduce((n, [, c]) => n + c, 0)
  check('no site holds more buildings of a district than its developed slots', Object.keys(r.levels).every((id) => Object.entries(r.levels[id]).every(([d, n]) => slots(id, d) <= n * slotsPerLevel('complex'))))
  const again = assignSeed({ mode: 'complex', sites, eligible: () => true, districts: { core: 1, urban: 1, industrial: 4, mining: 2, military: 1 }, buildings: [{ id: 'steelMill', count: 10 }, { id: 'ironMine', count: 3 }, { id: 'coalMine', count: 3 }, { id: 'clinic', count: 2 }, { id: 'governmentOffice', count: 3 }] })
  check('it is deterministic', JSON.stringify(r) === JSON.stringify(again))
  const unfit = assignSeed({ mode: 'simple', sites: [site('X#industrial-0', 'industrial', 1, 1)], eligible: () => true, districts: { industrial: 3 }, buildings: [{ id: 'civilianFactory', count: 5 }] })
  check('a world larger than its sites were generated for keeps its levels, flagged as overflow', Object.values(unfit.levels['X#industrial-0']).reduce((n, v) => n + v, 0) === 3 && unfit.overflowLevels === 2)
}

for (const model of ['abstract', 'complex'] as const) {
  console.log(`\n=== 2. A new game's starting worlds — ${model === 'complex' ? 'Complex' : 'Simple'} mode ===`)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  setUpNewGame()
  const mode = model === 'abstract' ? ('simple' as const) : ('complex' as const)
  const bodies = (model === 'abstract' ? Object.keys(useAbstractEconomyStore.getState().worlds) : useEconomyStore.getState().worlds.map((w) => w.id)).filter((b) => ['Mars', 'Venus', 'Earth', 'Luna', 'Arcadia'].includes(b))
  check('a new game turns on seeding, and nothing is seeded until something needs it', usePlacementStore.getState().autoSeed && Object.keys(usePlacementStore.getState().seeded).length === 0)
  const before = JSON.stringify(model === 'abstract' ? useAbstractEconomyStore.getState().worlds : useEconomyStore.getState().worlds)
  const loose: string[] = []
  for (const b of bodies) {
    const res = seedBodyPlacement(b)!
    if (Object.keys(res.unplaced).length > 0) loose.push(`${b}:${JSON.stringify(res.unplaced)}`)
  }
  check(`every starting building of ${bodies.join(', ')} stands on a site`, loose.length === 0, loose.join(' '))
  // Complex seeding also splits each world's buildings into one per place (economy/buildingSites): the split changes no total.
  const sansBuildings = (ws: unknown) => JSON.stringify((ws as { buildings?: unknown }[]).map((w) => ({ ...w, buildings: undefined })))
  const totals = (ws: { buildings: { recipeId: string; owner: { kind: string }; level: number; throughput: number }[] }[]) =>
    ws.map((w) => { const t: Record<string, number> = {}; for (const b of w.buildings) { const k = `${b.recipeId}|${b.owner.kind}`; t[k] = (t[k] ?? 0) + b.level; t[`${k}|run`] = (t[`${k}|run`] ?? 0) + b.level * b.throughput } return t })
  const sameTotals = (a: Record<string, number>[], b: Record<string, number>[]) => a.every((t, i) => Object.keys({ ...t, ...b[i] }).every((k) => Math.abs((t[k] ?? 0) - (b[i][k] ?? 0)) < 1e-6))
  check('...seeding changed no number in the economy: the worlds are exactly as they were', model === 'abstract'
    ? before === JSON.stringify(useAbstractEconomyStore.getState().worlds)
    : sansBuildings(JSON.parse(before)) === sansBuildings(useEconomyStore.getState().worlds) && sameTotals(totals(JSON.parse(before)), totals(useEconomyStore.getState().worlds)))
  for (const b of ['Mars', 'Venus']) {
    const levels = worldLevels(b, mode)
    const placedLevels: Record<string, number> = {}
    for (const [id, row] of Object.entries(usePlacementStore.getState().levels)) if (id.startsWith(`${b}#`)) for (const [d, n] of Object.entries(row)) placedLevels[d] = (placedLevels[d] ?? 0) + n
    check(`${b}: the levels placed on its sites add up to the world's levels, district by district (military aside)`, Object.keys(levels).filter((d) => d !== 'military').every((d) => (placedLevels[d] ?? 0) === (levels[d] ?? 0)), JSON.stringify(placedLevels))
    const counts = worldBuildings(b, mode)
    const placed: Record<string, number> = {}
    for (const [id, row] of Object.entries(usePlacementStore.getState().placed)) if (id.startsWith(`${b}#`)) for (const [bid, n] of Object.entries(row)) placed[bid] = (placed[bid] ?? 0) + n
    check(`${b}: the buildings placed are exactly the buildings it has (spaceports stand on their own, in no site)`, counts.filter((c) => !STANDALONE_BUILDINGS.has(c.id)).every((c) => (placed[c.id] ?? 0) === c.count) && counts.filter((c) => STANDALONE_BUILDINGS.has(c.id)).every((c) => (placed[c.id] ?? 0) === 0))
  }
  check('the sites used are the nation\'s, marked connected', locationsOf('Mars').filter((s) => usePlacementStore.getState().levels[s.id]).every((s) => siteOwner(s.id) === MARS && useLocationStore.getState().established[s.id]?.connected !== false))
  syncSiteAccess()
  const unchanged = model === 'abstract' ? useAbstractEconomyStore.getState().byCountry[MARS].buildingAccess === undefined : useEconomyStore.getState().worlds.every((w) => w.buildings.every((x) => x.siteAccess === undefined))
  check('...so no building is penalized for where it stands: the output shares are all full', unchanged && Object.values(accessOnBody('Mars', MARS)).every((f) => f === 1 || f === 0.5))
  const seededSites = locationsOf('Mars').filter((s) => usePlacementStore.getState().levels[s.id] || usePlacementStore.getState().placed[s.id])
  check('(every seeded site is full access for its owner)', seededSites.every((s) => accessOnBody('Mars', MARS)[s.id] === 1))
}

console.log('\n=== 3. After seeding, a building needs a developed slot ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  useGameTimeStore.setState({ simDays: 100 })
  ensureSeeded('Mars')
  const sites = locationsOf('Mars')
  const ind = sites.filter((s) => s.kind === 'industrial').find((s) => (usePlacementStore.getState().levels[s.id]?.industrial ?? 0) > 0)!
  const slotsFree = developedSlotsAt(ind.id, 'industrial') - districtUsedAt(ind.id, 'industrial')
  check('an industrial site of Mars has developed levels and a count of free slots', developedSlotsAt(ind.id, 'industrial') >= slotsPerLevel('simple'), `${slotsFree} free`)
  const empty = sites.find((s) => s.kind === 'industrial' && !usePlacementStore.getState().levels[s.id])
  if (empty) {
    const refused = planPlacement(MARS, 'Mars', { mode: 'simple', id: 'civilianFactory' }, empty.id)
    check('a site with no developed district refuses a factory and says to develop a level first', !refused.ok && /develop a level first/.test(refused.reason), refused.ok ? '' : refused.reason)
  }
  // Fill the free slots of one site, then the next building must go elsewhere or be refused.
  const ref = { mode: 'simple' as const, id: 'civilianFactory' }
  for (let i = 0; i < slotsFree; i++) {
    const p = planPlacement(MARS, 'Mars', ref, ind.id)
    if (p.ok) {
      useAbstractEconomyStore.setState((s) => ({ worlds: { ...s.worlds, Mars: { ...s.worlds.Mars, buildings: { ...s.worlds.Mars.buildings, civilianFactory: (s.worlds.Mars.buildings.civilianFactory ?? 0) + 1 } } } }))
      recordPlacement(p, MARS, ref)
    }
  }
  const full = planPlacement(MARS, 'Mars', ref, ind.id)
  check('when the developed slots are used up the site refuses more: develop another level', !full.ok && /full/.test(full.reason), full.ok ? '' : full.reason)
  // Develop a level at that site.
  const room = levelRoomAt(ind)
  const level = planDistrictLevel(MARS, 'Mars', 'industrial', ind.id)
  check('a district level can be developed AT a chosen site while it has room', room > 0 ? level.ok : !level.ok && /no room/.test(level.reason), room > 0 ? '' : (level as { reason?: string }).reason)
  const wrong = planDistrictLevel(MARS, 'Mars', 'industrial', sites.find((s) => s.kind === 'resource' && !s.material)!.id)
  check('...not on a site of the wrong kind', !wrong.ok && /sites, not resource/.test(wrong.reason), wrong.ok ? '' : wrong.reason)
  const auto = planDistrictLevel(MARS, 'Mars', 'core')
  check('with no site named, the best open one is chosen: a core level goes to a settlement', auto.ok && auto.site?.kind === 'settlement', auto.ok ? auto.site?.id : auto.reason)
  if (level.ok) {
    const before = usePlacementStore.getState().levels[ind.id]?.industrial ?? 0
    recordLevel(level, MARS, 'industrial')
    check('recording it adds the level to the site\'s ledger', (usePlacementStore.getState().levels[ind.id]?.industrial ?? 0) === before + 1)
    reconcileBody('Mars')
    check('...and with no order behind it (nothing was queued) the next read trims it back to what the world has', (usePlacementStore.getState().levels[ind.id]?.industrial ?? 0) === before)
  }
  void siteKindOf
}

console.log('\n=== 3b. District orders carry a site (both economies) ===')
for (const model of ['abstract', 'complex'] as const) {
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  setUpNewGame()
  const district = model === 'abstract' ? 'industrial' : 'industrial'
  const orders = () => (model === 'abstract' ? useAbstractEconomyStore.getState().byCountry[MARS].queue.filter((o) => o.district) : useEconomyStore.getState().worlds.find((w) => w.id === 'Mars')!.constructionQueue.filter((o) => o.district))
  const levelsOn = (id: string) => usePlacementStore.getState().levels[id]?.[district] ?? 0
  ensureSeeded('Mars')
  if (model === 'abstract') useAbstractEconomyStore.setState((s) => ({ worlds: { ...s.worlds, Mars: { ...s.worlds.Mars, land: 60 } } }))
  else useEconomyStore.setState((s) => ({ worlds: s.worlds.map((w) => (w.id === 'Mars' ? { ...w, land: 60 } : w)) }))
  const target = locationsOf('Mars').find((s) => s.kind === 'industrial' && levelRoomAt(s) > 0)!
  const before = levelsOn(target.id)
  const n0 = orders().length
  if (model === 'abstract') useAbstractEconomyStore.getState().queueDistrict(MARS, 'Mars', 'industrial', target.id)
  else useEconomyStore.getState().queueDistrict('Mars', 'industrial', target.id)
  const order = orders().at(-1)
  check(`${model === 'complex' ? 'Complex' : 'Simple'}: a level ordered at a named site carries the site and is on that site's ledger`, orders().length === n0 + 1 && order?.siteId === target.id && levelsOn(target.id) === before + 1)
  const wrong = locationsOf('Mars').find((s) => s.kind === 'resource' && !s.material)!
  const n1 = orders().length
  let refused = ''
  if (model === 'abstract') {
    const r = useAbstractEconomyStore.getState().queueDistrict(MARS, 'Mars', 'industrial', wrong.id)
    refused = r.ok ? '' : r.reason
  } else {
    useEconomyStore.getState().queueDistrict('Mars', 'industrial', wrong.id)
    refused = orders().length === n1 ? 'refused' : ''
  }
  check('...a level on a site of the wrong kind is refused', refused !== '' && orders().length === n1, refused)
  if (model === 'abstract') useAbstractEconomyStore.getState().cancelOrder(MARS, order!.id as number)
  else useEconomyStore.getState().cancelConstruction('Mars', order!.id as string)
  check('...and cancelling the order takes the level off the site', levelsOn(target.id) === before)
  // The economies' own AI orders (no site) are placed best-effort.
  const nAuto = orders().length
  if (model === 'abstract') useAbstractEconomyStore.setState((s) => ({ byCountry: { ...s.byCountry, [MARS]: { ...s.byCountry[MARS], queue: [...s.byCountry[MARS].queue, { id: 99001, bodyName: 'Mars', district: 'industrial', progress: 0 }] } } }))
  else useEconomyStore.setState((s) => ({ worlds: s.worlds.map((w) => (w.id === 'Mars' ? { ...w, constructionQueue: [...w.constructionQueue, { id: 'con-ai-1', recipeId: '', district: 'industrial', cost: 1200, progress: 0, owner: { kind: 'state' as const } }] } : w)) }))
  placeUnplacedOrders()
  check('a district order the economy\'s own AI queued with no site is given one', orders().length === nAuto + 1 && !!orders().at(-1)?.siteId)
}

console.log('\n=== 4. Save and load ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  ensureSeeded('Mars')
  const before = { levels: usePlacementStore.getState().levels, seeded: usePlacementStore.getState().seeded, placed: usePlacementStore.getState().placed, est: useLocationStore.getState().established }
  const file = JSON.parse(JSON.stringify(await createSave('seed')))
  resetGame()
  await applySave(file)
  check('levels, placements, the seeded flags and the connected sites survive save and load', sameData(before, { levels: usePlacementStore.getState().levels, seeded: usePlacementStore.getState().seeded, placed: usePlacementStore.getState().placed, est: useLocationStore.getState().established }) && usePlacementStore.getState().autoSeed)
  // A version-1 placement store (no levels) loads.
  const old = JSON.parse(JSON.stringify(file))
  old.stores.placement = { version: 1, data: { placed: old.stores.placement.data.placed } }
  resetGame()
  await applySave(old)
  check('a placement store from before levels existed loads with empty levels', Object.keys(usePlacementStore.getState().levels).length === 0 && Object.keys(usePlacementStore.getState().placed).length > 0)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll seed placement checks passed')
process.exit(failures ? 1 : 0)
