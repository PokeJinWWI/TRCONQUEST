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
import { automationsFor, pickSurveyTarget, resolveAutomation } from '../src/scene/automation'
import { systemBodies } from '../src/scene/territory'
import { settleShips } from '../src/hooks/useShipOrderSettler'
import { resolveSurvey } from '../src/hooks/useSurveyResolver'

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

function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [] })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useStarbaseStore.setState({ starbases: [] })
  useTerritoryStore.getState().reset()
  useResourceStore.setState({ byCountry: {} })
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'warp-drives', 'hyperspace-theory', 'warp-comms', 'orbital-construction']) } } })
}

console.log('\n=== 1. Which ships can be automated ===')
check('science ships survey', automationsFor('science').join() === 'survey')
check('construction ships build or refill', automationsFor('construction').join() === 'build,refill')
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
  useShipStore.getState().setAutomation(a, 'survey')
  useShipStore.getState().setAutomation(b, 'survey')
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
  check('a manual order turns automation off', !ship(a).automation && !ship(a).surveyJob)
}

console.log('\n=== 3. Construction ships: refill and build on their own ===')
{
  fresh()
  useResourceStore.getState().setAmount(MARS, 'alloys', 5000)
  const builder = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().setAutomation(builder, 'refill')
  resolveAutomation(1)
  check('at an owned world, auto-refill loads the hold from the stockpile', (ship(builder).cargo?.alloys ?? 0) >= (STARBASE_COST.alloys ?? 0), JSON.stringify(ship(builder).cargo))

  fresh()
  const hauler = spawnOwnedShip('cargo-ship', MARS, 'sol', 'Earth')!
  useShipStore.getState().setShipCargo(hauler, { alloys: 600 })
  const b2 = spawnOwnedShip('construction-ship', MARS, 'sol', 'Earth')!
  useShipStore.getState().setAutomation(b2, 'refill')
  resolveAutomation(1)
  check('away from home, a Cargo Ship in the same place tops it up', (ship(b2).cargo?.alloys ?? 0) > 0 && (ship(hauler).cargo?.alloys ?? 0) < 600, `${ship(b2).cargo?.alloys} / ${ship(hauler).cargo?.alloys}`)

  fresh()
  const b3 = spawnOwnedShip('construction-ship', MARS, 'sol', 'Earth')!
  useShipStore.getState().setAutomation(b3, 'build')
  resolveAutomation(1)
  check('with an empty hold and no Cargo Ship, auto-build flies home to load', ship(b3).arrivalCommand?.command.kind === 'load' && !!ship(b3).order)

  fresh()
  // Barnard's Star fully surveyed, two kitted builders at Mars.
  for (const body of systemBodies('barnards-star')) useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: body }, 0, 0)
  for (const body of systemBodies('alpha-centauri')) useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: body }, 0, 0)
  const x = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  const y = spawnOwnedShip('construction-ship', MARS, 'sol', 'Mars')!
  for (const id of [x, y]) {
    useShipStore.getState().setShipCargo(id, { ...STARBASE_COST })
    useShipStore.getState().setAutomation(id, 'build')
  }
  resolveAutomation(1)
  const tx = ship(x).arrivalCommand
  const ty = ship(y).arrivalCommand
  check('with a kit, it flies off to build a Starbase', tx?.command.kind === 'build-starbase' && !!ship(x).order, JSON.stringify(tx))
  check('...and the second builder picks another system', ty?.command.kind === 'build-starbase' && ty.starId !== tx?.starId, `${tx?.starId} / ${ty?.starId}`)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
