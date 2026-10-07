// Hyperlanes belong to the nation that charted them (state/hyperlaneStore.ts,
// pure scene/hyperlanes.ts): nobody else's jumps are safer for them and nobody
// else sees them, except in Observer mode. Lanes are never shared; mergeLanes is
// the pure hook a future treaty would use.
// Run: npx tsx tests/hyperlanes.test.ts
import { hasLane, laneEndpoints, laneKey, mergeLanes, withLane } from '../src/scene/hyperlanes'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { HYPERDRIVE_BASE_LOSS_CHANCE, HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE } from '../src/data/shipData'
import { STARS } from '../src/data/starData'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { hyperdriveJumpChance, hyperdriveJumpRiskFactor, planMoveUnchecked, setJumpRoll, starJumpChance } from '../src/scene/shipPhysics'
import { applyMoveResult } from '../src/scene/commsVisual'
import { laneSegments } from '../src/scene/observerView'
import { hyperdriveMkLoss } from '../src/data/warpData'
import { JUMP_WARN_LOSS } from '../src/scene/jumpWarning'
import { resetGame } from '../src/scene/gameReset'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'
const ship = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!

console.log('\n=== 1. Lanes as data ===')
{
  check('a lane has no direction', laneKey('sol', 'sirius') === laneKey('sirius', 'sol') && laneEndpoints(laneKey('sirius', 'sol')).join() === 'sirius,sol')
  const one = withLane([], 'sol', 'sirius')
  check('adding a lane', hasLane(one, 'sirius', 'sol') && !hasLane(one, 'sol', 'wolf-359'))
  check('adding it again gives the same list', withLane(one, 'sirius', 'sol') === one)
}

console.log('\n=== 2. Merging two nations\' lanes (the future hook, nothing calls it) ===')
{
  const a = [laneKey('sol', 'sirius'), laneKey('sol', 'wolf-359')]
  const b = [laneKey('wolf-359', 'sol'), laneKey('sol', 'ross-154')]
  const merged = mergeLanes(a, b)
  check('the union, each lane once', merged.length === 3 && hasLane(merged, 'sol', 'sirius') && hasLane(merged, 'sol', 'wolf-359') && hasLane(merged, 'sol', 'ross-154'))
  check('the first nation\'s order first, then what the second adds', merged.join() === [...a, laneKey('sol', 'ross-154')].join())
  check('the inputs are untouched', a.length === 2 && b.length === 2)
  check('with nothing, or with itself, it is the same set', mergeLanes(a, []).join() === a.join() && mergeLanes([], a).join() === a.join() && mergeLanes(a, a).join() === a.join())
  check('either way round, the same lanes', [...mergeLanes(b, a)].sort().join() === [...merged].sort().join())
}

