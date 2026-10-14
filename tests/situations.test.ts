// The Situations panel and notifications: each alert type fires on a minimal snapshot and
// clears when its problem is gone; hidden types and snoozes; pausing only on a NEW line of a
// pause-on type; snoozes dropping once their line clears; the toast filter; the saved
// preferences parser; and a real game start read into a snapshot (scene/situationSnapshot.ts).
// See scene/situations.ts.
//
// Run:  npx tsx tests/situations.test.ts

import {
  ALERT_TYPES,
  lineId,
  newPauseLines,
  prunedSnoozes,
  situationsFor,
  visibleLines,
  worstSeverity,
  type SituationSnapshot,
  type SnapShip,
} from '../src/scene/situations'
import { buildSituationSnapshot, shipIsIdle } from '../src/scene/situationSnapshot'
import { eventReachesPlayer } from '../src/scene/notificationFilter'
import { parseSituationPrefs } from '../src/state/situationPrefsStore'
import { useSituationStore } from '../src/state/situationStore'
import { useSituationSnoozeStore } from '../src/state/situationSnoozeStore'
import { useSituationPrefsStore } from '../src/state/situationPrefsStore'
import { refreshSituations } from '../src/hooks/useSituationTracker'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { setUpNewGame } from '../src/scene/gameSetup'
import { notifyOwner } from '../src/scene/notify'
import { STORE_REGISTRY } from '../src/state/gameStores'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const EMPTY: SituationSnapshot = {
  playerId: 'p',
  economyModel: 'abstract',
  ships: [],
  battles: [],
  hostilesAtOwnWorlds: [],
  occupied: [],
  groundWar: [],
  armies: [],
  yard: { slots: 2, building: 2, waiting: 0 },
  constructionQueued: 1,
  treasury: 100,
  balancePerMonth: 1,
  resources: [],
  influence: { amount: 0, cap: 1000 },
  inputShortages: [],
  prices: [],
  surpluses: [],
  inflation: 0.02,
  worlds: [],
  unrest: 0,
  deposits: [],
  routesInDisrepair: [],
  research: { hasIncome: true, queueLength: 1, blocked: [] },
  unsurveyed: [],
  foundings: [],
  starbasesBuilding: [],
  wars: [],
  encroachmentsAgainst: [],
  incidentsAgainst: [],
  contestedClaims: [],
}
const ship = (over: Partial<SnapShip>): SnapShip => ({ id: 's1', name: 'Corvette 1', className: 'Corvette', role: 'warship', fleetName: '1st Fleet', damage: 0, idle: false, where: 'in orbit of Mars', note: null, jumpWaitingDays: null, ...over })
const fires = (typeId: string, snap: SituationSnapshot) => situationsFor(snap).filter((l) => l.typeId === typeId)

console.log('\n=== 1. A calm nation has no alerts ===')
{
  const lines = situationsFor(EMPTY)
  check('nothing fires on a snapshot with no problems', lines.length === 0, lines.map((l) => l.typeId).join(', '))
  check('every alert type has a unique id', new Set(ALERT_TYPES.map((t) => t.id)).size === ALERT_TYPES.length)
}

