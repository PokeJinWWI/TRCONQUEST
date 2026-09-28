// Exploration and survey: a science ship explores the star it rests at, works
// through its bodies at a fixed rate, and its discoveries reach the player only
// after the FTL signal delay (instantly with Hyper Comms). Plus what the
// player is then allowed to see (scene/intel.ts).
//
// Run:  npx tsx tests/survey.test.ts

import { SHIP_CLASSES } from '../src/data/shipData'
import { SURVEY_DAYS_PER_BODY } from '../src/data/surveyData'
import { HYPER_COMMS_TECH_ID } from '../src/data/commsData'
import { useShipStore, pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useTechStore } from '../src/state/techStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { resolveSurvey } from '../src/hooks/useSurveyResolver'
import { applyShipCommand, orderSelectedToDoAt } from '../src/scene/shipCommands'
import { settleShips } from '../src/hooks/useShipOrderSettler'
import { isExplored, isFullySurveyed, restingStarId, stepSurveyJob, surveyProgress, systemIntelStatus, unsurveyedBodies } from '../src/scene/surveyLogic'
import { systemBodies } from '../src/scene/territory'
import { systemKnownToPlayer, unidentifiedStarbaseStars, visibleClaims } from '../src/scene/intel'
import type { Starbase } from '../src/scene/starbaseLogic'
import type { SystemClaim } from '../src/scene/territory'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const AC = 'alpha-centauri'
const owners = () => useTerritoryStore.getState().bodyOwner
const survey = () => useSurveyStore.getState()

function scienceShip(overrides: Partial<ShipInstance> = {}): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === 'science-ship')!
  return {
    id: 'sci1',
    classId: 'science-ship',
    name: 'Science Ship sci1',
    ownerId: MARS,
    location: { kind: 'star', starId: AC, offset: [0, 0, 0] },
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: false,
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(cls.combat),
    stance: 'balanced',
    fleetId: 'solo-sci1',
    ...overrides,
  }
}

function reset(ship: ShipInstance | null, hyperComms = false) {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useShipStore.setState({ ships: ship ? [ship] : [] })
  useTechStore.setState({
    byCountry: {
      [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperspace-theory', ...(hyperComms ? [HYPER_COMMS_TECH_ID] : [])]) },
    },
  })
}

console.log('\n=== Pure rules ===')
{
  const bodies = systemBodies(AC)
  check('Alpha Centauri has bodies to survey', bodies.length > 3, `${bodies.length}`)
  check('a nation knows its own systems with no report', isExplored(undefined, MARS, 'sol', owners()) && isFullySurveyed(undefined, MARS, 'sol', owners()))
  check('but not a stranger\'s', !isExplored(undefined, MARS, AC, owners()) && systemIntelStatus(undefined, MARS, AC, owners()) === 'unexplored')
  const p = surveyProgress({ explored: new Set([AC]), surveyed: new Set(bodies.slice(0, 2)) }, MARS, AC, owners())
  check('progress counts surveyed bodies', p.done === 2 && p.total === bodies.length)
  check('explored but partly surveyed reads "explored"', systemIntelStatus({ explored: new Set([AC]), surveyed: new Set(bodies.slice(0, 2)) }, MARS, AC, owners()) === 'explored')
  check('all bodies surveyed reads "surveyed"', systemIntelStatus({ explored: new Set([AC]), surveyed: new Set(bodies) }, MARS, AC, owners()) === 'surveyed')
  check('unsurveyed list skips the done ones, in order', unsurveyedBodies({ explored: new Set(), surveyed: new Set([bodies[0]]) }, MARS, AC, owners())[0] === bodies[1])

  const job = { starId: AC, startedSimDays: 10, done: 0 }
  const rem = bodies.slice()
  check('nothing done before one body-time has passed', stepSurveyJob(job, 10 + SURVEY_DAYS_PER_BODY - 0.1, rem).completed.length === 0)
  const one = stepSurveyJob(job, 10 + SURVEY_DAYS_PER_BODY, rem)
  check('one body after one body-time, dated at its completion', one.completed.length === 1 && one.completed[0].bodyName === bodies[0] && one.completed[0].atSimDays === 10 + SURVEY_DAYS_PER_BODY)
  const many = stepSurveyJob(job, 10 + SURVEY_DAYS_PER_BODY * 3.5, rem)
  check('a long jump completes several in order', many.completed.map((c) => c.bodyName).join() === bodies.slice(0, 3).join() && many.done === 3)
  const finish = stepSurveyJob(job, 10 + SURVEY_DAYS_PER_BODY * 1000, rem)
  check('finishes when nothing is left, and never overshoots', finish.finished && finish.completed.length === bodies.length)
  check('an already-surveyed system finishes at once', stepSurveyJob(job, 11, []).finished)
  check('restingStarId: beside a star', restingStarId(scienceShip()) === AC)
  check('restingStarId: none while under way', restingStarId(scienceShip({ order: {} as never })) === null)
  check('restingStarId: not at a planet', restingStarId(scienceShip({ location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 } })) === null)
}

