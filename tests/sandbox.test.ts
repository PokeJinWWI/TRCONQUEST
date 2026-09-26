// The sandbox: a game with no nations, where the player is a no-nation
// faction and everything else is friendly, neutral or hostile to them (see
// src/scene/sandboxSetup.ts, data/countryRoster.ts's factions,
// state/diplomacyStore.rogueHostility, and scene/scenarioLoader.ts).
//
// Run:  npx tsx tests/sandbox.test.ts

import { ARMY_KINDS } from '../src/data/armyData'
import { ARMY_SCENARIOS } from '../src/data/armyScenarios'
import {
  FRIENDLY_ROGUE_ID,
  NEUTRAL_ROGUE_ID,
  PIRATES_ID,
  SANDBOX_OWNER_BY_RELATION,
  SANDBOX_PLAYER_ID,
  SANDBOX_RELATIONS,
  isRogueFaction,
  ownerDisplay,
} from '../src/data/countryRoster'
import { COUNTRIES } from '../src/data/countryData'
import { SCENARIOS } from '../src/data/scenarios'
import { SHIP_CLASSES } from '../src/data/shipData'
import { armiesOnBody, type Army } from '../src/scene/armyLogic'
import { COMBAT_STEP_DAYS, stepEngagements, syncEngagements } from '../src/scene/combatResolution'
import { cellsToRad, groundSurface, landedUnits } from '../src/scene/groundLogic'
import { stepGroundWar } from '../src/scene/groundResolution'
import { currentScenarioOwners, loadArmyScenario, loadShipScenario } from '../src/scene/scenarioLoader'
import { SANDBOX_SPAWN_SPACING_CELLS, clearSandboxArmies, clearSandboxShips, spawnSandboxArmy, startSandbox } from '../src/scene/sandboxSetup'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { arc } from '../src/scene/surfaceMesh'
import { isEnemy } from '../src/state/combatStore'
import { atWar, atWarFrom, useDiplomacyStore } from '../src/state/diplomacyStore'
import { useArmyStore } from '../src/state/armyStore'
import { usePlayerStore, isSandbox } from '../src/state/playerStore'
import { isPlayerOwned, relationOfOwner } from '../src/state/shipRelations'
import { useShipStore } from '../src/state/shipStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useViewStore } from '../src/state/viewStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const ME = SANDBOX_PLAYER_ID

console.log('\n=== 1. Starting the sandbox ===')
{
  check('a normal game is not a sandbox', !isSandbox())
  startSandbox()
  check('the sandbox flag is set', isSandbox())
  check("the player is a faction, not a nation", usePlayerStore.getState().selectedCountryId === ME && !COUNTRIES.some((c) => c.id === ME))
  check('...which the game knows is a no-nation faction', isRogueFaction(ME))
  check('nobody owns any territory', Object.keys(useTerritoryStore.getState().bodyOwner).length === 0)
  check('nobody occupies anything', Object.keys(useTerritoryStore.getState().bodyController).length === 0)
  check('there are no wars', useDiplomacyStore.getState().wars.length === 0)
  check('there are no armies to begin with', useArmyStore.getState().armies.length === 0)
  check(
    'the view opens on Earth in Sol',
    useViewStore.getState().level === 'system' && useViewStore.getState().selectedStarId === 'sol' && useViewStore.getState().inViewSelection === 'Earth',
  )
  check('the player is named as such', ownerDisplay(ME).name === 'Sandbox Commander')
  // A later normal game still works.
  usePlayerStore.getState().selectCountry(MARS)
  check('picking a nation afterwards leaves the sandbox', !isSandbox() && usePlayerStore.getState().selectedCountryId === MARS)
  startSandbox()
}

