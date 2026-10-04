// Warp Drive Mk I-VII, Hyperdrive Mk I-V, exotic matter, hyperium and the Ship
// Designer's drive slot (src/data/warpData.ts, exoticMatter.ts, hyperium.ts,
// scene/shipPhysics.planMove, state/techStore.ts).
//
// Lore: the Sol neighbourhood's humans fly hyperdrives and have almost no exotic
// matter; warp needs exotic matter, and there is no exotic matter production.
//
// Run:  npx tsx tests/warp.test.ts

import { COUNTRIES } from '../src/data/countryData'
import { EXOTIC_AT_CORE, VENUS_ID, exoticMatterAtDistance, startingExoticMatter } from '../src/data/exoticMatter'
import { HYPERIUM_ANOMALY_AMOUNT, HYPERIUM_ANOMALY_CLUSTER_COUNT, HYPERIUM_NEAR_SOL, HYPERIUM_NEAR_SOL_KLY, distanceFromSolKly, hyperiumAnomalyClusters, hyperiumInCluster } from '../src/data/hyperium'
import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import { GALAXY_SEED, SOLAR_NEIGHBORHOOD_ID } from '../src/data/galaxyGen'
import { galaxyEmpires, generateEmpires } from '../src/data/generatedEmpires'
import { HULL_CHASSES, designToShipClass, drivesOf, emptyLoadout } from '../src/data/hullChassis'
import { HYPERDRIVE_BASE_LOSS_CHANCE, HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE, SHIP_CLASSES } from '../src/data/shipData'
import { DRIVE_MODULES, modulesForSlot } from '../src/data/shipModules'
import { EXOTIC_MATTER_PER_WARP_DRIVE, HYPERIUM_PER_HYPERDRIVE, RESOURCE_INCOME_PER_MONTH, shipBuildCost } from '../src/data/shipyardData'
import { STARTING_NAVY } from '../src/data/startingForces'
import { STARS, UNITS_PER_LY, starScenePosition } from '../src/data/starData'
import { ALL_TECHS, findTech, prerequisitesMet, resourceShortfall } from '../src/data/techData'
import { HUMAN_BASELINE_TIER, TECH_TIERS, techsForTier } from '../src/data/techTiers'
import {
  DUAL_DRIVE_TECH_ID,
  HYPERDRIVE_MK_HYPERIUM_COST,
  HYPERDRIVE_MK_RP_COST,
  HYPERDRIVE_TECH_IDS,
  WARP_DRIVE_TECH_IDS,
  WARP_MK1_RADIUS_KLY,
  WARP_MK_EXOTIC_COST,
  WARP_MK_RP_COST,
  WARP_SPEED_TIERS_C,
  hyperdriveMkLoss,
  hyperdriveMkOf,
  usableDrives,
  warpMkOf,
  warpSpeedCOfMk,
} from '../src/data/warpData'
import { settleShips } from '../src/hooks/useShipOrderSettler'
import { applyFleetMove, applyMoveResult } from '../src/scene/commsVisual'
import { planFtlCharge } from '../src/scene/combatResolution'
import { getPlanetsForStar } from '../src/scene/planetData'
import { hyperdriveJumpChance, isJumpDestination, jumpDistanceLy, planMoveUnchecked, setJumpRoll, wouldHyperjump } from '../src/scene/shipPhysics'
import { seedStrategicResources, spawnOwnedShip } from '../src/scene/shipyardLogic'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { useShipStore, type MoveDestination, type ShipInstance } from '../src/state/shipStore'
import { useShipyardStore } from '../src/state/shipyardStore'
import { DEFAULT_RESEARCHED, useTechStore } from '../src/state/techStore'
import { driveHullId, grantWarp } from './testWarp'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const increasing = (xs: readonly number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1])

const MARS = 'imperial-state-of-mars'
const NATIONS = COUNTRIES.map((c) => c.id)
const AC = 'alpha-centauri'
const acBody = getPlanetsForStar(AC)[0].name
const toAC: MoveDestination = { kind: 'star', starId: AC }
const toAcBody: MoveDestination = { kind: 'body', systemId: AC, bodyName: acBody }

const ship = (id: string): ShipInstance => useShipStore.getState().ships.find((s) => s.id === id)!
const amounts = (id: string) => useResourceStore.getState().stateFor(id).amounts

function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  useTechStore.setState({ byCountry: {}, freeResearchMode: false })
  useResourceStore.setState({ byCountry: {} })
  useShipyardStore.setState(useShipyardStore.getInitialState())
  useDiplomacyStore.getState().reset()
  // Jumps always arrive unless a section sets its own roll.
  setJumpRoll(() => 1)
}
const spawn = (classId: string, body = 'Mars') => spawnOwnedShip(classId, MARS, 'sol', body)!

