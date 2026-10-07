// Hyperdrive jump risk by distance and destination mass (src/scene/jumpRisk.ts,
// shipPhysics.hyperdriveLossChance / hyperdriveJumpRiskFactor).
//
// Run:  npx tsx tests/jumpRisk.test.ts

import {
  HYPERDRIVE_BASE_LOSS_CHANCE,
  HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE,
  JUMP_RISK_CLUSTER_REF_KLY,
  JUMP_RISK_MAX_FACTOR,
  JUMP_RISK_MIN_FACTOR,
  type HyperDrive,
} from '../src/data/shipData'
import { STARS } from '../src/data/starData'
import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import { SOLAR_NEIGHBORHOOD_ID } from '../src/data/galaxyGen'
import { clusterJumpRiskFactor, clusterMassKg, hyperdriveMkRiskFactor, jumpRiskFactor, starJumpRiskFactor } from '../src/scene/jumpRisk'
import { hyperdriveJumpChance, hyperdriveJumpRiskFactor, hyperdriveLossChance } from '../src/scene/shipPhysics'
import { useShipStore } from '../src/state/shipStore'
import { grantWarp, warpHullId } from './testWarp'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { usePlayerStore } from '../src/state/playerStore'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { SHIP_CLASSES } from '../src/data/shipData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const star = (id: string) => STARS.find((s) => s.id === id)!
const drive: HyperDrive = { kind: 'hyperdrive', cooldownDays: 27 }

console.log('\n=== 1. The rule ===')
{
  check('an average jump is 1', near(jumpRiskFactor(10, 5, 10, 5), 1))
  check('further is riskier', jumpRiskFactor(15, 5, 10, 5) > jumpRiskFactor(10, 5, 10, 5) && jumpRiskFactor(6, 5, 10, 5) < 1)
  check('a heavier destination is riskier', jumpRiskFactor(10, 10, 10, 5) > 1 && jumpRiskFactor(10, 2, 10, 5) < 1)
  check('distance counts for more than mass', jumpRiskFactor(20, 5, 10, 5) > jumpRiskFactor(10, 10, 10, 5))
  check('never below the floor', jumpRiskFactor(0.001, 0.001, 10, 5) === JUMP_RISK_MIN_FACTOR && jumpRiskFactor(0, 5, 10, 5) === JUMP_RISK_MIN_FACTOR)
  check('never above the ceiling', jumpRiskFactor(1e6, 1e6, 10, 5) === JUMP_RISK_MAX_FACTOR)
}

console.log('\n=== 2. Jumps between our stars ===')
{
  const factors: number[] = []
  for (const a of STARS) for (const b of STARS) if (a.id !== b.id) factors.push(starJumpRiskFactor(dist(a.position, b.position), b))
  const mean = factors.reduce((s, f) => s + f, 0) / factors.length
  check('the average jump keeps the base rates', mean > 0.9 && mean < 1.1, `mean factor ${mean.toFixed(3)}`)
  check('they differ from jump to jump', Math.max(...factors) - Math.min(...factors) > 0.3, `${Math.min(...factors).toFixed(2)} to ${Math.max(...factors).toFixed(2)}`)
  const fromSol = (id: string) => starJumpRiskFactor(star(id).distanceLy, star(id))
  check('Sol to Sirius (far, heavy) is riskier than Sol to Barnard\'s Star (near, light)', fromSol('sirius') > fromSol('barnards-star'), `${fromSol('sirius').toFixed(2)} vs ${fromSol('barnards-star').toFixed(2)}`)
  check('same distance, heavier star: riskier', starJumpRiskFactor(8, star('sirius')) > starJumpRiskFactor(8, star('wolf-359')))
}

console.log('\n=== 3. The chance a jump is lost ===')
{
  check('with no factor given, the old rates', hyperdriveLossChance(drive, false) === HYPERDRIVE_BASE_LOSS_CHANCE && hyperdriveLossChance(drive, true) === HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE)
  check('the factor scales the uncharted rate', near(hyperdriveLossChance(drive, false, 1, false, 1.4), HYPERDRIVE_BASE_LOSS_CHANCE * 1.4))
  check('...and the charted one', near(hyperdriveLossChance(drive, true, 1, false, 0.5), HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE * 0.5))
  check('damage still adds on top', hyperdriveLossChance(drive, false, 0, false, 1.2) > hyperdriveLossChance(drive, false, 1, false, 1.2))
  check('never past certain', hyperdriveLossChance(drive, false, 0, true, JUMP_RISK_MAX_FACTOR) <= 1)
  check('a drive that cannot be lost still cannot', hyperdriveLossChance({ ...drive, lossChanceOverride: 0 }, false, 0, true, JUMP_RISK_MAX_FACTOR) === 0)
}

