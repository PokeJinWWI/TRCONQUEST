// Exploration and survey: any ship entering a system explores it; a science
// ship surveys by flying to each body and spending a fixed time in its orbit;
// discoveries reach the player only after the FTL signal delay (instantly with
// Hyper Comms). Plus what the
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
import { applyShipCommand, orderSelectedToDoAt, orderSelectedToSurvey } from '../src/scene/shipCommands'
import { settleShips } from '../src/hooks/useShipOrderSettler'
import { isExplored, isFullySurveyed, restingStarId, stepSurveyJob, surveyJobBodies, surveyProgress, systemIntelStatus, systemOfShip, unsurveyedBodies } from '../src/scene/surveyLogic'
import { systemBodies } from '../src/scene/territory'
import { systemKnownToPlayer, unidentifiedStarbaseStars, visibleClaims } from '../src/scene/intel'
import type { Starbase } from '../src/scene/starbaseLogic'
import type { SystemClaim } from '../src/scene/territory'
import { safeJumps } from './testWarp'

// Not about jump risk: ships always arrive (the roll is tested in tests/warp.test.ts).
safeJumps()

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
      [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperdrive-mk1', 'hyperspace-theory', ...(hyperComms ? [HYPER_COMMS_TECH_ID] : [])]) },
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

  const job = { starId: AC, bodies: bodies.slice(0, 3), workingSinceSimDays: null }
  const away = { orbiting: null, headingTo: null }
  const at = (b: string) => ({ orbiting: b, headingTo: null })
  const s1 = stepSurveyJob(job, job.bodies, away, 0)
  check('a job first flies to its first body', s1.kind === 'fly' && s1.bodyName === bodies[0])
  check('...and waits while under way there', stepSurveyJob(job, job.bodies, { orbiting: null, headingTo: bodies[0] }, 3).kind === 'wait')
  const s2 = stepSurveyJob(job, job.bodies, at(bodies[0]), 10)
  check('in its orbit, work starts', s2.kind === 'wait' && s2.job.workingSinceSimDays === 10)
  const working = { ...job, workingSinceSimDays: 10 }
  check('nothing done before one body-time has passed', stepSurveyJob(working, job.bodies, at(bodies[0]), 10 + SURVEY_DAYS_PER_BODY - 0.1).kind === 'wait')
  const s3 = stepSurveyJob(working, job.bodies, at(bodies[0]), 10 + SURVEY_DAYS_PER_BODY + 4)
  check('one body after one body-time, dated at its completion, the rest left', s3.kind === 'surveyed' && s3.bodyName === bodies[0] && s3.atSimDays === 10 + SURVEY_DAYS_PER_BODY && s3.job?.bodies.join() === bodies.slice(1, 3).join() && s3.job.workingSinceSimDays === null)
  check('work on one body does not count for the next', stepSurveyJob(working, job.bodies.slice(1), at(bodies[1]), 100).kind === 'wait')
  const last = stepSurveyJob({ ...job, bodies: [bodies[2]], workingSinceSimDays: 0 }, [bodies[2]], at(bodies[2]), 99)
  check('the last body ends the job', last.kind === 'surveyed' && last.job === null)
  check('nothing left: done', stepSurveyJob(job, [], away, 0).kind === 'done')
  check('surveyJobBodies: every unsurveyed body, or just one', surveyJobBodies(undefined, MARS, AC, owners()).length === bodies.length && surveyJobBodies(undefined, MARS, AC, owners(), bodies[2]).join() === bodies[2])
  check('systemOfShip: beside a star', systemOfShip(scienceShip()) === AC)
  check('systemOfShip: orbiting a planet', systemOfShip(scienceShip({ location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 } })) === 'sol')
  check('systemOfShip: none in interstellar transit', systemOfShip(scienceShip({ order: { space: 'interstellar' } as never })) === null)
  check('restingStarId: beside a star', restingStarId(scienceShip()) === AC)
  check('restingStarId: not at a planet', restingStarId(scienceShip({ location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 } })) === null)
}

console.log('\n=== Entering a system explores it; the report takes signal time ===')
{
  reset(scienceShip({ classId: 'cargo-ship' }))
  resolveSurvey(0)
  check('ANY ship in a system explores it (discovered at once)', isExplored(survey().discovered[MARS], MARS, AC, owners()))
  check('the player does not know yet', !isExplored(survey().known[MARS], MARS, AC, owners()))
  check('a report is in flight', survey().reports.length === 1 && survey().reports[0].arrivesSimDays > 1000, `${survey().reports[0]?.arrivesSimDays.toFixed(0)}d`)
  const arrives = survey().reports[0].arrivesSimDays
  resolveSurvey(arrives - 1)
  check('still unknown just before it arrives', !isExplored(survey().known[MARS], MARS, AC, owners()))
  check('...and only one report was sent', survey().reports.length === 1)
  resolveSurvey(arrives)
  check('known once the signal arrives', isExplored(survey().known[MARS], MARS, AC, owners()) && survey().reports.length === 0)
}
{
  reset(scienceShip(), true)
  resolveSurvey(0)
  check('with Hyper Comms the player knows instantly', isExplored(survey().known[MARS], MARS, AC, owners()) && survey().reports.length === 0)
  reset(scienceShip({ location: { kind: 'interstellar-point', position: [1, 2, 3] } }), true)
  resolveSurvey(0)
  check('a ship in deep space explores nothing', !survey().discovered[MARS])
  reset(scienceShip({ order: { space: 'interstellar' } as never }), true)
  resolveSurvey(0)
  check('...nor one in interstellar transit', !survey().discovered[MARS])
}

