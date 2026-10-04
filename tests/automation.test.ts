// Ship automation (Stellaris-style): science ships survey on their own and
// never pile onto a system an allied ship is already surveying; construction
// ships keep a Starbase kit in the hold and build on their own.
// Run: npx tsx tests/automation.test.ts
import { STARBASE_COST } from '../src/data/starbaseData'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useTechStore } from '../src/state/techStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { automationsFor, pickSurveyTarget, resolveAutomation, type Automation } from '../src/scene/automation'
import { systemBodies } from '../src/scene/territory'
import { settleShips } from '../src/hooks/useShipOrderSettler'
import { resolveSurvey } from '../src/hooks/useSurveyResolver'
import { safeJumps } from './testWarp'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import type { MoveOrder } from '../src/state/shipStore'
import { autoJumpLimit, autoMove, nextAutoStep } from '../src/scene/autoTravel'
import { JUMP_WARN_LOSS } from '../src/scene/jumpWarning'
import { AUTO_MAX_RISK_DEFAULT } from '../src/data/shipData'
import { restingStarId, systemOfShip } from '../src/scene/surveyLogic'
import { applyShipCommand } from '../src/scene/shipCommands'

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
const ship = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!

// These sections are about what automation chooses to do, not about jump risk:
// their ships may make any jump, as automation did before "Make unsafe jumps"
// existed (sections 12 on test the box itself).
function automate(id: string, mode: Automation) {
  useShipStore.getState().setAutomation(id, mode)
  useShipStore.getState().setAutomationUnsafe(id, true)
}

function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [] })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useStarbaseStore.setState({ starbases: [] })
  useTerritoryStore.getState().reset()
  useResourceStore.setState({ byCountry: {} })
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperdrive-mk1', 'hyperspace-theory', 'warp-comms', 'orbital-construction']) } } })
}

console.log('\n=== 1. Which ships can be automated ===')
check('science ships survey', automationsFor('science').join() === 'survey')
check('construction ships build or refill', automationsFor('construction').join() === 'build,refill,receive')
check('warships have none', automationsFor('warship').length === 0)

console.log('\n=== 2. Science ships survey on their own, never doubling up ===')
{
  fresh()
  const owners = useTerritoryStore.getState().bodyOwner
  const first = pickSurveyTarget('sol', MARS, undefined, owners, new Set())
  check('the target is the nearest system with something left to survey', !!first && first !== 'sol', `${first}`)
  const second = pickSurveyTarget('sol', MARS, undefined, owners, new Set([first!]))
  check('...skipping one another ship already has', !!second && second !== first, `${second}`)

  const a = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  const b = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  const idle = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  automate(a, 'survey')
  automate(b, 'survey')
  resolveAutomation(1)
  const ja = ship(a).surveyJob
  const jb = ship(b).surveyJob
  check('both automated ships set off to survey', !!ja && !!jb)
  check('...different systems', ja?.starId !== jb?.starId, `${ja?.starId} / ${jb?.starId}`)
  check('...the nearest ones', ja?.starId === first && jb?.starId === second)
  check('a ship with automation off stays put', !ship(idle).surveyJob && !ship(idle).order)

  // Finishing one system, it moves on to the next free one by itself.
  let day = 1
  while (day < 4000 && !(ship(a).surveyJob && ship(a).surveyJob!.starId !== first)) {
    day++
    useGameTimeStore.setState({ simDays: day })
    settleShips(day)
    resolveSurvey(day)
    resolveAutomation(day)
  }
  check('after its system, it goes on to another one nobody else is on', !!ship(a).surveyJob && ship(a).surveyJob!.starId !== first && ship(a).surveyJob!.starId !== ship(b).surveyJob?.starId, `${ship(a).surveyJob?.starId} on day ${day}`)
  check('...and what it surveyed stays surveyed', systemBodies(first!).every((body) => useSurveyStore.getState().discovered[MARS]?.surveyed.has(body)))

  useShipStore.getState().setShipLocation(a, { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 })
  check('a manual order turns automation off', !(ship(a).automations?.length) && !ship(a).surveyJob)
}

