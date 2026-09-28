// Starbases: build validation, resource spend, and being sieged down by
// hostile warships (see src/scene/starbaseLogic.ts, src/state/starbaseStore.ts).
//
// Run:  npx tsx tests/starbase.test.ts

import { STARBASE_COST, STARBASE_INTEGRITY } from '../src/data/starbaseData'
import { STARBASE_LOSS_VALUE } from '../src/data/starbaseData'
import { starbaseAnchorBody, starbaseOwnersOf, stepStarbaseSieges } from '../src/scene/starbaseLogic'
import type { ShipLike } from '../src/scene/armyLogic'
import { canBuildStarbase, useStarbaseStore } from '../src/state/starbaseStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTechStore } from '../src/state/techStore'
import { useDiplomacyStore, atWar, warBetweenIn } from '../src/state/diplomacyStore'
import { recordLoss } from '../src/scene/peace'
import { scoreFor } from '../src/scene/warScore'
import { liveBodyValue } from '../src/scene/peace'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useShipStore, pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { SHIP_CLASSES } from '../src/data/shipData'
import { systemBodies } from '../src/scene/territory'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'

function reset() {
  useStarbaseStore.setState({ starbases: [] })
  useResourceStore.setState({ byCountry: {} })
  useTechStore.setState({ byCountry: {} })
  useShipStore.setState({ ships: [] })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useDiplomacyStore.getState().reset()
}
// A Construction Ship of `ownerId` resting at `starId`, carrying `cargo`.
function spawnBuilder(id: string, ownerId: string, starId: string, cargo: Partial<Record<string, number>> = STARBASE_COST): void {
  const cls = SHIP_CLASSES.find((c) => c.id === 'construction-ship')!
  const ship: ShipInstance = {
    id,
    classId: 'construction-ship',
    name: id,
    ownerId,
    location: { kind: 'star', starId, offset: [0, 0, 0] },
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
    fleetId: `solo-${id}`,
    cargo: cargo as never,
  }
  useShipStore.setState((s) => ({ ships: [...s.ships, ship] }))
}
// The whole system surveyed by `countryId` (what a science ship would have done).
function surveyAll(countryId: string, starId: string): void {
  const store = useSurveyStore.getState()
  store.discover(countryId, { kind: 'explored', starId }, 0, 0)
  for (const body of systemBodies(starId)) store.discover(countryId, { kind: 'surveyed', bodyName: body }, 0, 0)
}
function research(countryId: string) {
  useTechStore.setState((s) => ({
    byCountry: { ...s.byCountry, [countryId]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['orbital-construction']) } },
  }))
}
function orbiting(id: string, ownerId: string, classId: string, bodyName: string): ShipLike {
  return { id, ownerId, classId, location: { kind: 'orbiting', systemId: 'sol', bodyName, periodDays: 1, phaseDeg: 0, inclinationDeg: 0 } }
}

