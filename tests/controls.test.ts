// Keyboard and menu controls, queued orders (Shift), army line thickness, and
// the comms signal — src/hooks/useKeyboardControls.ts, state/menuStore.ts,
// scene/gameReset.ts, scene/orderQueue.ts, scene/commsSignal.ts.
//
// Run:  npx tsx tests/controls.test.ts

import { PIRATES_ID, SANDBOX_PLAYER_ID } from '../src/data/countryRoster'
import { handleEscape, handleSpace } from '../src/hooks/useKeyboardControls'
import { fightPace } from '../src/hooks/fightPace'
import { resetGame } from '../src/scene/gameReset'
import { advanceParticipantStops, appendParticipantStop, syncEngagements } from '../src/scene/combatResolution'
import { pendingSignalsOf, signalProgress } from '../src/scene/commsSignal'
import { fleetIsBusy, orderSelectedFleets, queueFleetMoveOrder } from '../src/scene/commsVisual'
import { dispatchQueuedLegs, resolveQueueAdds } from '../src/scene/orderQueue'
import { isQueueModifierHeld, setQueueModifierHeld } from '../src/scene/queueModifier'
import { spawnSandboxArmy, startSandbox } from '../src/scene/sandboxSetup'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { useArmyStore } from '../src/state/armyStore'
import { useConfirmStore } from '../src/state/confirmStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useGroundViewStore } from '../src/state/groundViewStore'
import { useMenuStore } from '../src/state/menuStore'
import { usePlayerStore } from '../src/state/playerStore'
import { LINE_THICKNESS_PX, useSettingsStore } from '../src/state/settingsStore'
import { useShipStore, type MoveDestination } from '../src/state/shipStore'
import { useTerritoryStore } from '../src/state/territoryStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const time = useGameTimeStore
const ME = SANDBOX_PLAYER_ID

console.log('\n=== 1. Line thickness settings ===')
{
  const s = useSettingsStore.getState()
  check('the army line thickness defaults to medium', s.armyLineThickness === 'medium')
  check('...while navigation lines stay thin', s.navigationLineThickness === 'thin')
  check('medium is thicker than thin', LINE_THICKNESS_PX.medium > LINE_THICKNESS_PX.thin)
  s.setArmyLineThickness('thick')
  check('it can be changed', useSettingsStore.getState().armyLineThickness === 'thick')
  s.setArmyLineThickness('medium')
}

console.log('\n=== 2. The Escape menu pauses and resumes ===')
{
  useMenuStore.setState({ open: false, pausedByMenu: false })
  time.setState({ paused: false })
  useMenuStore.getState().openMenu()
  check('opening the menu pauses a running game', useMenuStore.getState().open && time.getState().paused)
  useMenuStore.getState().closeMenu()
  check('...and closing it resumes', !useMenuStore.getState().open && !time.getState().paused)

  time.setState({ paused: true })
  useMenuStore.getState().openMenu()
  useMenuStore.getState().closeMenu()
  check('a game the player had already paused stays paused', time.getState().paused)
  time.setState({ paused: false })

  useMenuStore.getState().openMenu()
  time.getState().togglePause()
  useMenuStore.getState().closeMenu()
  check("if the pause was undone while the menu was up, closing doesn't pause it again", !time.getState().paused && !useMenuStore.getState().open)
  time.setState({ paused: false })

  // Regression: Esc from inside Settings closed the menu but left the page on
  // Settings, so the next Esc reopened Settings instead of the menu.
  useMenuStore.getState().openMenu()
  useMenuStore.getState().setView('settings')
  handleEscape()
  check('Escape from Settings closes the menu', !useMenuStore.getState().open)
  handleEscape()
  check('...and the next Escape opens the main menu, not Settings', useMenuStore.getState().open && useMenuStore.getState().view === 'main')
  useMenuStore.getState().closeMenu()
  time.setState({ paused: false })
}

