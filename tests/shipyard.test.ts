// Ship construction for players without the debug console: resource costs,
// the paid-up-front build queue, capital shipyard capacity, completed hulls
// appearing in orbit, and the placeholder resource supply. See
// src/data/shipyardData.ts and src/scene/shipyardLogic.ts.
//
// Run:  npx tsx tests/shipyard.test.ts

import { SHIP_CLASSES } from '../src/data/shipData'
import {
  BASE_BUILD_DAYS,
  EXOTIC_MATTER_PER_WARP_DRIVE,
  MAX_QUEUED_BUILDS,
  MIN_ALLOYS,
  RESOURCE_INCOME_PER_MONTH,
  STARTING_STOCKPILE,
  shipBuildCost,
  shipBuildDays,
} from '../src/data/shipyardData'
import { RESOURCE_TYPES, type ResourceId } from '../src/data/resourceData'
import {
  applyStrategicIncome,
  missingResources,
  seedStrategicResources,
  shipyardSlotsForWorld,
  spawnBuiltShip,
  stepShipyardQueue,
} from '../src/scene/shipyardLogic'
import { useShipyardStore, type ShipBuildOrder } from '../src/state/shipyardStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
import { useEconomyStore, worldByName } from '../src/state/economyStore'
import { getCountry } from '../src/data/countryData'
import type { World } from '../src/economy/economyTypes'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const cls = (id: string) => SHIP_CLASSES.find((c) => c.id === id)!
const ZERO = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>
// Every stockpile and queue is per nation now — these tests act as Mars.
const MARS = 'imperial-state-of-mars'
const amountsOf = (countryId: string = MARS) => useResourceStore.getState().stateFor(countryId).amounts
const ordersOf = (countryId: string = MARS) => useShipyardStore.getState().ordersFor(countryId)
function resetResources(amounts: Partial<Record<ResourceId, number>> = {}) {
  useResourceStore.setState({ byCountry: { [MARS]: { amounts: { ...ZERO, ...amounts }, monthlyDelta: { ...ZERO } } } })
  useShipyardStore.setState({ ordersByCountry: {} })
}
function order(id: string, durationDays: number, extra: Partial<ShipBuildOrder> = {}): ShipBuildOrder {
  return { id, classId: 'corvette', className: 'Corvette', cost: {}, durationDays, queuedSimDays: 0, startedSimDays: null, finishSimDays: null, ...extra }
}

console.log('\n=== 1. Costs come from what a hull IS ===')
{
  const courier = shipBuildCost(cls('swift-courier'))
  const destroyer = shipBuildCost(cls('destroyer'))
  const turing = shipBuildCost(cls('turing-scout'))
  const jumper = shipBuildCost(cls('star-jumper'))
  check('a warp hull needs exotic matter', courier.exoticMatter === EXOTIC_MATTER_PER_WARP_DRIVE)
  check('...and no hyperium', courier.hyperium === undefined)
  check('a hyperdrive hull needs exactly one indivisible hyperium', destroyer.hyperium === 1 && destroyer.exoticMatter === undefined)
  check('a hyperdrive hull with a crewed navigator needs no special material', jumper.special === undefined)
  check('the Turing Scout (AI navigator, jumps never fail) needs a special core', turing.special === 1)
  check('every hull needs at least the minimum alloys', SHIP_CLASSES.every((c) => (shipBuildCost(c).alloys ?? 0) >= MIN_ALLOYS))
  check('a battleship costs more alloys than a corvette', (shipBuildCost(cls('battleship')).alloys ?? 0) > (shipBuildCost(cls('corvette')).alloys ?? 0))
  check('armed hulls need more energy than an unarmed one', (destroyer.energy ?? 0) > (courier.energy ?? 0))
  check('bigger hulls take longer to build', shipBuildDays(cls('battleship')) > shipBuildDays(cls('corvette')))
  check('every hull takes at least the base build time', SHIP_CLASSES.every((c) => shipBuildDays(c) >= BASE_BUILD_DAYS))
}

console.log('\n=== 2. missingResources ===')
{
  check('an affordable cost misses nothing', missingResources({ alloys: 10 }, { ...ZERO, alloys: 10 }).length === 0)
  const missing = missingResources({ alloys: 10, hyperium: 1 }, { ...ZERO, alloys: 10 })
  check('a short resource is named', missing.length === 1 && missing[0] === 'Hyperium', missing.join(','))
}

console.log('\n=== 3. queueBuild pays up front; cancel refunds ===')
{
  const destroyerCost = shipBuildCost(cls('destroyer'))
  resetResources({ alloys: 1000, energy: 1000, hyperium: 2 })
  const result = useShipyardStore.getState().queueBuild(MARS, 'destroyer', 5)
  const after = amountsOf()
  check('queueing an affordable hull succeeds', result.ok)
  check('...deducts alloys', after.alloys === 1000 - (destroyerCost.alloys ?? 0))
  check('...deducts the indivisible hyperium', after.hyperium === 1)
  const queued = ordersOf()[0]
  check('...adds one waiting order stamped with the queue time', ordersOf().length === 1 && queued.queuedSimDays === 5 && queued.startedSimDays === null)

  useShipyardStore.getState().cancelBuild(MARS, queued.id)
  const refunded = amountsOf()
  check('cancelling refunds the full cost', refunded.alloys === 1000 && refunded.energy === 1000 && refunded.hyperium === 2)
  check('...and removes the order', ordersOf().length === 0)

  resetResources({ alloys: 1000, energy: 1000, hyperium: 0 })
  const refused = useShipyardStore.getState().queueBuild(MARS, 'destroyer', 0)
  check('a hull needing hyperium is refused with none in stock', !refused.ok && refused.reason.includes('Hyperium'))
  check('...and nothing is deducted or queued', amountsOf().alloys === 1000 && ordersOf().length === 0)
  check('an unknown class is refused', !useShipyardStore.getState().queueBuild(MARS, 'no-such-hull', 0).ok)

  resetResources({ alloys: 1e6, energy: 1e6, exoticMatter: 1e6 })
  for (let i = 0; i < MAX_QUEUED_BUILDS; i++) useShipyardStore.getState().queueBuild(MARS, 'corvette', 0)
  const overflow = useShipyardStore.getState().queueBuild(MARS, 'corvette', 0)
  check('the queue is bounded', !overflow.ok && ordersOf().length === MAX_QUEUED_BUILDS)
}