console.log('\n=== 1. Building a Starbase (Construction Ship, surveyed system, cargo) ===')
{
  reset()
  const noTech = canBuildStarbase(MARS, 'barnards-star', [], 'b1')
  check('needs Orbital Construction researched', !noTech.ok, noTech.ok ? '' : noTech.reason)

  research(MARS)
  const noShip = canBuildStarbase(MARS, 'barnards-star', [], null)
  check('needs a Construction Ship', !noShip.ok, noShip.ok ? '' : noShip.reason)
  const ghost = canBuildStarbase(MARS, 'barnards-star', [], 'nope')
  check('a ship that does not exist will not do', !ghost.ok)

  spawnBuilder('b1', MARS, 'wolf-359')
  const elsewhere = canBuildStarbase(MARS, 'barnards-star', [], 'b1')
  check('the ship has to be resting AT that star', !elsewhere.ok, elsewhere.ok ? '' : elsewhere.reason)
  check('...but the menu check still needs the tech, surveys and cargo (this one has no survey)', !canBuildStarbase(MARS, 'barnards-star', [], 'b1', { anywhere: true }).ok)

  reset()
  research(MARS)
  spawnBuilder('b1', MARS, 'barnards-star')
  const unsurveyed = canBuildStarbase(MARS, 'barnards-star', [], 'b1')
  check('refused in a system that is not fully surveyed', !unsurveyed.ok && /surveyed/.test(unsurveyed.ok ? '' : unsurveyed.reason), unsurveyed.ok ? '' : unsurveyed.reason)

  useSurveyStore.getState().discover(MARS, { kind: 'explored', starId: 'barnards-star' }, 0, 0)
  useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: systemBodies('barnards-star')[0] }, 0, 0)
  const partial = canBuildStarbase(MARS, 'barnards-star', [], 'b1')
  check('a partly surveyed system is still refused', !partial.ok)

  surveyAll(MARS, 'barnards-star')
  check('otherwise ready to build', canBuildStarbase(MARS, 'barnards-star', [], 'b1').ok)
  check("the right-click menu's check ignores where the ship is now (it flies there)", canBuildStarbase(MARS, 'barnards-star', [], 'b1', { anywhere: true }).ok)

  reset()
  research(MARS)
  spawnBuilder('poor', MARS, 'barnards-star', { alloys: 10 })
  surveyAll(MARS, 'barnards-star')
  const short = canBuildStarbase(MARS, 'barnards-star', [], 'poor')
  check('the hold has to cover the cost', !short.ok && /materials/.test(short.ok ? '' : short.reason), short.ok ? '' : short.reason)

  reset()
  research(MARS)
  spawnBuilder('theirs', VENUS, 'barnards-star')
  surveyAll(MARS, 'barnards-star')
  check("another nation's ship can't be used", !canBuildStarbase(MARS, 'barnards-star', [], 'theirs').ok)

  reset()
  research(MARS)
  useResourceStore.getState().setAmount(MARS, 'alloys', 100000)
  spawnBuilder('b1', MARS, 'barnards-star')
  surveyAll(MARS, 'barnards-star')
  const uncharted = canBuildStarbase(MARS, 'not-a-real-star', [], 'b1')
  check('refuses an uncharted/nonexistent system', !uncharted.ok, uncharted.ok ? '' : uncharted.reason)

  const r = useStarbaseStore.getState().build(MARS, 'barnards-star', 0, 'b1')
  check('build succeeds', r.ok)
  check('the stockpile is untouched (the hold pays)', useResourceStore.getState().stateFor(MARS).amounts.alloys === 100000)
  const ship = useShipStore.getState().ships[0]
  check('the hold is spent', (ship.cargo?.alloys ?? 0) === 0 && (ship.cargo?.energy ?? 0) === 0)
  check('the Construction Ship is NOT consumed', useShipStore.getState().ships.length === 1)
  const sb = useStarbaseStore.getState().starbases[0]
  check('starts at full integrity, not yet active (build time)', sb.integrity === STARBASE_INTEGRITY && sb.readySimDays > 0)

  const again = useStarbaseStore.getState().build(MARS, 'barnards-star', 0, 'b1')
  check("can't build a second one of your own in the same system", !again.ok)

  // Reuse: resupply the same ship and build again elsewhere.
  useShipStore.setState({ ships: [{ ...useShipStore.getState().ships[0], cargo: { ...STARBASE_COST } as never, location: { kind: 'star', starId: 'wolf-359', offset: [0, 0, 0] } }] })
  surveyAll(MARS, 'wolf-359')
  check('the same ship can build again once resupplied', useStarbaseStore.getState().build(MARS, 'wolf-359', 0, 'b1').ok && useStarbaseStore.getState().starbases.length === 2)
}

console.log('\n=== 2. Territory claim ===')
{
  reset()
  research(MARS)
  spawnBuilder('b1', MARS, 'barnards-star')
  surveyAll(MARS, 'barnards-star')
  useStarbaseStore.getState().build(MARS, 'barnards-star', 0, 'b1')
  check('an active Starbase claims its system for its owner', starbaseOwnersOf('barnards-star', useStarbaseStore.getState().starbases, 100).includes(MARS))
  check("...but not before it's finished building", starbaseOwnersOf('barnards-star', useStarbaseStore.getState().starbases, 0).length === 0)
}

