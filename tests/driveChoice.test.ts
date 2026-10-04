// The player's per-ship drive choice (src/scene/driveChoice.ts) and the planner honouring it
// (scene/shipPhysics.planMoveUnchecked / hyperdriveJumpChance / wouldHyperjump, scene/jumpConfirm).
// Run:  npx tsx tests/driveChoice.test.ts
import { COUNTRIES } from '../src/data/countryData'
import { SHIP_CLASSES } from '../src/data/shipData'
import { usableDrives } from '../src/data/warpData'
import { LONG_TRIP_DAYS, autoDrive, defaultDriveChoice, driveOptions, effectiveDrive, formatTripTime, isLongTrip, slowestIndex } from '../src/scene/driveChoice'
import { longestReactionTripDays } from '../src/scene/jumpConfirm'
import { applyFleetMove } from '../src/scene/commsVisual'
import { driveOfShip, hyperdriveJumpChance, planMoveUnchecked, setJumpRoll, wouldHyperjump } from '../src/scene/shipPhysics'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { useShipStore, type MoveDestination, type ShipInstance } from '../src/state/shipStore'
import { useTechStore } from '../src/state/techStore'
import { driveHullId, grantWarp } from './testWarp'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
void COUNTRIES
const AC = 'alpha-centauri'
const toAC: MoveDestination = { kind: 'star', starId: AC }
const ship = (id: string): ShipInstance => useShipStore.getState().ships.find((s) => s.id === id)!
const hyper = [{ kind: 'hyperdrive' as const }]
const warp = [{ kind: 'warp' as const }]
const dual = [{ kind: 'hyperdrive' as const }, { kind: 'warp' as const }]
const base = new Set(['warp-theory', 'hyperspace-theory', 'hyperdrive-mk1'])
const withWarp = new Set([...base, 'warp-drive-mk1'])

function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  useTechStore.setState({ byCountry: {}, freeResearchMode: false })
  useResourceStore.setState({ byCountry: {} })
  useDiplomacyStore.getState().reset()
  setJumpRoll(() => 1)
}

console.log('\n=== 1. Which drives a ship can pick (pure) ===')
{
  const o = (drives: typeof dual, r: Set<string>) => driveOptions(drives, r)
  check('reaction is always available', [hyper, warp, dual, []].every((d) => o(d, new Set()).find((x) => x.drive === 'reaction')!.available))
  const hOnly = o(hyper, base)
  check('a hyperdrive hull offers hyperdrive, and says why warp is greyed', hOnly.find((x) => x.drive === 'hyperdrive')!.available && !hOnly.find((x) => x.drive === 'warp')!.available && /no warp drive/.test(hOnly.find((x) => x.drive === 'warp')!.reason!))
  const wNoTech = o(warp, base)
  check('a warp hull whose owner lacks Warp Mk I greys warp with the tech reason', !wNoTech.find((x) => x.drive === 'warp')!.available && /Warp Drive Mk I/.test(wNoTech.find((x) => x.drive === 'warp')!.reason!))
  const d = o(dual, withWarp)
  check('a dual hull with both Mks offers all three', d.every((x) => x.available))
  check('...and agrees with usableDrives', usableDrives(dual, withWarp).warp && usableDrives(dual, withWarp).hyperdrive)
  check('no hyperdrive tech: hyperdrive greyed with the tech reason', /Hyperdrive Mk I/.test(o(hyper, new Set()).find((x) => x.drive === 'hyperdrive')!.reason!))
}

console.log('\n=== 2. What a choice means (pure) ===')
{
  check('auto = the planner\'s original rule: warp when usable and enabled', autoDrive(dual, withWarp, true) === 'warp')
  check('...a dual hull with warp turned off flies (it never jumped then either)', autoDrive(dual, withWarp, false) === 'reaction')
  check('...hyperdrive only outside a warp hull', autoDrive(hyper, base, true) === 'hyperdrive' && autoDrive(dual, base, true) === 'hyperdrive')
  check('...nothing usable: reaction', autoDrive(hyper, new Set(), true) === 'reaction')
  check('an explicit choice that is available wins, even over auto\'s pick', effectiveDrive('hyperdrive', dual, withWarp, true) === 'hyperdrive' && effectiveDrive('reaction', dual, withWarp, true) === 'reaction' && effectiveDrive('warp', dual, withWarp, false) === 'warp')
  check('an unavailable choice falls back to auto', effectiveDrive('warp', hyper, base, true) === 'hyperdrive' && effectiveDrive('hyperdrive', warp, withWarp, true) === 'warp')
  check('no choice = auto', effectiveDrive(undefined, dual, withWarp, true) === 'warp')
  check('the default is auto unless the class says otherwise', defaultDriveChoice(undefined) === 'auto' && defaultDriveChoice('hyperdrive') === 'hyperdrive')
  check('only the Turing Scout defaults to hyperdrive', SHIP_CLASSES.filter((c) => c.defaultDrive).map((c) => `${c.id}:${c.defaultDrive}`).join() === 'turing-scout:hyperdrive')
  check('the slowest ship of a selection', slowestIndex([{ drive: 'warp', days: 20 }, { drive: 'reaction', days: 900 }, { drive: 'hyperdrive', days: 0 }]) === 1)
  check('a trip over a year is a long one', isLongTrip(LONG_TRIP_DAYS + 1) && !isLongTrip(LONG_TRIP_DAYS) && /years/.test(formatTripTime(2000)) && /days/.test(formatTripTime(40)))
}

