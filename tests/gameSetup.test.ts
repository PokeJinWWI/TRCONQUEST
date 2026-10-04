// What every nation starts a new game with (scene/gameSetup.ts): its navy at
// the capital, the warships already one fleet, and the starting techs.
//
// Run:  npx tsx tests/gameSetup.test.ts

import { COUNTRIES } from '../src/data/countryData'
import { STARTING_NAVY } from '../src/data/startingForces'
import { commsTierFor } from '../src/data/commsData'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { useShipStore } from '../src/state/shipStore'
import { useArmyStore } from '../src/state/armyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useTechStore } from '../src/state/techStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. The starting navy ===')
{
  useShipStore.setState({ ships: [] })
  useArmyStore.getState().reset()
  useTerritoryStore.getState().reset()
  setUpNewGame()
  const ships = useShipStore.getState().ships
  for (const c of COUNTRIES) {
    const mine = ships.filter((s) => s.ownerId === c.id)
    const warships = mine.filter((s) => resolveShipClass(s.classId)?.role === 'warship')
    const others = mine.filter((s) => resolveShipClass(s.classId)?.role !== 'warship')
    check(`${c.name} gets the whole starting navy at its capital`, mine.length === STARTING_NAVY.length && mine.every((s) => s.location.kind === 'orbiting' && s.location.bodyName === c.capitalBodyName))
    check('...its warships in ONE fleet (so an order moves them together)', warships.length > 1 && new Set(warships.map((s) => s.fleetId)).size === 1)
    check('...and its troop transport in a fleet of its own', others.length > 0 && others.every((s) => !warships.some((w) => w.fleetId === s.fleetId)))
  }
  setUpNewGame()
  check('running it again never doubles anyone\'s navy', useShipStore.getState().ships.length === ships.length)
}

console.log('\n=== 2. Starting techs ===')
{
  useTechStore.setState({ byCountry: {} })
  const fresh = useTechStore.getState().stateFor(COUNTRIES[0].id).researched
  check('a nation starts with Hyper Comms and no Warp Comms (it has a hyperdrive, not a warp drive)', commsTierFor(fresh) === 'hyper' && !fresh.has('warp-comms'))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