console.log('\n=== 1. The tables ===')
{
  check('seven warp Mks, five hyperdrive Mks', WARP_DRIVE_TECH_IDS.length === 7 && WARP_SPEED_TIERS_C.length === 7 && HYPERDRIVE_TECH_IDS.length === 5)
  check('every Mk is a real Engineering tech, chained to the Mk before it', [WARP_DRIVE_TECH_IDS, HYPERDRIVE_TECH_IDS].every((ids) => ids.every((id, i) => { const t = findTech(id); return !!t && t.category === 'engineering' && (i === 0 || t.prerequisites.some((set) => set.includes(ids[i - 1]))) })))
  check('Warp Drive Mk I builds on Warp Theory, Hyperdrive Mk I on Hyperspace Theory', findTech('warp-drive-mk1')!.prerequisites.some((s) => s.includes('warp-theory')) && findTech('hyperdrive-mk1')!.prerequisites.some((s) => s.includes('hyperspace-theory')))
  check('the old Warp Drives tech is gone', findTech('warp-drives') === undefined)
  check('warp speed, research cost and exotic cost all rise with every Mk', increasing(WARP_SPEED_TIERS_C) && increasing(WARP_MK_RP_COST) && increasing(WARP_MK_EXOTIC_COST))
  check('the techs carry exactly those costs', WARP_DRIVE_TECH_IDS.every((id, i) => findTech(id)!.cost === WARP_MK_RP_COST[i] && findTech(id)!.resourceCost?.exoticMatter === WARP_MK_EXOTIC_COST[i]))
  check('hyperdrive research cost rises with every Mk', increasing(HYPERDRIVE_MK_RP_COST))
  check('Hyperdrive Mk I is free of hyperium, Mk II-V consume more each', HYPERDRIVE_MK_HYPERIUM_COST[0] === 0 && findTech('hyperdrive-mk1')!.resourceCost === undefined && increasing(HYPERDRIVE_MK_HYPERIUM_COST) && HYPERDRIVE_TECH_IDS.slice(1).every((id, i) => findTech(id)!.resourceCost?.hyperium === HYPERDRIVE_MK_HYPERIUM_COST[i + 1]))
  check('a Mk is the highest CONSECUTIVE one researched', warpMkOf(new Set()) === 0 && warpMkOf(new Set(['warp-drive-mk1', 'warp-drive-mk2'])) === 2 && warpMkOf(new Set(['warp-drive-mk1', 'warp-drive-mk3'])) === 1 && hyperdriveMkOf(new Set(['hyperdrive-mk2'])) === 0)
  check('warp speed by Mk: none at Mk 0, the table after', warpSpeedCOfMk(0) === 0 && WARP_SPEED_TIERS_C.every((c, i) => warpSpeedCOfMk(i + 1) === c))
}

console.log('\n=== 2. Hyperdrive Mk: the risk curve (the full set is tests/intercluster.test.ts) ===')
{
  check('a higher Mk is strictly safer at the same distance', [5, 10, 20].every((d) => [1, 2, 3, 4].every((mk) => hyperdriveMkLoss(mk + 1, d) < hyperdriveMkLoss(mk, d))), [1, 2, 3, 4, 5].map((mk) => `Mk${mk} ${(hyperdriveMkLoss(mk, 10) * 100).toFixed(1)}%`).join(', ') + ' at 10 ly')
  check('no hyperdrive Mk at all: certain loss', hyperdriveMkLoss(0, 1) === 1)
  const maxPair = Math.max(...STARS.flatMap((a) => STARS.map((b) => Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]))))
  check('Mk II makes the typical hop in the Sol neighbourhood under 2%, and even the furthest pair under 6%', hyperdriveMkLoss(2, 9.67) < 0.02 && hyperdriveMkLoss(2, maxPair) < 0.06, `typical ${(hyperdriveMkLoss(2, 9.67) * 100).toFixed(1)}%, furthest pair (${maxPair.toFixed(1)} ly) ${(hyperdriveMkLoss(2, maxPair) * 100).toFixed(1)}%`)
}

