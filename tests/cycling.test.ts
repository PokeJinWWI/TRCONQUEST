// Tab / C cycling through own fleets and colonies. Run: npx tsx tests/cycling.test.ts
import { cycleColonies, cycleFleets, nextKey, ownColonyNames, ownFleets } from '../src/scene/cycling'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useViewStore } from '../src/state/viewStore'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const MARS = 'imperial-state-of-mars'

console.log('\n=== nextKey ===')
check('starts at the first with no current', nextKey(['a', 'b', 'c'], null) === 'a')
check('...or the last going back', nextKey(['a', 'b', 'c'], null, -1) === 'c')
check('steps on, wrapping', nextKey(['a', 'b', 'c'], 'c') === 'a' && nextKey(['a', 'b', 'c'], 'a') === 'b')
check('steps back, wrapping', nextKey(['a', 'b', 'c'], 'a', -1) === 'c')
check('an unknown current starts over', nextKey(['a', 'b'], 'zzz') === 'a')
check('an empty list has none', nextKey([], null) === null)

console.log('\n=== Fleets ===')
{
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false })
  useShipStore.setState({ ships: [] })
  const a = spawnOwnedShip('cruiser', MARS, 'sol', 'Mars')!
  const b = spawnOwnedShip('cruiser', 'republic-of-venus', 'sol', 'Venus')!
  const c = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  check("only the player's own fleets", ownFleets().length === 2 && !ownFleets().some((f) => f.leadShipId === b))
  cycleFleets()
  check('first press selects the first fleet', useShipStore.getState().selectedShipId === a)
  cycleFleets()
  check('next press the next', useShipStore.getState().selectedShipId === c)
  cycleFleets()
  check('...and it wraps', useShipStore.getState().selectedShipId === a)
  cycleFleets(-1)
  check('Shift goes back', useShipStore.getState().selectedShipId === c)
}

console.log('\n=== Colonies ===')
{
  const names = ownColonyNames()
  check('own worlds, including moons', names.includes('Mars') && names.includes('Phobos') && !names.includes('Venus'), names.join(','))
  useViewStore.setState({ inViewSelection: null })
  cycleColonies()
  check('C opens the first one and selects it', useViewStore.getState().inViewSelection === names[0], `${useViewStore.getState().inViewSelection}`)
  cycleColonies()
  check('...then the next', useViewStore.getState().inViewSelection === names[1])
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
