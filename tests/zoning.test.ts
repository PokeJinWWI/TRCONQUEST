// Zones (scene/zoning.ts pure, scene/zoneOrders.ts live): the ground a district may grow into, drawn by the player. A zone sets
// the capacity of its site; the rural district is the buildable ground in no zone; the land-use law decides whether a zone may
// grow into it; shrinking a zone takes down what no longer fits, with the costs and the unrest of any demolition.
//
// Run:  npx tsx tests/zoning.test.ts
import { surfaceOf } from '../src/scene/planetTerrain'
import { locationsOf, locationById } from '../src/scene/locations'
import { brushCells, capacityFromZone, cellsPerCapacity, defaultZone, defaultZoneSize, judgeZoneEdit, ruralCells, zoneOf, type ZoneSite } from '../src/scene/zoning'
import { setUpNewGame } from '../src/scene/gameSetup'
import { ensureSeededFor } from '../src/scene/placementOrders'
import { siteOwner } from '../src/state/locationStore'
import { growthOrder } from '../src/scene/footprint'
import { applyZoneEdit, bodyZones, planZoneEdit, resolveZonePermits, ruralDistrict, zoneBase } from '../src/scene/zoneOrders'
import { footprintsOf } from '../src/scene/footprintState'
import { resetGame } from '../src/scene/gameReset'
import { usePlayerStore } from '../src/state/playerStore'
import { useLocationStore } from '../src/state/locationStore'
import { usePlacementStore } from '../src/state/placementStore'
import { useZoneStore } from '../src/state/zoneStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { unrestNow, useUnrestStore } from '../src/state/unrestStore'
import { applySave, createSave } from '../src/state/saveGame'
import { PERMIT_DAYS } from '../src/data/zoningData'
import { LOCATION_KINDS } from '../src/data/locationData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const base = surfaceOf('Mars', 'world')

console.log('\n=== 1. A zone and the room it gives ===')
{
  let ok = true
  for (const kind of LOCATION_KINDS) {
    if (cellsPerCapacity(kind) === 0) continue
    for (let c = 1; c <= 6; c++) if (capacityFromZone(kind, defaultZoneSize(kind, c)) !== c) ok = false
  }
  check('the default zone holds exactly the capacity the site was generated with', ok)
  check('a smaller zone holds less, a bigger one more', capacityFromZone('industrial', 10) < capacityFromZone('industrial', 40))
  const site = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  const zs: ZoneSite = { id: site.id, kind: site.kind, node: site.node!, capacity: site.capacity }
  const zone = defaultZone(base, zs)
  check('the default zone starts at the site itself and is made of buildable ground', zone[0] === site.node && zone.length === defaultZoneSize('industrial', site.capacity))
  check('a painted zone replaces the default', JSON.stringify(zoneOf(base, zs, [site.node!])) === JSON.stringify([site.node!]))
  const rural = new Set(ruralCells(base, [zone]))
  check('rural ground is buildable ground in no zone', zone.every((c) => !rural.has(c)) && rural.size > 1000)
  const brush = brushCells(base, site.node!, 2)
  check('the brush covers a patch around its centre', brush.includes(site.node!) && brush.length > 5)

  const others = new Set<number>()
  const edit = judgeZoneEdit(base, zs, zone, { add: brush, remove: [] }, others, rural)
  check('adding cells grows the zone and counts the rural ones', edit.ok && edit.cells.length > zone.length && edit.ruralAdded > 0 && edit.capacityAfter >= edit.capacityBefore)
  const taken = judgeZoneEdit(base, zs, zone, { add: brush, remove: [] }, new Set(brush), rural)
  check('cells another zone holds are not added', taken.ok && taken.cells.length === zone.length)
  const gone = judgeZoneEdit(base, zs, zone, { add: [], remove: zone }, others, rural)
  check('a zone always keeps the ground its district stands on', gone.ok && gone.cells.includes(site.node!) && gone.cells.length === 1)
  const sea = (() => {
    for (let i = 0; i < base.landComponent.length; i++) if (base.landComponent[i] < 0) return i
    return -1
  })()
  const wet = judgeZoneEdit(base, zs, zone, { add: [sea], remove: [] }, others, rural)
  check('water is never added', wet.ok && !wet.cells.includes(sea))
}

