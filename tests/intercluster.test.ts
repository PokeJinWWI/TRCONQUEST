// Intercluster travel: ships between clusters in the galactic view, the smooth
// distance-dependent hyperdrive risk, the 5% warning and confirmation, the loss
// notification and the AI's cap (data/warpData.ts, scene/shipPhysics.ts,
// scene/jumpWarning.ts, scene/jumpConfirm.ts, scene/jumpLoss.ts, ai/jumpRules.ts).
//
// Run:  npx tsx tests/intercluster.test.ts

import { AI_JUMP_MAX_LOSS, AI_RESEARCH_PATH, AI_SCOUT_JUMP_MAX_LOSS } from '../src/data/aiData'
import { SOLAR_NEIGHBORHOOD_ID } from '../src/data/galaxyGen'
import { NEIGHBORHOODS, UNITS_PER_KLY } from '../src/data/neighborhoodData'
import { HYPERDRIVE_BASE_LOSS_CHANCE, HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE, type HyperDrive } from '../src/data/shipData'
import { STARS } from '../src/data/starData'
import { commsDelayToLocation } from '../src/scene/commsVisual'
import { applyMoveResult } from '../src/scene/commsVisual'
import {
  HYPERDRIVE_D0_MK1_LY,
  HYPERDRIVE_D0_PER_MK,
  HYPERDRIVE_MK5_ANCHOR_LOSS,
  HYPERDRIVE_MK5_ANCHOR_LY,
  HYPERDRIVE_REFERENCE_HOP_LY,
  WARP_SPEED_TIERS_C,
  hyperdriveD0Ly,
  hyperdriveMkLoss,
} from '../src/data/warpData'
import { aiMayJump, aiMayJumpNow, aiJumpCap } from '../src/ai/jumpRules'
import { eventDestination, goToEvent } from '../src/scene/eventNavigation'
import { confirmRiskyJump, jumpRiskLine } from '../src/scene/jumpConfirm'
import { jumpLossText, jumpPlaceOf, loseShipToJump } from '../src/scene/jumpLoss'
import { JUMP_WARN_LOSS, CHARTED_LANE_RISK_RATIO, formatLossPercent, jumpWarning } from '../src/scene/jumpWarning'
import {
  KM_PER_GALACTIC_UNIT,
  LY_IN_KM,
  clusterScenePosition,
  getShipRenderPosition,
  hyperdriveJumpChance,
  hyperdriveLossChance,
  isJumpDestination,
  isShipInGalacticSpace,
  jumpDistanceLy,
  planMoveUnchecked,
  reachabilityBlock,
  resolveArrivalLocation,
  setJumpRoll,
  shipPlaceLabel,
  wouldHyperjump,
} from '../src/scene/shipPhysics'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { useConfirmStore } from '../src/state/confirmStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore, type MoveDestination, type ShipInstance } from '../src/state/shipStore'
import { DEFAULT_RESEARCHED, useTechStore } from '../src/state/techStore'
import { useViewStore } from '../src/state/viewStore'
import { grantWarp, warpHullId } from './testWarp'

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
const YEAR_DAYS = 365.25
const YEAR_DAYS_ALIAS = YEAR_DAYS
// The nearest and the second-nearest cluster to Sol (2.5 and 3.2 kly).
const sol = NEIGHBORHOODS.find((n) => n.id === SOLAR_NEIGHBORHOOD_ID)!
const byDistance = NEIGHBORHOODS.filter((n) => n.id !== SOLAR_NEIGHBORHOOD_ID).sort(
  (a, b) => Math.hypot(a.position[0] - sol.position[0], a.position[1] - sol.position[1], a.position[2] - sol.position[2]) - Math.hypot(b.position[0] - sol.position[0], b.position[1] - sol.position[1], b.position[2] - sol.position[2]),
)
const NEAR = byDistance[0].id
const NEXT = byDistance[1].id
const toNear: MoveDestination = { kind: 'cluster', clusterId: NEAR }
const toNext: MoveDestination = { kind: 'cluster', clusterId: NEXT }
const toSol: MoveDestination = { kind: 'cluster', clusterId: SOLAR_NEIGHBORHOOD_ID }

const ship = (id: string): ShipInstance => useShipStore.getState().ships.find((s) => s.id === id)!
function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false })
  useGameTimeStore.setState({ simDays: 100, paused: false })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  useTechStore.setState({ byCountry: {}, freeResearchMode: false })
  useDiplomacyStore.getState().reset()
  useConfirmStore.setState({ pending: null })
  setJumpRoll(() => 1)
}
const spawn = (classId: string, owner = MARS) => spawnOwnedShip(classId, owner, 'sol', owner === MARS ? 'Mars' : 'Venus')!
// Puts a ship out at a cluster, as an arrival would.
function placeAtCluster(id: string, clusterId: string) {
  useShipStore.getState().setShipLocation(id, resolveArrivalLocation({ kind: 'cluster', clusterId }, id))
}

