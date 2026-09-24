// Game pacing and the decisions that interrupt it: the operational time mode
// for ground battles, the clock following a fight the player is in, and AI
// peace offers to the player pausing the game and being throttled.
//
// Run:  npx tsx tests/pacing.test.ts

import { AI_PLAYER_OFFER_COOLDOWN_DAYS, AI_PLAYER_OFFER_MAX_COOLDOWN_DAYS, AI_PLAYER_OFFER_MIN_GAP_DAYS } from '../src/data/aiData'
import { PIRATES_ID, SANDBOX_PLAYER_ID } from '../src/data/countryRoster'
import { executeIntents, mayOfferPeaceToPlayer } from '../src/ai/executor'
import { useAiStore } from '../src/ai/aiStore'
import { fightPace, paceAfterSpaceFight } from '../src/hooks/fightPace'
import { followGroundFightWithClock, GROUND_FIGHT_COOLDOWN_DAYS } from '../src/hooks/useGroundCombatResolver'
import type { Army } from '../src/scene/armyLogic'
import { playerFightLive } from '../src/scene/armyLogic'
import { useCombatStore } from '../src/state/combatStore'
import { useConfirmStore } from '../src/state/confirmStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import {
  NORMAL_DAYS_PER_SECOND,
  NORMAL_SPEED_MULTIPLIERS,
  OPERATIONAL_DAYS_PER_SECOND,
  OPERATIONAL_SPEED_MULTIPLIERS,
  TACTICAL_DAYS_PER_SECOND,
  daysPerSecondFor,
  speedMultipliersFor,
  useGameTimeStore,
} from '../src/state/gameTimeStore'

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

console.log('\n=== 1. Operational time: a pace between strategic and tactical ===')
{
  check('operational is slower than strategic and faster than tactical', OPERATIONAL_DAYS_PER_SECOND < NORMAL_DAYS_PER_SECOND && OPERATIONAL_DAYS_PER_SECOND > TACTICAL_DAYS_PER_SECOND)
  check('it is one sim-day per second', daysPerSecondFor('operational') === 1)
  check('it has the same five speed tiers', speedMultipliersFor('operational') === OPERATIONAL_SPEED_MULTIPLIERS && OPERATIONAL_SPEED_MULTIPLIERS.length === NORMAL_SPEED_MULTIPLIERS.length)
  time.setState({ simDays: 0, paused: false, speedIndex: 0, mode: 'operational' })
  time.getState().tick(2)
  check('two real seconds at 1x pass two days', Math.abs(time.getState().simDays - 2) < 1e-9)
  time.setState({ simDays: 0, paused: false, speedIndex: 0, mode: 'normal' })
}