console.log("\n=== 3. An enemy Starbase already claiming a system can't just be built over ===")
{
  reset()
  research(MARS)
  research(VENUS)
  spawnBuilder('bm', MARS, 'barnards-star')
  spawnBuilder('bv', VENUS, 'barnards-star')
  surveyAll(MARS, 'barnards-star')
  surveyAll(VENUS, 'barnards-star')
  useStarbaseStore.getState().build(MARS, 'barnards-star', 0, 'bm')
  useDiplomacyStore.getState().declareWar(MARS, VENUS, 0)
  const blocked = canBuildStarbase(VENUS, 'barnards-star', useStarbaseStore.getState().starbases, 'bv')
  check('refused while at war with the nation already claiming it by Starbase', !blocked.ok, blocked.ok ? '' : blocked.reason)
}

console.log('\n=== 4. Sieging a Starbase down ===')
{
  reset()
  research(MARS)
  spawnBuilder('b1', MARS, 'sol')
  useStarbaseStore.getState().build(MARS, 'sol', 0, 'b1')
  const sb = useStarbaseStore.getState().starbases[0]
  const anchor = starbaseAnchorBody('sol')
  check('a Starbase at Sol stands at a real, named body (its own star)', !!anchor)

  const noHostiles = stepStarbaseSieges(30, [{ ...sb, readySimDays: 0 }], [], atWar, 100)
  check('no ships present, no damage', Object.keys(noHostiles.damaged).length === 0)

  const friendly: ShipLike[] = [orbiting('s1', MARS, 'cruiser', anchor!)]
  const noWar = stepStarbaseSieges(30, [{ ...sb, readySimDays: 0 }], friendly, atWar, 100)
  check("its own nation's ships never damage it", Object.keys(noWar.damaged).length === 0)

  useDiplomacyStore.getState().declareWar(MARS, VENUS, 0)
  const hostile: ShipLike[] = [orbiting('s2', VENUS, 'cruiser', anchor!)]
  const sieged = stepStarbaseSieges(1, [{ ...sb, readySimDays: 0 }], hostile, atWar, 100)
  check('a hostile warship at its star grinds its integrity down', (sieged.damaged[sb.id] ?? STARBASE_INTEGRITY) < STARBASE_INTEGRITY)

  const finished = stepStarbaseSieges(1000, [{ ...sb, readySimDays: 0 }], hostile, atWar, 100)
  check('...and destroys it outright given enough time', finished.destroyedIds.includes(sb.id))

  useStarbaseStore.setState({ starbases: [{ ...sb, readySimDays: 0 }] })
  useStarbaseStore.getState().applyDamage(finished.damaged, finished.destroyedIds)
  check('the store actually removes a destroyed Starbase', useStarbaseStore.getState().starbases.length === 0)
  check('...and its claim falls with it', starbaseOwnersOf('sol', useStarbaseStore.getState().starbases, 1000).length === 0)
}

console.log('\n=== 5. Destroying a Starbase moves the war score (scene/peace.recordLoss) ===')
{
  reset()
  useTerritoryStore.getState().reset()
  useDiplomacyStore.getState().declareWar(MARS, VENUS, 0)
  const war = warBetweenIn(useDiplomacyStore.getState().wars, MARS, VENUS)!
  const before = scoreFor(war, MARS, useTerritoryStore.getState().bodyOwner, useTerritoryStore.getState().bodyController, liveBodyValue)
  recordLoss(VENUS, [MARS], STARBASE_LOSS_VALUE)
  const afterWar = warBetweenIn(useDiplomacyStore.getState().wars, MARS, VENUS)!
  const after = scoreFor(afterWar, MARS, useTerritoryStore.getState().bodyOwner, useTerritoryStore.getState().bodyController, liveBodyValue)
  check("Venus losing a Starbase to Mars' fleet improves Mars' war score", after > before, `${before} -> ${after}`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
