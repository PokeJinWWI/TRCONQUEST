// Ship classes for surveying/construction/hauling, the cargo hold rules, and
// the shipyard's tech gate on the Construction Ship.
//
// Run:  npx tsx tests/cargo.test.ts

import { SHIP_CLASSES, SHIP_ROLE_LABELS, CONSTRUCTION_SHIP_CARGO, CARGO_SHIP_CARGO } from '../src/data/shipData'
import { STARBASE_COST } from '../src/data/starbaseData'
import { cargoCovers, cargoMinus, cargoPlus, cargoSpace, cargoTotal, clampToSpace, loadingBody, transferCheck } from '../src/scene/cargoLogic'
import { useShipyardStore } from '../src/state/shipyardStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTechStore } from '../src/state/techStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useShipStore, pristineCombatState, type ShipInstance, type ShipLocation } from '../src/state/shipStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { applyShipCommand, queueShipCommand, resolvePendingCommands } from '../src/scene/shipCommands'
import { usePlayerStore } from '../src/state/playerStore'
import { nearestStation, orderRefill, refillWant } from '../src/scene/refill'
import { settleShips } from '../src/hooks/useShipOrderSettler'
import { systemBodies } from '../src/scene/territory'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const orbit = (bodyName: string, systemId = 'sol'): ShipLocation => ({ kind: 'orbiting', systemId, bodyName, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
const NATION = 'imperial-state-of-mars'

console.log('\n=== Classes ===')
{
  const sci = SHIP_CLASSES.find((c) => c.id === 'science-ship')!
  const con = SHIP_CLASSES.find((c) => c.id === 'construction-ship')!
  const car = SHIP_CLASSES.find((c) => c.id === 'cargo-ship')!
  check('three new hulls exist with their roles', sci?.role === 'science' && con?.role === 'construction' && car?.role === 'cargo')
  check('roles have labels', !!SHIP_ROLE_LABELS.science && !!SHIP_ROLE_LABELS.construction && !!SHIP_ROLE_LABELS.cargo)
  check('all are unarmed', [sci, con, car].every((c) => c.combat.weapons.length === 0))
  check('only the Construction Ship is tech-gated (Orbital Construction)', con.requiresTech === 'orbital-construction' && !sci.requiresTech && !car.requiresTech)
  check('holds: construction covers one Starbase, cargo is the big hold', CONSTRUCTION_SHIP_CARGO >= Object.values(STARBASE_COST).reduce((a, b) => a + (b ?? 0), 0) && CARGO_SHIP_CARGO > CONSTRUCTION_SHIP_CARGO)
  check('science ship has no hold', !sci.cargoCapacity)
}

console.log('\n=== Hold arithmetic ===')
{
  const hold = { alloys: 100, energy: 50 }
  check('total / space', cargoTotal(hold) === 150 && cargoSpace(400, hold) === 250 && cargoSpace(100, hold) === 0)
  check('covers a cost it has', cargoCovers(hold, { alloys: 100, energy: 10 }))
  check('does not cover one it lacks', !cargoCovers(hold, { alloys: 101 }) && !cargoCovers(hold, { exoticMatter: 1 }))
  const after = cargoMinus(hold, { alloys: 30, energy: 60 })
  check('minus clamps at zero and never goes negative', after.alloys === 70 && after.energy === 0)
  check('plus adds', cargoPlus(hold, { alloys: 5, exoticMatter: 2 }).exoticMatter === 2 && cargoPlus(hold, { alloys: 5 }).alloys === 105)
  const clamped = clampToSpace({ alloys: 300, energy: 300 }, { alloys: 200, energy: 500 }, 350)
  check('clamp respects stock, then space, in order', clamped.alloys === 200 && clamped.energy === 150, JSON.stringify(clamped))
  check('clamp with no room takes nothing', Object.keys(clampToSpace({ alloys: 10 }, { alloys: 10 }, 0)).length === 0)
}

console.log('\n=== Where a ship can load / transfer ===')
{
  const owners = { Mars: NATION, Venus: 'republic-of-venus' }
  const at = (bodyName: string, extra = {}) => ({ ownerId: NATION, order: null, location: orbit(bodyName), ...extra })
  check('load at an owned body', loadingBody(at('Mars'), owners).ok)
  check('not at a foreign body', !loadingBody(at('Venus'), owners).ok)
  check('not at an unowned body', !loadingBody(at('Ceres'), owners).ok)
  check('not while under way', !loadingBody(at('Mars', { order: {} }), owners).ok)
  check('not in open space', !loadingBody({ ownerId: NATION, order: null, location: { kind: 'system-point', systemId: 'sol', position: [0, 0, 0] } }, owners).ok)

  const a = { id: 'a', ...at('Mars') }
  check('transfer in the same place', transferCheck(a, { id: 'b', ...at('Mars') }).ok)
  check('not to itself', !transferCheck(a, a).ok)
  check('not across places', !transferCheck(a, { id: 'b', ...at('Earth') }).ok)
  check('not across nations', !transferCheck(a, { id: 'b', ...at('Mars', { ownerId: 'republic-of-venus' }) }).ok)
  check('not while under way', !transferCheck(a, { id: 'b', ...at('Mars', { order: {} }) }).ok)
}

console.log('\n=== Shipyard tech gate ===')
{
  useGameTimeStore.setState({ simDays: 0 })
  useTechStore.setState({ byCountry: {} })
  const rs = useResourceStore.getState()
  for (const id of ['alloys', 'energy', 'exoticMatter'] as const) rs.setAmount(NATION, id, 10_000)
  const queue = useShipyardStore.getState().queueBuild
  const refused = queue(NATION, 'construction-ship', 0)
  check('Construction Ship refused without Orbital Construction', !refused.ok && /Orbital Construction/.test(refused.ok ? '' : refused.reason), refused.ok ? '' : refused.reason)
  check('Science and Cargo ships buildable from the start', queue(NATION, 'science-ship', 0).ok && queue(NATION, 'cargo-ship', 0).ok)
  useTechStore.setState({ byCountry: { [NATION]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperspace-theory', 'orbital-construction']) } } })
  check('Construction Ship buildable once researched', queue(NATION, 'construction-ship', 0).ok)
}

function ship(id: string, classId: string, location: ShipLocation, cargo: Record<string, number> = {}, ownerId = NATION): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === classId)!
  return {
    id, classId, name: id, ownerId, location, order: null, hyperdriveReadySimDays: 0, warpReadySimDays: 0, warpEnabled: true, warpWhenReady: false,
    chaffAutoDeploy: true, pendingHyperdriveJump: null, followingShipId: null, combat: pristineCombatState(cls.combat), stance: 'balanced', fleetId: `solo-${id}`,
    cargo: cargo as never,
  }
}

console.log('\n=== Ship commands: load, transfer, build ===')
{
  usePlayerStore.setState({ selectedCountryId: NATION, sandbox: false })
  useGameTimeStore.setState({ simDays: 0 })
  useResourceStore.setState({ byCountry: {} })
  useTerritoryStore.getState().reset()
  useStarbaseStore.setState({ starbases: [] })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  const rs = useResourceStore.getState()
  rs.setAmount(NATION, 'alloys', 1000)
  rs.setAmount(NATION, 'energy', 1000)
  rs.setAmount(NATION, 'exoticMatter', 100)
  const marsOrbit = orbit('Mars')
  useShipStore.setState({ ships: [ship('con', 'construction-ship', marsOrbit), ship('car', 'cargo-ship', marsOrbit), ship('far', 'cargo-ship', orbit('Venus'))] })
  const held = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)?.cargo ?? {}
  const stockOf = (id: 'alloys' | 'energy' | 'exoticMatter') => useResourceStore.getState().stateFor(NATION).amounts[id]

  applyShipCommand('con', { kind: 'load', want: { alloys: 220 } }, 0)
  check('load takes goods from the stockpile into the hold', held('con').alloys === 220 && stockOf('alloys') === 780 && Object.keys(held('con')).length === 1)
  applyShipCommand('con', { kind: 'load', want: { alloys: 9999 } }, 0)
  check('load stops at the hold capacity', (held('con').alloys ?? 0) + (held('con').energy ?? 0) + (held('con').exoticMatter ?? 0) === CONSTRUCTION_SHIP_CARGO)
  const before = stockOf('energy')
  applyShipCommand('far', { kind: 'load', want: { energy: 50 } }, 0)
  check('load is refused away from an owned world (Venus is not yours)', stockOf('energy') === before && !held('far').energy)

  useShipStore.getState().setShipCargo('con', {})
  applyShipCommand('car', { kind: 'load', want: { alloys: 300 } }, 0)
  applyShipCommand('car', { kind: 'transfer', toShipId: 'con', want: { alloys: 300 } }, 0)
  check('transfer moves goods to a ship in the same place', held('con').alloys === 300 && !held('car').alloys)
  useResourceStore.getState().setAmount(NATION, 'alloys', 5000)
  applyShipCommand('car', { kind: 'load', want: { alloys: 500 } }, 0)
  applyShipCommand('car', { kind: 'transfer', toShipId: 'con', want: { alloys: 500 } }, 0)
  check('...clamped to the receiving hold\'s space (the rest stays aboard)', held('con').alloys === CONSTRUCTION_SHIP_CARGO && held('car').alloys === 400)
  applyShipCommand('car', { kind: 'transfer', toShipId: 'far', want: { alloys: 10 } }, 0)
  check('transfer is refused to a ship in another place', !held('far').alloys)

  // Build from the hold.
  useTerritoryStore.getState().reset()
  useTechStore.setState({ byCountry: { [NATION]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'orbital-construction']) } } })
  useShipStore.setState({ ships: [ship('b', 'construction-ship', { kind: 'star', starId: 'barnards-star', offset: [0, 0, 0] }, { alloys: 220 })] })
  applyShipCommand('b', { kind: 'build-starbase' }, 0)
  check('build refused while the system is not surveyed', useStarbaseStore.getState().starbases.length === 0)
  const sv = useSurveyStore.getState()
  sv.discover(NATION, { kind: 'explored', starId: 'barnards-star' }, 0, 0)
  for (const body of systemBodies('barnards-star')) sv.discover(NATION, { kind: 'surveyed', bodyName: body }, 0, 0)
  applyShipCommand('b', { kind: 'build-starbase' }, 0)
  check('build-starbase command builds it from the hold', useStarbaseStore.getState().starbases.length === 1 && !held('b').alloys)
}