console.log('\n=== 2. Who fights whom: fixed by faction, no wars stored ===')
{
  const own = SANDBOX_OWNER_BY_RELATION.own
  const friendly = SANDBOX_OWNER_BY_RELATION.friendly
  const neutral = SANDBOX_OWNER_BY_RELATION.neutral
  const hostile = SANDBOX_OWNER_BY_RELATION.hostile
  check('the four relations map to four distinct factions', new Set([own, friendly, neutral, hostile]).size === 4)
  check('own = the sandbox player, friendly, neutral, hostile = pirates', own === ME && friendly === FRIENDLY_ROGUE_ID && neutral === NEUTRAL_ROGUE_ID && hostile === PIRATES_ID)
  check('all four are recognised factions', [own, friendly, neutral, hostile].every(isRogueFaction))
  check('and there are exactly four relations', SANDBOX_RELATIONS.length === 4)

  check('the hostile are at war with the player', atWar(hostile, own) && atWar(own, hostile))
  check('...with the friendly', atWar(hostile, friendly) && atWar(friendly, hostile))
  check('...and with the neutral', atWar(hostile, neutral) && atWar(neutral, hostile))
  check('the friendly are at war with no one else', !atWar(friendly, own) && !atWar(friendly, neutral))
  check('the neutral are at war with no one else', !atWar(neutral, own) && !atWar(neutral, friendly))
  check('the player is at war with no one but the hostile', !atWar(own, friendly) && !atWar(own, neutral))
  check('nobody is at war with themselves (the hostile included)', [own, friendly, neutral, hostile].every((f) => !atWar(f, f)))
  check('a snapshot atWar agrees', atWarFrom({})(hostile, own) && !atWarFrom({})(friendly, own) && !atWarFrom({})(neutral, friendly))
  check('none of it is stored as a war', useDiplomacyStore.getState().wars.length === 0)

  check('the player sees their own as own', relationOfOwner(own, ME) === 'own')
  check('...the friendly as allied', relationOfOwner(friendly, ME) === 'allied')
  check('...the neutral as neutral', relationOfOwner(neutral, ME) === 'neutral')
  check('...the hostile as enemy', relationOfOwner(hostile, ME) === 'enemy')
  check('the four have four different colours', new Set([own, friendly, neutral, hostile].map((f) => ownerDisplay(f).color)).size === 4)
}

console.log('\n=== 3. Ownership: only your own is yours to command ===')
{
  useShipStore.setState({ ships: [] })
  const mine = spawnOwnedShip('cruiser', ME, 'sol', 'Earth')!
  const theirs = spawnOwnedShip('cruiser', PIRATES_ID, 'sol', 'Earth')!
  const ships = useShipStore.getState().ships
  check('ships of the sandbox factions spawn', ships.length === 2)
  check('the player commands their own', isPlayerOwned(ships.find((s) => s.id === mine)!))
  check("...and not the hostile's", !isPlayerOwned(ships.find((s) => s.id === theirs)!))
  for (const id of ['friendly', 'neutral'] as const) {
    const shipId = spawnOwnedShip('cruiser', SANDBOX_OWNER_BY_RELATION[id], 'sol', 'Earth')!
    check(`...nor the ${id}'s`, !isPlayerOwned(useShipStore.getState().ships.find((s) => s.id === shipId)!))
  }
  clearSandboxShips()
  check('clearing removes every ship', useShipStore.getState().ships.length === 0)
}