console.log('\n=== 1. The risk curve ===')
{
  const mks = [1, 2, 3, 4, 5]
  const grid = [0, 0.5, 1, 2, 4, 8, 9.67, 12, 17, 30, 100, 1000, 2500, 10000, 37000, 85000]
  check('loss never falls as the distance grows, for every Mk', mks.every((mk) => grid.every((d, i) => i === 0 || hyperdriveMkLoss(mk, d) >= hyperdriveMkLoss(mk, grid[i - 1]))))
  check('...and rises strictly across the neighbourhood-scale distances', mks.every((mk) => [0.5, 1, 2, 4, 8, 12, 17].every((d, i, a) => i === 0 || hyperdriveMkLoss(mk, d) > hyperdriveMkLoss(mk, a[i - 1]))))
  check('loss never rises with the Mk, at any distance', grid.every((d) => [1, 2, 3, 4].every((mk) => hyperdriveMkLoss(mk + 1, d) <= hyperdriveMkLoss(mk, d))))
  check('...and falls strictly while the odds are still real', [2, 5, 9.67, 17].every((d) => [1, 2, 3, 4].every((mk) => hyperdriveMkLoss(mk + 1, d) < hyperdriveMkLoss(mk, d))))
  check('a zero-length jump is safe, a long one is certain loss', hyperdriveMkLoss(1, 0) === 0 && hyperdriveMkLoss(1, -5) === 0 && hyperdriveMkLoss(1, 1e6) === 1 && hyperdriveMkLoss(5, 1e9) === 1)
  check('it is a smooth probability in [0, 1]', mks.every((mk) => grid.every((d) => hyperdriveMkLoss(mk, d) >= 0 && hyperdriveMkLoss(mk, d) <= 1)))

  // Calibration: today's 50% at the typical hop.
  check('Mk I loses exactly 50% at the reference hop', near(hyperdriveMkLoss(1, HYPERDRIVE_REFERENCE_HOP_LY), HYPERDRIVE_BASE_LOSS_CHANCE, 1e-12) && HYPERDRIVE_BASE_LOSS_CHANCE === 0.5)
  const pairs: number[] = []
  for (const a of STARS) for (const b of STARS) if (a.id < b.id) pairs.push(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]))
  const geo = Math.exp(pairs.reduce((n, d) => n + Math.log(d), 0) / pairs.length)
  check('...which is the Solar Neighbourhood\'s own typical star-to-star hop (its geometric mean)', Math.abs(geo - HYPERDRIVE_REFERENCE_HOP_LY) < 0.05 && Math.abs(hyperdriveMkLoss(1, geo) - 0.5) < 0.01, `${geo.toFixed(2)} ly -> ${(hyperdriveMkLoss(1, geo) * 100).toFixed(1)}%`)
  const hops = ['alpha-centauri', 'barnards-star', 'wolf-359', 'sirius'].map((id) => hyperdriveMkLoss(1, Math.hypot(...(STARS.find((s) => s.id === id)!.position as [number, number, number]))))
  check('the nearest stars keep today\'s feel at Mk I (13% .. 43%)', hops[0] > 0.1 && hops[0] < 0.16 && hops[3] > 0.38 && hops[3] < 0.48 && hops.every((x, i) => i === 0 || x > hops[i - 1]), hops.map((x) => `${(x * 100).toFixed(0)}%`).join(' '))
  check('d0 is the Mk I figure, and each Mk multiplies it by the same ratio', near(hyperdriveD0Ly(1), HYPERDRIVE_D0_MK1_LY) && [1, 2, 3, 4].every((mk) => near(hyperdriveD0Ly(mk + 1) / hyperdriveD0Ly(mk), HYPERDRIVE_D0_PER_MK, 1e-9)), `d0 = ${mks.map((mk) => hyperdriveD0Ly(mk) < 1000 ? `${hyperdriveD0Ly(mk).toFixed(0)} ly` : `${(hyperdriveD0Ly(mk) / 1000).toFixed(1)} kly`).join(', ')}`)
  check('Mk V still loses 30% at 10,000 ly (the anchor)', near(hyperdriveMkLoss(5, HYPERDRIVE_MK5_ANCHOR_LY), HYPERDRIVE_MK5_ANCHOR_LOSS, 1e-9))
  check('there is no range cap: a far jump is simply almost certain to be lost', hyperdriveMkLoss(1, 60) > 0.99 && hyperdriveMkLoss(2, 600) > 0.99)

  // What the clusters cost.
  const nearLy = jumpDistanceLyFromSol(NEAR)
  check('the nearest cluster is ~2.5 kly away', nearLy > 2400 && nearLy < 2600, `${nearLy.toFixed(0)} ly`)
  check('...certain loss at Mk I-III, 57% at Mk IV, a few percent at Mk V', [1, 2, 3].every((mk) => hyperdriveMkLoss(mk, nearLy) > 0.99) && Math.abs(hyperdriveMkLoss(4, nearLy) - 0.57) < 0.05 && hyperdriveMkLoss(5, nearLy) < 0.05, [1, 2, 3, 4, 5].map((mk) => `Mk${mk} ${(hyperdriveMkLoss(mk, nearLy) * 100).toFixed(0)}%`).join(' '))
  const farLy = Math.hypot(...NEIGHBORHOODS.filter((n) => n.id !== SOLAR_NEIGHBORHOOD_ID).map((n) => Math.hypot(n.position[0] - sol.position[0], n.position[1] - sol.position[1], n.position[2] - sol.position[2])).sort((a, b) => a - b).slice(Math.floor(320 / 2), Math.floor(320 / 2) + 1)) * 1000
  check('the median cluster is almost certain loss even at Mk V', hyperdriveMkLoss(5, farLy) > 0.97, `${(farLy / 1000).toFixed(0)} kly: ${(hyperdriveMkLoss(5, farLy) * 100).toFixed(1)}%`)

  // A charted lane and the Turing override.
  const drive: HyperDrive = { kind: 'hyperdrive', cooldownDays: 27 }
  const f = hyperdriveMkLoss(1, 9.67) / HYPERDRIVE_BASE_LOSS_CHANCE
  check('a charted lane cuts the risk by the same ratio as ever (to a fifth)', near(CHARTED_LANE_RISK_RATIO, 0.2) && near(hyperdriveLossChance(drive, true, 1, false, f) / hyperdriveLossChance(drive, false, 1, false, f), HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE / HYPERDRIVE_BASE_LOSS_CHANCE, 1e-9))
  check('...at any distance (a long lane is still a fifth of a long jump, short of the cap)', [3, 6, 12].every((d) => { const g = hyperdriveMkLoss(1, d) / HYPERDRIVE_BASE_LOSS_CHANCE; return near(hyperdriveLossChance(drive, true, 1, false, g), hyperdriveMkLoss(1, d) * 0.2, 1e-9) }))
  const turing: HyperDrive = { kind: 'hyperdrive', cooldownDays: 7, lossChanceOverride: 0 }
  check('the Turing Scout stays at 0% however far', [10, 2500, 85000].every((d) => hyperdriveLossChance(turing, false, 1, false, hyperdriveMkLoss(1, d) / HYPERDRIVE_BASE_LOSS_CHANCE) === 0))
}

