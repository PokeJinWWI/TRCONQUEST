// Upgrading a ship at its shipyard: the generic per-class path (scouts first), the rules,
// the slip it takes (FIFO), completion keeping the ship, the hold, refunds, and the AI
// obeying the same rules. See scene/shipUpgrade.ts, state/shipyardStore.queueUpgrade,
// scene/shipyardLogic.advanceShipyard and ai/shipwright.pickUpgrade.
//
// Run:  npx tsx tests/shipUpgrade.test.ts

import { SHIP_CLASSES, type HyperDrive } from '../src/data/shipData'
import { shipBuildDays, UPGRADE_DURATION_FACTOR, MAX_QUEUED_BUILDS } from '../src/data/shipyardData'
import { RESOURCE_TYPES, type ResourceId } from '../src/data/resourceData'
import { COUNTRIES, getCountry } from '../src/data/countryData'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { useShipyardStore } from '../src/state/shipyardStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTechStore } from '../src/state/techStore'
import { useShipStore } from '../src/state/shipStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useCombatStore } from '../src/state/combatStore'
import { useArmyStore } from '../src/state/armyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useAiStore } from '../src/ai/aiStore'
import { useDefenseStore } from '../src/state/defenseStore'
import { useBombardmentStore } from '../src/state/bombardmentStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { advanceShipyard, seedStrategicResources, spawnOwnedShip } from '../src/scene/shipyardLogic'
import { atShipyard, nextLevel, upgradeBlock, upgradeCost, upgradeDays, upgradeTarget } from '../src/scene/shipUpgrade'
import { planMove, planMoveUnchecked } from '../src/scene/shipPhysics'
import { setUpNewGame } from '../src/scene/gameSetup'
import { buildBlackboard } from '../src/ai/blackboard'
import { captureSnapshot } from '../src/ai/snapshot'
import { upgradedName } from '../src/scene/shipyardLogic'
import { orderUpgrade } from '../src/scene/upgradeOrders'
import { applyShipCommand } from '../src/scene/shipCommands'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { pickUpgrade, shipwright } from '../src/ai/shipwright'
import { INITIAL_AI_MEMORY } from '../src/ai/types'
import { runStrategicAI } from '../src/ai/runStrategicAI'
import { resolveShipyards } from '../src/hooks/useShipyardResolver'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const LALANDE = 'kingdom-of-lalande'
const ZERO = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>
const cls = (id: string) => SHIP_CLASSES.find((c) => c.id === id)!
const NAV = 'autonomous-navigation'
const set = (...ids: string[]) => new Set(ids)
const country = getCountry(MARS)!

function reset(researched: string[], amounts: Partial<Record<ResourceId, number>> = {}) {
  usePlayerStore.setState({ selectedCountryId: MARS })
  useResourceStore.setState({ byCountry: { [MARS]: { amounts: { ...ZERO, alloys: 1e6, energy: 1e6, hyperium: 1e6, special: 5, ...amounts }, monthlyDelta: { ...ZERO } } } })
  useShipyardStore.setState({ ordersByCountry: {} })
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(researched) } } })
  useShipStore.setState({ ships: [] })
  useCombatStore.setState({ engagements: [] })
}
const amountsOf = () => useResourceStore.getState().stateFor(MARS).amounts
const orders = () => useShipyardStore.getState().ordersFor(MARS)
const shipOf = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!
const scout = () => spawnOwnedShip('hyperspace-scout', MARS, 'sol', 'Mars')!

console.log('\n=== 1. Selection, cost, duration (pure) ===')
{
  const hyper = cls('hyperspace-scout')
  const turing = cls('turing-scout')
  check('a Hyperspace Scout upgrades to the Turing Scout once its tech is researched', upgradeTarget('hyperspace-scout', set(NAV), resolveShipClass)?.id === 'turing-scout')
  check('...to nothing before it (but the next level is still known, for the button)', upgradeTarget('hyperspace-scout', set(), resolveShipClass) === null && nextLevel('hyperspace-scout', resolveShipClass)?.id === 'turing-scout')
  check('the top of a line has no upgrade', upgradeTarget('turing-scout', set(NAV), resolveShipClass) === null && nextLevel('turing-scout', resolveShipClass) === null)
  check('a class without a line has none (scouts are the only opt-in so far)', SHIP_CLASSES.filter((c) => c.upgradesTo).map((c) => c.id).join() === 'hyperspace-scout' && ['corvette', 'frigate', 'science-ship', 'troop-transport'].every((id) => upgradeTarget(id, set(NAV, 'frigate-hulls'), resolveShipClass) === null))
  check('it costs the build-cost difference: one special core', JSON.stringify(upgradeCost(hyper, turing)) === JSON.stringify({ special: 1 }))
  check('it holds a slip for half the new level\'s build time (a named factor)', UPGRADE_DURATION_FACTOR === 0.5 && upgradeDays(turing) === Math.round(shipBuildDays(turing) * 0.5) && upgradeDays(turing) < shipBuildDays(turing))
}