console.log('\n=== Commands take signal time out of contact ===')
{
  useTechStore.setState({ byCountry: {} })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [ship('sci', 'science-ship', { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })] })
  useSurveyStore.getState().discover(NATION, { kind: 'explored', starId: 'alpha-centauri' }, 0, 0)
  queueShipCommand('sci', { kind: 'survey' })
  const s0 = useShipStore.getState().ships[0]
  check('far away the command is queued, not applied', !s0.surveyJob && (s0.pendingCommands?.length ?? 0) === 1, `${s0.pendingCommands?.[0]?.arrivesSimDays.toFixed(0)}d`)
  const arrives = s0.pendingCommands![0].arrivesSimDays
  resolvePendingCommands(arrives - 1)
  check('not applied just before the signal arrives', !useShipStore.getState().ships[0].surveyJob)
  resolvePendingCommands(arrives)
  check('applied when it arrives, and the queue empties', !!useShipStore.getState().ships[0].surveyJob && (useShipStore.getState().ships[0].pendingCommands?.length ?? 0) === 0)
}

console.log('\n=== Refill at nearest station ===')
{
  check('a construction hold asks for exactly one Starbase kit', JSON.stringify(refillWant(undefined, CONSTRUCTION_SHIP_CARGO)) === JSON.stringify({ alloys: 220 }))
  const big = refillWant(undefined, CARGO_SHIP_CARGO)
  check('a cargo hold asks for as many kits as fit (6), and only alloys', big.alloys === 1320 && Object.keys(big).length === 1, JSON.stringify(big))
  check('what is already aboard is not asked for again', refillWant({ alloys: 100 }, CONSTRUCTION_SHIP_CARGO).alloys === 120)
  check('a full hold asks for nothing', Object.keys(refillWant({ alloys: 220 }, CONSTRUCTION_SHIP_CARGO)).length === 0)

  usePlayerStore.setState({ selectedCountryId: NATION, sandbox: false })
  useTerritoryStore.getState().reset()
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useResourceStore.setState({ byCountry: {} })
  for (const id of ['alloys', 'energy', 'exoticMatter'] as const) useResourceStore.getState().setAmount(NATION, id, 5000)
  useTechStore.setState({ byCountry: { [NATION]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperspace-theory', 'hyper-comms']) } } })
  const owners = useTerritoryStore.getState().bodyOwner
  const farOut = ship('haul', 'cargo-ship', { kind: 'orbiting', systemId: 'sol', bodyName: 'Neptune', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
  const st = nearestStation(farOut, owners, 0)
  check('the nearest station is one of the nation\'s own worlds', !!st && owners[st.bodyName] === NATION, JSON.stringify(st))
  const away = ship('haul', 'cargo-ship', { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
  check('from another star system it is still a world of theirs in Sol', owners[nearestStation(away, owners, 0)!.bodyName] === NATION && nearestStation(away, owners, 0)!.systemId === 'sol')

  // At a station: loads at once. Elsewhere: flies there and loads on arrival.
  useShipStore.setState({ ships: [ship('haul', 'cargo-ship', orbit('Mars'))] })
  orderRefill('haul')
  check('at one of its worlds, Refill loads straight away', (useShipStore.getState().ships[0].cargo?.alloys ?? 0) === 1320)
  useShipStore.setState({ ships: [farOut] })
  orderRefill('haul')
  const sh = useShipStore.getState().ships[0]
  check('elsewhere it heads for the nearest station and remembers to load', !!sh.order && sh.arrivalCommand?.bodyName === st!.bodyName && sh.arrivalCommand.command.kind === 'load')
  const arrives = sh.order!.arrivalSimDays
  settleShips(arrives - 1)
  check('nothing is loaded before it arrives', (useShipStore.getState().ships[0].cargo?.alloys ?? 0) === 0)
  settleShips(arrives)
  const after = useShipStore.getState().ships[0]
  check('on arrival it loads from the stockpile and the order clears', (after.cargo?.alloys ?? 0) === 1320 && !after.arrivalCommand)
}

console.log(failures === 0 ? '\nAll cargo checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