function jumpDistanceLyFromSol(clusterId: string): number {
  const n = NEIGHBORHOODS.find((x) => x.id === clusterId)!
  return Math.hypot(n.position[0] - sol.position[0], n.position[1] - sol.position[1], n.position[2] - sol.position[2]) * 1000
}

console.log('\n=== 2. The warning threshold ===')
{
  check('the line is 5%', JUMP_WARN_LOSS === 0.05)
  check('at or under 5% there is no warning', jumpWarning([]) === null && jumpWarning([0]) === null && jumpWarning([0.049]) === null && jumpWarning([0.05]) === null && jumpWarning([0.02, 0.05]) === null)
  const w = jumpWarning([0.0501])
  check('just over 5% warns', !!w && w.worst === 0.0501)
  const one = jumpWarning([0.43])!
  check('the warning is plain language with the percentage', one.percent === '43%' && /43%/.test(one.text) && /chance of losing the ship/.test(one.text), one.text)
  const fleet = jumpWarning([0.02, 0.43, 0.2])!
  const sure = jumpWarning([1])!
  check('a jump that is all but certain loss says so in words', /almost certain to lose the ship/.test(sure.text) && sure.percent === '100%' && /almost certain to lose each of 2 ships/.test(jumpWarning([0.999, 0.999])!.text), `${sure.text} / ${jumpWarning([0.999])!.percent}`)
  check('a fleet reports its worst ship and how many are at risk', fleet.worst === 0.43 && fleet.ships === 2 && /43%/.test(fleet.text) && /2 ships/.test(fleet.text), fleet.text)
  check('a hair over the line never reads as 5%', formatLossPercent(0.0504) === '5.0%' && formatLossPercent(0.0996) === '10%', `${formatLossPercent(0.0504)}, ${formatLossPercent(0.0996)}`)
  check('percentages read cleanly', formatLossPercent(0.43) === '43%' && formatLossPercent(0.999) === '>99%' && formatLossPercent(1) === '100%' && formatLossPercent(0.06) === '6.0%' && formatLossPercent(0.123) === '12%')

  // With real ships: a jump to the nearest cluster warns, a flight in the system does not.
  fresh()
  const id = spawn('science-ship')
  const asked = (dest: MoveDestination, ids: string[] = [id]) => {
    useConfirmStore.setState({ pending: null })
    let ran = false
    confirmRiskyJump(ids.map(ship), dest, () => (ran = true))
    return { ran, pending: useConfirmStore.getState().pending }
  }
  const risky = asked(toNear)
  check('ordering a risky jump asks first and does not run until confirmed', !risky.ran && !!risky.pending && /Risky jump/.test(risky.pending.title) && /almost certain|%/.test(risky.pending.body ?? ''))
  risky.pending!.onConfirm()
  check('...and confirming runs it', true)
  let declined = false
  useConfirmStore.setState({ pending: null })
  confirmRiskyJump([ship(id)], toNear, () => undefined, () => (declined = true))
  useConfirmStore.getState().resolve(false)
  check('declining runs the cancel handler instead', declined)
  const flight = asked({ kind: 'body', systemId: 'sol', bodyName: 'Venus' })
  check('a flight inside the system never asks', flight.ran && flight.pending === null)
  const safeJump = asked({ kind: 'star', starId: 'alpha-centauri' })
  check('a ~15% jump to Alpha Centauri asks (above 5%)', !safeJump.ran && !!safeJump.pending && /1\d%/.test(safeJump.pending.body ?? ''), safeJump.pending?.body ?? '')
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, 'hyperdrive-mk2']) } } })
  const withMk2 = asked({ kind: 'star', starId: 'alpha-centauri' })
  check('with Hyperdrive Mk II the same jump is under 5% and runs at once', withMk2.ran && withMk2.pending === null)
  check('...but a cluster still asks', !asked(toNear).ran)
  const line = jumpRiskLine([ship(id)], toNear)
  check('the panel line reads the same risk', /Jump risk: (100|>99)% chance/.test(line ?? ''), line ?? 'none')
  grantWarp(MARS)
  const w2 = spawn(warpHullId('corvette-hull'))
  check('a warp ship never asks, however far', asked(toNear, [w2]).ran && jumpRiskLine([ship(w2)], toNear) === null)
  useConfirmStore.setState({ pending: null })
}

