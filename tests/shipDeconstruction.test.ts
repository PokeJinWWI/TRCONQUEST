// Scrapping a ship: the construction bar in reverse, holding no shipyard slip, no refund.
// See src/scene/shipDeconstruction.ts, state/shipDeconstructionStore.ts and
// hooks/useShipDeconstructionResolver.ts.
//
// Run:  npx tsx tests/shipDeconstruction.test.ts

import { readFileSync } from 'node:fs'
import { shipBuildDays } from '../src/data/shipyardData'
import { SHIP_CLASSES } from '../src/data/shipData'
import { RESOURCE_TYPES, type ResourceId } from '../src/data/resourceData'
import {
  deconstructBlock,
  deconstructionDays,
  deconstructionRemaining,
  newDeconstruction,
  stepDeconstructions,
  type ShipDeconstruction,
} from '../src/scene/shipDeconstruction'
import { resolveShipDeconstructions } from '../src/hooks/useShipDeconstructionResolver'
import { useShipDeconstructionStore } from '../src/state/shipDeconstructionStore'
import { useShipStore } from '../src/state/shipStore'
import { useShipyardStore, type ShipBuildOrder } from '../src/state/shipyardStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useCombatStore } from '../src/state/combatStore'
import { spawnOwnedShip, stepShipyardQueue } from '../src/scene/shipyardLogic'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { resetGame } from '../src/scene/gameReset'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const cls = (id: string) => SHIP_CLASSES.find((c) => c.id === id)!

console.log('\n=== 1. The pure rules ===')
{
  const corvette = cls('corvette')
  check('it takes as long as the hull took to build', deconstructionDays(corvette) === shipBuildDays(corvette) && deconstructionDays(cls('battleship')) > deconstructionDays(corvette))
  const job = newDeconstruction({ id: 's1', ownerId: MARS, name: 'Corvette 1' }, corvette, 100)
  check('a job is stamped with absolute start and finish days', job.startedSimDays === 100 && job.finishSimDays === 100 + job.durationDays && job.shipId === 's1' && job.shipName === 'Corvette 1')
  check('the bar starts FULL...', deconstructionRemaining(job, 100) === 1)
  const half = deconstructionRemaining(job, 100 + job.durationDays / 2)
  check('...runs down...', Math.abs(half - 0.5) < 1e-9, String(half))
  check('...to EMPTY at the finish', deconstructionRemaining(job, job.finishSimDays) === 0)
  check('...and never leaves 0..1 (before the start or long after the end)', deconstructionRemaining(job, 50) === 1 && deconstructionRemaining(job, 1e6) === 0)
  check('it only ever goes down (the reverse of the build bar)', [0, 0.25, 0.5, 0.75, 1].map((f) => deconstructionRemaining(job, 100 + job.durationDays * f)).every((v, i, a) => i === 0 || v <= a[i - 1]))
  check('a free ship can be scrapped', deconstructBlock({ alreadyRunning: false, engaged: false, armiesAboard: 0 }) === null)
  check('...not twice', deconstructBlock({ alreadyRunning: true, engaged: false, armiesAboard: 0 }) !== null)
  check('...not mid-fight', deconstructBlock({ alreadyRunning: false, engaged: true, armiesAboard: 0 }) === 'It is in a fight')
  check('...not with armies aboard (they would go down with it)', deconstructBlock({ alreadyRunning: false, engaged: false, armiesAboard: 1 }) === 'Unload its armies first')

  const a = newDeconstruction({ id: 'a', ownerId: MARS, name: 'A' }, corvette, 0)
  const b = newDeconstruction({ id: 'b', ownerId: MARS, name: 'B' }, cls('battleship'), 0)
  const live = new Set(['a', 'b'])
  let step = stepDeconstructions([a, b], a.finishSimDays - 0.01, new Set(), live)
  check('nothing finishes before its bar is empty', step.finished.length === 0 && step.jobs.length === 2)
  step = stepDeconstructions([a, b], a.finishSimDays, new Set(), live)
  check('a ship finishes when its own bar empties (the bigger hull later)', step.finished.map((j) => j.shipId).join() === 'a' && step.jobs.map((j) => j.shipId).join() === 'b')
  step = stepDeconstructions([a], a.finishSimDays + 5, new Set(['a']), live)
  check('a ship in a fight waits at empty, and goes when the fight is over', step.finished.length === 0 && step.jobs.length === 1 && stepDeconstructions(step.jobs, a.finishSimDays + 6, new Set(), live).finished.length === 1)
  step = stepDeconstructions([a, b], 1e6, new Set(), new Set(['b']))
  check('a job whose ship is already gone is dropped, not finished', step.finished.map((j) => j.shipId).join() === 'b' && step.jobs.length === 0)
}