console.log('\n=== 3. Start states: hyperdrive humans, no warp ===')
{
  fresh()
  check('a fresh nation knows Warp Theory, Hyperspace Theory, Hyperdrive Mk I and Hyper Comms (no Warp Comms: it has no warp drive)', ['warp-theory', 'hyperspace-theory', 'hyperdrive-mk1', 'hyper-comms'].every((t) => DEFAULT_RESEARCHED.includes(t)) && !DEFAULT_RESEARCHED.includes('warp-comms'))
  check('...and no warp drive tech at all', !DEFAULT_RESEARCHED.some((t) => (WARP_DRIVE_TECH_IDS as readonly string[]).includes(t)) && warpMkOf(useTechStore.getState().stateFor(MARS).researched) === 0)
  check('...at Hyperdrive Mk I', hyperdriveMkOf(useTechStore.getState().stateFor(MARS).researched) === 1)
  check('its Hyperdrive Mk I stands on theories it also starts with', ['hyperdrive-mk1'].every((id) => prerequisitesMet(findTech(id)!, new Set(DEFAULT_RESEARCHED))))
  check('every preset hull is hyperdrive-only', SHIP_CLASSES.every((c) => c.ftlDrives.length === 1 && c.ftlDrives[0].kind === 'hyperdrive'))
  check('...so the starting navy flies hyperdrives', STARTING_NAVY.length > 0 && STARTING_NAVY.every((id) => resolveShipClass(id)!.ftlDrives.every((d) => d.kind === 'hyperdrive')))
  check('every chassis defaults to a hyperdrive and has one drive slot', HULL_CHASSES.every((c) => c.slots.drive.length === 1 && c.ftlDrives.every((d) => d.kind === 'hyperdrive')))

  for (const id of NATIONS) seedStrategicResources(id)
  const exotic = Object.fromEntries(NATIONS.map((id) => [id, amounts(id).exoticMatter ?? 0]))
  check('every nation starts with its distance-from-the-core exotic matter', NATIONS.every((id) => exotic[id] === startingExoticMatter(id)), JSON.stringify(exotic))
  check('Venus is slightly above Mars, Orion and Lalande', NATIONS.filter((id) => id !== VENUS_ID).every((id) => exotic[VENUS_ID] > exotic[id]))
  check('all four are below Warp Drive Mk I\'s exotic cost', NATIONS.every((id) => exotic[id] < WARP_MK_EXOTIC_COST[0]), `Mk I needs ${WARP_MK_EXOTIC_COST[0]}`)
  check('...and below the 5 a single warp hull costs, or just at it', NATIONS.every((id) => exotic[id] <= EXOTIC_MATTER_PER_WARP_DRIVE))
  check('there is no exotic matter income', (RESOURCE_INCOME_PER_MONTH.exoticMatter ?? 0) === 0 && NATIONS.every((id) => useResourceStore.getState().stateFor(id).monthlyDelta.exoticMatter === 0))
  check('every nation starts with the near-Sol hyperium, enough for several hulls', NATIONS.every((id) => amounts(id).hyperium === HYPERIUM_NEAR_SOL) && HYPERIUM_NEAR_SOL >= 5 * HYPERIUM_PER_HYPERDRIVE)

  check('exotic matter falls with distance from the core', exoticMatterAtDistance(0) === EXOTIC_AT_CORE && increasing([40, 27, 18, 10, 0].map(exoticMatterAtDistance)))
  const sol = NEIGHBORHOODS.find((n) => n.id === SOLAR_NEIGHBORHOOD_ID)!
  const solKly = Math.hypot(sol.position[0], sol.position[1])
  const nearer = galaxyEmpires().filter((e) => e.coreDistanceKly < solKly - 1)
  check('all four nations are below every empire clearly nearer the core', nearer.length > 0 && nearer.every((e) => NATIONS.every((id) => e.exoticMatter > exotic[id])), `${nearer.length} empires, least ${Math.min(...nearer.map((e) => e.exoticMatter))}`)
}

console.log('\n=== 4. Exotic matter gates Warp Drive Mk I ===')
{
  fresh()
  for (const id of NATIONS) seedStrategicResources(id)
  const tech = useTechStore.getState
  // Warp Drive Mk I alone is ~1,080 points now: plenty, so the exotic matter is what gates it.
  for (const id of NATIONS) tech().grantResearch(id, 'engineering', 50_000)
  const blocks = NATIONS.map((id) => tech().researchBlock(id, 'warp-drive-mk1'))
  check('Mk I is blocked for every Sol nation, with the reason', blocks.every((b) => !!b && /15/.test(b) && /exotic/i.test(b)), blocks[0] ?? '')
  check('...so researching it fails, points or not', NATIONS.every((id) => !tech().researchNode(id, 'warp-drive-mk1')) && NATIONS.every((id) => warpMkOf(tech().stateFor(id).researched) === 0))
  check('...and nothing is spent', NATIONS.every((id) => tech().stateFor(id).researchPoints.engineering === 50_000 && amounts(id).exoticMatter === startingExoticMatter(id)))

  useResourceStore.getState().setAmount(MARS, 'exoticMatter', 40)
  check('with enough exotic matter it is no longer blocked', tech().researchBlock(MARS, 'warp-drive-mk1') === null)
  check('...and researches', tech().researchNode(MARS, 'warp-drive-mk1') && warpMkOf(tech().stateFor(MARS).researched) === 1)
  check('...consuming exactly its exotic cost and research points', amounts(MARS).exoticMatter === 40 - WARP_MK_EXOTIC_COST[0] && tech().stateFor(MARS).researchPoints.engineering === 50_000 - WARP_MK_RP_COST[0])
  check('Mk II (25) is exactly affordable, Mk III (40) is not', tech().researchNode(MARS, 'warp-drive-mk2') && amounts(MARS).exoticMatter === 0 && !!tech().researchBlock(MARS, 'warp-drive-mk3') && !tech().researchNode(MARS, 'warp-drive-mk3'))

  // A resource-blocked tech does not stall the queue behind it.
  const VENUS = VENUS_ID
  tech().queueTech(VENUS, 'warp-drive-mk1')
  tech().queueTech(VENUS, 'hyperdrive-mk2')
  const v = tech().stateFor(VENUS)
  check('a queued tech blocked on a resource does not stall the one behind it', v.researched.has('hyperdrive-mk2') && !v.researched.has('warp-drive-mk1'), `queue: ${(v.queue ?? []).join(', ')}`)
  check('...and stays queued', (v.queue ?? []).includes('warp-drive-mk1'))
  check('...which consumed its hyperium', amounts(VENUS).hyperium === HYPERIUM_NEAR_SOL - HYPERDRIVE_MK_HYPERIUM_COST[1])
  useResourceStore.getState().setAmount(VENUS, 'exoticMatter', WARP_MK_EXOTIC_COST[0])
  tech().processQueue(VENUS)
  check('once the exotic matter is there, the queue researches it', tech().stateFor(VENUS).researched.has('warp-drive-mk1') && amounts(VENUS).exoticMatter === 0)

  // Free Research (the dev cheat) waives the resource cost too.
  const ORION = 'orion-republic'
  const before = amounts(ORION).exoticMatter
  tech().setFreeResearchMode(true)
  check('Free Research waives the exotic matter', tech().researchBlock(ORION, 'warp-drive-mk1') === null && tech().researchNode(ORION, 'warp-drive-mk1') && amounts(ORION).exoticMatter === before)
  tech().setFreeResearchMode(false)
}