console.log('\n=== 2. The clock follows a ground fight the player is in ===')
{
  const unit = (id: string, firingAtId: string | null = null) => ({ id, type: 'infantry' as const, strength: 25, maxStrength: 25, firingAtId })
  const army = (owner: string, units: ReturnType<typeof unit>[]): Army => ({
    id: `a-${owner}-${units[0].id}`,
    ownerId: owner,
    kind: 'assault',
    units: units as Army['units'],
    location: { kind: 'body', bodyName: 'Earth' },
  })
  const quiet = [army(ME, [unit('m1')]), army(PIRATES_ID, [unit('e1')])]
  const mineFiring = [army(ME, [unit('m1', 'e1')]), army(PIRATES_ID, [unit('e1')])]
  const theirsFiring = [army(ME, [unit('m1')]), army(PIRATES_ID, [unit('e1', 'm1')])]
  const otherPeoples = [army('orion-republic', [unit('o1', 'v1')]), army('republic-of-venus', [unit('v1')])]
  check('no shots, no fight', !playerFightLive(quiet, ME))
  check('your unit firing is a fight', playerFightLive(mineFiring, ME))
  check('an enemy firing at your unit is a fight', playerFightLive(theirsFiring, ME))
  check("other nations' fights are not yours", !playerFightLive(otherPeoples, ME))
  check('nothing to fight without a player', !playerFightLive(mineFiring, null))

  useCombatStore.setState({ autoTacticalOnEngage: true })
  time.setState({ mode: 'normal', paused: false, speedIndex: 2 })
  followGroundFightWithClock(true, 100)
  check('a fight pulls strategic time down to operational', time.getState().mode === 'operational')
  check('...keeping the chosen speed tier and not touching pause', time.getState().speedIndex === 2 && !time.getState().paused)
  followGroundFightWithClock(false, 100 + GROUND_FIGHT_COOLDOWN_DAYS / 2)
  check('a lull shorter than the cooldown keeps it', time.getState().mode === 'operational')
  followGroundFightWithClock(false, 100 + GROUND_FIGHT_COOLDOWN_DAYS)
  check('...and strategic pace returns once the fight is over', time.getState().mode === 'normal')

  // Once the last fight is over the clock goes back to strategic, whichever
  // pace it was on and however it got there.
  const endFights = (t: number) => {
    followGroundFightWithClock(false, t)
    followGroundFightWithClock(false, t + GROUND_FIGHT_COOLDOWN_DAYS)
  }
  time.setState({ mode: 'normal' })
  followGroundFightWithClock(true, 1000)
  time.setState({ mode: 'tactical' })
  endFights(1100)
  check('when the fight ends the clock goes back to strategic, even from a pace the player chose', time.getState().mode === 'normal')

  time.setState({ mode: 'operational' })
  followGroundFightWithClock(false, 3000)
  check("a pace the player picks with no fight going on is left alone (it only returns when a fight ENDS)", time.getState().mode === 'operational')
  time.setState({ mode: 'normal' })

  time.setState({ mode: 'tactical' })
  followGroundFightWithClock(true, 4000)
  check("a ground fight doesn't override tactical time", time.getState().mode === 'tactical')
  endFights(4100)
  check('...and when it ends, with no space fight either, the clock returns to strategic', time.getState().mode === 'normal')

  // A space fight still going keeps the clock where it is.
  fightPace.spaceLive = true
  time.setState({ mode: 'normal' })
  followGroundFightWithClock(true, 4200)
  time.setState({ mode: 'tactical' })
  endFights(4300)
  check('a ground fight ending during a space fight leaves tactical time alone', time.getState().mode === 'tactical')
  fightPace.spaceLive = false
  time.setState({ mode: 'normal' })

  // The bug this guards: with the switch acting every tick of a fight, a
  // player who clicked back to strategic mid-battle was put straight back in
  // operational time. Once a fight is under way it must leave the clock alone.
  time.setState({ mode: 'normal' })
  followGroundFightWithClock(true, 5000)
  check('a new fight switches to operational', time.getState().mode === 'operational')
  time.getState().setMode('normal')
  for (let d = 5000; d < 5040; d += 0.25) followGroundFightWithClock(true, d)
  check('...and the player can switch back to strategic mid-fight and stay there', time.getState().mode === 'normal')
  // Tick-to-tick flicker in who's firing doesn't count as a new fight.
  followGroundFightWithClock(false, 5040)
  followGroundFightWithClock(true, 5040.5)
  check('...even if the shooting pauses for a moment', time.getState().mode === 'normal')
  endFights(5100)
  followGroundFightWithClock(true, 5200)
  check('a fight after a real lull is a new fight', time.getState().mode === 'operational')
  endFights(5300)
  time.setState({ mode: 'normal' })
  useCombatStore.setState({ autoTacticalOnEngage: false })
  followGroundFightWithClock(true, 9000)
  check('with the preference off, the clock is never touched', time.getState().mode === 'normal')
  time.setState({ mode: 'operational' })
  endFights(9100)
  check('...including when a fight ends', time.getState().mode === 'operational')
  time.setState({ mode: 'normal' })
  useCombatStore.setState({ autoTacticalOnEngage: true })
}

console.log('\n=== 2b. The pace only moves down on its own, and falls back to what is still needed ===')
{
  useCombatStore.setState({ autoTacticalOnEngage: true })
  time.setState({ mode: 'normal', paused: false })
  followGroundFightWithClock(true, 20010)
  check('a ground fight takes strategic down to operational', time.getState().mode === 'operational')
  time.setState({ mode: 'tactical' })
  followGroundFightWithClock(true, 20011)
  check('a ground fight never pulls tactical back up', time.getState().mode === 'tactical')
  check('a space fight ending mid ground battle falls back to operational, not strategic', paceAfterSpaceFight() === 'operational')
  followGroundFightWithClock(false, 20100)
  followGroundFightWithClock(false, 20100 + GROUND_FIGHT_COOLDOWN_DAYS)
  check('...and to strategic if no ground fight is going', paceAfterSpaceFight() === 'normal')
  time.setState({ mode: 'normal' })
}