console.log('\n=== 3. Escape and Space ===')
{
  useMenuStore.setState({ open: false, pausedByMenu: false })
  time.setState({ paused: false })
  useConfirmStore.setState({ pending: null })
  useGroundViewStore.getState().setMode({ kind: 'order' })

  handleEscape()
  check('Escape opens the menu (and pauses)', useMenuStore.getState().open && time.getState().paused)
  handleEscape()
  check('Escape again closes it (and resumes)', !useMenuStore.getState().open && !time.getState().paused)

  handleSpace()
  check('Space pauses', time.getState().paused)
  handleSpace()
  check('...and resumes', !time.getState().paused)

  useMenuStore.getState().openMenu()
  handleSpace()
  check('Space does nothing while the menu is up', time.getState().paused)
  useMenuStore.getState().closeMenu()

  let confirmed = false
  useConfirmStore.getState().requestConfirm({ title: 'x', effects: [], onConfirm: () => (confirmed = true) })
  handleEscape()
  check('Escape cancels a pending decision first', !useConfirmStore.getState().pending && !confirmed && !useMenuStore.getState().open)
  useConfirmStore.getState().requestConfirm({ title: 'x', effects: [], onConfirm: () => {} })
  handleSpace()
  check('Space is ignored while a decision waits', !time.getState().paused)
  useConfirmStore.getState().resolve(false)

  useGroundViewStore.getState().setMode({ kind: 'spawn', ownerId: ME, armyKind: 'assault' })
  handleEscape()
  check('Escape drops a half-made placement on the ground map before opening the menu', useGroundViewStore.getState().mode.kind === 'order' && !useMenuStore.getState().open)
  time.setState({ paused: false })
}

console.log('\n=== 4. Quitting to the empire select screen ===')
{
  startSandbox()
  spawnOwnedShip('cruiser', ME, 'sol', 'Earth')
  spawnSandboxArmy(ME, 'assault', 'Earth')
  time.setState({ simDays: 500, mode: 'tactical', paused: true })
  useDiplomacyStore.getState().forceWar('a', 'b', 0)
  fightPace.groundLive = true
  useSettingsStore.getState().setArmyLineThickness('thick')
  check('there is a game to throw away', useShipStore.getState().ships.length === 1 && useArmyStore.getState().armies.length === 1)

  resetGame()
  check('no player is picked (the menu shows)', usePlayerStore.getState().selectedCountryId === null && !usePlayerStore.getState().sandbox)
  check('every ship and army is gone', useShipStore.getState().ships.length === 0 && useArmyStore.getState().armies.length === 0)
  check('the clock is back at the start, running, at strategic pace', time.getState().simDays === 0 && !time.getState().paused && time.getState().mode === 'normal')
  check('wars are gone', useDiplomacyStore.getState().wars.length === 0)
  check("the nations' territory is back (the sandbox had cleared it)", Object.keys(useTerritoryStore.getState().bodyOwner).length > 0)
  check('fight pacing is reset', !fightPace.groundLive)
  check("display settings are kept", useSettingsStore.getState().armyLineThickness === 'thick')
  useSettingsStore.getState().setArmyLineThickness('medium')
}

