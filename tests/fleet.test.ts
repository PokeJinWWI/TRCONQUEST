// Fleets travel together at their slowest ship's pace (src/scene/fleetMove.ts,
// commsVisual.applyFleetMove), keep their identity where they arrive (no
// auto-merge), and the multi-selection that orders several at once
// (shipStore.selectedShipIds).
//
// Run:  npx tsx tests/fleet.test.ts

import { SHIP_CLASSES } from '../src/data/shipData'
import { pristineCombatState, useShipStore, type MoveOrder, type ShipInstance } from '../src/state/shipStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { getShipRenderPosition, planMoveUnchecked, resolveArrivalLocation } from '../src/scene/shipPhysics'
import { planFleetMove, synchroniseOrders } from '../src/scene/fleetMove'
import { applyFleetMove, orderSelectedFleets } from '../src/scene/commsVisual'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
usePlayerStore.setState({ selectedCountryId: MARS })
useGameTimeStore.setState({ paused: false, simDays: 100 })

function makeShip(classId: string, id: string, bodyName = 'Mars', fleetId = 'f1'): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === classId)!
  return {
    id,
    classId,
    name: id,
    ownerId: MARS,
    fleetId,
    location: { kind: 'orbiting', systemId: 'sol', bodyName, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: false,
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(cls.combat),
    stance: 'balanced',
  }
}

const toVenus = { kind: 'body' as const, systemId: 'sol', bodyName: 'Venus' }

console.log('\n=== 1. Synchronising orders to the slowest ===')
{
  const base = (arrival: number, x: number): MoveOrder => ({
    destination: toVenus,
    departSimDays: 100,
    arrivalSimDays: arrival,
    space: 'system',
    systemId: 'sol',
    startPosition: [x, 0, 0],
    endPosition: [x + 1, 0, 0],
    usedWarp: true,
  })
  const synced = synchroniseOrders([
    { ship: makeShip('corvette', 'fast'), order: base(105, 0) },
    { ship: makeShip('cruiser', 'slow'), order: base(140, 5) },
  ])
  check('everyone gets the slowest arrival', synced.every((o) => o.order.arrivalSimDays === 140))
  check('...but keeps their own start and end points', synced[0].order.startPosition[0] === 0 && synced[1].order.startPosition[0] === 5)
  check('only a hull with a warp drive pays warp cooldown', synced[0].order.usedWarp === true && synced[1].order.usedWarp === false)
}

console.log('\n=== 2. A mixed fleet crossing the system arrives together ===')
{
  const corvette = makeShip('corvette', 'c1') // warp
  const cruiser = makeShip('cruiser', 'k1') // hyperdrive only: reaction drive in-system
  const solo = (ship: ShipInstance) => planMoveUnchecked(ship, toVenus, 100)
  const cSolo = solo(corvette)
  const kSolo = solo(cruiser)
  check('alone, the warp corvette would arrive well before the cruiser', cSolo.kind === 'order' && kSolo.kind === 'order' && cSolo.order.arrivalSimDays < kSolo.order.arrivalSimDays)
  const plan = planFleetMove([corvette, cruiser], toVenus, 100, planMoveUnchecked)
  const arrivals = plan.orders.map((o) => o.order.arrivalSimDays)
  check('as a fleet, both have orders', plan.orders.length === 2 && plan.individual.length === 0)
  check("...arriving together, at the cruiser's pace", kSolo.kind === 'order' && arrivals.every((a) => a === kSolo.order.arrivalSimDays))

  // Halfway there, both have covered the same share of their trip.
  const mid = (plan.orders[0].order.departSimDays + plan.orders[0].order.arrivalSimDays) / 2
  const progress = (o: MoveOrder) => {
    const pos = getShipRenderPosition({ ...corvette, order: o }, mid).position
    const [sx, sy, sz] = o.startPosition
    const [ex, ey, ez] = o.endPosition
    const total = Math.hypot(ex - sx, ey - sy, ez - sz)
    return Math.hypot(pos.x - sx, pos.y - sy, pos.z - sz) / total
  }
  const p0 = progress(plan.orders[0].order)
  const p1 = progress(plan.orders[1].order)
  check('...and move in lockstep on the way', Math.abs(p0 - p1) < 1e-6, `${p0.toFixed(3)} vs ${p1.toFixed(3)}`)
}