console.log('\n=== 5. Hyperium gates Hyperdrive Mk II-V ===')
{
  fresh()
  seedStrategicResources(MARS)
  const tech = useTechStore.getState
  tech().grantResearch(MARS, 'engineering', 10_000)
  const start = { hyperium: HYPERIUM_NEAR_SOL }
  check('from the starting stock: Mk II and III are each affordable, Mk IV and V are not', resourceShortfall(findTech('hyperdrive-mk2')!, start) === null && resourceShortfall(findTech('hyperdrive-mk3')!, start) === null && !!resourceShortfall(findTech('hyperdrive-mk4')!, start) && !!resourceShortfall(findTech('hyperdrive-mk5')!, start))
  check('a nation researches Mk II', tech().researchNode(MARS, 'hyperdrive-mk2') && hyperdriveMkOf(tech().stateFor(MARS).researched) === 2 && amounts(MARS).hyperium === HYPERIUM_NEAR_SOL - 3)
  const block = tech().researchBlock(MARS, 'hyperdrive-mk3')
  check('...and then cannot afford Mk III, with the reason', !!block && /hyperium/i.test(block) && !tech().researchNode(MARS, 'hyperdrive-mk3'), block ?? '')
  check('with no hyperium at all, even Mk II is blocked', !!resourceShortfall(findTech('hyperdrive-mk2')!, { hyperium: 0 }))
}

console.log('\n=== 6. A warp drive works at its owner\'s Mk ===')
{
  fresh()
  const warpHull = driveHullId('corvette-hull', 'drive-warp')
  const id = spawn(warpHull)
  const none = planMoveUnchecked(ship(id), toAC, 0)
  check('no Warp Drive Mk: a warp hull crawls on its reaction drive', none.kind === 'order' && none.order.usedWarp === false)
  check('...and has no usable drive', !usableDrives(resolveShipClass(warpHull)!.ftlDrives, useTechStore.getState().stateFor(MARS).researched).warp)
  const days: number[] = []
  for (let mk = 1; mk <= 7; mk++) {
    grantWarp(MARS, mk)
    const r = planMoveUnchecked(ship(id), toAC, 0)
    days.push(r.kind === 'order' && r.order.usedWarp ? r.order.arrivalSimDays : NaN)
  }
  check('with Mk I the SAME ship warps, no refit', Number.isFinite(days[0]) && none.kind === 'order' && days[0] < none.order.arrivalSimDays)
  check('every Mk after is faster for the whole fleet at once', days.every(Number.isFinite) && increasing([...days].reverse()), days.map((d) => d.toFixed(1)).join(' > ') + ' days')
  // The long leg is flown at the Mk's speed: Mk I against Mk II, less the same climb out of the gravity well.
  const ly = jumpDistanceLy(ship(id), AC, 0)!
  const cruise = (mk: number) => (ly * 365.25) / WARP_SPEED_TIERS_C[mk - 1]
  check('the time saved between two Mks is the difference of their cruise times', near(days[0] - days[1], cruise(1) - cruise(2), 0.5), `${(days[0] - days[1]).toFixed(1)}d vs ${(cruise(1) - cruise(2)).toFixed(1)}d`)
  check('a warp ship takes no jump risk', hyperdriveJumpChance(ship(id), AC, 0) === null && !wouldHyperjump(ship(id), toAC, 0))
}