console.log('\n=== Exploring is an order; the report takes signal time ===')
{
  reset(scienceShip())
  resolveSurvey(0)
  check('resting at a star does NOT explore it by itself', !survey().discovered[MARS])
  applyShipCommand('sci1', { kind: 'explore' }, 0)
  check('the explore order explores where it rests at once (discovered)', isExplored(survey().discovered[MARS], MARS, AC, owners()))
  check('the player does not know yet', !isExplored(survey().known[MARS], MARS, AC, owners()))
  check('a report is in flight', survey().reports.length === 1 && survey().reports[0].arrivesSimDays > 1000, `${survey().reports[0]?.arrivesSimDays.toFixed(0)}d`)
  const arrives = survey().reports[0].arrivesSimDays
  resolveSurvey(arrives - 1)
  check('still unknown just before it arrives', !isExplored(survey().known[MARS], MARS, AC, owners()))
  resolveSurvey(arrives)
  check('known once the signal arrives', isExplored(survey().known[MARS], MARS, AC, owners()) && survey().reports.length === 0)
}
{
  reset(scienceShip(), true)
  applyShipCommand('sci1', { kind: 'explore' }, 0)
  check('with Hyper Comms the player knows instantly', isExplored(survey().known[MARS], MARS, AC, owners()) && survey().reports.length === 0)
}
{
  reset(scienceShip({ location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 } }))
  applyShipCommand('sci1', { kind: 'explore' }, 0)
  check('resting at a planet (not at a star) explores nothing', !survey().discovered[MARS])
  reset(scienceShip({ classId: 'cargo-ship' }), true)
  applyShipCommand('sci1', { kind: 'explore' }, 0)
  check('only science ships explore', !survey().discovered[MARS])
  reset(scienceShip({ order: {} as never }), true)
  applyShipCommand('sci1', { kind: 'explore' }, 0)
  check('...and only once they are there (not under way)', !survey().discovered[MARS])
}