console.log('\n=== 4. Ships: the fights the four factions have ===')
{
  useShipStore.setState({ ships: [] })
  const at = (owner: string) => spawnOwnedShip('cruiser', owner, 'sol', 'Earth')
  const ids = { own: at(ME)!, friendly: at(FRIENDLY_ROGUE_ID)!, neutral: at(NEUTRAL_ROGUE_ID)!, hostile: at(PIRATES_ID)! }
  const [e] = syncEngagements(useShipStore.getState().ships, [], 0)
  const part = (id: string) => e.participants.find((p) => p.shipId === id)!
  check('hostile ships spark a four-sided fight', !!e && e.participants.length === 4 && (e.nations?.length ?? 0) === 4)
  check('the hostile are everyone\'s enemy', (['own', 'friendly', 'neutral'] as const).every((r) => isEnemy(part(ids[r]), part(ids.hostile)) && isEnemy(part(ids.hostile), part(ids[r]))))
  check('yours, the friendly and the neutral leave each other alone', !isEnemy(part(ids.own), part(ids.friendly)) && !isEnemy(part(ids.own), part(ids.neutral)) && !isEnemy(part(ids.friendly), part(ids.neutral)))
  check("you're on side 0 (the player's side)", part(ids.own).side === 0)

  useShipStore.setState({ ships: [] })
  at(ME)
  at(FRIENDLY_ROGUE_ID)
  at(NEUTRAL_ROGUE_ID)
  check('without the hostile there is no fight at all', syncEngagements(useShipStore.getState().ships, [], 0).length === 0)

  // The fight actually runs: your cruiser against a hostile corvette (the
  // easy scenario's matchup — the cruiser wins on defaults every time).
  useShipStore.setState({ ships: [] })
  at(ME)
  spawnOwnedShip('corvette', PIRATES_ID, 'sol', 'Earth')
  let engagements = syncEngagements(useShipStore.getState().ships, [], 0)
  const alive = new Map(useShipStore.getState().ships.map((s) => [s.id, s]))
  let seed = 7
  const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  let steps = 0
  for (; steps < 5000 && engagements.length > 0; steps++) {
    const result = stepEngagements(engagements, [...alive.values()], (steps + 1) * COMBAT_STEP_DAYS, rng)
    for (const id of result.destroyedShipIds) alive.delete(id)
    for (const id of result.disengagedShipIds) alive.delete(id)
    for (const [id, combat] of Object.entries(result.shipCombat)) {
      const ship = alive.get(id)
      if (ship) alive.set(id, { ...ship, combat })
    }
    engagements = result.engagements
  }
  check(
    'a fight between yours and a hostile ship is fought to a finish, and yours wins',
    alive.size === 1 && [...alive.values()][0].ownerId === ME,
    `${alive.size} ship(s) left after ${steps} steps`,
  )
  clearSandboxShips()
}

console.log('\n=== 5. Armies: placing them, and who fights ===')
{
  clearSandboxArmies()
  const a = spawnSandboxArmy(ME, 'assault', 'Earth')
  const b = spawnSandboxArmy(PIRATES_ID, 'assault', 'Earth')
  const c = spawnSandboxArmy(FRIENDLY_ROGUE_ID, 'marine', 'Earth')
  const d = spawnSandboxArmy(NEUTRAL_ROGUE_ID, 'garrison', 'Earth')
  check('armies of all four factions can be placed', !!a && !!b && !!c && !!d)
  const armies = useArmyStore.getState().armies
  check('...owned by whom they were placed for', armies.find((x) => x.id === a)!.ownerId === ME && armies.find((x) => x.id === b)!.ownerId === PIRATES_ID)
  check('...on the ground', armiesOnBody(armies, 'Earth').length === 4)

  // Spaced out: no unit of one army within the spacing of another's.
  const surface = groundSurface('Earth', useTerritoryStore.getState().bodyOwner)!
  const units = landedUnits(armies, 'Earth')
  let nearest = Infinity
  for (const u of units) for (const v of units) if (u.army.id !== v.army.id) nearest = Math.min(nearest, arc(u.unit.position!, v.unit.position!))
  check(
    'placed armies keep clear of one another',
    nearest > cellsToRad(SANDBOX_SPAWN_SPACING_CELLS) - 1e-9,
    `${(nearest / cellsToRad(1)).toFixed(1)} cells apart at the closest`,
  )
  check('every unit stands on ground it can', units.every((u) => !!u.unit.position) && !!surface)
  check('a star has no ground to place an army on', spawnSandboxArmy(ME, 'assault', 'Sun') === null)

  // Nobody fights until someone is within reach — and then only the hostile.
  const closeUp = (ownerA: string, ownerB: string): Army[] => {
    clearSandboxArmies()
    const x = spawnSandboxArmy(ownerA, 'assault', 'Earth')!
    const y = spawnSandboxArmy(ownerB, 'assault', 'Earth')!
    const list = useArmyStore.getState().armies.map((army) => ({ ...army, units: army.units.map((u) => ({ ...u })) }))
    // Stand y's units right on x's.
    const ax = list.find((l) => l.id === x)!
    const ay = list.find((l) => l.id === y)!
    ay.units.forEach((u, i) => (u.position = { ...ax.units[i % ax.units.length].position! }))
    return list
  }
  const surfaceOf = (body: string) => groundSurface(body, {})
  const fight = (list: Army[]) =>
    stepGroundWar({ armies: list, owners: {}, controllers: {}, nodeHolders: {}, atWar, isAutonomous: (id) => id !== ME, surfaceOf }, 0, 10)
  const strength = (list: Army[], owner: string) => list.filter((l) => l.ownerId === owner).flatMap((l) => l.units).reduce((s, u) => s + u.strength, 0)
  const vsHostile = fight(closeUp(ME, PIRATES_ID))
  check('your army and a hostile army in contact fight', strength(vsHostile.armies, ME) < 100 && strength(vsHostile.armies, PIRATES_ID) < 100)
  for (const other of [FRIENDLY_ROGUE_ID, NEUTRAL_ROGUE_ID]) {
    const calm = fight(closeUp(ME, other))
    check(`your army and a ${other === FRIENDLY_ROGUE_ID ? 'friendly' : 'neutral'} one in contact do not`, strength(calm.armies, ME) === 100 && strength(calm.armies, other) === 100)
  }
  const friendsFight = fight(closeUp(FRIENDLY_ROGUE_ID, PIRATES_ID))
  check('the friendly fight the hostile too', strength(friendsFight.armies, FRIENDLY_ROGUE_ID) < 100)
  clearSandboxArmies()
  check('clearing removes every army', useArmyStore.getState().armies.length === 0)
  check('all kinds of army can be spawned', (Object.keys(ARMY_KINDS) as (keyof typeof ARMY_KINDS)[]).every((k) => !!spawnSandboxArmy(ME, k, 'Earth')))
  clearSandboxArmies()
}