console.log('\n=== 4. A real ship ===')
{
  usePlayerStore.setState({ selectedCountryId: 'imperial-state-of-mars' })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  // A hull that jumps (hyperdrive, no warp), with an ordinary drive.
  const jumper = SHIP_CLASSES.find((c) => c.ftlDrives.some((d) => d.kind === 'hyperdrive' && d.lossChanceOverride === undefined) && !c.ftlDrives.some((d) => d.kind === 'warp'))
  // No preset hull warps: a designer-built warp hull, flown by a nation with Warp Drive Mk I.
  const warper = { id: warpHullId() }
  check('there is a hyperdrive-only hull to test with', !!jumper, jumper?.id ?? 'none')
  if (jumper) {
    const id = spawnOwnedShip(jumper.id, 'imperial-state-of-mars', 'sol', 'Mars')!
    const ship = useShipStore.getState().ships.find((s) => s.id === id)!
    const toSirius = hyperdriveJumpRiskFactor(ship, 'sirius', 0)
    const toBarnard = hyperdriveJumpRiskFactor(ship, 'barnards-star', 0)
    // Mars flies Hyperdrive Mk I: the Mk's loss at that distance, times the destination's mass.
    check('from Sol, its factor is the Mk I Sol-to-star one', near(toSirius, hyperdriveMkRiskFactor(1, dist(star('sirius').position, [0, 0, 0]), star('sirius')), 1e-6) && near(toBarnard, hyperdriveMkRiskFactor(1, dist(star('barnards-star').position, [0, 0, 0]), star('barnards-star')), 1e-6))
    const chance = hyperdriveJumpChance(ship, 'sirius', 0)!
    check('the chance shown is base x factor', near(chance, Math.min(1, HYPERDRIVE_BASE_LOSS_CHANCE * toSirius), 1e-6), `${Math.round(chance * 100)}% to Sirius, ${Math.round(hyperdriveJumpChance(ship, 'barnards-star', 0)! * 100)}% to Barnard's Star`)
    useHyperlaneStore.getState().addHyperlane(ship.ownerId, 'sol', 'sirius')
    check('a charted lane cuts it to a fifth of the distance risk, the mass factor dropped', near(hyperdriveJumpChance(ship, 'sirius', 0)!, HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE * hyperdriveJumpRiskFactor(ship, 'sirius', 0, true), 1e-6) && hyperdriveJumpRiskFactor(ship, 'sirius', 0, true) !== toSirius)
    check('an unknown star: average', hyperdriveJumpRiskFactor(ship, 'nowhere', 0) === 1)
  }
  if (warper) {
    const id = spawnOwnedShip(warper.id, 'imperial-state-of-mars', 'sol', 'Mars')!
    const ship = useShipStore.getState().ships.find((s) => s.id === id)!
    check('a warp hull whose owner has no Warp Drive Mk has no drive to jump with either', hyperdriveJumpChance(ship, 'sirius', 0) === null)
    grantWarp('imperial-state-of-mars')
    check('a ship that warps has no jump risk to show', hyperdriveJumpChance(ship, 'sirius', 0) === null && !!resolveShipClass(ship.classId))
  }
}

console.log('\n=== 5. The same rule for neighbourhoods ===')
{
  const others = NEIGHBORHOODS.filter((n) => n.id !== SOLAR_NEIGHBORHOOD_ID)
  check('a neighbourhood weighs what its stars do', near(clusterMassKg(SOLAR_NEIGHBORHOOD_ID), STARS.reduce((s, x) => s + x.massKg, 0), 1) && others.every((n) => clusterMassKg(n.id) > 0))
  const sol = NEIGHBORHOODS.find((n) => n.id === SOLAR_NEIGHBORHOOD_ID)!
  const byDistance = [...others].sort((a, b) => dist(a.position, sol.position) - dist(b.position, sol.position))
  const nearest = byDistance[0]
  const farthest = byDistance[byDistance.length - 1]
  check('the far side of the galaxy is riskier than next door', clusterJumpRiskFactor(sol.id, farthest.id) > clusterJumpRiskFactor(sol.id, nearest.id), `${clusterJumpRiskFactor(sol.id, farthest.id).toFixed(2)} vs ${clusterJumpRiskFactor(sol.id, nearest.id).toFixed(2)}`)
  check('within the same limits', others.every((n) => clusterJumpRiskFactor(sol.id, n.id) >= JUMP_RISK_MIN_FACTOR && clusterJumpRiskFactor(sol.id, n.id) <= JUMP_RISK_MAX_FACTOR))
  // Two neighbourhoods about as far away: the heavier is riskier.
  const pair = byDistance.filter((n) => { const d = dist(n.position, sol.position); return d > JUMP_RISK_CLUSTER_REF_KLY * 0.5 && d < JUMP_RISK_CLUSTER_REF_KLY * 1.5 })
  const light = pair.reduce((a, b) => (clusterMassKg(a.id) < clusterMassKg(b.id) ? a : b))
  const heavy = pair.reduce((a, b) => (clusterMassKg(a.id) > clusterMassKg(b.id) ? a : b))
  const flat = (n: typeof light) => jumpRiskFactor(JUMP_RISK_CLUSTER_REF_KLY, clusterMassKg(n.id), JUMP_RISK_CLUSTER_REF_KLY, clusterMassKg(light.id))
  check('at the same distance the heavier neighbourhood is riskier', flat(heavy) > flat(light))
  check('an unknown neighbourhood: average', clusterJumpRiskFactor(sol.id, 'nowhere') === 1)
}

console.log(failures === 0 ? '\nAll jump risk checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
