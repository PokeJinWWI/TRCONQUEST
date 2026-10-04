// The order arrows of the galactic view: which ships get a committed, a pending (behind
// comms delay) and a queued line, and where cluster / galactic-point destinations point.
// See scene/galacticOrders.ts. (Interstellar's own line selection is unchanged.)
//
// Run:  npx tsx tests/galacticOrders.test.ts

import { readFileSync } from 'node:fs'
import { galacticDestinationPosition, galacticOrderLines } from '../src/scene/galacticOrders'
import { clusterScenePosition, galacticPosition } from '../src/scene/shipPhysics'
import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import type { ShipInstance } from '../src/state/shipStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const ME = 'imperial-state-of-mars'
const target = NEIGHBORHOODS.find((n) => n.id !== 'solar-neighborhood')!.id
const loc = { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 }
const ship = (id: string, extra: object = {}, owner = ME) => ({ id, ownerId: owner, classId: 'corvette', name: id, fleetId: 'f', location: loc, ...extra }) as unknown as ShipInstance
const galacticOrder = (destination: object) => ({ destination, space: 'galactic', departSimDays: 0, arrivalSimDays: 10, startPosition: [0, 0, 0], endPosition: [1, 0, 0] })
const cluster = { kind: 'cluster', clusterId: target }
const point = { kind: 'galactic-point', position: [3, 0, 4] }

console.log('\n=== 1. Destinations in the galactic frame ===')
{
  const c = galacticDestinationPosition(cluster as never)!
  const here = clusterScenePosition(target)
  check('a cluster order points at that cluster', c.distanceTo(here) < 1e-9 && c.length() > 0)
  const p = galacticDestinationPosition(point as never)!
  check('a galactic point is its own position', p.x === 3 && p.y === 0 && p.z === 4)
  check('a star, a world or an interstellar point is not representable here (no line)', galacticDestinationPosition({ kind: 'star', starId: 'sol' } as never) === null && galacticDestinationPosition({ kind: 'body', systemId: 'sol', bodyName: 'Mars' } as never) === null && galacticDestinationPosition({ kind: 'interstellar-point', position: [0, 0, 0] } as never) === null)
  check('a ship inside the Solar Neighbourhood starts its dashed line at that neighbourhood\'s point', galacticPosition({ space: 'interstellar', position: clusterScenePosition(target) } as never).distanceTo(clusterScenePosition('solar-neighborhood')) < 1e-9)
}

console.log('\n=== 2. Which ships get which line ===')
{
  const flying = ship('flying', { order: galacticOrder(cluster) })
  const flyingHome = ship('flying-inside', { order: { ...galacticOrder({ kind: 'star', starId: 'alpha-centauri' }), space: 'interstellar' } })
  const pendingCluster = ship('pending', { pendingMoveOrder: { destination: cluster } })
  const pendingStar = ship('pending-star', { pendingMoveOrder: { destination: { kind: 'star', starId: 'alpha-centauri' } } })
  const queued = ship('queued', { order: galacticOrder(cluster), orderQueue: [point] })
  const queuedInside = ship('queued-inside', { order: { ...galacticOrder({ kind: 'star', starId: 'alpha-centauri' }), space: 'interstellar' }, orderQueue: [cluster] })
  const idle = ship('idle')
  const theirs = ship('theirs', { order: galacticOrder(cluster), pendingMoveOrder: { destination: cluster }, orderQueue: [point] }, 'republic-of-venus')
  const all = [flying, flyingHome, pendingCluster, pendingStar, queued, queuedInside, idle, theirs]
  const l = galacticOrderLines(all, ME)
  const ids = (xs: ShipInstance[]) => xs.map((s) => s.id).sort().join()
  check('committed: ships flying a galactic order (the solid arrow)', ids(l.committed) === 'flying,queued')
  check('...not one flying inside a neighbourhood (that is the interstellar view\'s arrow)', !l.committed.some((s) => s.id === 'flying-inside'))
  check('pending: a command to a cluster or point still behind comms delay (dashed)', ids(l.pending) === 'pending')
  check('...not one to a star (not representable here)', !l.pending.some((s) => s.id === 'pending-star'))
  check('queued: legs behind a galactic order', ids(l.queued) === 'queued')
  check('only the player\'s own ships (other nations\' orders are never shown)', [...l.committed, ...l.pending, ...l.queued].every((s) => s.ownerId === ME))
  check('no ships, no lines; no player, no lines', galacticOrderLines([], ME).committed.length === 0 && galacticOrderLines(all, null).pending.length === 0)
  // They clear on their own: completion/cancel remove the order, pending order or queue from the ship.
  const done = galacticOrderLines([{ ...flying, order: undefined } as ShipInstance, { ...pendingCluster, pendingMoveOrder: undefined } as ShipInstance, { ...queued, order: undefined, orderQueue: [] } as ShipInstance], ME)
  check('a completed or cancelled order, an arrived command and an emptied queue draw nothing', done.committed.length === 0 && done.pending.length === 0 && done.queued.length === 0)
}

console.log('\n=== 3. Wiring: reuse, not copies ===')
{
  const g = readFileSync('src/scene/GalacticShips.tsx', 'utf8')
  check('the galactic view uses the interstellar view\'s own line components', /from '.\/NavigationLine'/.test(g) && /from '.\/PendingOrderLine'/.test(g) && /from '.\/QueuedRouteLine'/.test(g))
  check('with the same dash sizes as interstellar', /PENDING_DASH_SIZE = 6/.test(g) && /PENDING_GAP_SIZE = 4/.test(g) && /PENDING_DASH_SIZE = 6/.test(readFileSync('src/scene/InterstellarScene.tsx', 'utf8')))
  check('and never subscribes to simDays', !/useGameTimeStore\(/.test(g) && !/s\.simDays/.test(g))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