console.log('\n=== 5. Shift: queueing strategic orders ===')
{
  startSandbox() // no nation, so no comms delay: orders take effect at once
  time.setState({ simDays: 0, paused: false })
  const id = spawnOwnedShip('cruiser', ME, 'sol', 'Earth')!
  useShipStore.getState().selectShip(id)
  const at = (bodyName: string): MoveDestination => ({ kind: 'body', systemId: 'sol', bodyName })
  const ship = () => useShipStore.getState().ships.find((s) => s.id === id)!

  check('the modifier is not held by default', !isQueueModifierHeld())
  orderSelectedFleets(at('Mars'), true)
  check('with nothing to follow, a queued order just starts', !!ship().order && (ship().orderQueue?.length ?? 0) === 0)
  check('the fleet is now busy', fleetIsBusy([ship()]))
  orderSelectedFleets(at('Jupiter'), true)
  orderSelectedFleets(at('Saturn'), true)
  check('Shift-orders queue behind it, in order', ship().orderQueue?.length === 2 && ship().orderQueue?.[0].kind === 'body')
  check("...without touching the current order", ship().order?.destination.kind === 'body' && (ship().order?.destination as { bodyName: string }).bodyName === 'Mars')

  // The ship arrives at Mars: it should set off for Jupiter, then Saturn.
  const arrive = () => {
    const s = ship()
    time.setState({ simDays: (s.order?.arrivalSimDays ?? 0) + 0.001 })
  }
  arrive()
  // settle: the order completes (what useShipOrderSettler does)
  const s1 = ship()
  useShipStore.getState().setShipLocation(id, { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, undefined, true)
  check('arriving leaves the ship idle with its queue intact', !ship().order && ship().orderQueue?.length === 2 && !!s1)
  dispatchQueuedLegs(time.getState().simDays)
  check('the next queued order is sent', (ship().order?.destination as { bodyName?: string })?.bodyName === 'Jupiter')
  check('...and the queue shrinks', ship().orderQueue?.length === 1 && (ship().orderQueue?.[0] as { bodyName?: string }).bodyName === 'Saturn')

  // A plain order replaces everything.
  queueFleetMoveOrder([ship()], at('Venus'))
  check('a plain order replaces the queue', (ship().order?.destination as { bodyName?: string })?.bodyName === 'Venus' && (ship().orderQueue?.length ?? 0) === 0)

  setQueueModifierHeld(true)
  check('the modifier state is readable', isQueueModifierHeld())
  setQueueModifierHeld(false)
  useShipStore.setState({ ships: [] })
}

console.log('\n=== 6. Shift-orders behind comms delay travel as signals ===')
{
  useDiplomacyStore.getState().reset()
  usePlayerStore.getState().selectCountry('imperial-state-of-mars')
  useShipStore.setState({ ships: [] })
  time.setState({ simDays: 100 })
  // A Mars ship at Alpha Centauri: far from the capital, so behind delay.
  const id = spawnOwnedShip('cruiser', 'imperial-state-of-mars', 'alpha-centauri', 'Arcadia')!
  useShipStore.getState().selectShip(id)
  const ship = () => useShipStore.getState().ships.find((s) => s.id === id)!
  const there = (bodyName: string): MoveDestination => ({ kind: 'body', systemId: 'alpha-centauri', bodyName })

  orderSelectedFleets(there('Toliman b'), false)
  check('a plain order behind delay is a pending command', !!ship().pendingMoveOrder && !ship().order)
  const pm = ship().pendingMoveOrder!
  check('...that records when it was sent', pm.sentSimDays === 100 && pm.arrivesSimDays > 100)
  orderSelectedFleets(there('Toliman c'), true)
  check('a Shift-order behind delay is its own signal, not yet in the queue', ship().pendingQueueAdds?.length === 1 && (ship().orderQueue?.length ?? 0) === 0)
  const add = ship().pendingQueueAdds![0]
  check('...sent now, arriving after the delay', add.sentSimDays === 100 && add.arrivesSimDays > 100)

  const signals = pendingSignalsOf(ship(), 100)
  check('both are drawn as signals on their way', signals.length === 2 && signals.some((x) => x.kind === 'move') && signals.some((x) => x.kind === 'queue'))
  const s0 = signals[0]
  check('a signal starts at the capital and ends at the ship', signalProgress(s0, s0.sentSimDays) === 0 && signalProgress(s0, s0.arrivesSimDays) === 1)
  const mid = (s0.sentSimDays + s0.arrivesSimDays) / 2
  check('...and is halfway at the halfway point', Math.abs(signalProgress(s0, mid) - 0.5) < 1e-9)
  check('progress never leaves 0..1', signalProgress(s0, s0.sentSimDays - 5) === 0 && signalProgress(s0, s0.arrivesSimDays + 5) === 1)

  resolveQueueAdds(add.arrivesSimDays - 0.01)
  check('before it lands, the queue is unchanged', ship().pendingQueueAdds?.length === 1)
  resolveQueueAdds(add.arrivesSimDays + 0.01)
  check('once the signal lands the order joins the queue', ship().pendingQueueAdds?.length === 0 && ship().orderQueue?.length === 1)
  useShipStore.setState({ ships: [] })
}

console.log('\n=== 7. Shift: queueing stops in the combat arena ===')
{
  useDiplomacyStore.getState().reset()
  startSandbox()
  useShipStore.setState({ ships: [] })
  spawnOwnedShip('cruiser', ME, 'sol', 'Earth')
  spawnOwnedShip('corvette', PIRATES_ID, 'sol', 'Earth')
  const ships = useShipStore.getState().ships
  const [engagement] = syncEngagements(ships, [], 0)
  const mine = engagement.participants.find((p) => p.shipId === ships[0].id)!
  const here = mine.position
  const point = (dx: number, dy: number, dz: number) => ({ x: here.x + dx, y: here.y + dy, z: here.z + dz })

  const first = { ...mine, holdPosition: true, path: [point(4, 0, 0)] }
  const queued = appendParticipantStop(first, point(4, 4, 0), engagement.density, 0, engagement.obstacles)
  check('a stop is added after the current route', queued.stops?.length === 1 && queued.path.length === 1)
  const queued2 = appendParticipantStop(queued, point(0, 4, 0), engagement.density, 0, engagement.obstacles)
  check('...and another after that, in order', queued2.stops?.length === 2)
  check('a point the plan already ends at is refused (nothing to add)', appendParticipantStop(first, point(4, 0, 0), engagement.density, 0, engagement.obstacles) === first)

  const midRoute = advanceParticipantStops(queued2, engagement.density, 0, engagement.obstacles)
  check('while the ship is still under way, nothing changes', midRoute === queued2)
  const arrived = { ...queued2, path: [] }
  const next = advanceParticipantStops(arrived, engagement.density, 0, engagement.obstacles)
  check('once it has flown its route it sets off for the next stop', next.path.length > 0 && next.stops?.length === 1)
  const auto = advanceParticipantStops({ ...arrived, holdPosition: false }, engagement.density, 0, engagement.obstacles)
  check('handing the ship back to auto drops the plan', auto.stops?.length === 0 && auto.path.length === 0)
  useShipStore.setState({ ships: [] })
}

console.log('\n=== 8. Shift: queueing moves on the ground ===')
{
  startSandbox()
  useArmyStore.getState().reset()
  const armyId = spawnSandboxArmy(ME, 'assault', 'Earth')!
  const units = () => useArmyStore.getState().armies.find((a) => a.id === armyId)!.units
  const infantry = units().find((u) => u.type === 'infantry')!
  // Two reachable nodes a few cells from the unit.
  const start = infantry.nodeHint!
  const { surfaceMesh } = await import('../src/scene/surfaceMesh')
  const mesh = surfaceMesh()
  const ring = (from: number, steps: number): number => {
    let node = from
    for (let i = 0; i < steps; i++) node = mesh.neighbors.fine[node][0]
    return node
  }
  const a = ring(start, 3)
  const b = ring(a, 3)
  const r1 = useArmyStore.getState().orderUnits([infantry.id], a)
  check('a plain order sets a route', r1.ok && (units().find((u) => u.id === infantry.id)!.path?.length ?? 0) > 0)
  const len1 = units().find((u) => u.id === infantry.id)!.path!.length
  const r2 = useArmyStore.getState().orderUnits([infantry.id], b, true)
  const len2 = units().find((u) => u.id === infantry.id)!.path!.length
  check('a queued order extends the route instead of replacing it', r2.ok && len2 > len1, `${len1} → ${len2} waypoints`)
  useArmyStore.getState().orderUnits([infantry.id], a)
  const len3 = units().find((u) => u.id === infantry.id)!.path!.length
  check('a plain order afterwards replaces the whole route', len3 <= len1 + 1 && len3 < len2)
  useArmyStore.getState().reset()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