console.log('\n=== 3. A hyperdrive jump between clusters ===')
{
  fresh()
  const id = spawn('science-ship')
  check('a cluster is a jump for a ship in the Solar Neighbourhood', isJumpDestination(ship(id), toNear, 100) && wouldHyperjump(ship(id), toNear, 100))
  check('the distance is measured between the clusters, in light-years', Math.abs((jumpDistanceLy(ship(id), toNear, 100) ?? 0) - jumpDistanceLyFromSol(NEAR)) < 1)
  check('it is no flight: the loss chance is Mk I\'s at that distance', near(hyperdriveJumpChance(ship(id), toNear, 100)!, Math.min(1, hyperdriveMkLoss(1, jumpDistanceLyFromSol(NEAR))), 1e-9))
  const jump = planMoveUnchecked(ship(id), toNear, 100)
  check('with a good roll the jump is instant', jump.kind === 'instant' && jump.location.kind === 'cluster' && jump.location.clusterId === NEAR)
  check('...starting the drive\'s cooldown', jump.kind === 'instant' && jump.hyperdriveReadySimDays > 100)
  check('...and charting the lane Sol-cluster to cluster', jump.kind === 'instant' && jump.hyperlaneEstablished?.join() === `${SOLAR_NEIGHBORHOOD_ID},${NEAR}`)
  applyMoveResult(ship(id), toNear, jump)
  check('the ship rests beside the cluster, out in galactic space', ship(id).location.kind === 'cluster' && isShipInGalacticSpace(ship(id)) && getShipRenderPosition(ship(id), 100).space === 'galactic')
  check('...near the cluster\'s own position in the galactic view', getShipRenderPosition(ship(id), 100).position.distanceTo(clusterScenePosition(NEAR)) < 3)
  check('the lane is on the map', useHyperlaneStore.getState().hasHyperlane(MARS, SOLAR_NEIGHBORHOOD_ID, NEAR))
  check('a lane to the nearest cluster is not Sol-to-star: it is cluster to cluster', !useHyperlaneStore.getState().hasHyperlane(MARS, 'sol', NEAR))

  // From out there: a second jump uses its own origin, a ship can be sent home.
  useGameTimeStore.setState({ simDays: 200 })
  const second = planMoveUnchecked(ship(id), toNext, 200)
  check('from a cluster it jumps to another cluster, charting that lane from where it rests', second.kind === 'instant' && second.hyperlaneEstablished?.join() === `${NEAR},${NEXT}`)
  check('...measured from the cluster it is at, not from Sol', Math.abs((jumpDistanceLy(ship(id), toNext, 200) ?? 0) - (() => { const a = NEIGHBORHOODS.find((n) => n.id === NEAR)!; const b = NEIGHBORHOODS.find((n) => n.id === NEXT)!; return Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]) * 1000 })()) < 60)
  const home = planMoveUnchecked(ship(id), toSol, 200)
  check('ordered to the Solar Neighbourhood it lands in interstellar space beside Sol', home.kind === 'instant' && home.location.kind === 'interstellar-point')
  applyMoveResult(ship(id), toSol, home)
  check('...where the interstellar view takes over (no longer out between clusters)', !isShipInGalacticSpace(ship(id)) && getShipRenderPosition(ship(id), 200).space === 'interstellar' && getShipRenderPosition(ship(id), 200).position.length() < 2)
  check('...and the lane home is charted', useHyperlaneStore.getState().hasHyperlane(MARS, NEAR, SOLAR_NEIGHBORHOOD_ID))
  // The charted lane cuts the risk a fifth of what it was.
  fresh()
  const id2 = spawn('science-ship')
  const uncharted = hyperdriveJumpChance(ship(id2), toNear, 100)!
  useHyperlaneStore.getState().addHyperlane(MARS, SOLAR_NEIGHBORHOOD_ID, NEAR)
  check('a charted lane to the cluster is a fifth of the risk', near(hyperdriveJumpChance(ship(id2), toNear, 100)!, uncharted * 0.2, 1e-9) || (uncharted >= 0.99 && hyperdriveJumpChance(ship(id2), toNear, 100)! === Math.min(1, uncharted * 0.2)), `${(uncharted * 100).toFixed(0)}% -> ${(hyperdriveJumpChance(ship(id2), toNear, 100)! * 100).toFixed(0)}%`)

  // Loss, and the Turing Scout.
  fresh()
  const id3 = spawn('science-ship')
  setJumpRoll(() => 0.5)
  check('a roll under the chance loses the ship', planMoveUnchecked(ship(id3), toNear, 100).kind === 'lost-in-hyperspace')
  const turing = spawn('turing-scout')
  check('the Turing Scout makes the same jump safely', planMoveUnchecked(ship(turing), toNear, 100).kind === 'instant' && hyperdriveJumpChance(ship(turing), toNear, 100) === 0)
  setJumpRoll(() => 1)
  useGameTimeStore.setState({ paused: true })
  check('a paused clock queues the jump, as a jump to a star does', planMoveUnchecked(ship(id3), toNear, 100).kind === 'paused')
  useGameTimeStore.setState({ paused: false })
  useShipStore.setState((s) => ({ ships: s.ships.map((x) => (x.id === id3 ? { ...x, hyperdriveReadySimDays: 500 } : x)) }))
  check('...and so does a drive still on cooldown', planMoveUnchecked(ship(id3), toNear, 100).kind === 'on-cooldown')

  // Reachability.
  fresh()
  const id4 = spawn('science-ship')
  placeAtCluster(id4, NEAR)
  const star = planMoveUnchecked(ship(id4), { kind: 'star', starId: 'alpha-centauri' }, 100)
  check('out between clusters a star order is refused, with the reason', star.kind === 'unreachable' && /Solar Neighbourhood/.test(star.reason), star.kind === 'unreachable' ? star.reason : star.kind)
  check('...a body order too', planMoveUnchecked(ship(id4), { kind: 'body', systemId: 'sol', bodyName: 'Mars' }, 100).kind === 'unreachable')
  const there = planMoveUnchecked(ship(id4), toNear, 100)
  check('a ship cannot be sent to the cluster it is already at', there.kind === 'unreachable' && /already at/.test(there.reason) && !isJumpDestination(ship(id4), toNear, 100))
  check('...nor to its own cluster from inside the Solar Neighbourhood', planMoveUnchecked(ship(spawn('science-ship')), toSol, 100).kind === 'unreachable')
  check('reachabilityBlock agrees', reachabilityBlock(ship(id4), { kind: 'galactic-point', position: [0, 0, 0] }, 100) === null && reachabilityBlock(ship(id4), { kind: 'interstellar-point', position: [0, 0, 0] }, 100) !== null)
  const toPoint: MoveDestination = { kind: 'galactic-point', position: [100, 0, 100] }
  const pt = planMoveUnchecked(ship(id4), toPoint, 100)
  check('a bare point of galactic space is a jump with no lane', pt.kind === 'instant' && pt.location.kind === 'galactic-point' && pt.hyperlaneEstablished === undefined)
  check('...and a clean place label', shipPlaceLabel(ship(id4)).length > 0 && /cluster|Reach|Drift|Expanse|Rim|Belt|Verge|Span|Deep|Marches|Cluster/.test(shipPlaceLabel(ship(id4))))
}