console.log('\n=== 2. Each alert type fires on its problem, and only then ===')
{
  const cases: [string, Partial<SituationSnapshot>][] = [
    ['battle', { battles: [{ key: 'space:e1', label: 'Space battle at Mars' }] }],
    ['hostile-at-world', { hostilesAtOwnWorlds: [{ bodyName: 'Mars', count: 2, owners: 'Venus' }] }],
    ['world-occupied', { occupied: [{ bodyName: 'Phobos', byName: 'Venus' }] }],
    ['ground-war', { groundWar: ['Mars'] }],
    ['ship-damaged', { ships: [ship({ damage: 0.4 })] }],
    ['army-weak', { armies: [{ id: 'a', label: 'Assault army', strength: 30, max: 100, bodyName: 'Mars' }] }],
    ['ship-stuck', { ships: [ship({ note: 'No reachable star' })] }],
    ['jump-waiting', { ships: [ship({ jumpWaitingDays: 12 })] }],
    ['yard-idle', { yard: { slots: 2, building: 0, waiting: 0 } }],
    ['nothing-building', { constructionQueued: 0 }],
    ['deficit', { balancePerMonth: -5e6 }],
    ['resource-running-out', { resources: [{ id: 'hyperium', label: 'Hyperium', amount: 3, monthlyDelta: -1 }] }],
    ['price-high', { prices: [{ bodyName: 'Mars', good: 'steel', label: 'Steel', ratio: 2 }] }],
    ['price-low', { prices: [{ bodyName: 'Mars', good: 'grains', label: 'Grains', ratio: 0.4 }] }],
    ['inflation', { inflation: 0.12 }],
    ['surplus', { surpluses: [{ key: 'alloys', label: 'Alloys', where: null, made: 800, used: 160 }] }],
    ['input-shortage', { inputShortages: ['minerals'] }],
    ['low-sol', { worlds: [{ bodyName: 'Mars', lowSolShare: 0.5, employment: 0.95 }] }],
    ['unemployment', { worlds: [{ bodyName: 'Mars', lowSolShare: 0, employment: 0.7 }] }],
    ['unrest', { unrest: 3 }],
    ['deposit-low', { deposits: [{ bodyName: 'Mars', material: 'hyperium', remaining: 2 }] }],
    ['route-disrepair', { routesInDisrepair: [{ id: 'r1', bodyName: 'Mars' }] }],
    ['research-idle', { research: { hasIncome: true, queueLength: 0, blocked: [] } }],
    ['research-blocked', { research: { hasIncome: true, queueLength: 1, blocked: [{ name: 'Warp Drive Mk I', reason: 'needs 15 exotic matter' }] } }],
    ['idle-science', { ships: [ship({ role: 'science', idle: true })] }],
    ['idle-construction', { ships: [ship({ role: 'construction', idle: true })] }],
    ['idle-colony', { ships: [ship({ role: 'colony', idle: true })] }],
    ['idle-cargo', { ships: [ship({ role: 'cargo', idle: true })] }],
    ['unsurveyed', { unsurveyed: [{ starId: 'sol', starName: 'Sol', count: 3 }] }],
    ['influence-capped', { influence: { amount: 1000, cap: 1000 } }],
    ['colony-founding', { foundings: [{ shipId: 's9', shipName: 'Colony Ship 1', bodyName: 'Ceres' }] }],
    ['starbase-soon', { starbasesBuilding: [{ starId: 'barnards-star', starName: "Barnard's Star", readyInDays: 10 }] }],
    ['at-war', { wars: [{ id: 'w1', enemyName: 'Venus', score: 12 }] }],
    ['encroachment', { encroachmentsAgainst: [{ id: 'e1', byName: 'Venus', starId: 'sol', starName: 'Sol' }] }],
    ['incident', { incidentsAgainst: [{ id: 'i1', byName: 'Venus', text: 'Venus attacked your ships' }] }],
    ['claim-contested', { contestedClaims: [{ key: 'body:Ceres', label: 'Ceres', rivals: 'Venus', place: { bodyName: 'Ceres' } }] }],
  ]
  const tested = new Set(cases.map(([id]) => id))
  check('every alert type has a case here', ALERT_TYPES.every((t) => tested.has(t.id)), ALERT_TYPES.filter((t) => !tested.has(t.id)).map((t) => t.id).join(', '))
  for (const [id, over] of cases) {
    const lines = situationsFor({ ...EMPTY, ...over })
    check(`${id}: fires, and nothing else does`, lines.length === 1 && lines[0].typeId === id, lines.map((l) => `${l.typeId}: ${l.text}`).join(' | '))
  }
  check('a lightly scratched ship is not "damaged"', fires('ship-damaged', { ...EMPTY, ships: [ship({ damage: 0.01 })] }).length === 0)
  check('a resource that lasts past the horizon is not "running out"', fires('resource-running-out', { ...EMPTY, resources: [{ id: 'h', label: 'H', amount: 100, monthlyDelta: -1 }] }).length === 0)
  check('a yard with orders waiting is not idle', fires('yard-idle', { ...EMPTY, yard: { slots: 2, building: 0, waiting: 1 } }).length === 0)
  check('no research income (Complex) means no empty-queue alert', fires('research-idle', { ...EMPTY, research: { hasIncome: false, queueLength: 0, blocked: [] } }).length === 0)
  check('a normal price is neither expensive nor cheap', fires('price-high', { ...EMPTY, prices: [{ bodyName: 'Mars', good: 'steel', label: 'Steel', ratio: 1.1 }] }).length + fires('price-low', { ...EMPTY, prices: [{ bodyName: 'Mars', good: 'steel', label: 'Steel', ratio: 0.9 }] }).length === 0)
  check('deflation is flagged too', fires('inflation', { ...EMPTY, inflation: -0.05 })[0]?.text.startsWith('Deflation') === true)
  check('a busy science ship is not idle', fires('idle-science', { ...EMPTY, ships: [ship({ role: 'science', idle: false })] }).length === 0)
}

