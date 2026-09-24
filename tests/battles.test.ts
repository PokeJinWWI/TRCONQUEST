// The Outliner's Battles list (src/scene/battleList.ts): every battle the
// player is in, ship or ground, and only those.
//
// Run:  npx tsx tests/battles.test.ts

import { FRIENDLY_ROGUE_ID, NEUTRAL_ROGUE_ID, PIRATES_ID, SANDBOX_PLAYER_ID } from '../src/data/countryRoster'
import {
  battleKindsAtBody,
  battleKindsInSystem,
  battlesInStars,
  groundBattleDetail,
  playerGroundBattles,
  playerSpaceBattles,
  spaceBattleDetail,
  type PlayerBattle,
} from '../src/scene/battleList'
import { playerArmyGroups } from '../src/scene/armyOutliner'
import { syncEngagements } from '../src/scene/combatResolution'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { spawnSandboxArmy, startSandbox } from '../src/scene/sandboxSetup'
import { atWar } from '../src/state/diplomacyStore'
import { useArmyStore } from '../src/state/armyStore'
import { useShipStore } from '../src/state/shipStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const ME = SANDBOX_PLAYER_ID
startSandbox()

console.log('\n=== 1. Space battles ===')
{
  useShipStore.setState({ ships: [] })
  spawnOwnedShip('cruiser', ME, 'sol', 'Earth')
  spawnOwnedShip('cruiser', FRIENDLY_ROGUE_ID, 'sol', 'Earth')
  let ships = useShipStore.getState().ships
  check('no hostile ship, no battle', playerSpaceBattles(syncEngagements(ships, [], 0), ships, ME).length === 0)

  spawnOwnedShip('corvette', PIRATES_ID, 'sol', 'Earth')
  ships = useShipStore.getState().ships
  const engagements = syncEngagements(ships, [], 0)
  const battles = playerSpaceBattles(engagements, ships, ME)
  check('a hostile ship at the player\'s location makes a battle', battles.length === 1)
  check('...tagged as a space battle, at Earth, in Sol', battles[0]?.kind === 'space' && battles[0].place === 'Earth' && battles[0].starId === 'sol')
  check('...that opens its engagement', battles[0]?.engagementId === engagements[0].id)
  check('...and says how many ships are on each side', spaceBattleDetail(engagements[0], ships, ME, atWar) === '1 of yours · 1 hostile')

  // Someone else's fight elsewhere isn't the player's.
  spawnOwnedShip('cruiser', NEUTRAL_ROGUE_ID, 'sol', 'Mars')
  spawnOwnedShip('cruiser', PIRATES_ID, 'sol', 'Mars')
  ships = useShipStore.getState().ships
  const both = syncEngagements(ships, [], 0)
  check('two fights exist', both.length === 2)
  check("...but only the one with the player's ship is listed", playerSpaceBattles(both, ships, ME).length === 1)
  check('with no player there is nothing to list', playerSpaceBattles(both, ships, null).length === 0)
  useShipStore.setState({ ships: [] })
}

console.log('\n=== 2. Ground battles ===')
{
  useArmyStore.getState().reset()
  const a = spawnSandboxArmy(ME, 'assault', 'Earth')!
  spawnSandboxArmy(PIRATES_ID, 'assault', 'Earth')
  spawnSandboxArmy(PIRATES_ID, 'assault', 'Luna')
  let armies = useArmyStore.getState().armies
  check('armies apart and not firing are no battle', playerGroundBattles(armies, ME).length === 0)

  // Put the player's units in contact and mark them firing.
  armies = armies.map((army) => ({ ...army, units: army.units.map((u) => ({ ...u })) }))
  const mine = armies.find((x) => x.id === a)!
  const theirs = armies.find((x) => x.ownerId === PIRATES_ID && x.location.kind === 'body' && x.location.bodyName === 'Earth')!
  theirs.units[0].firingAtId = mine.units[0].id
  const battles = playerGroundBattles(armies, ME)
  check('an enemy firing at a unit of the player\'s makes a battle', battles.length === 1)
  check('...tagged as a ground battle on Earth in Sol', battles[0]?.kind === 'ground' && battles[0].place === 'Earth' && battles[0].bodyName === 'Earth' && battles[0].starId === 'sol')
  check("a fight on another world isn't listed", !battles.some((b) => b.place === 'Luna'))
  const lunaFight = armies.map((x) => ({ ...x, units: x.units.map((u) => ({ ...u })) }))
  lunaFight.find((x) => x.location.kind === 'body' && x.location.bodyName === 'Luna')!.units[0].firingAtId = 'someone'
  check('...even if units there are firing (not at the player)', playerGroundBattles(lunaFight, ME).every((b) => b.place !== 'Luna'))
  const detail = groundBattleDetail(armies, 'Earth', ME, atWar)
  check('the detail gives each side\'s strength on the world', detail === 'yours 100 · enemy 100', detail)
  check('with no player there is nothing to list', playerGroundBattles(armies, null).length === 0)
  useArmyStore.getState().reset()
}