console.log('\n=== 3. Construction ships: refill and build on their own ===')
{
  fresh()
  useResourceStore.getState().setAmount(MARS, 'alloys', 5000)
  const builder = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  automate(builder, 'refill')
  resolveAutomation(1)
  check('at an owned world, auto-refill loads the hold from the stockpile', (ship(builder).cargo?.alloys ?? 0) >= (STARBASE_COST.alloys ?? 0), JSON.stringify(ship(builder).cargo))

  fresh()
  const hauler = spawnOwnedShip('cargo-ship', MARS, 'sol', 'Earth')!
  useShipStore.getState().setShipCargo(hauler, { alloys: 600 })
  const b2 = spawnOwnedShip('construction-ship', MARS, 'sol', 'Earth')!
  automate(b2, 'refill')
  resolveAutomation(1)
  check('away from home, a Cargo Ship in the same place tops it up', (ship(b2).cargo?.alloys ?? 0) > 0 && (ship(hauler).cargo?.alloys ?? 0) < 600, `${ship(b2).cargo?.alloys} / ${ship(hauler).cargo?.alloys}`)

  fresh()
  const b3 = spawnOwnedShip('construction-ship', MARS, 'sol', 'Earth')!
  automate(b3, 'build')
  resolveAutomation(1)
  check('with an empty hold and no Cargo Ship, auto-build flies home to load', ship(b3).arrivalCommand?.command.kind === 'load' && !!ship(b3).order)

  fresh()
  // Barnard's Star fully surveyed, two kitted builders at Mars.
  for (const body of systemBodies('barnards-star')) useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: body }, 0, 0)
  for (const body of systemBodies('alpha-centauri')) useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: body }, 0, 0)
  useResourceStore.getState().setAmount(MARS, 'influence', 500)
  const x = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  const y = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  for (const id of [x, y]) {
    useShipStore.getState().setShipCargo(id, { ...STARBASE_COST })
    automate(id, 'build')
  }
  resolveAutomation(1)
  const tx = ship(x).arrivalCommand
  const ty = ship(y).arrivalCommand
  check('with a kit, it flies off to build a Starbase', tx?.command.kind === 'build-starbase' && !!ship(x).order, JSON.stringify(tx))
  check('...and the second builder picks another system', ty?.command.kind === 'build-starbase' && ty.starId !== tx?.starId, `${tx?.starId} / ${ty?.starId}`)
}

console.log('\n=== 4. Cargo ships: auto-refill, optionally returning ===')
{
  fresh()
  useResourceStore.getState().setAmount(MARS, 'alloys', 5000)
  check('cargo ships can auto-refill', automationsFor('cargo').includes('refill'))
  const c = spawnOwnedShip('cargo-ship', MARS, 'sol', 'Earth')!
  automate(c, 'refill')
  useShipStore.getState().setAutomationReturn(c, true)
  resolveAutomation(1)
  check('away from a world of its own, it flies to the nearest to load', ship(c).arrivalCommand?.command.kind === 'load' && !!ship(c).order)
  check('...remembering where it was', ship(c).autoHome?.kind === 'body' && (ship(c).autoHome as { bodyName: string }).bodyName === 'Earth')
  // Arrive and load.
  let day = 1
  while (ship(c).order && day < 200) { day++; useGameTimeStore.setState({ simDays: day }); settleShips(day) }
  check('it loads on arrival', Object.keys(ship(c).cargo ?? {}).length > 0, JSON.stringify(ship(c).cargo))
  resolveAutomation(day + 1)
  check('once full it heads back', !!ship(c).order && ship(c).order!.destination.kind === 'body' && (ship(c).order!.destination as { bodyName: string }).bodyName === 'Earth' && !ship(c).autoHome)

  fresh()
  useResourceStore.getState().setAmount(MARS, 'alloys', 5000)
  const d = spawnOwnedShip('cargo-ship', MARS, 'sol', 'Earth')!
  automate(d, 'refill')
  resolveAutomation(1)
  check('without the option it stays where it loaded', !ship(d).autoHome)
}