console.log('\n=== 3. A decision that arrives on its own pauses the game ===')
{
  const confirm = useConfirmStore.getState()
  time.setState({ paused: false })
  confirm.requestConfirm({ title: 'Peace?', effects: [], onConfirm: () => {}, pausesGame: true })
  check('a pausing request stops a running clock', time.getState().paused)
  useConfirmStore.getState().resolve(true)
  check('...and resumes it once decided', !time.getState().paused)

  time.setState({ paused: false })
  let declined = false
  confirm.requestConfirm({ title: 'Peace?', effects: [], onConfirm: () => {}, onCancel: () => (declined = true), pausesGame: true })
  useConfirmStore.getState().resolve(false)
  check('declining runs onCancel and also resumes', declined && !time.getState().paused)

  time.setState({ paused: true })
  confirm.requestConfirm({ title: 'Peace?', effects: [], onConfirm: () => {}, pausesGame: true })
  useConfirmStore.getState().resolve(true)
  check('a game the player had already paused stays paused', time.getState().paused)

  time.setState({ paused: false })
  confirm.requestConfirm({ title: 'Build?', effects: [], onConfirm: () => {} })
  check('an ordinary confirmation (the player clicked something) does not pause', !time.getState().paused)
  useConfirmStore.getState().resolve(false)
}

console.log('\n=== 4. Peace offers to the player are throttled ===')
{
  const base = AI_PLAYER_OFFER_COOLDOWN_DAYS
  check('the first offer in a war is allowed', mayOfferPeaceToPlayer(100, undefined, null))
  check('...but not right after any other empire\'s offer', !mayOfferPeaceToPlayer(100 + AI_PLAYER_OFFER_MIN_GAP_DAYS - 1, undefined, 100))
  check('...once the gap has passed it is', mayOfferPeaceToPlayer(100 + AI_PLAYER_OFFER_MIN_GAP_DAYS, undefined, 100))
  const fresh = { lastOfferSimDays: 0, declines: 0 }
  check('the same war waits out the cooldown', !mayOfferPeaceToPlayer(base - 1, fresh, null) && mayOfferPeaceToPlayer(base, fresh, null))
  const declinedOnce = { lastOfferSimDays: 0, declines: 1 }
  check('a decline doubles the wait', !mayOfferPeaceToPlayer(base * 2 - 1, declinedOnce, null) && mayOfferPeaceToPlayer(base * 2, declinedOnce, null))
  const declinedALot = { lastOfferSimDays: 0, declines: 20 }
  check('...up to a cap', !mayOfferPeaceToPlayer(AI_PLAYER_OFFER_MAX_COOLDOWN_DAYS - 1, declinedALot, null) && mayOfferPeaceToPlayer(AI_PLAYER_OFFER_MAX_COOLDOWN_DAYS, declinedALot, null))
  check('an empire offering every 60 days is now throttled well below that', base >= 3 * 60)
}

console.log('\n=== 5. End to end: an AI offer pauses, and declines make it rarer ===')
{
  useAiStore.getState().reset()
  useDiplomacyStore.getState().reset()
  useConfirmStore.setState({ pending: null })
  const MARS = 'imperial-state-of-mars'
  const VENUS = 'republic-of-venus'
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  const warId = useDiplomacyStore.getState().wars[0].id
  const offer = (simDays: number) => executeIntents(MARS, [{ kind: 'propose-peace', warId, terms: { kind: 'white' } }], simDays, VENUS)

  time.setState({ paused: false })
  offer(10)
  check('an offer to the player opens the dialog', !!useConfirmStore.getState().pending)
  check('...and pauses the game', time.getState().paused)
  useConfirmStore.getState().resolve(false)
  check('declining resumes the game and is remembered', !time.getState().paused && useAiStore.getState().playerOffers[warId]?.declines === 1)

  offer(10 + AI_PLAYER_OFFER_COOLDOWN_DAYS)
  check('a repeat after the base cooldown is too soon once declined', !useConfirmStore.getState().pending)
  offer(10 + AI_PLAYER_OFFER_COOLDOWN_DAYS * 2)
  check('...but comes after the doubled wait', !!useConfirmStore.getState().pending)
  useConfirmStore.getState().resolve(false)
  check('a second decline is counted', useAiStore.getState().playerOffers[warId]?.declines === 2)
  useAiStore.getState().reset()
  useDiplomacyStore.getState().reset()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