console.log('\n=== 7. A hyperdrive jumps anywhere outside its own system ===')
{
  fresh()
  const id = spawn('science-ship')
  check('to another star: a jump', isJumpDestination(ship(id), toAC, 0) && wouldHyperjump(ship(id), toAC, 0))
  check('into a world\'s orbit in another system: a jump', isJumpDestination(ship(id), toAcBody, 0))
  check('to a point in another system, or in open space: a jump', isJumpDestination(ship(id), { kind: 'point', systemId: AC, position: [1, 0, 0] }, 0) && isJumpDestination(ship(id), { kind: 'interstellar-point', position: [10, 0, 0] }, 0))
  check('inside its own system (a world, a point, the star itself): not a jump', !isJumpDestination(ship(id), { kind: 'body', systemId: 'sol', bodyName: 'Venus' }, 0) && !isJumpDestination(ship(id), { kind: 'point', systemId: 'sol', position: [1, 0, 0] }, 0) && !isJumpDestination(ship(id), { kind: 'star', starId: 'sol' }, 0))
  const inSystem = planMoveUnchecked(ship(id), { kind: 'body', systemId: 'sol', bodyName: 'Venus' }, 0)
  check('...it flies there on its reaction drive', inSystem.kind === 'order' && inSystem.order.usedWarp === false)

  const chanceBefore = hyperdriveJumpChance(ship(id), AC, 0)!
  const jump = planMoveUnchecked(ship(id), toAcBody, 0)
  check('a jump to a world lands straight in its orbit, at once', jump.kind === 'instant' && jump.location.kind === 'orbiting' && jump.location.bodyName === acBody && jump.location.systemId === AC)
  check('...charting the lane to that system\'s STAR, not to where it landed', jump.kind === 'instant' && jump.hyperlaneEstablished?.join() === `sol,${AC}`)
  check('...and starting the drive\'s cooldown', jump.kind === 'instant' && jump.hyperdriveReadySimDays > 0)
  applyMoveResult(ship(id), toAcBody, jump)
  check('the ship is there and the lane is on the map', ship(id).location.kind === 'orbiting' && useHyperlaneStore.getState().hasHyperlane(MARS, 'sol', AC))

  // The lane is used by every later jump between the two systems, wherever it lands.
  const back = spawn('science-ship')
  const charted = hyperdriveJumpChance(ship(back), AC, 0)!
  check('a charted lane cuts the risk of a jump into that system', near(charted / chanceBefore, HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE / HYPERDRIVE_BASE_LOSS_CHANCE), `${(chanceBefore * 100).toFixed(0)}% uncharted, ${(charted * 100).toFixed(0)}% charted`)
  let lost = 0
  setJumpRoll(() => (charted + chanceBefore) / 2)
  if (planMoveUnchecked(ship(back), toAcBody, 0).kind === 'lost-in-hyperspace') lost++
  check('...a jump to a WORLD there rolls against the charted rate too', lost === 0)
  useHyperlaneStore.setState({ lanes: {} })
  check('...and against the uncharted rate with no lane', planMoveUnchecked(ship(back), toAcBody, 0).kind === 'lost-in-hyperspace')
  setJumpRoll(() => 1)

  const deep = planMoveUnchecked(ship(back), { kind: 'interstellar-point', position: [16, 0, 0] }, 0)
  check('a jump into open space charts no lane', deep.kind === 'instant' && deep.location.kind === 'interstellar-point' && deep.hyperlaneEstablished === undefined)

  // On cooldown, a jump to a world waits and then goes to that world.
  const cooling = spawn('cargo-ship')
  useShipStore.setState((s) => ({ ships: s.ships.map((x) => (x.id === cooling ? { ...x, hyperdriveReadySimDays: 20 } : x)) }))
  const wait = planMoveUnchecked(ship(cooling), toAcBody, 0)
  applyMoveResult(ship(cooling), toAcBody, wait)
  check('a drive still cooling queues the jump, world and all', wait.kind === 'on-cooldown' && ship(cooling).pendingHyperdriveJump === AC && ship(cooling).pendingHyperdriveJumpTo?.kind === 'body')
  useGameTimeStore.setState({ simDays: 10 })
  settleShips(10)
  check('...which does not fire early', ship(cooling).location.kind === 'orbiting' && (ship(cooling).location as { bodyName: string }).bodyName === 'Mars')
  useGameTimeStore.setState({ simDays: 20 })
  settleShips(20)
  check('...and lands in that world\'s orbit when the drive is ready', ship(cooling).pendingHyperdriveJump === null && ship(cooling).pendingHyperdriveJumpTo === undefined && (ship(cooling).location as { bodyName?: string }).bodyName === acBody)

  // A whole fleet.
  useGameTimeStore.setState({ simDays: 100 })
  const a = spawn('destroyer')
  const b = spawn('cruiser')
  applyFleetMove([ship(a), ship(b)], toAcBody, 100, planMoveUnchecked)
  check('a hyperdrive fleet ordered to a world in another system lands there together', [a, b].every((x) => !ship(x).order && (ship(x).location as { bodyName?: string }).bodyName === acBody))

  // "Go and do this" fires though the ship never "arrived".
  const hauler = spawn('cargo-ship', 'Earth')
  useResourceStore.getState().setAmount(MARS, 'alloys', 500)
  useShipStore.getState().setArrivalCommand(hauler, { starId: 'sol', bodyName: 'Mars', command: { kind: 'load', want: { alloys: 50 } } })
  useShipStore.getState().setShipLocation(hauler, { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, undefined, true)
  useShipStore.getState().setArrivalCommand(hauler, { starId: 'sol', bodyName: 'Mars', command: { kind: 'load', want: { alloys: 50 } } })
  settleShips(100)
  check('a command to carry out on arrival fires after an instant jump', !ship(hauler).arrivalCommand && (ship(hauler).cargo?.alloys ?? 0) === 50, JSON.stringify(ship(hauler).cargo))
}

console.log('\n=== 8. No range cap: a far jump is allowed, and almost certainly fatal ===')
{
  fresh()
  const id = spawn('science-ship')
  const sunAt = starScenePosition(STARS.find((s) => s.id === 'sol')!)
  const far: MoveDestination = { kind: 'interstellar-point', position: [sunAt[0] + 60 * UNITS_PER_LY, sunAt[1], sunAt[2]] }
  check('60 ly is far beyond the old 20 ly range: the jump is no longer refused', jumpDistanceLy(ship(id), far, 0) !== null && planMoveUnchecked(ship(id), far, 0).kind === 'instant')
  const chance = hyperdriveJumpChance(ship(id), far, 0)!
  check('...but it is almost certainly fatal at Mk I', chance > 0.99, `${(chance * 100).toFixed(1)}%`)
  setJumpRoll(() => 0.5)
  check('...and a roll under it loses the ship', planMoveUnchecked(ship(id), far, 0).kind === 'lost-in-hyperspace')
  setJumpRoll(() => 1)
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, 'hyperdrive-mk2']) } } })
  check('Mk II is much safer over the same 60 ly', hyperdriveJumpChance(ship(id), far, 0)! < chance - 0.3, `${(hyperdriveJumpChance(ship(id), far, 0)! * 100).toFixed(0)}%`)
  check('a warp ship takes no jump risk at any distance', (() => { grantWarp(MARS); const w = spawn(driveHullId('corvette-hull', 'drive-warp')); return planMoveUnchecked(ship(w), far, 0).kind === 'order' && hyperdriveJumpChance(ship(w), far, 0) === null })())
}