console.log('\n=== 5. Receiving and distribution modes ===')
{
  fresh()
  useResourceStore.getState().setAmount(MARS, 'alloys', 5000)
  check('construction ships can receive; cargo ships distribute', automationsFor('construction').includes('receive') && automationsFor('cargo').includes('distribute'))
  const builder = spawnOwnedShip('construction-ship', MARS, 'sol', 'Earth')!
  automate(builder, 'receive')
  const hauler = spawnOwnedShip('cargo-ship', MARS, 'sol', 'Mars')!
  automate(hauler, 'distribute')
  resolveAutomation(1)
  check('a receiving ship stays where it is', !ship(builder).order)
  check('an empty distributing hauler loads at its world first', Object.keys(ship(hauler).cargo ?? {}).length > 0, JSON.stringify(ship(hauler).cargo))
  resolveAutomation(2)
  check('then goes to the receiver', ship(hauler).arrivalCommand?.command.kind === 'transfer' && !!ship(hauler).order)
  let day = 2
  while (ship(hauler).order && day < 300) { day++; useGameTimeStore.setState({ simDays: day }); settleShips(day) }
  check('and hands the goods over on arrival', (ship(builder).cargo?.alloys ?? 0) > 0, JSON.stringify(ship(builder).cargo))
  check('the receiver never moved', !ship(builder).order && ship(builder).location.kind === 'orbiting' && (ship(builder).location as { bodyName: string }).bodyName === 'Earth')

  // Two haulers do not both go to one receiver.
  fresh()
  useResourceStore.getState().setAmount(MARS, 'alloys', 5000)
  const r = spawnOwnedShip('construction-ship', MARS, 'sol', 'Earth')!
  automate(r, 'receive')
  const h1 = spawnOwnedShip('cargo-ship', MARS, 'sol', 'Mars')!
  const h2 = spawnOwnedShip('cargo-ship', MARS, 'sol', 'Mars')!
  for (const h of [h1, h2]) { useShipStore.getState().setShipCargo(h, { alloys: 300 }); automate(h, 'distribute') }
  resolveAutomation(1)
  const going = [h1, h2].filter((h) => ship(h).arrivalCommand?.command.kind === 'transfer').length
  check('only one hauler is sent to a receiver', going === 1, `${going}`)
}

console.log('\n=== 5b. Modes combine ===')
{
  fresh()
  useResourceStore.getState().setAmount(MARS, 'alloys', 5000)
  const hauler = spawnOwnedShip('cargo-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().toggleAutomation(hauler, 'distribute')
  useShipStore.getState().toggleAutomation(hauler, 'refill')
  const builder = spawnOwnedShip('construction-ship', MARS, 'sol', 'Earth')!
  useShipStore.getState().toggleAutomation(builder, 'receive')
  useShipStore.getState().toggleAutomation(builder, 'build')
  check('several modes can be on at once', ship(builder).automations?.join() === 'receive,build')
  resolveAutomation(1)
  check('receiving + building, empty hold, a distributor exists: it waits instead of flying to load', !ship(builder).order && !ship(builder).arrivalCommand)
  check('the distributing hauler loads first', Object.keys(ship(hauler).cargo ?? {}).length > 0)
  resolveAutomation(2)
  check('then brings the goods', ship(hauler).arrivalCommand?.command.kind === 'transfer')
  useShipStore.getState().toggleAutomation(builder, 'build')
  check('a mode can be switched off without touching the others', ship(builder).automations?.join() === 'receive')
  useShipStore.getState().setShipLocation(builder, { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 })
  check('a manual order turns all of them off', (ship(builder).automations ?? []).length === 0)

  // No distributor around: a receiving builder still refills itself.
  fresh()
  useResourceStore.getState().setAmount(MARS, 'alloys', 5000)
  const solo = spawnOwnedShip('construction-ship', MARS, 'sol', 'Earth')!
  useShipStore.getState().toggleAutomation(solo, 'receive')
  useShipStore.getState().toggleAutomation(solo, 'build')
  resolveAutomation(1)
  check('...but with no Cargo Ship distributing it goes to load itself', ship(solo).arrivalCommand?.command.kind === 'load')
}

console.log('\n=== 6. Colony ships settle on their own ===')
{
  fresh()
  useStarbaseStore.setState({ starbases: [{ id: 'sb', starId: 'sol', ownerId: MARS, integrity: 50, readySimDays: 0 }] })
  useResourceStore.getState().setAmount(MARS, 'influence', 500)
  useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: 'Titan' }, 0, 0)
  const c1 = spawnOwnedShip('colony-ship', MARS, 'sol', 'Mars')!
  const c2 = spawnOwnedShip('colony-ship', MARS, 'sol', 'Mars')!
  for (const c of [c1, c2]) { useShipStore.getState().setSettlers(c, 20); automate(c, 'settle') }
  check('colony ships can auto-settle', automationsFor('colony').join() === 'settle')
  resolveAutomation(1)
  const heading = [c1, c2].filter((c) => ship(c).arrivalCommand?.command.kind === 'colonize')
  check('one is sent to the only settleable world, not both', heading.length === 1 && (ship(heading[0]).arrivalCommand!.command as { bodyName: string }).bodyName === 'Titan')
}