console.log('\n=== Surveying needs no exploring first ===')
{
  reset(scienceShip(), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  check('the survey order starts a job at an UNexplored star', useShipStore.getState().ships[0].surveyJob?.starId === AC)
  const bodies = systemBodies(AC)
  resolveSurvey(SURVEY_DAYS_PER_BODY * 2)
  check('two bodies done after two body-times', survey().discovered[MARS].surveyed.size === 2 && survey().known[MARS].surveyed.size === 2)
  check('...without the system having been explored', !isExplored(survey().discovered[MARS], MARS, AC, owners()))
  check('job progress recorded', useShipStore.getState().ships[0].surveyJob?.done === 2)
  resolveSurvey(SURVEY_DAYS_PER_BODY * bodies.length + 1)
  check('the whole system is surveyed in bodies x days', isFullySurveyed(survey().known[MARS], MARS, AC, owners()))
  check('and the job ends', !useShipStore.getState().ships[0].surveyJob)
  check('a fully surveyed system is still not "explored"', !isExplored(survey().known[MARS], MARS, AC, owners()))
}
{
  // Progress survives the ship leaving and coming back.
  reset(scienceShip(), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  resolveSurvey(SURVEY_DAYS_PER_BODY * 2)
  useShipStore.setState({ ships: [{ ...useShipStore.getState().ships[0], order: {} as never }] })
  resolveSurvey(SURVEY_DAYS_PER_BODY * 3)
  check('leaving cancels the job', !useShipStore.getState().ships[0].surveyJob)
  check('but the two finished bodies stay surveyed', survey().discovered[MARS].surveyed.size === 2)
  useShipStore.setState({ ships: [{ ...useShipStore.getState().ships[0], order: null }] })
  applyShipCommand('sci1', { kind: 'survey' }, 100)
  resolveSurvey(100 + SURVEY_DAYS_PER_BODY)
  check('coming back continues with the rest', survey().discovered[MARS].surveyed.size === 3)
}
{
  reset(scienceShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  resolveSurvey(1)
  check('surveying your own (already known) system ends at once, nothing new', !useShipStore.getState().ships[0].surveyJob)
  reset(scienceShip({ classId: 'cargo-ship' }), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  check('survey refused for a non-science ship', !useShipStore.getState().ships[0].surveyJob)
}

console.log('\n=== Right-click "go and do this" ===')
{
  const starOrder = (starId: string) => ({ destination: { kind: 'star' as const, starId } }) as never
  reset(scienceShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  const { setArrivalCommand, setShipOrder } = useShipStore.getState()
  setArrivalCommand('sci1', { starId: AC, command: { kind: 'explore' } })
  setShipOrder('sci1', { ...starOrder(AC), arrivalSimDays: 50, departSimDays: 0 } as never)
  check('an order to the same star keeps the arrival command', useShipStore.getState().ships[0].arrivalCommand?.starId === AC)
  setShipOrder('sci1', { ...starOrder('barnards-star'), arrivalSimDays: 60, departSimDays: 0 } as never)
  check('an order to somewhere else cancels it', !useShipStore.getState().ships[0].arrivalCommand)

  // Arriving fires it.
  reset(scienceShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  useShipStore.getState().setArrivalCommand('sci1', { starId: AC, command: { kind: 'explore' } })
  useShipStore.getState().setShipOrder('sci1', { destination: { kind: 'star', starId: AC }, departSimDays: 0, arrivalSimDays: 10, space: 'interstellar', startPosition: [0, 0, 0], endPosition: [1, 0, 0], usedWarp: true })
  settleShips(5)
  check('nothing happens before it arrives', !isExplored(survey().discovered[MARS], MARS, AC, owners()))
  settleShips(10)
  check('on arrival the order fires (explored) and clears', isExplored(survey().discovered[MARS], MARS, AC, owners()) && !useShipStore.getState().ships[0].arrivalCommand)

  reset(scienceShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  useShipStore.getState().setArrivalCommand('sci1', { starId: AC, command: { kind: 'survey' } })
  useShipStore.getState().setShipOrder('sci1', { destination: { kind: 'star', starId: AC }, departSimDays: 0, arrivalSimDays: 10, space: 'interstellar', startPosition: [0, 0, 0], endPosition: [1, 0, 0], usedWarp: true })
  settleShips(10)
  check('a survey arrival command starts the survey job', useShipStore.getState().ships[0].surveyJob?.starId === AC)

  // The menu action itself: already there -> immediate; else fly + arrival command.
  reset(scienceShip(), true)
  useShipStore.getState().selectShips(['sci1'])
  orderSelectedToDoAt(AC, { kind: 'explore' })
  check('already at the star: the action happens straight away', isExplored(survey().discovered[MARS], MARS, AC, owners()) && !useShipStore.getState().ships[0].order)
  reset(scienceShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  useShipStore.getState().selectShips(['sci1'])
  orderSelectedToDoAt(AC, { kind: 'survey' })
  const away = useShipStore.getState().ships[0]
  check('elsewhere: it flies there and remembers what to do', !!away.order && away.arrivalCommand?.starId === AC && away.arrivalCommand.command.kind === 'survey')
  reset(scienceShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  useShipStore.getState().selectShips(['sci1'])
  orderSelectedToDoAt(AC, { kind: 'build-starbase' })
  check("a science ship is not handed a construction order", !useShipStore.getState().ships[0].arrivalCommand)
}

console.log('\n=== What the player may see (intel) ===')
{
  reset(null)
  const sb = (starId: string, ownerId: string): Starbase => ({ id: `sb-${starId}-${ownerId}`, starId, ownerId, integrity: 50, readySimDays: 0 })
  const known = (id: string, bases: Starbase[]) => systemKnownToPlayer(id, MARS, survey().known[MARS], owners(), bases, 10)
  check('own systems are known from the start', known('sol', []))
  check('a stranger\'s system is not', !known(AC, []))
  check('a Starbase of your own makes its system known', known('barnards-star', [sb('barnards-star', MARS)]))
  check('an enemy Starbase does not', !known('barnards-star', [sb('barnards-star', 'orion-republic')]))

  const claims = new Map<string, SystemClaim>([
    ['sol', { kind: 'contested', countryIds: ['imperial-state-of-mars', 'republic-of-venus'] }],
    [AC, { kind: 'owned', countryId: 'orion-republic' }],
  ])
  const shown = visibleClaims(claims, (id) => id === 'sol')
  check('an unexplored system shows no owner', shown.get(AC)?.kind === 'unclaimed' && shown.get('sol')?.kind === 'contested')

  const bases = [sb('barnards-star', 'orion-republic'), sb('sol', MARS)]
  const unident = unidentifiedStarbaseStars(bases, (id) => id === 'sol', 10)
  check('a Starbase in an unexplored system is listed as unidentified', unident.join() === 'barnards-star')
  check('a Starbase still under construction is not', unidentifiedStarbaseStars([{ ...sb('wolf-359', 'orion-republic'), readySimDays: 50 }], () => false, 10).length === 0)

  // After the report arrives Alpha Centauri is known: Orion's border shows.
  survey().discover(MARS, { kind: 'explored', starId: AC }, 0, 0)
  check('once explored, the system is known', known(AC, []))
}

console.log(failures === 0 ? '\nAll survey checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