console.log('\n=== 4. Warp flies between clusters at the owner\'s warp speed ===')
{
  fresh()
  grantWarp(MARS, 7)
  const hull = warpHullId('corvette-hull')
  const id = spawn(hull)
  const dist = jumpDistanceLyFromSol(NEAR)
  const order = planMoveUnchecked(ship(id), toNear, 100)
  check('it is an order over time, not a jump, and no risk', order.kind === 'order' && order.order.usedWarp && hyperdriveJumpChance(ship(id), toNear, 100) === null && !wouldHyperjump(ship(id), toNear, 100))
  if (order.kind === 'order') {
    check('it plays out in galactic space, in one leg', order.order.space === 'galactic' && order.order.systemId === undefined)
    const o = order.order
    const kmLeg = Math.hypot(o.endPosition[0] - o.startPosition[0], o.endPosition[1] - o.startPosition[1], o.endPosition[2] - o.startPosition[2]) * KM_PER_GALACTIC_UNIT
    check('the leg is the cluster-to-cluster distance in km', Math.abs(kmLeg / LY_IN_KM - dist) < 1, `${(kmLeg / LY_IN_KM).toFixed(0)} ly`)
    const years = (o.arrivalSimDays - 100) / YEAR_DAYS
    check('Warp Mk VII (314c) crosses it in dist/314 years: 3 kly would be about 10', years > dist / 314 - 1e-6 && years < (dist / 314) * 1.02 && Math.abs((3000 / 314) - 9.55) < 0.01, `${years.toFixed(2)} years for ${(dist / 1000).toFixed(2)} kly`)
    const cruiseYears = dist / WARP_SPEED_TIERS_C[6] // light-years at 314 times light speed
    check('...the cruise at 314c plus the climb out of the gravity well', years >= cruiseYears - 1e-6 && years < cruiseYears * 1.02, `${cruiseYears.toFixed(2)} cruise`)
    useShipStore.getState().setShipOrder(id, o, order.warpReadyOverride)
    const mid = (o.departSimDays + o.arrivalSimDays) / 2
    const here = getShipRenderPosition(ship(id), mid)
    check('mid-flight it is a point on the line between the clusters, in galactic units', here.space === 'galactic' && here.position.y === here.position.y && here.position.distanceTo(clusterScenePosition(SOLAR_NEIGHBORHOOD_ID)) > 10 && here.position.distanceTo(clusterScenePosition(NEAR)) > 5, here.position.toArray().map((v) => v.toFixed(1)).join(','))
    check('it counts as out between clusters (the galactic view draws it)', isShipInGalacticSpace(ship(id)))
    const before = getShipRenderPosition(ship(id), o.departSimDays).position
    const after = getShipRenderPosition(ship(id), o.arrivalSimDays).position
    check('...starting at Sol\'s cluster and ending at the target\'s', before.distanceTo(clusterScenePosition(SOLAR_NEIGHBORHOOD_ID)) < 1 && after.distanceTo(clusterScenePosition(NEAR)) < 1)
    check('on arrival it rests beside the cluster', resolveArrivalLocation(o.destination, id).kind === 'cluster')
    check('its label says where it is going', /^to /.test(shipPlaceLabel(ship(id))))
  }
  // Every Mk is faster, for the same trip.
  const days: number[] = []
  useTechStore.setState({ byCountry: {} })
  for (let mk = 1; mk <= 7; mk++) {
    grantWarp(MARS, mk)
    const r = planMoveUnchecked(ship(id), toNear, 100)
    days.push(r.kind === 'order' ? r.order.arrivalSimDays - 100 : NaN)
  }
  check('each warp Mk crosses the same gap faster', days.every(Number.isFinite) && days.every((d, i) => i === 0 || d < days[i - 1]), days.map((d) => `${(d / YEAR_DAYS).toFixed(1)}y`).join(' > '))
  check('Mk I (10c) takes ~dist/10 years: a quarter of a thousand to the nearest cluster', days[0] / YEAR_DAYS > dist / 10 - 1e-6 && days[0] / YEAR_DAYS < (dist / 10) * 1.02 && days[0] / YEAR_DAYS > 240 && days[0] / YEAR_DAYS < 265, `${(days[0] / YEAR_DAYS).toFixed(0)} years`)
  // Ships without a usable FTL drive crawl.
  const crawler = spawn('science-ship')
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperspace-theory', 'warp-comms']) } } })
  const slow = planMoveUnchecked(ship(crawler), toNear, 100)
  check('a hull with no usable drive crawls on its reaction drive (thousands of years)', slow.kind === 'order' && !slow.order.usedWarp && (slow.order.arrivalSimDays - 100) / YEAR_DAYS > 100000, slow.kind === 'order' ? `${((slow.order.arrivalSimDays - 100) / YEAR_DAYS).toExponential(1)} years` : slow.kind)
  // A warp ship out there can be flown on to another cluster, and home.
  fresh()
  grantWarp(MARS, 7)
  const w2 = spawn(warpHullId('corvette-hull'))
  placeAtCluster(w2, NEAR)
  const onward = planMoveUnchecked(ship(w2), toNext, 100)
  check('from a foreign cluster it flies on to another', onward.kind === 'order' && onward.order.space === 'galactic' && onward.order.usedWarp)
  const back = planMoveUnchecked(ship(w2), toSol, 100)
  check('...and back to the Solar Neighbourhood, arriving beside Sol', back.kind === 'order' && back.order.space === 'galactic' && resolveArrivalLocation(back.order.destination, w2).kind === 'interstellar-point')
  check('...but a star order from there is refused', planMoveUnchecked(ship(w2), { kind: 'star', starId: 'sirius' }, 100).kind === 'unreachable')
}