console.log('\n=== 2. It holds no slip ===')
{
  const order = (id: string): ShipBuildOrder => ({ id, classId: 'corvette', className: 'Corvette', cost: {}, durationDays: 10, queuedSimDays: 0, startedSimDays: null, finishSimDays: null })
  const queue = [order('a'), order('b')]
  const before = stepShipyardQueue(queue.map((o) => ({ ...o })), 1, 0)
  useShipStore.setState({ ships: [] })
  useShipyardStore.setState({ ordersByCountry: {} })
  useShipDeconstructionStore.setState({ jobs: [] })
  const id = spawnOwnedShip('corvette', MARS, 'sol', 'Mars')!
  const ship = useShipStore.getState().ships.find((s) => s.id === id)!
  useShipDeconstructionStore.getState().begin(ship, resolveShipClass(ship.classId)!, 0)
  check('starting one adds nothing to the shipyard queue', useShipyardStore.getState().ordersFor(MARS).length === 0)
  const after = stepShipyardQueue(queue.map((o) => ({ ...o })), 1, 0)
  check('...and the slips step exactly as without it (one slot still starts one order)', JSON.stringify(before) === JSON.stringify(after) && after.orders.filter((o) => o.startedSimDays !== null).length === 1)
  const src = readFileSync('src/state/shipDeconstructionStore.ts', 'utf8') + readFileSync('src/hooks/useShipDeconstructionResolver.ts', 'utf8') + readFileSync('src/scene/shipDeconstruction.ts', 'utf8')
  check('no part of it touches the shipyard store or its slot count', !/shipyardStore|shipyardSlots|SHIPYARD_FREE_SLOTS|stepShipyardQueue/.test(src.replace(/\/\/.*$/gm, '')))
  const panel = readFileSync('src/components/ShipyardPanel.tsx', 'utf8')
  check('the Slips boxes count only the building orders; scrapping is its own list', panel.includes('Slips ({building.length}/{slots})') && panel.includes('Deconstructing ('))
  useShipDeconstructionStore.setState({ jobs: [] })
}

console.log('\n=== 3. The ship goes when the bar is empty; no refund ===')
{
  const ZERO = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>
  const stock = { ...ZERO, alloys: 123, energy: 45, hyperium: 6, special: 1 }
  useResourceStore.setState({ byCountry: { [MARS]: { amounts: { ...stock }, monthlyDelta: { ...ZERO } } } })
  useCombatStore.setState({ engagements: [] })
  useShipStore.setState({ ships: [] })
  useShipDeconstructionStore.setState({ jobs: [] })
  const id = spawnOwnedShip('cruiser', MARS, 'sol', 'Mars')!
  const keep = spawnOwnedShip('corvette', MARS, 'sol', 'Mars')!
  const ship = useShipStore.getState().ships.find((s) => s.id === id)!
  useShipDeconstructionStore.getState().begin(ship, resolveShipClass(ship.classId)!, 10)
  useShipDeconstructionStore.getState().begin(ship, resolveShipClass(ship.classId)!, 20)
  const job = useShipDeconstructionStore.getState().jobs
  check('a second request for the same ship is ignored', job.length === 1 && job[0].startedSimDays === 10)
  resolveShipDeconstructions(10 + job[0].durationDays / 2)
  check('half way the ship is still there, the bar half full', useShipStore.getState().ships.some((s) => s.id === id) && Math.abs(deconstructionRemaining(job[0], 10 + job[0].durationDays / 2) - 0.5) < 1e-9)
  resolveShipDeconstructions(job[0].finishSimDays)
  const ids = useShipStore.getState().ships.map((s) => s.id)
  check('at empty the ship is removed (and only that one)', !ids.includes(id) && ids.includes(keep))
  check('...the job is gone', useShipDeconstructionStore.getState().jobs.length === 0)
  check('...and nothing is refunded (the existing rule for a built thing)', JSON.stringify(useResourceStore.getState().stateFor(MARS).amounts) === JSON.stringify(stock))

  // A fight holds it at empty.
  const id2 = spawnOwnedShip('corvette', MARS, 'sol', 'Mars')!
  const s2 = useShipStore.getState().ships.find((s) => s.id === id2)!
  useShipDeconstructionStore.getState().begin(s2, resolveShipClass(s2.classId)!, 0)
  useCombatStore.setState({ engagements: [{ participants: [{ shipId: id2 }] }] as never })
  resolveShipDeconstructions(1e6)
  check('a ship in a fight is not removed until it is over', useShipStore.getState().ships.some((s) => s.id === id2))
  useCombatStore.setState({ engagements: [] })
  resolveShipDeconstructions(1e6)
  check('...then it goes', !useShipStore.getState().ships.some((s) => s.id === id2))

  // Cancelling stops it.
  const id3 = spawnOwnedShip('corvette', MARS, 'sol', 'Mars')!
  const s3 = useShipStore.getState().ships.find((s) => s.id === id3)!
  useShipDeconstructionStore.getState().begin(s3, resolveShipClass(s3.classId)!, 0)
  useShipDeconstructionStore.getState().cancel(id3)
  resolveShipDeconstructions(1e6)
  check('a cancelled one stays', useShipStore.getState().ships.some((s) => s.id === id3) && useShipDeconstructionStore.getState().jobs.length === 0)

  // Quitting forgets them.
  useShipDeconstructionStore.getState().begin(s3, resolveShipClass(s3.classId)!, 0)
  resetGame()
  check('resetGame clears every job', useShipDeconstructionStore.getState().jobs.length === 0)
}

console.log('\n=== 4. Wired into the game ===')
{
  const panel = readFileSync('src/scene/ShipPanel.tsx', 'utf8')
  check('the ship panel has the button for own ships', /owned && <ShipDeconstructSection/.test(panel))
  const app = readFileSync('src/App.tsx', 'utf8')
  check('the resolver runs off the game clock', app.includes('useShipDeconstructionResolver()'))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