console.log('\n=== 3. One nation\'s lane is not another\'s ===')
{
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  const m = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  const v = spawnOwnedShip('science-ship', VENUS, 'sol', 'Venus')!
  const before = { m: hyperdriveJumpChance(ship(m), 'alpha-centauri', 0)!, v: hyperdriveJumpChance(ship(v), 'alpha-centauri', 0)! }
  check('today\'s single-hop value: base x the jump\'s factor', near(before.m, Math.min(1, HYPERDRIVE_BASE_LOSS_CHANCE * hyperdriveJumpRiskFactor(ship(m), 'alpha-centauri', 0))), `${(before.m * 100).toFixed(1)}%`)

  // Mars's ship makes the jump (the roll never loses here) and charts the lane.
  setJumpRoll(() => 1)
  const dest = { kind: 'star' as const, starId: 'alpha-centauri' }
  const jump = planMoveUnchecked(ship(m), dest, 0)
  applyMoveResult(ship(m), dest, jump)
  setJumpRoll(null)
  const lanes = useHyperlaneStore.getState()
  check('the jump charts the lane for the ship\'s own nation', jump.kind === 'instant' && lanes.hasHyperlane(MARS, 'sol', 'alpha-centauri'))
  check('...and for nobody else', !lanes.hasHyperlane(VENUS, 'sol', 'alpha-centauri') && lanes.lanesOf(VENUS).length === 0)
  check('the map list of each nation: Mars one lane, Venus none', lanes.lanesOf(MARS).length === 1 && lanes.lanesOf(VENUS).length === 0 && lanes.lanesOf(null).length === 0)

  const m2 = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  const after = { m: hyperdriveJumpChance(ship(m2), 'alpha-centauri', 0)!, v: hyperdriveJumpChance(ship(v), 'alpha-centauri', 0)! }
  check('Mars\'s next jump there is on the lane: a fifth of the distance risk, the destination\'s mass no longer counted', near(after.m, HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE * hyperdriveJumpRiskFactor(ship(m2), 'alpha-centauri', 0, true)) && after.m < before.m * 0.26, `${(after.m * 100).toFixed(1)}%`)
  check('Venus\'s is exactly what it was: it cannot use Mars\'s lane', after.v === before.v, `${(after.v * 100).toFixed(1)}%`)
  // The roll itself uses the same per-nation lane.
  setJumpRoll(() => (after.m + before.v) / 2)
  check('at a roll between the two chances Mars\'s ship arrives and Venus\'s is lost', planMoveUnchecked(ship(m2), dest, 0).kind === 'instant' && planMoveUnchecked(ship(v), dest, 0).kind === 'lost-in-hyperspace')
  setJumpRoll(null)

  console.log('\n=== 4. Observer mode still sees every nation\'s lanes ===')
  useHyperlaneStore.getState().addHyperlane(VENUS, 'sol', 'sirius')
  useHyperlaneStore.getState().addHyperlane(VENUS, 'alpha-centauri', 'sol')
  const all = useHyperlaneStore.getState().allLanes()
  check('all lanes: each one once, whoever charted it', all.length === 2 && hasLane(all, 'sol', 'alpha-centauri') && hasLane(all, 'sol', 'sirius'))
  check('...drawn as one segment buffer', laneSegments(all, STARS).length === 12)
  check('the player\'s own map still has only its own', useHyperlaneStore.getState().lanesOf(MARS).length === 1)
  check('the same list until the nation charts another lane (a stable selector)', useHyperlaneStore.getState().lanesOf(MARS) === useHyperlaneStore.getState().lanesOf(MARS) && useHyperlaneStore.getState().lanesOf('nobody') === useHyperlaneStore.getState().lanesOf('nobody'))

  resetGame()
  check('a new game starts with no lanes', Object.keys(useHyperlaneStore.getState().lanes).length === 0)
}

console.log('\n=== 5. A charted lane is as safe one way as the other (the mass factor is for blind jumps only) ===')
{
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  const atSol = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  const atBarnard = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setShipLocation(atBarnard, { kind: 'orbiting', systemId: 'barnards-star', bodyName: "Barnard's Star", periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
  const out = () => hyperdriveJumpChance(ship(atSol), 'barnards-star', 0)!
  const back = () => hyperdriveJumpChance(ship(atBarnard), 'sol', 0)!
  const blind = { out: out(), back: back() }
  check('uncharted, the jump toward the heavier star (Sol) is the riskier one', blind.back > blind.out, `${(blind.out * 100).toFixed(1)}% out, ${(blind.back * 100).toFixed(1)}% back`)
  useHyperlaneStore.getState().addHyperlane(MARS, 'sol', 'barnards-star')
  const ly = Math.hypot(...STARS.find((s) => s.id === 'barnards-star')!.position)
  const lane = hyperdriveMkLoss(1, ly) * (HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE / HYPERDRIVE_BASE_LOSS_CHANCE)
  check('charted, both directions carry the same risk', near(out(), back()), `${(out() * 100).toFixed(1)}% out, ${(back() * 100).toFixed(1)}% back`)
  check('...a fifth of the distance risk alone, no mass factor', near(out(), lane, 1e-9) && near(back(), lane, 1e-9), `${(lane * 100).toFixed(1)}%`)
  check('...which is under the 5% warning line both ways', out() <= JUMP_WARN_LOSS && back() <= JUMP_WARN_LOSS)
  check('the route planner sees the same number', near(starJumpChance(ship(atSol), 'barnards-star', 'sol')!, lane, 1e-9) && near(starJumpChance(ship(atSol), 'sol', 'barnards-star')!, lane, 1e-9))
  // The roll itself: between the old 5.8% and the new 4.6%, the jump home now arrives.
  setJumpRoll(() => 0.05)
  check('the jump home is rolled against the lane\'s risk', planMoveUnchecked(ship(atBarnard), { kind: 'star', starId: 'sol' }, 0).kind === 'instant')
  setJumpRoll(null)
  useHyperlaneStore.setState({ lanes: {} })
  check('with the lane gone the mass factor is back', near(back(), blind.back) && near(out(), blind.out))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