console.log('\n=== 3. The planner honours the choice (a dual-drive hull) ===')
{
  fresh()
  grantWarp(MARS, 1, true)
  const cls = driveHullId('destroyer-hull', 'drive-dual')
  const id = spawnOwnedShip(cls, MARS, 'sol', 'Mars')!
  check('untouched, a dual hull is on Auto and warps (as before)', driveOfShip(ship(id)) === 'warp' && planMoveUnchecked(ship(id), toAC, 0).kind === 'order')

  useShipStore.getState().setDriveChoice(id, 'warp')
  const warped = planMoveUnchecked(ship(id), toAC, 0)
  check('Warp: an order at warp speed, no jump, no risk shown', warped.kind === 'order' && warped.order.usedWarp === true && hyperdriveJumpChance(ship(id), AC, 0) === null && !wouldHyperjump(ship(id), toAC, 0))

  useShipStore.getState().setDriveChoice(id, 'hyperdrive')
  const jumped = planMoveUnchecked(ship(id), toAC, 0)
  check('Hyperdrive on a dual hull: it JUMPS (instant) although warp is usable', jumped.kind === 'instant' && wouldHyperjump(ship(id), toAC, 0))
  const chance = hyperdriveJumpChance(ship(id), AC, 0)
  check('...and the risk shown is a real number, the one the roll uses', chance !== null && chance > 0 && chance < 1, `${((chance ?? 0) * 100).toFixed(1)}%`)
  setJumpRoll(() => 0)
  check('...a bad roll loses it', planMoveUnchecked(ship(id), toAC, 0).kind === 'lost-in-hyperspace')
  setJumpRoll(() => 1)

  useShipStore.getState().setDriveChoice(id, 'reaction')
  const flown = planMoveUnchecked(ship(id), toAC, 0)
  check('Reaction: a plain order, no warp, and no jump risk shown', flown.kind === 'order' && flown.order.usedWarp === false && hyperdriveJumpChance(ship(id), AC, 0) === null && !wouldHyperjump(ship(id), toAC, 0))
  const warpDays = warped.kind === 'order' ? warped.order.arrivalSimDays : 0
  const reactionDays = flown.kind === 'order' ? flown.order.arrivalSimDays : 0
  check('...and it takes far longer than warp (years vs days)', reactionDays > warpDays * 100 && reactionDays > LONG_TRIP_DAYS, `${warpDays.toFixed(0)} d warp, ${(reactionDays / 365.25).toFixed(1)} y reaction`)
  check('...the long-trip warning sees it (and only for a reaction ship)', (longestReactionTripDays([ship(id)], toAC, 0) ?? 0) > LONG_TRIP_DAYS)
  useShipStore.getState().setDriveChoice(id, 'warp')
  check('a warp ship has no long-trip warning', longestReactionTripDays([ship(id)], toAC, 0) === null)

  // The choice persists: it is on the ship, not on the order.
  useShipStore.getState().setDriveChoice(id, 'reaction')
  planMoveUnchecked(ship(id), toAC, 0)
  check('the choice stays on the ship across orders', ship(id).driveChoice === 'reaction' && driveOfShip(ship(id)) === 'reaction')
  check('picking Reaction or Hyperdrive turns the legacy warp flag off, Warp and Auto turn it on', ship(id).warpEnabled === false && (useShipStore.getState().setDriveChoice(id, 'auto'), ship(id).warpEnabled === true))

  // A fleet orders by each ship's own pick; the move still comes out together.
  useShipStore.getState().setDriveChoice(id, 'hyperdrive')
  const escort = spawnOwnedShip(cls, MARS, 'sol', 'Mars')!
  useShipStore.getState().setDriveChoice(escort, 'warp')
  applyFleetMove([ship(id), ship(escort)], toAC, 0, planMoveUnchecked)
  check('a mixed-pick fleet: the warper flies, the jumper waits to land with it', !!ship(escort).order && ship(id).pendingHyperdriveJump === AC && ship(id).pendingHyperdriveJumpArrivesSimDays === ship(escort).order!.arrivalSimDays)
}

console.log('\n=== 4. Turing Scouts start on Hyperdrive; nothing else changes ===')
{
  fresh()
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...base, 'autonomous-navigation']) } } })
  const turing = spawnOwnedShip('turing-scout', MARS, 'sol', 'Mars')!
  check('a Turing Scout\'s drive is Hyperdrive with no choice stored', ship(turing).driveChoice === undefined && driveOfShip(ship(turing)) === 'hyperdrive' && resolveShipClass('turing-scout')!.defaultDrive === 'hyperdrive')
  check('...so it jumps like before', planMoveUnchecked(ship(turing), toAC, 0).kind === 'instant')
  const corvette = spawnOwnedShip('corvette', MARS, 'sol', 'Mars')!
  check('a Corvette is on Auto: it jumps like before', driveOfShip(ship(corvette)) === 'hyperdrive' && planMoveUnchecked(ship(corvette), toAC, 0).kind === 'instant')
  useShipStore.getState().setDriveChoice(corvette, 'reaction')
  check('a hyperdrive-only hull can pick Reaction to fly instead', planMoveUnchecked(ship(corvette), toAC, 0).kind === 'order' && hyperdriveJumpChance(ship(corvette), AC, 0) === null)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