console.log('\n=== 6. Scenarios load into the sandbox against the pirates ===')
{
  startSandbox()
  const owners = currentScenarioOwners()
  check('scenario roles resolve to the player and the pirates', owners?.player === ME && owners?.enemy === PIRATES_ID)

  let badScenario = false
  for (const scenario of SCENARIOS) {
    loadShipScenario(scenario, owners!)
    const ships = useShipStore.getState().ships
    const mine = ships.filter((s) => s.ownerId === ME).length
    const theirs = ships.filter((s) => s.ownerId === PIRATES_ID).length
    if (mine !== scenario.ships.filter((s) => s.role === 'player').length || theirs !== scenario.ships.filter((s) => s.role === 'enemy').length) {
      badScenario = true
      console.log(`  FAIL  ${scenario.id}: loads its ships — ${mine} vs ${theirs}`)
    }
  }
  check('every ship scenario loads the right ships', !badScenario)
  const first = SCENARIOS[0]
  loadShipScenario(first, owners!)
  check('a ship scenario replaces what was on the board', useShipStore.getState().ships.length === first.ships.length)
  check('...and stores no war (the pirates are hostile by definition)', useDiplomacyStore.getState().wars.length === 0)
  check('...and starts the fight', syncEngagements(useShipStore.getState().ships, [], 0).length === 1)
  clearSandboxShips()

  spawnSandboxArmy(FRIENDLY_ROGUE_ID, 'assault', 'Mars')
  for (const scenario of ARMY_SCENARIOS) {
    const r = loadArmyScenario(scenario, owners!)
    const armies = useArmyStore.getState().armies
    check(`${scenario.id}: loads`, r.ok && armies.length === scenario.player.length + scenario.enemy.length, r.ok ? r.bodyName : r.reason)
    check(
      `${scenario.id}: your armies are yours, the enemy's are the pirates'`,
      armies.filter((a) => a.ownerId === ME).length === scenario.player.length && armies.filter((a) => a.ownerId === PIRATES_ID).length === scenario.enemy.length,
    )
  }
  check('an army scenario replaces the armies that were on the board', !useArmyStore.getState().armies.some((a) => a.ownerId === FRIENDLY_ROGUE_ID))
  check('...and opens the ground map on the battlefield', useViewStore.getState().level === 'ground' && useViewStore.getState().selectedBodyName === ARMY_SCENARIOS[ARMY_SCENARIOS.length - 1].battlefield.bodyName)
  check('...with no wars stored', useDiplomacyStore.getState().wars.length === 0)
  check(
    "the ship classes scenarios use all exist",
    SCENARIOS.every((s) => s.ships.every((sh) => SHIP_CLASSES.some((c) => c.id === sh.classId))),
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
