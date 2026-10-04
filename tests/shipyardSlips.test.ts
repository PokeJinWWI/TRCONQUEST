// Slip auto-start: when a build slip is free, the next queued ship starts by itself,
// FIFO by queue order, for the player and every AI alike; deconstruction uses no slip.
// Also the Navy/Shipyard tab order. See scene/shipyardLogic.ts (ordersToStart,
// stepShipyardQueue, advanceShipyard) and state/shipyardStore.ts.
//
// Run:  npx tsx tests/shipyardSlips.test.ts

import { readFileSync } from 'node:fs'
import { ordersToStart, stepShipyardQueue } from '../src/scene/shipyardLogic'
import { useShipyardStore, type ShipBuildOrder } from '../src/state/shipyardStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { RESOURCE_TYPES, type ResourceId } from '../src/data/resourceData'
import { FLEET_TABS } from '../src/components/FleetManagement'
import { useFleetTabStore } from '../src/state/fleetTabStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const order = (id: string, extra: Partial<ShipBuildOrder> = {}): ShipBuildOrder => ({ id, classId: 'corvette', className: 'Corvette', cost: {}, durationDays: 10, queuedSimDays: 0, startedSimDays: null, finishSimDays: null, ...extra })
const building = (id: string) => order(id, { startedSimDays: 0, finishSimDays: 10 })

console.log('\n=== 1. ordersToStart: the pure selection ===')
{
  check('an empty queue starts nothing', ordersToStart([], 2).length === 0)
  check('a free slip with an empty queue (only built orders) starts nothing', ordersToStart([building('a')], 2).length === 0)
  check('one free slip starts the FIRST waiting order, in queue order', ordersToStart([order('x'), order('y'), order('z')], 1).join() === 'x')
  check('...even when the queue lists an earlier-started one first', ordersToStart([building('a'), order('x'), order('y')], 2).join() === 'x')
  check('two free slips start the first two, FIFO', ordersToStart([order('x'), order('y'), order('z')], 2).join() === 'x,y')
  check('no free slip starts nothing', ordersToStart([building('a'), building('b'), order('x')], 2).length === 0)
  check('zero or negative slips start nothing', ordersToStart([order('x')], 0).length === 0 && ordersToStart([order('x')], -1).length === 0)
  check('it does not mutate its input', (() => { const q = [order('x')]; ordersToStart(q, 1); return q[0].startedSimDays === null })())
}

console.log('\n=== 2. The step uses it: a slip freed hands over FIFO ===')
{
  const q = [building('a'), order('b'), order('c')]
  const step = stepShipyardQueue(q, 1, 10)
  check('the finished order completes and the NEXT in queue order takes its slip at the finish time', step.completed.map((o) => o.id).join() === 'a' && step.orders.find((o) => o.id === 'b')!.startedSimDays === 10 && step.orders.find((o) => o.id === 'c')!.startedSimDays === null)
  const two = stepShipyardQueue([order('a'), order('b'), order('c')], 2, 0)
  check('two slips start the first two at once, the third waits', two.orders.map((o) => o.startedSimDays !== null).join() === 'true,true,false')
  check('a free slip with an empty queue changes nothing', JSON.stringify(stepShipyardQueue([], 3, 5)) === JSON.stringify({ orders: [], completed: [] }))
  check('(the AI shares this: both run advanceShipyard / stepShipyardQueue per nation)', /for \(const country of COUNTRIES\) advanceShipyard\(country, simDays\)/.test(readFileSync('src/hooks/useShipyardResolver.ts', 'utf8')))
}

console.log('\n=== 3. The store starts a free slip at once ===')
{
  const MARS = 'imperial-state-of-mars'
  const ZERO = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>
  useResourceStore.setState({ byCountry: { [MARS]: { amounts: { ...ZERO, alloys: 1e6, energy: 1e6, hyperium: 1e6 }, monthlyDelta: { ...ZERO } } } })
  useShipyardStore.setState({ ordersByCountry: {} })
  useGameTimeStore.setState({ simDays: 100 })
  const q = (n: number) => { for (let i = 0; i < n; i++) useShipyardStore.getState().queueBuild(MARS, 'corvette', 100) }
  q(4)
  const orders = () => useShipyardStore.getState().ordersFor(MARS)
  const started = () => orders().filter((o) => o.startedSimDays !== null).map((o) => o.id)
  check('queueing into free slips starts them straight away (a paused game too): Mars has 2', started().length === 2 && orders().length === 4, String(started().length))
  check('...the first two queued', started().join() === orders().slice(0, 2).map((o) => o.id).join())
  const first = orders()[0].id
  const third = orders()[2].id
  useShipyardStore.getState().cancelBuild(MARS, first)
  check('cancelling a building order frees its slip: the next waiting order (queue order) starts', started().length === 2 && started().includes(third) && orders().length === 3)
  check('...and the one after it keeps waiting', orders()[2].startedSimDays === null)
}

console.log('\n=== 4. Tab order ===')
{
  check('Fleet Manager is the first Navy tab and the default', FLEET_TABS[0].id === 'manager' && FLEET_TABS[0].label === 'Fleet Manager' && useFleetTabStore.getState().tab === 'manager')
  check('the four tabs keep their names', FLEET_TABS.map((t) => t.label).join() === 'Fleet Manager,Ship Designer,Shipyard,Strategizer')
  const panel = readFileSync('src/components/ShipyardPanel.tsx', 'utf8')
  const tabsAt = panel.indexOf('className="nav-subtabs shipyard-tabs"')
  const block = panel.slice(tabsAt, panel.indexOf('{message &&', tabsAt))
  check('in the Shipyard, the Slips subtab comes after every hull-group subtab', block.indexOf('sections.map') > -1 && block.indexOf('Slips (') > block.indexOf('sections.map'))
  check('...and the Shipyard opens on its first subtab, not Slips (unless a quick button asked for another)', /useState<string>\(\(\) => useFleetTabStore\.getState\(\)\.shipyardRequest \?\? GROUPS\[0\]\.id\)/.test(panel))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