console.log('\n=== 3. Hidden types, snoozes, pausing ===')
{
  const a = situationsFor({ ...EMPTY, ships: [ship({ damage: 0.5 })], wars: [{ id: 'w1', enemyName: 'Venus', score: 0 }] })
  check('hidden types are not shown', visibleLines(a, { hidden: { 'at-war': true } }, new Set()).every((l) => l.typeId !== 'at-war'))
  const damagedId = lineId(a.find((l) => l.typeId === 'ship-damaged')!)
  check('a snoozed line is not shown', visibleLines(a, { hidden: {} }, new Set([damagedId])).every((l) => lineId(l) !== damagedId))
  check('a snooze stays while its line is there', prunedSnoozes([damagedId], a).length === 1)
  check('a snooze is dropped once its line is gone', prunedSnoozes([damagedId], situationsFor(EMPTY)).length === 0)

  const before = situationsFor(EMPTY)
  const after = situationsFor({ ...EMPTY, hostilesAtOwnWorlds: [{ bodyName: 'Mars', count: 1, owners: 'Venus' }], ships: [ship({ damage: 0.5 })] })
  const prefs = { hidden: {}, pause: {} }
  const alarms = newPauseLines(before, after, prefs, new Set())
  check('a new enemy at a world pauses by default; a damaged ship does not', alarms.length === 1 && alarms[0].typeId === 'hostile-at-world')
  check('the same line again does not pause again', newPauseLines(after, after, prefs, new Set()).length === 0)
  check('the player can turn a type\'s pause off', newPauseLines(before, after, { hidden: {}, pause: { 'hostile-at-world': false } }, new Set()).length === 0)
  check('...or on', newPauseLines(before, after, { hidden: {}, pause: { 'ship-damaged': true } }, new Set()).length === 2)
  check('a hidden type never pauses', newPauseLines(before, after, { hidden: { 'hostile-at-world': true }, pause: {} }, new Set()).length === 0)
  check('worst severity picks danger over warning', worstSeverity(after) === 'danger' && worstSeverity([]) === null)
}

console.log('\n=== 4. Which notifications pop up ===')
{
  const own = { kind: 'colony-founded' as const, countryIds: ['p'] }
  const othersColony = { kind: 'colony-founded' as const, countryIds: ['x'] }
  const othersWar = { kind: 'war-declared' as const, countryIds: ['x', 'y'] }
  check('relevant: own events and world news, not others\' routine', eventReachesPlayer(own, 'p', 'relevant') && eventReachesPlayer(othersWar, 'p', 'relevant') && !eventReachesPlayer(othersColony, 'p', 'relevant'))
  check('mine: only own', eventReachesPlayer(own, 'p', 'mine') && !eventReachesPlayer(othersWar, 'p', 'mine'))
  check('all: everything', eventReachesPlayer(othersColony, 'p', 'all'))
}

