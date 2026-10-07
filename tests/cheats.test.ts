// The Debug Console's cheats (src/scene/cheats.ts): where a spawned ship goes (any cluster), the time jump,
// resources and influence, ending a war.
// Run:  npx tsx tests/cheats.test.ts
import { SOLAR_NEIGHBORHOOD_ID } from '../src/data/galaxyGen'
import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import { getStarsForNeighborhood } from '../src/data/starData'
import { NEAR_CLUSTER_ENTRY, NEAR_STAR, cheatAddResource, cheatEndAllWars, cheatEndWar, cheatJumpDays, defaultNear, jumpPlan, nearOptions, spawnLocation, warLabel } from '../src/scene/cheats'
import { shipClusterId } from '../src/scene/clusters'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { TEST_ENEMY, TEST_PLAYER, setUpTestNations } from './testNations'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. Spawning in any cluster ===')
{
  const foreign = NEIGHBORHOODS.find((n) => n.id !== SOLAR_NEIGHBORHOOD_ID)!
  const star = getStarsForNeighborhood(foreign.id)[0]
  check('a foreign cluster has stars to choose from (the list used to be Sol\'s only)', getStarsForNeighborhood(foreign.id).length >= 6)
  const opts = nearOptions(star.id)
  check('its list ends with the bare star and the cluster entry', opts.at(-2)?.value === NEAR_STAR && opts.at(-1)?.value === NEAR_CLUSTER_ENTRY)
  check('the default is its primary star', opts.some((o) => o.value === defaultNear(star.id)))

  const entry = spawnLocation(foreign.id, star.id, NEAR_CLUSTER_ENTRY)
  check('the entry point of a foreign cluster is on ITS map', entry.kind === 'interstellar-point' && entry.clusterId === foreign.id && shipClusterId({ order: null, location: entry }) === foreign.id)
  const home = spawnLocation(SOLAR_NEIGHBORHOOD_ID, 'sol', NEAR_CLUSTER_ENTRY)
  check('the Solar Neighbourhood\'s has no clusterId', home.kind === 'interstellar-point' && home.clusterId === undefined)
  const bare = spawnLocation(foreign.id, star.id, NEAR_STAR)
  check('at the star: a star location in that cluster', bare.kind === 'star' && shipClusterId({ order: null, location: bare }) === foreign.id)
  const orbit = spawnLocation(foreign.id, star.id, defaultNear(star.id), 90)
  check('orbiting a body of a foreign system is in that cluster', orbit.kind === 'orbiting' && orbit.phaseDeg === 90 && shipClusterId({ order: null, location: orbit }) === foreign.id)
  const sol = spawnLocation(SOLAR_NEIGHBORHOOD_ID, 'sol', 'Mars')
  check('the old case is unchanged: orbiting Mars', sol.kind === 'orbiting' && sol.systemId === 'sol' && sol.bodyName === 'Mars')
}

console.log('\n=== 2. Time jump ===')
{
  check('a jump is cut into steps of at most 10 days', jumpPlan(35).join() === '10,10,10,5')
  check('...summing to exactly what was asked', Math.abs(jumpPlan(123.5).reduce((a, b) => a + b, 0) - 123.5) < 1e-9)
  check('nothing for zero or a negative', jumpPlan(0).length === 0 && jumpPlan(-5).length === 0)
  useGameTimeStore.setState({ simDays: 100, paused: true })
  const steps = cheatJumpDays(25, 5)
  await new Promise((r) => setTimeout(r, 120))
  check('it advances the clock by exactly that, even while paused', Math.abs(useGameTimeStore.getState().simDays - 125) < 1e-9, `${steps} steps`)
  check('...and does not unpause or change the clock otherwise', useGameTimeStore.getState().paused === true)
}

console.log('\n=== 3. Resources and influence ===')
{
  cheatAddResource(TEST_PLAYER, 'alloys', 500)
  check('adds to the stockpile', useResourceStore.getState().stateFor(TEST_PLAYER).amounts.alloys === 500)
  cheatAddResource(TEST_PLAYER, 'influence', 100)
  cheatAddResource(TEST_PLAYER, 'influence', 50)
  check('influence is a resource like the rest', useResourceStore.getState().stateFor(TEST_PLAYER).amounts.influence === 150)
  cheatAddResource(TEST_PLAYER, 'alloys', -9999)
  check('taking more than there is leaves zero, never negative', useResourceStore.getState().stateFor(TEST_PLAYER).amounts.alloys === 0)
}

console.log('\n=== 4. Ending a war ===')
{
  setUpTestNations()
  const wars = () => useDiplomacyStore.getState().wars
  check('setup: one war', wars().length === 1)
  check('it has a readable label', warLabel(wars()[0]).includes(' vs '), warLabel(wars()[0]))
  check('ending an unknown war is refused', !cheatEndWar('nope'))
  check('ending the war through the real peace code', cheatEndWar(wars()[0].id) && wars().length === 0)
  useDiplomacyStore.getState().forceWar(TEST_PLAYER, TEST_ENEMY, 0)
  check('end all clears every war and says how many', cheatEndAllWars() === 1 && wars().length === 0)
  check('with none left it ends none', cheatEndAllWars() === 0)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
if (failures > 0) process.exit(1)