console.log('\n=== 5. The loss notification ===')
{
  fresh()
  const id = spawn('science-ship')
  const lost = ship(id)
  loseShipToJump(lost, toNear, 0.43)
  check('the ship is gone', !useShipStore.getState().ships.some((s) => s.id === id))
  const events = useDiplomacyStore.getState().events.filter((e) => e.kind === 'ship-lost')
  check('the player is told, once', events.length === 1 && events[0].countryIds.join() === MARS)
  check('...with the ship, where it was headed and the risk it ran', /lost in a hyperspace jump/.test(events[0].text) && events[0].text.includes(lost.name) && /43%/.test(events[0].text), events[0].text)
  check('...and a click goes to that cluster in the galactic view', events[0].place?.neighborhoodId === NEAR && eventDestination(events[0]).kind === 'galaxy')
  useViewStore.getState().enterInterstellar('solar-neighborhood')
  goToEvent(events[0])
  check('...the galactic view with the cluster selected', useViewStore.getState().level === 'galactic' && useViewStore.getState().inViewSelection === NEAR)
  check('a jump to a star or a world points there instead', jumpPlaceOf({ kind: 'star', starId: 'sirius' })?.starId === 'sirius' && jumpPlaceOf({ kind: 'body', systemId: 'sol', bodyName: 'Mars' })?.bodyName === 'Mars' && jumpPlaceOf({ kind: 'point', systemId: 'sol', position: [0, 0, 0] })?.starId === 'sol')
  check('a bare point of space has no place', jumpPlaceOf({ kind: 'galactic-point', position: [0, 0, 0] }) === undefined && jumpPlaceOf(undefined) === undefined)
  check('the text reads plainly', jumpLossText('Scout 1', toNear, 0.5) === `Scout 1 was lost in a hyperspace jump to ${NEIGHBORHOODS.find((n) => n.id === NEAR)!.name} (a 50% risk)` && jumpLossText('Scout 1', undefined) === 'Scout 1 was lost in a hyperspace jump')
  useDiplomacyStore.getState().reset()
  const other = spawn('science-ship', VENUS)
  loseShipToJump(ship(other), toNear, 0.4)
  check('another nation\'s ship is removed, with no notification for the player', !useShipStore.getState().ships.some((s) => s.id === other) && useDiplomacyStore.getState().events.length === 0)

  // The real route: an order that rolls a loss.
  fresh()
  const id2 = spawn('science-ship')
  setJumpRoll(() => 0.1)
  const result = planMoveUnchecked(ship(id2), toNear, 100)
  applyMoveResult(ship(id2), toNear, result)
  check('an order that loses the roll removes the ship and notifies', result.kind === 'lost-in-hyperspace' && !useShipStore.getState().ships.some((s) => s.id === id2) && useDiplomacyStore.getState().events.some((e) => e.kind === 'ship-lost'))
  setJumpRoll(() => 1)
  // An order refused tells the player once, why.
  fresh()
  const id3 = spawn('science-ship')
  placeAtCluster(id3, NEAR)
  const refused = planMoveUnchecked(ship(id3), { kind: 'star', starId: 'sol' }, 100)
  applyMoveResult(ship(id3), { kind: 'star', starId: 'sol' }, refused)
  applyMoveResult(ship(id3), { kind: 'star', starId: 'sol' }, refused)
  const refusals = useDiplomacyStore.getState().events.filter((e) => e.kind === 'order-refused')
  check('a refused order is told once, with the reason', refusals.length === 1 && /Solar Neighbourhood/.test(refusals[0].text), refusals[0]?.text ?? 'none')
}