console.log('\n=== 9. The designer\'s drive slot ===')
{
  fresh()
  const ids = (researched: Set<string>) => modulesForSlot('drive', 'small', researched).map((m) => m.id).join()
  const base = new Set(DEFAULT_RESEARCHED)
  check('three drive modules: Hyperdrive, Warp Drive, Dual Drive', DRIVE_MODULES.map((m) => m.id).join() === 'drive-hyper,drive-warp,drive-dual' && DRIVE_MODULES.every((m) => m.powerCost === 0))
  check('a fresh nation can fit only the Hyperdrive', ids(base) === 'drive-hyper')
  check('Warp Drive Mk I unlocks the Warp Drive', ids(new Set([...base, 'warp-drive-mk1'])) === 'drive-hyper,drive-warp')
  check('the Dual Drive needs its own tech', ids(new Set([...base, 'warp-drive-mk1', DUAL_DRIVE_TECH_ID])) === 'drive-hyper,drive-warp,drive-dual')
  const dualTech = findTech(DUAL_DRIVE_TECH_ID)!
  check('Dual-Drive Systems needs Warp Drive Mk I and Hyperspace Theory, and no exotic matter', dualTech.category === 'engineering' && !prerequisitesMet(dualTech, base) && prerequisitesMet(dualTech, new Set([...base, 'warp-drive-mk1'])) && dualTech.resourceCost === undefined)

  const chassis = HULL_CHASSES.find((c) => c.id === 'frigate-hull')!
  const design = (drive: string | null) => ({ id: 'd', name: 'D', chassisId: chassis.id, equipped: { ...emptyLoadout(chassis), drive: [drive] }, powerTier: 1 })
  const kinds = (drive: string | null) => drivesOf(design(drive), chassis).map((d) => d.kind).join()
  check('an empty drive slot keeps the chassis default: a hyperdrive', kinds(null) === 'hyperdrive')
  check('each module gives its drives', kinds('drive-hyper') === 'hyperdrive' && kinds('drive-warp') === 'warp' && kinds('drive-dual') === 'hyperdrive,warp')
  check('the built ship class carries them', designToShipClass(design('drive-dual'), chassis).ftlDrives.length === 2)
  const cost = (drive: string | null) => shipBuildCost(designToShipClass(design(drive), chassis))
  check('a hyperdrive hull costs 1 hyperium, a warp hull 5 exotic matter, a dual hull both', cost('drive-hyper').hyperium === 1 && cost('drive-hyper').exoticMatter === undefined && cost('drive-warp').exoticMatter === EXOTIC_MATTER_PER_WARP_DRIVE && cost('drive-warp').hyperium === undefined && cost('drive-dual').hyperium === 1 && cost('drive-dual').exoticMatter === EXOTIC_MATTER_PER_WARP_DRIVE)

  // The shipyard says why.
  seedStrategicResources(MARS)
  useResourceStore.getState().setAmount(MARS, 'alloys', 1e6)
  useResourceStore.getState().setAmount(MARS, 'energy', 1e6)
  const warpBuild = useShipyardStore.getState().queueBuild(MARS, driveHullId('corvette-hull', 'drive-warp'), 0)
  check('a Sol nation cannot afford even one warp hull, and is told so', !warpBuild.ok && /exotic/i.test(warpBuild.ok ? '' : warpBuild.reason), warpBuild.ok ? '' : warpBuild.reason)
  let built = 0
  while (built < 20 && useShipyardStore.getState().queueBuild(MARS, 'corvette', 0).ok) built++
  const dry = useShipyardStore.getState().queueBuild(MARS, 'corvette', 0)
  check('the starting hyperium builds several hyperdrive hulls, one hyperium each', built >= 5 && built <= HYPERIUM_NEAR_SOL, `${built} hulls`)
  useShipyardStore.setState(useShipyardStore.getInitialState())
  useResourceStore.getState().setAmount(MARS, 'hyperium', 0)
  const noHyperium = useShipyardStore.getState().queueBuild(MARS, 'corvette', 0)
  check('with none left the shipyard refuses and says hyperium', !noHyperium.ok && /hyperium/i.test(noHyperium.ok ? '' : noHyperium.reason), `${noHyperium.ok ? '' : noHyperium.reason}${dry.ok ? '' : ` / ${dry.reason}`}`)
}