// A Mars game with one industrial site established and developed.
function setup(policy?: 'free' | 'permit' | 'restricted') {
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  for (const r of ['minerals', 'alloys'] as const) useResourceStore.getState().setAmount(MARS, r, 100000)
  const site = locationsOf('Mars').find((s) => s.kind === 'industrial')!
  useLocationStore.getState().establish(site.id, MARS, 0)
  usePlacementStore.getState().markSeeded('Mars')
  if (policy) useZoneStore.getState().setPolicy(MARS, policy)
  return site
}

console.log('\n=== 2. The land-use law ===')
{
  const site = setup('restricted')
  const rural = new Set(ruralDistrict('Mars'))
  const near = brushCells(surfaceOf('Mars', 'world'), site.node!, 3).filter((c) => rural.has(c))
  check('Mars has rural ground beside the site', near.length > 0)
  const refused = planZoneEdit(MARS, site.id, { add: near, remove: [] })
  check('restricted: no expansion into rural land', !refused.ok, refused.ok ? '' : refused.reason)
  const inside = planZoneEdit(MARS, site.id, { add: [], remove: bodyZones('Mars')[site.id].slice(-3) })
  check('...but a zone can still be redrawn among what it holds', inside.ok)

  useZoneStore.getState().setPolicy(MARS, 'free')
  const free = applyZoneEdit(MARS, site.id, { add: near, remove: [] })
  check('free: it grows at once', free.ok && (useZoneStore.getState().zones[site.id]?.length ?? 0) > 0, free.ok ? `${free.capacityBefore} -> ${free.capacityAfter} levels of room` : free.reason)
  check('...and the site holds more now (capacity follows the zone)', free.ok && locationById(site.id)!.capacity === free.capacityAfter)

  const site2 = setup('permit')
  const rural2 = new Set(ruralDistrict('Mars'))
  const add2 = brushCells(surfaceOf('Mars', 'world'), site2.node!, 3).filter((c) => rural2.has(c))
  const before = bodyZones('Mars')[site2.id].length
  const asked = applyZoneEdit(MARS, site2.id, { add: add2, remove: [] })
  check('permit: the request is filed, not granted', asked.ok && asked.law === 'permit' && useZoneStore.getState().requests.length === 1)
  check('...the zone is unchanged until the day comes', bodyZones('Mars')[site2.id].length === before)
  resolveZonePermits(PERMIT_DAYS - 1)
  check('...still waiting the day before', useZoneStore.getState().requests.length === 1)
  resolveZonePermits(PERMIT_DAYS + 1)
  check('...approved on the day: the rural cells join the zone', useZoneStore.getState().requests.length === 0 && bodyZones('Mars')[site2.id].length === before + add2.length)
  resetGame()
}