console.log('\n=== 6. The AI plays by the same risk ===')
{
  check('the AI line is 5%, the same as the player\'s warning; a scout is allowed more', AI_JUMP_MAX_LOSS === JUMP_WARN_LOSS && AI_SCOUT_JUMP_MAX_LOSS > AI_JUMP_MAX_LOSS)
  check('every role but a Science Ship is held to 5%', ['warship', 'transport', 'cargo', 'construction', 'colony', 'civilian', undefined].every((role) => aiJumpCap(role) === AI_JUMP_MAX_LOSS))
  check('a Science Ship may take up to the scout cap', aiJumpCap('science') === AI_SCOUT_JUMP_MAX_LOSS)
  check('it never attempts a jump over its cap', !aiMayJump(0.0501, 'warship') && !aiMayJump(0.5, 'cargo') && !aiMayJump(0.41, 'science') && !aiMayJump(1, 'science'))
  check('...and takes one at or under it', aiMayJump(0.05, 'warship') && aiMayJump(0, 'construction') && aiMayJump(0.4, 'science') && aiMayJump(0.13, 'science'))
  check('a move that is no jump (a flight, a warp ship) is always allowed', aiMayJump(null, 'cargo') && aiMayJump(null, 'warship'))
  fresh()
  const sci = spawn('science-ship')
  const cargo = spawn('cargo-ship')
  const alpha: MoveDestination = { kind: 'star', starId: 'alpha-centauri' }
  const sirius: MoveDestination = { kind: 'star', starId: 'sirius' }
  check('with Hyperdrive Mk I a scout may go to Alpha Centauri (13%) but a cargo ship may not', aiMayJumpNow(ship(sci), alpha, 100) && !aiMayJumpNow(ship(cargo), alpha, 100))
  check('...and a scout may not go to Sirius (43%)', !aiMayJumpNow(ship(sci), sirius, 100))
  check('nor to another cluster', !aiMayJumpNow(ship(sci), toNear, 100) && !aiMayJumpNow(ship(cargo), toNear, 100))
  check('a flight inside its own system is always fine', aiMayJumpNow(ship(cargo), { kind: 'body', systemId: 'sol', bodyName: 'Venus' }, 100))
  useHyperlaneStore.getState().addHyperlane(MARS, 'sol', 'alpha-centauri')
  check('on a lane its scout charted, everyone may take the jump (13% x 0.2 under 5%)', aiMayJumpNow(ship(cargo), alpha, 100), `${(hyperdriveJumpChance(ship(cargo), alpha, 100)! * 100).toFixed(1)}%`)
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, 'hyperdrive-mk2']) } } })
  useHyperlaneStore.setState({ lanes: {} })
  check('with Hyperdrive Mk II every typical hop is under 5% for everyone', aiMayJumpNow(ship(cargo), alpha, 100) && aiMayJumpNow(ship(cargo), { kind: 'star', starId: 'wolf-359' }, 100) && aiMayJumpNow(ship(cargo), sirius, 100))
  check('...but still not a cluster', !aiMayJumpNow(ship(cargo), toNear, 100))
  const path = [...AI_RESEARCH_PATH]
  check('the AI researches Hyperdrive Mk II (last, after Orbital Construction), with Mk I in the path as its prerequisite', path.includes('hyperdrive-mk2') && path.indexOf('hyperdrive-mk2') > path.indexOf('orbital-construction') && path.indexOf('hyperdrive-mk1') < path.indexOf('hyperdrive-mk2'))
}

