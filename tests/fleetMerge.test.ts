// Merging a multi-selection into one fleet (scene/fleetRules.mergeCheck, used
// by the selection panel), and the click-away deselect (scene/deselect.ts).
// Run:  npx tsx tests/fleetMerge.test.ts
import { SHIP_CLASSES } from '../src/data/shipData'
import { mergeCheck } from '../src/scene/fleetRules'
import { deselectShipsOnEmptyClick } from '../src/scene/deselect'
import { pristineCombatState, useShipStore, type ShipInstance } from '../src/state/shipStore'
import { useFleetStore } from '../src/state/fleetStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { usePlayerStore } from '../src/state/playerStore'
import { settleShips } from '../src/hooks/useShipOrderSettler'
import { applyFleetMove } from '../src/scene/commsVisual'
import { planMoveUnchecked } from '../src/scene/shipPhysics'
import { startFleetMerge } from '../src/scene/fleetMerge'

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
function ship(id: string, fleetId: string, over: Partial<ShipInstance> = {}, classId = 'destroyer'): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === classId)!
  return {
    id, classId, name: id, ownerId: MARS, fleetId,
    location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
    order: null, hyperdriveReadySimDays: 0, warpReadySimDays: 0, warpEnabled: true, warpWhenReady: false, chaffAutoDeploy: true,
    pendingHyperdriveJump: null, followingShipId: null, combat: pristineCombatState(cls.combat), stance: 'balanced',
    ...over,
  }
}
const own = (s: ShipInstance) => s.ownerId === MARS

console.log('\n=== Merging selected fleets ===')
{
  const a = [ship('a1', 'fa')]
  const b = [ship('b1', 'fb'), ship('b2', 'fb')]
  check('two resting fleets of one nation can merge', mergeCheck([a, b], own).ok)
  check('one fleet is nothing to merge', !mergeCheck([a], own).ok)
  const away = [ship('c1', 'fc', { location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Venus', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 } })]
  check('fleets in different places can (the others fly to the lead)', mergeCheck([a, away], own).ok)
  const moving = [ship('d1', 'fd', { order: { destination: { kind: 'body', systemId: 'sol', bodyName: 'Venus' }, departSimDays: 0, arrivalSimDays: 10 } as never })]
  check('a fleet under way can too', mergeCheck([a, moving], own).ok)
  const sci = [ship('s1', 'fs', {}, 'science-ship')]
  const civ = mergeCheck([a, sci], own)
  check('civilian ships never join a fleet', !civ.ok && /Civilian/.test(civ.ok ? '' : civ.reason))
  const foreign = [ship('f1', 'ff', { ownerId: VENUS })]
  check('ships you do not own cannot be merged', !mergeCheck([a, foreign], own).ok)
  check('two nations\' fleets cannot be merged even if both were "own"', !mergeCheck([a, foreign], () => true).ok)
}

console.log('\n=== The store merge it drives ===')
{
  useFleetStore.getState().createFleet({ id: 'fa', name: 'Fleet A', ownerId: MARS, strategy: null })
  useFleetStore.getState().createFleet({ id: 'fb', name: 'Fleet B', ownerId: MARS, strategy: null })
  useShipStore.setState({ ships: [ship('a1', 'fa'), ship('b1', 'fb'), ship('b2', 'fb')] })
  useShipStore.getState().mergeFleets('fa', 'fb')
  const ships = useShipStore.getState().ships
  check('all three ships end up in one fleet', new Set(ships.map((s) => s.fleetId)).size === 1)
  check('...and the emptied fleet is gone', !useFleetStore.getState().fleets.some((f) => f.id === 'fb'))
}


console.log('\n=== Stellaris-style: the others fly to the fleet on top and join it ===')
{
  usePlayerStore.setState({ selectedCountryId: MARS })
  useGameTimeStore.setState({ paused: false, simDays: 100 })
  const at = (bodyName: string) => ({ kind: 'orbiting' as const, systemId: 'sol', bodyName, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
  for (const id of ['fa', 'fb', 'fc']) useFleetStore.getState().createFleet({ id, name: `Fleet ${id}`, ownerId: MARS, strategy: null })
  useShipStore.setState({ ships: [ship('lead', 'fa', { location: at('Mars') }), ship('f1', 'fb', { location: at('Earth') }), ship('f2', 'fc', { location: at('Earth') })] })
  // The lead is under way to Venus.
  const toVenus = { kind: 'body' as const, systemId: 'sol', bodyName: 'Venus' }
  applyFleetMove(useShipStore.getState().ships.filter((s) => s.id === 'lead'), toVenus, 100, planMoveUnchecked)
  const leadOrder = useShipStore.getState().ships.find((s) => s.id === 'lead')!.order
  check('the lead is under way', !!leadOrder)
  startFleetMerge('fa', ['fb', 'fc'])
  let ships = useShipStore.getState().ships
  check('the others are sent after it (following) and marked merging', ships.filter((s) => s.id !== 'lead').every((s) => s.followingShipId === 'lead' && s.mergeIntoFleetId === 'fa'))
  check('...and nothing merges while they are still apart', new Set(ships.map((s) => s.fleetId)).size === 3)
  let mergedDay = -1
  for (let day = 101; day < 400 && mergedDay < 0; day++) {
    useGameTimeStore.setState({ simDays: day })
    settleShips(day)
    if (new Set(useShipStore.getState().ships.map((s) => s.fleetId)).size === 1) mergedDay = day
  }
  ships = useShipStore.getState().ships
  check('they catch it and all end in one fleet', mergedDay > 0, `day ${mergedDay}`)
  check('...its own fleet, the one on top', ships.every((s) => s.fleetId === 'fa'))
  check('...and the lead carried on to where it was going the whole time', ships.every((s) => s.location.kind === 'orbiting' && s.location.bodyName === 'Venus'))
  check('...the follow and merge marks are cleared', ships.every((s) => !s.followingShipId && !s.mergeIntoFleetId))

  // A follower given its own order stops merging.
  useShipStore.setState({ ships: [ship('lead', 'fa', { location: at('Mars') }), ship('f1', 'fb', { location: at('Earth') })] })
  startFleetMerge('fa', ['fb'])
  useShipStore.getState().setFollowing('f1', null)
  useGameTimeStore.setState({ simDays: 500 })
  settleShips(500)
  const after = useShipStore.getState().ships
  check('a fleet given its own order is left alone', after.find((s) => s.id === 'f1')!.fleetId === 'fb' && !after.find((s) => s.id === 'f1')!.mergeIntoFleetId)
}

console.log('\n=== Click away deselects ===')
{
  useShipStore.setState({ ships: [ship('a1', 'fa'), ship('a2', 'fa')], selectedShipId: 'a1', selectedShipIds: ['a1', 'a2'] })
  deselectShipsOnEmptyClick({ shiftKey: true, ctrlKey: false, metaKey: false })
  check('a Shift-click on empty space leaves the selection alone', useShipStore.getState().selectedShipIds.length === 2)
  deselectShipsOnEmptyClick({ shiftKey: false, ctrlKey: false, metaKey: false })
  check('a plain click on empty space drops it', useShipStore.getState().selectedShipIds.length === 0 && useShipStore.getState().selectedShipId === null)
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