// Runs the clock day by day (settling arrivals, then the survey), reporting
// each newly surveyed body and every body the ship rested in orbit of.
const orbited = new Set<string>()
function runDays(from: number, to: number, onSurveyed?: (body: string) => void) {
  for (let d = from; d <= to; d++) {
    useGameTimeStore.setState({ simDays: d })
    const before = new Set(survey().discovered[MARS]?.surveyed ?? [])
    settleShips(d)
    resolveSurvey(d)
    const ship = useShipStore.getState().ships[0]
    if (ship && !ship.order && ship.location.kind === 'orbiting') orbited.add(ship.location.bodyName)
    for (const b of survey().discovered[MARS]?.surveyed ?? []) if (!before.has(b)) onSurveyed?.(b)
  }
}

console.log('\n=== Surveying: the ship flies to each body in turn ===')
{
  reset(scienceShip(), true)
  const bodies = systemBodies(AC)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  const s0 = useShipStore.getState().ships[0]
  check('the survey order starts a job for every body of the system', s0.surveyJob?.starId === AC && s0.surveyJob.bodies.length === bodies.length)
  check('...and the ship sets off for the first body at once', s0.order?.destination.kind === 'body' && s0.order.destination.bodyName === bodies[0], JSON.stringify(s0.order?.destination))
  const where: string[] = []
  let doneDay = -1
  orbited.clear()
  runDays(1, 5000, (b) => {
    where.push(b)
    if (isFullySurveyed(survey().discovered[MARS], MARS, AC, owners()) && doneDay < 0) doneDay = useGameTimeStore.getState().simDays
  })
  check('every body gets surveyed, in order', where.join() === bodies.join(), where.join(' '))
  check('...the ship having orbited each one', bodies.every((b) => orbited.has(b)), [...orbited].join(', '))
  check(`...taking at least ${SURVEY_DAYS_PER_BODY} days a body`, doneDay >= SURVEY_DAYS_PER_BODY * bodies.length, `${doneDay} days for ${bodies.length} bodies`)
  check('and the job ends', !useShipStore.getState().ships[0].surveyJob)
}
{
  reset(scienceShip(), true)
  const bodies = systemBodies(AC)
  applyShipCommand('sci1', { kind: 'survey', bodyName: bodies[2] }, 0)
  check('one body can be surveyed on its own', useShipStore.getState().ships[0].surveyJob?.bodies.join() === bodies[2])
  runDays(1, 2000)
  check('...and only that one is', survey().discovered[MARS].surveyed.size === 1 && survey().discovered[MARS].surveyed.has(bodies[2]))
}
{
  reset(scienceShip(), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  let stopAt = -1
  runDays(1, 3000, () => {
    if (stopAt < 0 && survey().discovered[MARS].surveyed.size === 2) stopAt = useGameTimeStore.getState().simDays
  })
  check('(two bodies surveyed at some point)', stopAt > 0)
  reset(scienceShip(), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  runDays(1, stopAt)
  const ship = useShipStore.getState().ships[0]
  useShipStore.getState().setShipLocation('sci1', ship.location.kind === 'orbiting' ? { kind: 'star', starId: AC, offset: [0, 0, 0] } : ship.location)
  check('a manual order cancels the job', !useShipStore.getState().ships[0].surveyJob)
  check('...but the finished bodies stay surveyed', survey().discovered[MARS].surveyed.size === 2)
  applyShipCommand('sci1', { kind: 'survey' }, stopAt + 1)
  check('ordering it again carries on with the rest', useShipStore.getState().ships[0].surveyJob?.bodies.length === systemBodies(AC).length - 2)
}
{
  reset(scienceShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  check('your own (already known) system has nothing to survey', !useShipStore.getState().ships[0].surveyJob)
  reset(scienceShip({ classId: 'cargo-ship' }), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  check('survey refused for a non-science ship', !useShipStore.getState().ships[0].surveyJob)
  reset(scienceShip({ location: { kind: 'interstellar-point', position: [1, 2, 3] } }), true)
  applyShipCommand('sci1', { kind: 'survey' }, 0)
  check('in deep space with no system named, nothing to survey', !useShipStore.getState().ships[0].surveyJob)
}

console.log('\n=== Right-click menus ===')
{
  const starOrder = (starId: string) => ({ destination: { kind: 'star' as const, starId } }) as never
  reset(scienceShip({ classId: 'construction-ship', location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  const { setArrivalCommand, setShipOrder } = useShipStore.getState()
  setArrivalCommand('sci1', { starId: AC, command: { kind: 'build-starbase' } })
  setShipOrder('sci1', { ...starOrder(AC), arrivalSimDays: 50, departSimDays: 0 } as never)
  check('an order to the same star keeps the arrival command', useShipStore.getState().ships[0].arrivalCommand?.starId === AC)
  setShipOrder('sci1', { ...starOrder('barnards-star'), arrivalSimDays: 60, departSimDays: 0 } as never)
  check('an order to somewhere else cancels it', !useShipStore.getState().ships[0].arrivalCommand)

  // "Survey system" from another system: the job itself flies the ship there.
  reset(scienceShip({ location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] } }), true)
  useShipStore.getState().selectShips(['sci1'])
  orderSelectedToSurvey(AC)
  const away = useShipStore.getState().ships[0]
  check('Survey system from afar: a job for that system, and the ship on its way', away.surveyJob?.starId === AC && (!!away.order || away.location.kind !== 'star'), JSON.stringify(away.order?.destination ?? away.location))
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