console.log('\n=== 10. A dual-drive hull, end to end ===')
{
  fresh()
  const dual = driveHullId('destroyer-hull', 'drive-dual')
  const id = spawn(dual)
  const cls = resolveShipClass(dual)!
  check('it carries both drives', cls.ftlDrives.map((d) => d.kind).sort().join() === 'hyperdrive,warp')
  const asJumper = planMoveUnchecked(ship(id), toAcBody, 0)
  check('until its owner has Warp Drive Mk I it jumps on its hyperdrive', asJumper.kind === 'instant' && wouldHyperjump(ship(id), toAcBody, 0) && hyperdriveJumpChance(ship(id), AC, 0) !== null)
  check('...and charges out of a fight on the hyperdrive', planFtlCharge(ship(id), toAC, 0)?.kind === 'hyperdrive')
  grantWarp(MARS, 1, true)
  const asWarper = planMoveUnchecked(ship(id), toAcBody, 0)
  check('with Mk I the same ship warps instead: no jump, no risk', asWarper.kind === 'order' && asWarper.order.usedWarp === true && !wouldHyperjump(ship(id), toAcBody, 0) && hyperdriveJumpChance(ship(id), AC, 0) === null)
  let anyLost = false
  setJumpRoll(() => 0)
  for (let i = 0; i < 20; i++) if (planMoveUnchecked(ship(id), toAC, 0).kind === 'lost-in-hyperspace') anyLost = true
  setJumpRoll(() => 1)
  check('...so it can never be lost on an ordinary trip', !anyLost)
  check('...and it never refuses a long trip for range', planMoveUnchecked(ship(id), { kind: 'interstellar-point', position: [600, 0, 0] }, 0).kind === 'order')
  // In a mixed fleet the warp hull flies and the jump hulls wait for it.
  const escort = spawn('destroyer')
  applyFleetMove([ship(id), ship(escort)], toAC, 0, planMoveUnchecked)
  check('in a fleet with a hyperdrive hull, it flies and the jump ship waits to land with it', !!ship(id).order && ship(escort).pendingHyperdriveJump === AC && ship(escort).pendingHyperdriveJumpArrivesSimDays === ship(id).order!.arrivalSimDays)
  const usable = usableDrives(cls.ftlDrives, useTechStore.getState().stateFor(MARS).researched)
  check('both drives are usable once both Mks are known', usable.warp && usable.hyperdrive)
}