console.log('\n=== 3. Jump ships wait for the fleet ===')
{
  const toCentauri = { kind: 'star' as const, starId: 'alpha-centauri' }
  const destroyer = makeShip('destroyer', 'd1') // hyperdrive
  const corvette = makeShip('corvette', 'c2') // warp
  const plan = planFleetMove([destroyer, corvette], toCentauri, 100, planMoveUnchecked)
  check('the warp ship gets a timed order', plan.orders.length === 1 && plan.orders[0].shipId === 'c2')
  check("the hyperdrive ship holds its jump until the fleet's arrival (no early roll)", plan.deferredJumps.length === 1 && plan.deferredJumps[0].shipId === 'd1' && plan.deferredJumps[0].atSimDays === plan.orders[0].order.arrivalSimDays)

  const ready = makeShip('destroyer', 'd2')
  const cooling = { ...makeShip('cruiser', 'k2'), hyperdriveReadySimDays: 130 }
  const waitPlan = planFleetMove([ready, cooling], toCentauri, 100, planMoveUnchecked)
  check('an all-jump fleet with a drive still cooling waits for it — all of it', waitPlan.deferredJumps.length === 2 && waitPlan.deferredJumps.every((j) => j.atSimDays === 130) && waitPlan.individual.length === 0)
}

console.log('\n=== 4. Fleets keep their identity; merges are explicit ===')
{
  useShipStore.setState({ ships: [] })
  const spawn = (id: string, classId: string, bodyName = 'Mars') => {
    const { fleetId: _unused, ...rest } = makeShip(classId, id, bodyName)
    void _unused
    useShipStore.getState().spawnShip(rest)
  }
  spawn('a', 'corvette')
  spawn('b', 'cruiser')
  const ships = () => useShipStore.getState().ships
  const fleetOf = (id: string) => ships().find((s) => s.id === id)!.fleetId
  check('new ships at the same spot join one fleet', fleetOf('a') === fleetOf('b'))

  spawn('z', 'frigate', 'Venus')
  const venusFleet = fleetOf('z')
  applyFleetMove(ships().filter((s) => s.fleetId === fleetOf('a')), toVenus, 100, planMoveUnchecked)
  check('ordering the fleet moves every member', ships().filter((s) => s.id !== 'z').every((s) => !!s.order))
  const homeFleet = fleetOf('a')
  for (const s of ships()) {
    if (s.order) useShipStore.getState().setShipLocation(s.id, resolveArrivalLocation(s.order.destination, s.id), undefined, true)
  }
  check('arriving next to another fleet does NOT merge them', fleetOf('a') === homeFleet && fleetOf('z') === venusFleet && homeFleet !== venusFleet)
  useShipStore.getState().mergeFleets(homeFleet, venusFleet)
  check('...merging is an explicit act', fleetOf('z') === homeFleet)

  useShipStore.getState().splitFleet(['b'])
  const split = fleetOf('b')
  check('split off, a ship is its own fleet', split !== homeFleet)
  useShipStore.getState().selectShip('b')
  orderSelectedFleets({ kind: 'body', systemId: 'sol', bodyName: 'Mars' })
  // Away from the capital the order may wait on FTL comms (pendingMoveOrder);
  // either way it's this ship's alone.
  const commanded = (s: ShipInstance) => !!s.order || !!s.pendingMoveOrder
  check('...and moves on its own', commanded(ships().find((s) => s.id === 'b')!) && ships().filter((s) => s.id !== 'b').every((s) => !commanded(s)))
}

console.log('\n=== 5. Multi-selection ===')
{
  useShipStore.setState({ ships: [makeShip('corvette', 'p', 'Mars', 'fa'), makeShip('corvette', 'q', 'Earth', 'fb'), makeShip('corvette', 'r', 'Earth', 'fb')] })
  const st = () => useShipStore.getState()
  st().selectShip('p')
  st().toggleShipSelection('q')
  check('toggling adds and makes it primary', st().selectedShipIds.join() === 'p,q' && st().selectedShipId === 'q')
  st().toggleShipSelection('q')
  check('toggling again removes it, primary falls back', st().selectedShipIds.join() === 'p' && st().selectedShipId === 'p')
  st().toggleShipSelection('q')
  st().selectShip('r')
  check('a plain select resets to one', st().selectedShipIds.join() === 'r')
  st().selectShips(['p', 'q'])
  st().removeShip('q')
  check('a removed ship leaves the selection', st().selectedShipIds.join() === 'p' && st().selectedShipId === 'p')

  // Add an unselected fleetmate of r: selecting any member orders its whole fleet.
  useShipStore.setState({ ships: [...st().ships, makeShip('frigate', 't', 'Earth', 'fb'), makeShip('corvette', 'u', 'Earth', 'fc')] })
  st().selectShips(['p', 'r'])
  orderSelectedFleets(toVenus)
  const moving = st().ships.filter((s) => !!s.order || !!s.pendingMoveOrder).map((s) => s.id).sort().join()
  check('ordering a multi-selection moves every selected fleet whole (fleetmate t), and nothing else (u)', moving === 'p,r,t', moving)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