console.log('\n=== 5. Saved preferences ===')
{
  const p = parseSituationPrefs(JSON.stringify({ hidden: { 'at-war': true, bad: 3 }, pause: { battle: true }, toastFilter: 'mine' }))
  check('hidden, pause and toast filter load; junk entries are dropped', p.hidden['at-war'] === true && !('bad' in p.hidden) && p.pause.battle === true && p.toastFilter === 'mine')
  check('nothing saved, bad JSON or an unknown filter give the defaults', parseSituationPrefs(null).toastFilter === 'relevant' && parseSituationPrefs('{{').toastFilter === 'relevant' && parseSituationPrefs('{"toastFilter":"loud"}').toastFilter === 'relevant')
  check('the snooze store is saved and the lines are not', STORE_REGISTRY.some((e) => e.key === 'situationSnooze' && e.kind === 'game') && STORE_REGISTRY.some((e) => e.key === 'situations' && e.kind === 'ui'))
}

console.log('\n=== 6. A real game start, read into a snapshot ===')
{
  usePlayerStore.getState().selectCountry('imperial-state-of-mars')
  setUpNewGame()
  const snap = buildSituationSnapshot()
  check('the snapshot is built for the player', snap?.playerId === 'imperial-state-of-mars')
  const mine = useShipStore.getState().ships.filter((s) => s.ownerId === 'imperial-state-of-mars')
  check('the starting navy is read, undamaged', !!snap && snap.ships.length === mine.length && snap.ships.every((s) => s.damage === 0))
  check('starting ships sit idle in orbit', mine.every((s) => shipIsIdle(s)))
  const lines = snap ? situationsFor(snap) : []
  check('no war, battle or enemy at the start', lines.every((l) => !['at-war', 'battle', 'hostile-at-world', 'world-occupied', 'ground-war'].includes(l.typeId)), lines.map((l) => l.typeId).join(', '))

  // The tracker: the first fill never pauses; a new enemy-at-world line does.
  useGameTimeStore.setState({ paused: false })
  refreshSituations()
  check('the first fill does not pause', useGameTimeStore.getState().paused === false && useSituationStore.getState().lines.length === lines.length)
  // Damage a ship, with its type set to pause: the next refresh pauses and lists it.
  useSituationPrefsStore.getState().setPause('ship-damaged', true)
  const target = mine.find((s) => s.combat)!
  useShipStore.setState((s) => ({ ships: s.ships.map((sh) => (sh.id === target.id ? { ...sh, combat: { ...sh.combat, armorHp: 0, shieldHp: 0 } } : sh)) }))
  refreshSituations()
  const damaged = useSituationStore.getState().lines.filter((l) => l.typeId === 'ship-damaged')
  check('a damaged ship appears and pauses the game', damaged.length >= 1 && useGameTimeStore.getState().paused === true, `${damaged.length} line(s)`)
  // Snooze it; repair it; the snooze goes once the line clears.
  if (damaged[0]) useSituationSnoozeStore.getState().snooze(lineId(damaged[0]))
  useShipStore.setState((s) => ({ ships: s.ships.map((sh) => (sh.id === target.id ? { ...sh, combat: target.combat } : sh)) }))
  refreshSituations()
  check('repairing clears the line and drops its snooze', useSituationStore.getState().lines.every((l) => l.typeId !== 'ship-damaged' || l.key !== target.id) && useSituationSnoozeStore.getState().snoozed.length === 0)

  // Operational notifications are raised for the player only.
  const before = useDiplomacyStore.getState().events.length
  notifyOwner('republic-of-venus', 'ship-built', 'Venus built a ship')
  notifyOwner('imperial-state-of-mars', 'ship-built', 'Mars built a ship')
  const added = useDiplomacyStore.getState().events.slice(before)
  check('operational notifications are only the player\'s', added.length === 1 && added[0].text === 'Mars built a ship')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