console.log('\n=== 12. "Make unsafe jumps" off: automation refuses an unsafe jump and says why ===')
{
  fresh()
  useHyperlaneStore.setState({ lanes: {} })
  const a = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setAutomation(a, 'survey')
  check('the box is off by default', !ship(a).automationUnsafe && autoJumpLimit(ship(a)) === JUMP_WARN_LOSS)
  resolveAutomation(1)
  check('with every jump out of Sol over 5% at Mk I, it does not set off', !ship(a).surveyJob && !ship(a).order && ship(a).location.kind === 'orbiting')
  const note = ship(a).automationNote ?? ''
  check('...and says why in plain words', note.includes('Alpha Centauri') && note.includes('5.0%') && note.includes('16%') && note.includes('Make unsafe jumps'), note)
  check('no lane was charted', useHyperlaneStore.getState().lanesOf(MARS).length === 0)

  // Its own nation's charted lane makes that jump safe (3.3%): now it goes, box still off.
  useHyperlaneStore.getState().addHyperlane(MARS, 'sol', 'alpha-centauri')
  resolveAutomation(2)
  check('once the lane to Alpha Centauri is charted the jump is safe and it goes, box still off', ship(a).surveyJob?.starId === 'alpha-centauri' && !ship(a).automationNote)

  console.log('\n=== 13. The box on, and the max-risk slider ===')
  fresh()
  useHyperlaneStore.setState({ lanes: {} })
  const b = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setAutomation(b, 'survey')
  useShipStore.getState().setAutomationUnsafe(b, true)
  check('ticked, the limit starts at "any jump" (what automation did before)', autoJumpLimit(ship(b)) === AUTO_MAX_RISK_DEFAULT && AUTO_MAX_RISK_DEFAULT === 1)
  useShipStore.getState().setAutomationMaxRisk(b, 0.1)
  resolveAutomation(1)
  check('max risk 10%: the 16% jump to Alpha Centauri is still refused', !ship(b).surveyJob && (ship(b).automationNote ?? '').includes('Raise the max risk'), ship(b).automationNote ?? '')
  useShipStore.getState().setAutomationMaxRisk(b, 0.2)
  check('changing the setting clears the old reason', !ship(b).automationNote)
  resolveAutomation(2)
  check('max risk 20%: it sets off for Alpha Centauri', ship(b).surveyJob?.starId === 'alpha-centauri')
  resolveSurvey(2)
  check('...and jumps there with no question asked', systemOfShip(ship(b)) === 'alpha-centauri' && useHyperlaneStore.getState().hasHyperlane(MARS, 'sol', 'alpha-centauri'))
  useShipStore.getState().setShipOrder(b, { ...({} as MoveOrder), destination: { kind: 'star', starId: 'sol' }, arrivalSimDays: 999 } as MoveOrder)
  check('a manual order turns automation off and drops its route and reason', (ship(b).automations ?? []).length === 0 && !ship(b).autoRoute && !ship(b).automationNote)

  console.log('\n=== 14. A trip of several jumps: the route that loses least, a jump per cooldown ===')
  fresh()
  useHyperlaneStore.setState({ lanes: {} })
  const c = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setAutomation(c, 'survey')
  useShipStore.getState().setAutomationUnsafe(c, true)
  const lalande = { kind: 'star' as const, starId: 'lalande-21185' }
  const first = nextAutoStep(ship(c), lalande, 1)
  check('to Lalande 21185 the first leg is a stopover at Wolf 359', 'next' in first && !first.last && first.next.kind === 'star' && first.next.starId === 'wolf-359')
  useShipStore.getState().setArrivalCommand(c, { starId: 'lalande-21185', command: { kind: 'survey', starId: 'lalande-21185' } })
  check('it sets off', autoMove(ship(c), lalande, 1) === 'moved')
  check('...resting at Wolf 359 with the trip remembered', restingStarId(ship(c)) === 'wolf-359' && ship(c).autoRoute?.kind === 'star')
  check('...and what it is to do on arrival kept', ship(c).arrivalCommand?.starId === 'lalande-21185')
  const ready = ship(c).hyperdriveReadySimDays
  for (let day = 2; day < ready; day++) {
    useGameTimeStore.setState({ simDays: day })
    settleShips(day)
    resolveAutomation(day)
  }
  check('while the drive cools down it waits at the stopover', restingStarId(ship(c)) === 'wolf-359' && !!ship(c).autoRoute && !!ship(c).arrivalCommand, `ready on day ${Math.ceil(ready)}`)
  for (let day = Math.ceil(ready); day < Math.ceil(ready) + 3; day++) {
    useGameTimeStore.setState({ simDays: day })
    resolveAutomation(day)
    settleShips(day)
  }
  check('then it makes the second jump and the trip is over', systemOfShip(ship(c)) === 'lalande-21185' && !ship(c).autoRoute)
  check('the arrival command fired there', !ship(c).arrivalCommand && ship(c).surveyJob?.starId === 'lalande-21185')
  const lanes = useHyperlaneStore.getState()
  check('both lanes are charted, for Mars only', lanes.hasHyperlane(MARS, 'sol', 'wolf-359') && lanes.hasHyperlane(MARS, 'wolf-359', 'lalande-21185') && !lanes.hasHyperlane(MARS, 'sol', 'lalande-21185') && lanes.lanesOf('republic-of-venus').length === 0)

  // An automated survey's own flights go the same way (hooks/useSurveyResolver).
  fresh()
  useHyperlaneStore.setState({ lanes: {} })
  const d = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setAutomation(d, 'survey')
  useShipStore.getState().setAutomationUnsafe(d, true)
  applyShipCommand(d, { kind: 'survey', starId: 'ross-154' }, 1)
  resolveSurvey(1)
  check('an auto-survey of Ross 154 stops over at Barnard\'s Star', restingStarId(ship(d)) === 'barnards-star' && ship(d).surveyJob?.starId === 'ross-154')
  const ready2 = Math.ceil(ship(d).hyperdriveReadySimDays)
  resolveSurvey(ready2 - 1)
  check('...waits for the drive', restingStarId(ship(d)) === 'barnards-star')
  useGameTimeStore.setState({ simDays: ready2 })
  resolveSurvey(ready2)
  check('...then jumps on into the system, the job kept', systemOfShip(ship(d)) === 'ross-154' && !!ship(d).surveyJob)
  // The same job with the box off ends, with the reason.
  fresh()
  useHyperlaneStore.setState({ lanes: {} })
  const e = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setAutomation(e, 'survey')
  applyShipCommand(e, { kind: 'survey', starId: 'ross-154' }, 1)
  resolveSurvey(1)
  check('box off: the same survey is dropped where it stands, with the reason', !ship(e).surveyJob && systemOfShip(ship(e)) === 'sol' && (ship(e).automationNote ?? '').includes('Ross 154'))
  // A survey the player ordered by hand is not automation: it jumps as before.
  fresh()
  useHyperlaneStore.setState({ lanes: {} })
  const f = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  applyShipCommand(f, { kind: 'survey', starId: 'ross-154' }, 1)
  resolveSurvey(1)
  check('a survey ordered by hand still jumps straight there', systemOfShip(ship(f)) === 'ross-154')
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