console.log('\n=== 3. Where battles show on the maps ===')
{
  const space = (place: string, starId: string | undefined): PlayerBattle => ({ key: `space:${place}`, kind: 'space', place, starId, engagementId: place })
  const ground = (place: string, starId: string): PlayerBattle => ({ key: `ground:${place}`, kind: 'ground', place, starId, bodyName: place })
  const battles = [space('Earth', 'sol'), ground('Luna', 'sol'), space('Arcadia', 'alpha-centauri'), space('Deep space', undefined)]
  check('a body shows its own battles', battleKindsAtBody([space('Earth', 'sol')], 'Earth').join() === 'space')
  check("a planet also shows its moons' battles (Luna's fight is on Earth's marker)", battleKindsAtBody(battles, 'Earth').join() === 'space,ground' && battleKindsAtBody([ground('Luna', 'sol')], 'Earth').join() === 'ground')
  check("...and a moon shows only its own, not its planet's", battleKindsAtBody([space('Earth', 'sol')], 'Luna').length === 0)
  check('a body with nothing shows nothing', battleKindsAtBody(battles, 'Mars').length === 0)
  check('kinds come out in a fixed order', battleKindsAtBody([ground('Earth', 'sol'), space('Earth', 'sol')], 'Earth').join() === 'space,ground')
  check('a system shows every kind fought in it', battleKindsInSystem(battles, 'sol').join() === 'space,ground')
  check("...and not another system's", battleKindsInSystem(battles, 'sirius').length === 0)
  check('a battle in deep space belongs to no system', battleKindsInSystem(battles, 'undefined').length === 0)
  check('a neighbourhood shows the battles of the systems it holds', battlesInStars(battles, ['sol']).length === 2 && battlesInStars(battles, ['sol', 'alpha-centauri']).length === 3)
}

console.log('\n=== 4. The Outliner\'s army groups ===')
{
  useArmyStore.getState().reset()
  useShipStore.setState({ ships: [] })
  spawnSandboxArmy(ME, 'assault', 'Earth')
  spawnSandboxArmy(ME, 'assault', 'Earth')
  spawnSandboxArmy(ME, 'garrison', 'Earth')
  spawnSandboxArmy(ME, 'marine', 'Luna')
  spawnSandboxArmy(PIRATES_ID, 'assault', 'Earth')
  const transport = spawnOwnedShip('troop-transport', ME, 'sol', 'Earth')!
  const armies = useArmyStore.getState().armies
  const groups = playerArmyGroups(armies, useShipStore.getState().ships, ME)
  check("only the player's armies are listed", groups.length === 2)
  const earth = groups.find((g) => g.bodyName === 'Earth')
  check('one row per world, counting each kind', earth?.detail === '2 assault · 1 garrison', earth?.detail)
  check('moons get their own row like any world', groups.some((g) => g.bodyName === 'Luna' && g.detail === '1 marine'))
  check('a world row knows its system (to open the ground map)', earth?.starId === 'sol')
  check('nothing to list without a player', playerArmyGroups(armies, [], null).length === 0)
  // Embark one: it moves to its transport's row.
  const assault = armies.find((a) => a.ownerId === ME && a.kind === 'assault')!
  useArmyStore.getState().embark([assault.id], transport)
  const after = playerArmyGroups(useArmyStore.getState().armies, useShipStore.getState().ships, ME)
  const aboard = after.find((g) => g.shipId === transport)
  check('an embarked army is listed under its transport', aboard?.detail === '1 assault' && aboard.label.startsWith('Aboard '), aboard?.label)
  check('...and comes off its world\'s count', after.find((g) => g.bodyName === 'Earth')?.detail === '1 assault · 1 garrison')
  useArmyStore.getState().reset()
  useShipStore.setState({ ships: [] })
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