console.log('\n=== 11. Hyperium geography ===')
{
  const nearSol = NEIGHBORHOODS.filter((n) => distanceFromSolKly(n.id) <= HYPERIUM_NEAR_SOL_KLY)
  const far = NEIGHBORHOODS.filter((n) => distanceFromSolKly(n.id) > HYPERIUM_NEAR_SOL_KLY)
  check('the Sol neighbourhood and the clusters round it hold the modest stock', nearSol.some((n) => n.id === SOLAR_NEIGHBORHOOD_ID) && nearSol.every((n) => hyperiumInCluster(n.id, new Set()) === HYPERIUM_NEAR_SOL), `${nearSol.length} clusters within ${HYPERIUM_NEAR_SOL_KLY} kly`)
  check('everywhere else there is none', far.length > 250 && far.every((n) => hyperiumInCluster(n.id, new Set()) === 0))
  const empires = galaxyEmpires()
  const anomalies = hyperiumAnomalyClusters(empires.map((e) => e.clusterId), GALAXY_SEED)
  check(`exactly ${HYPERIUM_ANOMALY_CLUSTER_COUNT} far clusters hold a tiny deposit`, anomalies.size === HYPERIUM_ANOMALY_CLUSTER_COUNT && [...anomalies].every((id) => distanceFromSolKly(id) > HYPERIUM_NEAR_SOL_KLY && hyperiumInCluster(id, anomalies) === HYPERIUM_ANOMALY_AMOUNT))
  check('...way less than the Sol neighbourhood', HYPERIUM_ANOMALY_AMOUNT < HYPERIUM_NEAR_SOL / 5)
  check('...each one a cluster that hosts an empire', [...anomalies].every((id) => empires.some((e) => e.clusterId === id)))
  check('an empire\'s hyperium is its cluster\'s', empires.every((e) => e.hyperium === hyperiumInCluster(e.clusterId, anomalies)), empires.filter((e) => e.hyperium > 0).map((e) => `${e.id}: ${e.hyperium}`).join(', '))
  check('the pick is the same every time', [...hyperiumAnomalyClusters(empires.map((e) => e.clusterId).reverse(), GALAXY_SEED)].sort().join() === [...anomalies].sort().join())
  // Each cluster ranks itself: removing a cluster that did not win changes nothing.
  const loser = empires.map((e) => e.clusterId).find((id) => !anomalies.has(id) && distanceFromSolKly(id) > HYPERIUM_NEAR_SOL_KLY)!
  check('...and does not depend on the clusters that lost', [...hyperiumAnomalyClusters(empires.map((e) => e.clusterId).filter((id) => id !== loser), GALAXY_SEED)].sort().join() === [...anomalies].sort().join())
}

console.log('\n=== 12. Empires: Warp Drive Mk I near the core ===')
{
  const empires = galaxyEmpires()
  const nearCore = empires.filter((e) => e.coreDistanceKly <= WARP_MK1_RADIUS_KLY)
  check(`an empire has Warp Drive Mk I exactly when it is within ${WARP_MK1_RADIUS_KLY} kly of the core`, nearCore.length > 0 && nearCore.length < empires.length && empires.every((e) => e.researched.has('warp-drive-mk1') === (e.coreDistanceKly <= WARP_MK1_RADIUS_KLY)), `${nearCore.length} of ${empires.length}`)
  check('...each of them at the human baseline tier or above, so its prerequisites are met', nearCore.every((e) => e.techTier >= HUMAN_BASELINE_TIER && prerequisitesMet(findTech('warp-drive-mk1')!, e.researched)))
  check('...and with the exotic matter Mk I takes', nearCore.every((e) => e.exoticMatter >= WARP_MK_EXOTIC_COST[0]), `least ${Math.min(...nearCore.map((e) => e.exoticMatter))}`)
  check('no empire has a higher warp Mk, or a hyperdrive Mk past I', empires.every((e) => warpMkOf(e.researched) <= 1 && hyperdriveMkOf(e.researched) <= 1))
  check('every empire\'s techs are closed under prerequisites', empires.every((e) => ALL_TECHS.filter((t) => e.researched.has(t.id)).every((t) => prerequisitesMet(t, e.researched))))
  check('the tier map is closed under prerequisites', TECH_TIERS.every((_, t) => { const set = techsForTier(t); return ALL_TECHS.filter((x) => set.has(x.id)).every((x) => prerequisitesMet(x, set)) }))
  check('the human baseline tier is what the nations start with, hyperdrive and no warp', DEFAULT_RESEARCHED.every((t) => techsForTier(HUMAN_BASELINE_TIER).has(t) || t === 'hyper-comms' || t === 'quantum-mechanics') && warpMkOf(techsForTier(HUMAN_BASELINE_TIER)) === 0)
  const slot = nearCore[0].slot
  const lore = generateEmpires(GALAXY_SEED, [{ slot, id: 'lore-plain', name: 'The Plain', color: '#123456', researched: ['warp-theory'] }])
  check('a lore empire\'s own techs still win over the near-core rule', lore[slot].researched.size === 1 && !lore[slot].researched.has('warp-drive-mk1'))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
if (failures > 0) process.exit(1)