console.log('\n=== 7. Comms over kly (unchanged: the same rule at every scale) ===')
{
  const nearPlace = { kind: 'cluster' as const, clusterId: NEAR, offset: [0, 0, 0] as [number, number, number] }
  const light = commsDelayToLocation(nearPlace, 'sol', 'Mars', 0, 'light') / YEAR_DAYS
  const warp = commsDelayToLocation(nearPlace, 'sol', 'Mars', 0, 'warp') / YEAR_DAYS
  const hyper = commsDelayToLocation(nearPlace, 'sol', 'Mars', 0, 'hyper')
  check('light speed to the nearest cluster: about 2,500 years', light > 2400 && light < 2600, `${light.toFixed(0)} years`)
  check('Warp Comms (500c): about 5 years one way', warp > 4.8 && warp < 5.2, `${warp.toFixed(2)} years`)
  check('Hyper Comms: no delay at any distance', hyper === 0)
  const medianPlace = { kind: 'cluster' as const, clusterId: byDistance[Math.floor(byDistance.length / 2)].id, offset: [0, 0, 0] as [number, number, number] }
  check('the median cluster at Warp Comms is decades (the order and the report both wait)', commsDelayToLocation(medianPlace, 'sol', 'Mars', 0, 'warp') / YEAR_DAYS > 50)
  check('a bare point of galactic space is measured the same way', commsDelayToLocation({ kind: 'galactic-point', position: clusterScenePosition(NEAR).toArray() as [number, number, number] }, 'sol', 'Mars', 0, 'warp') > 0)
  check('galactic scene units match the neighbourhood table (UNITS_PER_KLY per thousand light-years)', Math.abs(clusterScenePosition(SOLAR_NEIGHBORHOOD_ID).x - sol.position[0] * UNITS_PER_KLY) < 1e-9)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
if (failures > 0) process.exit(1)