console.log('\n=== 2. Rules: what blocks an upgrade ===')
{
  const base = { classId: 'hyperspace-scout', researched: set(NAV), amounts: { ...ZERO, special: 1 }, classOf: resolveShipClass, atYard: true, engaged: false, alreadyQueued: false, queueFull: false }
  check('fine: tech in, at the yard, a core in stock', upgradeBlock(base) === null)
  check('no tech: names it', (upgradeBlock({ ...base, researched: set() }) ?? '').includes('Autonomous Navigation'))
  check('away from the shipyard world', (upgradeBlock({ ...base, atYard: false }) ?? '').includes('shipyard'))
  check('in a fight', upgradeBlock({ ...base, engaged: true }) === 'It is in a fight')
  check('already queued', (upgradeBlock({ ...base, alreadyQueued: true }) ?? '').includes('Already'))
  check('queue full', (upgradeBlock({ ...base, queueFull: true }) ?? '').includes('full') && MAX_QUEUED_BUILDS > 0)
  check('short of the core', (upgradeBlock({ ...base, amounts: ZERO }) ?? '').startsWith('Short of'))
  check('nothing to upgrade to', upgradeBlock({ ...base, classId: 'turing-scout' }) === 'Nothing to upgrade it to')
  reset([])
  const id = scout()
  check('at the shipyard = resting in orbit of the capital', atShipyard(shipOf(id)))
  useShipStore.getState().setShipLocation(id, { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
  check('...not at another star', !atShipyard(shipOf(id)))
}

console.log('\n=== 3. It takes a slip like a build, FIFO ===')
{
  reset([NAV])
  const id = scout()
  const free = useShipyardStore.getState().queueUpgrade(MARS, id, 0)
  const o = orders()[0]
  check('queueing pays the cost up front and adds an order', free.ok && amountsOf().special === 4 && orders().length === 1)
  check('...an upgrade order for that ship, to the new level, for the shortened time', o.upgradeShipId === id && o.classId === 'turing-scout' && o.durationDays === upgradeDays(cls('turing-scout')))
  check('...that took a free slip at once (a paused game too)', o.startedSimDays === 0 && o.finishSimDays === o.durationDays)
  check('...and holds the ship', shipOf(id).upgrading === true)

  // A full yard: it waits behind earlier orders, in queue order.
  reset([NAV])
  const id2 = scout()
  for (let i = 0; i < 6; i++) useShipyardStore.getState().queueBuild(MARS, 'corvette', 0)
  const startedBefore = orders().filter((x) => x.startedSimDays !== null).length
  const waitingBefore = orders().filter((x) => x.startedSimDays === null).map((x) => x.id)
  check('(setup: the yard is full, builds are waiting)', startedBefore >= 1 && waitingBefore.length >= 1)
  useShipyardStore.getState().queueUpgrade(MARS, id2, 0)
  const up = orders().find((x) => x.upgradeShipId === id2)!
  check('with every slip busy the upgrade WAITS, last in the queue', up.startedSimDays === null && orders()[orders().length - 1].id === up.id)
  // Cancelling builds frees slips in queue order: the earlier waiting builds start first.
  const queueOrder = orders().map((x) => x.id)
  const running = orders().filter((x) => x.startedSimDays !== null)
  for (const r of running) useShipyardStore.getState().cancelBuild(MARS, r.id)
  const nowStarted = orders().filter((x) => x.startedSimDays !== null).map((x) => x.id)
  check('freed slips go to the waiting orders in queue order, so the upgrade is behind the earlier builds', nowStarted.every((sid) => queueOrder.indexOf(sid) < queueOrder.indexOf(up.id)) && orders().find((x) => x.id === up.id)!.startedSimDays === null)
  check('it counts against the queue bound', orders().length <= MAX_QUEUED_BUILDS)
}

console.log('\n=== 4. Finishing: the same ship, the new level ===')
{
  reset([NAV])
  const id = scout()
  useShipStore.setState((s) => ({ ships: s.ships.map((x) => (x.id === id ? { ...x, name: 'Pathfinder' } : x)) }))
  const before = JSON.stringify(shipOf(id))
  useShipyardStore.getState().queueUpgrade(MARS, id, 0)
  const o = orders()[0]
  advanceShipyard(country, o.finishSimDays! - 0.5)
  check('before it is done the ship is still the old level, still held', shipOf(id).classId === 'hyperspace-scout' && shipOf(id).upgrading === true && orders().length === 1)
  advanceShipyard(country, o.finishSimDays!)
  const after = shipOf(id)
  check('when it finishes the ship becomes the Turing Scout', after.classId === 'turing-scout' && orders().length === 0)
  check('...the SAME ship (id, name, fleet, owner, location), no longer held', JSON.stringify({ ...after, classId: 'hyperspace-scout', upgrading: undefined }) === JSON.stringify({ ...JSON.parse(before), upgrading: undefined }) && after.name === 'Pathfinder' && !after.upgrading && useShipStore.getState().ships.length === 1)
  check('...with the Turing drive (0% loss, 7-day cooldown stay as they are)', (resolveShipClass(after.classId)!.ftlDrives[0] as HyperDrive).lossChanceOverride === 0)
  check('...and nothing more to upgrade', upgradeTarget(after.classId, set(NAV), resolveShipClass) === null)
}

console.log('\n=== 5. The hold, cancel and refund ===')
{
  reset([NAV])
  const id = scout()
  useShipyardStore.getState().queueUpgrade(MARS, id, 0)
  const dest = { kind: 'body' as const, systemId: 'sol', bodyName: 'Venus' }
  const held = planMove(shipOf(id), dest, 0)
  check('the player cannot order a ship that is queued or in a slip away', held.kind === 'unreachable' && /upgraded/.test(held.reason))
  check('...though a forced/unchecked move (an escape, automation) is not blocked', planMoveUnchecked(shipOf(id), dest, 0).kind !== 'unreachable')
  const spent = amountsOf().special
  useShipyardStore.getState().cancelBuild(MARS, orders()[0].id)
  check('cancelling refunds the full cost and frees the ship', amountsOf().special === spent + 1 && orders().length === 0 && !shipOf(id).upgrading && planMove(shipOf(id), dest, 0).kind !== 'unreachable')

  useShipyardStore.getState().queueUpgrade(MARS, id, 0)
  const paid = amountsOf().special
  useShipStore.getState().removeShip(id)
  advanceShipyard(country, 1)
  check('if the ship is lost meanwhile the order is dropped, refunded in full', orders().length === 0 && amountsOf().special === paid + 1)

  reset([NAV], { special: 0 })
  const poor = scout()
  check('refused with no core, nothing queued or spent', !useShipyardStore.getState().queueUpgrade(MARS, poor, 0).ok && orders().length === 0)
  reset([])
  const early = scout()
  check('refused before the tech', !useShipyardStore.getState().queueUpgrade(MARS, early, 0).ok)
  reset([NAV])
  const id3 = scout()
  useShipyardStore.getState().queueUpgrade(MARS, id3, 0)
  check('refused a second time while queued', !useShipyardStore.getState().queueUpgrade(MARS, id3, 0).ok && orders().length === 1)
  reset([NAV])
  const away = scout()
  useShipStore.getState().setShipLocation(away, { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
  check('refused away from the shipyard world', !useShipyardStore.getState().queueUpgrade(MARS, away, 0).ok)
  reset([NAV])
  const fight = scout()
  useCombatStore.setState({ engagements: [{ participants: [{ shipId: fight }] }] as never })
  check('refused in a fight', !useShipyardStore.getState().queueUpgrade(MARS, fight, 0).ok)
  check('only the owner can queue it', !useShipyardStore.getState().queueUpgrade(LALANDE, fight, 0).ok)
}

console.log('\n=== 6. The AI obeys the same rules ===')
{
  const freshWorld = () => {
    useHyperlaneStore.setState({ lanes: {} })
    useShipStore.setState({ ships: [] })
    useArmyStore.getState().reset()
    useTerritoryStore.getState().reset()
    useDiplomacyStore.getState().reset()
    useAiStore.getState().reset()
    useShipyardStore.setState({ ordersByCountry: {} })
    useResourceStore.setState({ byCountry: {} })
    useDefenseStore.setState({ installations: [] })
    useBombardmentStore.setState({ devastation: {}, strikes: [] })
    useTechStore.setState({ byCountry: {} })
    useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
    useStarbaseStore.setState({ starbases: [] })
    useCombatStore.setState({ engagements: [] })
    usePlayerStore.setState({ selectedCountryId: LALANDE })
    setUpNewGame()
    for (const c of COUNTRIES) seedStrategicResources(c.id)
  }
  const researchedFor = (...extra: string[]) => useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperspace-theory', 'hyperdrive-mk1', ...extra]) } } })
  const pick = () => { const snap = captureSnapshot(0); const bb = buildBlackboard(MARS, snap); return pickUpgrade(bb, snap, bb.resources) }
  freshWorld()
  const id = scout()
  researchedFor()
  check('without the tech the AI does not upgrade', pick() === null)
  researchedFor(NAV)
  const p = pick()
  check('with the tech, a free slip and the core it does', p?.shipId === id && JSON.stringify(p.cost) === JSON.stringify({ special: 1 }))
  const intents = shipwright(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), INITIAL_AI_MEMORY).intents
  check('...as an upgrade intent that replaces a new build this pass (one queue place)', intents.some((i) => i.kind === 'upgrade-ship' && i.shipId === id) && !intents.some((i) => i.kind === 'build-ship'))
  useResourceStore.getState().setAmount(MARS, 'special', 0)
  check('not without the core', pick() === null)
  useResourceStore.getState().setAmount(MARS, 'special', 3)
  useShipyardStore.getState().queueBuild(MARS, 'corvette', 0)
  check('not when its yard already has an order (no free slip)', pick() === null)
  useShipyardStore.setState({ ordersByCountry: {} })
  useShipStore.getState().setShipLocation(id, { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
  check('not for a ship away from its shipyard', pick() === null)
  useShipStore.getState().setShipLocation(id, { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 })
  check('...and again once it is home', pick()?.shipId === id)
  useCombatStore.setState({ engagements: [{ participants: [{ shipId: id }] }] as never })
  check('not for a ship in a fight', pick() === null)
  useCombatStore.setState({ engagements: [] })

  // Through the real loop: the intent is executed by the same store action, and the ship is upgraded.
  const special0 = useResourceStore.getState().stateFor(MARS).amounts.special
  let queuedDay = -1
  for (let d = 1; d <= 60; d++) {
    runStrategicAI(d)
    if (queuedDay < 0 && orders().some((o) => o.upgradeShipId === id)) queuedDay = d
    resolveShipyards(d)
  }
  check('the executor queued it through the same action (the core was paid)', queuedDay > 0 && useResourceStore.getState().stateFor(MARS).amounts.special === special0 - 1, `day ${queuedDay}`)
  check('...and it becomes a Turing Scout when the slip finishes', shipOf(id).classId === 'turing-scout')
}

console.log('\n=== 4. The name follows the class; a ship away flies to the yard by itself ===')
{
  check('a default name keeps its number and takes the new class', upgradedName('Hyperspace Scout 3', 'Hyperspace Scout', 'Turing Scout') === 'Turing Scout 3')
  check('a name the player chose is left alone', upgradedName('Pathfinder', 'Hyperspace Scout', 'Turing Scout') === 'Pathfinder' && upgradedName('Hyperspace Scout Alpha', 'Hyperspace Scout', 'Turing Scout') === 'Hyperspace Scout Alpha')
  reset([NAV])
  const id = scout()
  check('spawned with the class name', shipOf(id).name.startsWith('Hyperspace Scout '))
  const number = shipOf(id).name.split(' ').pop()
  useShipyardStore.getState().queueUpgrade(MARS, id, 0)
  for (let d = 1; d <= 60; d++) resolveShipyards(d)
  check('...and is renamed when the upgrade finishes', shipOf(id).classId === 'turing-scout' && shipOf(id).name === `Turing Scout ${number}`, shipOf(id).name)

  // Away from the yard: ordering the upgrade sends it home and queues on arrival (a hyperdrive
  // nation: without Hyperdrive Mk I the trip would be years of reaction drive, which asks first).
  reset([NAV, 'hyperspace-theory', 'hyperdrive-mk1'])
  const far = scout()
  useShipStore.getState().setShipLocation(far, { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
  useGameTimeStore.setState({ simDays: 0 })
  orderUpgrade(far)
  check('away from the yard it is NOT refused: it gets a move order to the capital world', !!(shipOf(far).order ?? shipOf(far).pendingMoveOrder ?? shipOf(far).pendingHyperdriveJump) || shipOf(far).location.kind === 'orbiting')
  check('...with the upgrade waiting on arrival, and nothing paid yet', (shipOf(far).arrivalCommand?.command.kind === 'upgrade' || shipOf(far).location.kind === 'orbiting') && orders().length === 0 && amountsOf().special === 5)
  useShipStore.getState().setArrivalCommand(far, null)
  useShipStore.getState().setShipLocation(far, { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 })
  applyShipCommand(far, { kind: 'upgrade' }, 0)
  check('on arrival the command queues the upgrade (cost paid, ship held)', orders().some((o) => o.upgradeShipId === far) && shipOf(far).upgrading === true && amountsOf().special === 4)
  const home = scout()
  orderUpgrade(home)
  check('already at the yard it queues at once', orders().some((o) => o.upgradeShipId === home))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
