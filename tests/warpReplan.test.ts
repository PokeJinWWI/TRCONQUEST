// "Warp When Ready" switched on mid-flight (scene/warpReplan.ts): an order
// already underway on reaction drive is re-planned to engage warp as soon as
// the drive is ready. Also covers planMove carrying an unfinished
// gravity-well escape into the new plan.
//
// Run:  npx tsx tests/warpReplan.test.ts

import { resolveShipClass } from '../src/state/shipClassResolver'
import { grantWarp, warpHullId } from './testWarp'
import { useShipStore, pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { usePlayerStore } from '../src/state/playerStore'
import { planMove } from '../src/scene/shipPhysics'
import { replanForWarpWhenReady } from '../src/scene/warpReplan'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const PLAYER = 'imperial-state-of-mars'
// No preset hull warps: a designer-built warp courier, its owner at Warp Drive Mk I.
grantWarp(PLAYER)
const WARP_COURIER = warpHullId('civilian-hull')
function makeShip(overrides: Partial<ShipInstance> = {}): ShipInstance {
  const cls = resolveShipClass(WARP_COURIER)!
  return {
    id: 'w1',
    classId: WARP_COURIER,
    name: 'Courier w1',
    ownerId: PLAYER,
    location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
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
    fleetId: 'solo-w1',
    ...overrides,
  }
}

const shipNow = () => useShipStore.getState().ships[0]
const alphaCen = { kind: 'star', starId: 'alpha-centauri' } as const

usePlayerStore.setState({ selectedCountryId: PLAYER })
useGameTimeStore.setState({ simDays: 100, paused: false })

console.log('\n=== Warp When Ready mid-flight ===')
{
  // Warp on cooldown until day 130, flag off -> the order rides reaction drive.
  useShipStore.setState({ ships: [makeShip({ warpReadySimDays: 130 })] })
  const first = planMove(shipNow(), alphaCen, 100)
  check('order planned', first.kind === 'order', first.kind)
  if (first.kind === 'order') useShipStore.getState().setShipOrder('w1', first.order, first.warpReadyOverride)
  check('starts on reaction drive only', shipNow().order?.usedWarp === false)
  const reactionArrival = shipNow().order!.arrivalSimDays

  // Nothing to do while the flag is off.
  check('no re-plan while the flag is off', replanForWarpWhenReady('w1', 105) === false && shipNow().order?.usedWarp === false)

  useShipStore.getState().setWarpWhenReady('w1', true)
  const did = replanForWarpWhenReady('w1', 105)
  const o = shipNow().order!
  check('turning it on mid-flight re-plans the order to use warp', did && o.usedWarp)
  check('warp engages exactly when the drive comes off cooldown', o.warpEngageSimDays === 130, `engage ${o.warpEngageSimDays}`)
  check('the trip now arrives much sooner', o.arrivalSimDays < reactionArrival, `${o.arrivalSimDays.toFixed(1)} vs ${reactionArrival.toFixed(1)}`)
  check('destination unchanged', o.destination.kind === 'star' && o.destination.starId === 'alpha-centauri')

  // Idempotent: an order already using warp is left alone.
  const before = shipNow().order
  check('an order already using warp is not touched again', replanForWarpWhenReady('w1', 106) === false && shipNow().order === before)
}

console.log('\n=== Needs "Use Warp Drive" ===')
{
  useShipStore.setState({ ships: [makeShip({ warpReadySimDays: 130, warpEnabled: false, warpWhenReady: true })] })
  const first = planMove(shipNow(), alphaCen, 100)
  if (first.kind === 'order') useShipStore.getState().setShipOrder('w1', first.order)
  check('warp drive off: no re-plan even with the flag on', replanForWarpWhenReady('w1', 105) === false && shipNow().order?.usedWarp === false)
}

console.log('\n=== Arrives before warp could engage: order left alone ===')
{
  useShipStore.setState({ ships: [makeShip({ warpReadySimDays: 1e9 })] })
  const first = planMove(shipNow(), { kind: 'star', starId: 'alpha-centauri' }, 100)
  if (first.kind === 'order') useShipStore.getState().setShipOrder('w1', first.order)
  useShipStore.getState().setWarpWhenReady('w1', true)
  const before = shipNow().order
  check('cooldown outlasts the trip -> unchanged', replanForWarpWhenReady('w1', 105) === false && shipNow().order === before)
}

console.log('\n=== Unfinished gravity-well escape carries over ===')
{
  // Fresh order from Sol: well-clearing phase (~155), flag off, cooldown (day 200)
  // active => reaction drive, but the well clear time is recorded.
  useShipStore.setState({
    ships: [
      makeShip({
        location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] },
        warpReadySimDays: 200,
      }),
    ],
  })
  const first = planMove(shipNow(), alphaCen, 100)
  if (first.kind === 'order') useShipStore.getState().setShipOrder('w1', first.order)
  const wellClear = shipNow().order?.gravityWellClearSimDays
  check('star-side order records a gravity well phase', wellClear !== undefined && wellClear > 101, `clear ${wellClear?.toFixed(1)}`)
  useShipStore.getState().setWarpWhenReady('w1', true)
  const did = replanForWarpWhenReady('w1', 110)
  const o = shipNow().order!
  check('re-plan warps', did && o.usedWarp)
  check('warp does not engage before the well is cleared', (o.warpEngageSimDays ?? 0) >= wellClear!, `engage ${o.warpEngageSimDays?.toFixed(1)} vs clear ${wellClear?.toFixed(1)}`)
}

console.log('\n=== Warp switched on mid-flight from inside a well ===')
{
  // Order given with warp OFF from Sol; the order still records the escape.
  useShipStore.setState({
    ships: [makeShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] }, warpEnabled: false })],
  })
  const first = planMove(shipNow(), alphaCen, 100)
  if (first.kind === 'order') useShipStore.getState().setShipOrder('w1', first.order)
  const wellClear = shipNow().order?.gravityWellClearSimDays
  check('warp-off order still records the well escape', wellClear !== undefined && wellClear > 100, `clear ${wellClear?.toFixed(1)}`)
  useShipStore.getState().setWarpEnabled('w1', true)
  useShipStore.getState().setWarpWhenReady('w1', true)
  const did = replanForWarpWhenReady('w1', 101)
  const o = shipNow().order!
  check('then enabling warp + warp-when-ready re-plans to warp', did && o.usedWarp)
  check('but not until the well is cleared', (o.warpEngageSimDays ?? 0) >= wellClear!, `engage ${o.warpEngageSimDays?.toFixed(1)} vs clear ${wellClear?.toFixed(1)}`)
}

console.log(failures === 0 ? '\nAll warp re-plan checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