console.log('\n=== 3. Shrinking a zone takes things down ===')
{
  const site = setup('free')
  // Two developed levels, a spare level on Mars's world, and the zone cut to a quarter.
  useAbstractEconomyStore.setState((st) => {
    const w = st.worlds['Mars']
    return { worlds: { ...st.worlds, Mars: { ...w, districts: { ...w.districts, industrial: (w.districts.industrial ?? 0) + 2 } } } }
  })
  usePlacementStore.getState().addLevel(site.id, 'industrial', 2)
  const zone = bodyZones('Mars')[site.id]
  // The quarter of the zone nearest the district itself (a zone is a set; the growth order says what is near).
  const near = new Set(growthOrder(zoneBase('Mars')!, site.node!).slice(0, Math.max(1, Math.floor(zone.length / 4))))
  const half = zone.filter((c) => near.has(c))
  const plan = planZoneEdit(MARS, site.id, { add: [], remove: zone.filter((c) => !half.includes(c)) })
  check('the plan says how much room is lost', plan.ok && plan.capacityAfter < plan.capacityBefore, plan.ok ? `${plan.capacityBefore} -> ${plan.capacityAfter}` : plan.reason)
  check('...and what has to come down, with its cost', plan.ok && plan.levelsDown.length > 0 && Object.keys(plan.quote.resources).length > 0)
  const unconfirmed = applyZoneEdit(MARS, site.id, { add: [], remove: zone.filter((c) => !half.includes(c)) })
  check('it will not do it unconfirmed', !unconfirmed.ok && (usePlacementStore.getState().levels[site.id]?.industrial ?? 0) === 2)
  const poorBefore = { ...useResourceStore.getState().stateFor(MARS).amounts }
  const done = applyZoneEdit(MARS, site.id, { add: [], remove: zone.filter((c) => !half.includes(c)) }, { confirmed: true })
  const levelsAfter = usePlacementStore.getState().levels[site.id]?.industrial ?? 0
  check('confirmed: levels beyond the new room are taken down', done.ok && levelsAfter <= (done.ok ? done.capacityAfter : 0), `${levelsAfter} left`)
  check('...paid for', useResourceStore.getState().stateFor(MARS).amounts.minerals < (poorBefore.minerals ?? 0))
  const fp = footprintsOf('Mars', zoneBase('Mars')!).find((f) => f.siteId === site.id)
  check('the footprint stays inside the new zone', !!fp && fp.cells.length > 0 && fp.cells.every((c) => half.includes(c)), fp ? `${fp.cells.length} cells in a zone of ${half.length}` : 'none')

  const poor = setup('free')
  usePlacementStore.getState().addLevel(poor.id, 'industrial', 2)
  useAbstractEconomyStore.setState((st) => {
    const w = st.worlds['Mars']
    return { worlds: { ...st.worlds, Mars: { ...w, districts: { ...w.districts, industrial: (w.districts.industrial ?? 0) + 2 } } } }
  })
  useResourceStore.getState().setAmount(MARS, 'minerals', 0)
  const z = bodyZones('Mars')[poor.id]
  const broke = planZoneEdit(MARS, poor.id, { add: [], remove: z.slice(1) })
  check('a nation that cannot pay for the demolition is told so', !broke.ok, broke.ok ? '' : broke.reason)
  check('unrest is only left by displacing people', unrestNow(MARS, 0) === 0 && Object.keys(useUnrestStore.getState().byNation).length === 0)
  resetGame()
}

console.log('\n=== 3c. Drawing a bigger zone does not grow the city by itself ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  ensureSeededFor('Mars')
  const city = locationsOf('Mars').find((s) => s.kind === 'settlement' && siteOwner(s.id) === MARS)!
  useZoneStore.getState().setPolicy(MARS, 'free')
  const base = zoneBase('Mars')!
  const cellsOf = () => footprintsOf('Mars', base).find((f) => f.siteId === city.id)?.cells.length ?? 0
  const before = cellsOf()
  const rural = new Set(ruralDistrict('Mars'))
  const add = brushCells(base, city.node!, 4).filter((c) => rural.has(c))
  const done = applyZoneEdit(MARS, city.id, { add, remove: [] })
  check('the zone grows', done.ok && done.capacityAfter >= done.capacityBefore, done.ok ? `${done.capacityBefore} -> ${done.capacityAfter}` : done.reason)
  check('...and the urban area stays exactly as big (it grows with people and buildings, not with room)', cellsOf() === before, `${before} -> ${cellsOf()}`)
  resetGame()
}

console.log('\n=== 4. Save and load ===')
{
  const site = setup('permit')
  useZoneStore.getState().setZone(site.id, [site.node!])
  const capacity = locationById(site.id)!.capacity
  const file = JSON.parse(JSON.stringify(await createSave('zones')))
  resetGame()
  check('a reset forgets the zones and the law', Object.keys(useZoneStore.getState().zones).length === 0 && !useZoneStore.getState().policy[MARS])
  await applySave(file)
  check('they come back with a load', JSON.stringify(useZoneStore.getState().zones[site.id]) === JSON.stringify([site.node]) && useZoneStore.getState().policy[MARS] === 'permit')
  check('...and so does the capacity they give', locationById(site.id)!.capacity === capacity)
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll zoning checks passed')
process.exit(failures ? 1 : 0)