console.log('\n=== 4. stepShipyardQueue: slots, FIFO, chaining ===')
{
  let step = stepShipyardQueue([order('a', 10), order('b', 10)], 1, 100)
  check('one slot starts only the first order', step.orders.find((o) => o.id === 'a')!.startedSimDays === 100 && step.orders.find((o) => o.id === 'b')!.startedSimDays === null)
  check('...finishing at start + duration', step.orders.find((o) => o.id === 'a')!.finishSimDays === 110)

  step = stepShipyardQueue([order('a', 10), order('b', 10)], 2, 100)
  check('two slots build two orders in parallel', step.orders.every((o) => o.startedSimDays === 100))

  const running = stepShipyardQueue([order('a', 10), order('b', 10)], 1, 100).orders
  step = stepShipyardQueue(running, 1, 105)
  check('nothing completes before its deadline', step.completed.length === 0)
  step = stepShipyardQueue(running, 1, 110)
  check('an order completes exactly at its deadline', step.completed.length === 1 && step.completed[0].id === 'a')
  check('...and hands its slot to the next order AT that finish time', step.orders[0].id === 'b' && step.orders[0].startedSimDays === 110 && step.orders[0].finishSimDays === 120)

  step = stepShipyardQueue(running, 1, 500)
  check('one big clock jump completes the whole chain, not just the first order', step.completed.map((o) => o.id).join() === 'a,b' && step.orders.length === 0)

  step = stepShipyardQueue([order('a', 10)], 0, 100)
  check('with zero capacity nothing starts', step.orders[0].startedSimDays === null && step.completed.length === 0)

  const input = [order('a', 10)]
  stepShipyardQueue(input, 1, 100)
  check('the step is pure — it does not mutate its input', input[0].startedSimDays === null)
}

console.log('\n=== 5. Capital shipyard capacity ===')
{
  check('no world still gets the free baseline slot', shipyardSlotsForWorld(undefined) === 1)
  const fake = { buildings: [{ recipeId: 'spaceyard', level: 2 }, { recipeId: 'steelMill', level: 9 }] } as unknown as World
  check('each Spaceyard level adds a slot; other buildings add none', shipyardSlotsForWorld(fake) === 3)
  const mars = worldByName(useEconomyStore.getState().worlds, 'Mars')
  check('Mars, seeded with a level-1 Spaceyard, has 2 slots', shipyardSlotsForWorld(mars) === 2)
  const venus = worldByName(useEconomyStore.getState().worlds, 'Venus')
  check('a capital with no Spaceyard still has the baseline', shipyardSlotsForWorld(venus) >= 1)
}

console.log('\n=== 6. A finished hull appears in orbit around the capital ===')
{
  useShipStore.setState({ ships: [] })
  const mars = getCountry('imperial-state-of-mars')!
  const id = spawnBuiltShip(order('a', 10, { classId: 'destroyer', className: 'Destroyer' }), mars)
  const ship = useShipStore.getState().ships.find((s) => s.id === id)
  check('the ship exists and belongs to the nation that built it', !!ship && ship.ownerId === mars.id)
  check('...of the ordered class', ship?.classId === 'destroyer')
  check(
    '...orbiting the capital body',
    ship?.location.kind === 'orbiting' && ship.location.bodyName === mars.capitalBodyName && ship.location.systemId === mars.capitalStarId,
  )
  check('...at full health and at rest', !!ship && ship.order === null && ship.combat.componentHp.core > 0)
  check('an unknown class spawns nothing', spawnBuiltShip(order('b', 10, { classId: 'nope' }), mars) === null)
  useShipStore.setState({ ships: [] })
}

console.log('\n=== 7. Placeholder resource supply ===')
{
  resetResources()
  seedStrategicResources(MARS)
  const a = amountsOf()
  check('a fresh player gets the starting reserve', a.alloys === STARTING_STOCKPILE.alloys && a.hyperium === STARTING_STOCKPILE.hyperium)
  check('...and the HUD monthly figure reflects the income table', useResourceStore.getState().stateFor(MARS).monthlyDelta.hyperium === RESOURCE_INCOME_PER_MONTH.hyperium)

  useResourceStore.getState().addAmount(MARS, 'alloys', -100)
  seedStrategicResources(MARS)
  check('re-seeding never overwrites earned/spent stock', amountsOf().alloys === (STARTING_STOCKPILE.alloys ?? 0) - 100)

  const before = amountsOf().alloys
  applyStrategicIncome(MARS, 3)
  check('income credits whole months of the table', amountsOf().alloys === before + (RESOURCE_INCOME_PER_MONTH.alloys ?? 0) * 3)
  applyStrategicIncome(MARS, 0)
  check('zero months credits nothing', amountsOf().alloys === before + (RESOURCE_INCOME_PER_MONTH.alloys ?? 0) * 3)
  const fresh = STARTING_STOCKPILE
  check('the starting reserve affords at least one preset hull', SHIP_CLASSES.some((c) => Object.entries(shipBuildCost(c)).every(([id, n]) => n <= (fresh[id as ResourceId] ?? 0))))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
