// Pure-function verification of the autonomous escape behavior's star-
// picking logic (see src/hooks/useEscapeBehavior.ts). The hook itself is a
// React effect wired to store subscriptions, which isn't practical to unit
// test the way the rest of this project's pure functions are — this
// exercises the actual decision (which star counts as "safe"), and the
// timing/trigger side is verified live in the browser instead.
//
// Run:  npx tsx tests/escape.test.ts
//
// Deliberately outside `src/` for the same reason every other test file
// here is — tsconfig.app.json only includes `src`.

import { SHIP_CLASSES } from '../src/data/shipData'
import { pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { pickSafeStar, shipCurrentStarId } from '../src/hooks/useEscapeBehavior'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { STARS } from '../src/data/starData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function makeShip(classId: string, id: string, allegiance: ShipInstance['allegiance'], starId: string): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === classId)!
  return {
    id,
    classId,
    name: `${cls.name} ${id}`,
    allegiance,
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
  }
}

console.log('\n=== Escape behavior: pickSafeStar ===')
{
  const fleeingShip = makeShip('destroyer', 'p1', 'player', 'sol')

  // No hostiles anywhere — nearest OTHER star wins, current star excluded.
  const nearest = pickSafeStar(fleeingShip, 'sol', [fleeingShip])
  check('with no hostiles anywhere, picks a star that is not the current one', !!nearest && nearest.id !== 'sol', nearest?.id)
  check('picks the real nearest star (Alpha Centauri, 4.37ly) when nothing blocks it', nearest?.id === 'alpha-centauri', nearest?.id)

  // A hostile sitting at the nearest star should be skipped in favor of the
  // next-nearest clear one.
  const blocker = makeShip('cruiser', 'h1', 'hostile', 'alpha-centauri')
  const avoided = pickSafeStar(fleeingShip, 'sol', [fleeingShip, blocker])
  check('skips a star with hostile presence', avoided?.id !== 'alpha-centauri', avoided?.id)
  check('...and still lands on some other real star', !!avoided && STARS.some((s) => s.id === avoided.id), avoided?.id)

  // Friendly presence at a star should NOT disqualify it — only hostiles do.
  const friendlyThere = makeShip('cruiser', 'f1', 'friendly', 'alpha-centauri')
  const stillGoes = pickSafeStar(fleeingShip, 'sol', [fleeingShip, friendlyThere])
  check('a friendly (non-hostile) presence does not disqualify a star', stillGoes?.id === 'alpha-centauri', stillGoes?.id)

  // If every other star is hostile-occupied, there's genuinely nowhere safe.
  const everyoneElse = STARS.filter((s) => s.id !== 'sol').map((s, i) => makeShip('cruiser', `h${i}`, 'hostile', s.id))
  const nowhere = pickSafeStar(fleeingShip, 'sol', [fleeingShip, ...everyoneElse])
  check('returns null when every candidate star is hostile-occupied', nowhere === null)
}

console.log('\n=== Escape behavior: requireChartedFrom (the risk fix) ===')
{
  // This is the actual bug fix: a hyperdrive-only hull's jump to a fresh
  // star carries a ~50% loss chance (see shipPhysics.HYPERDRIVE_BASE_LOSS_
  // CHANCE) — an autonomous decision the player never asked for should
  // never gamble the ship on that. Only an already-charted lane (~10%) is
  // ever offered when the caller asks for one.
  useHyperlaneStore.setState({ lanes: [] })
  const fleeingShip = makeShip('destroyer', 'p1', 'player', 'sol') // destroyer: hyperdrive only, no warp

  const noLanesYet = pickSafeStar(fleeingShip, 'sol', [fleeingShip], 'sol')
  check('with no hyperlane charted from the current star, requiring one yields nothing', noLanesYet === null)

  // Without requiring a charted lane, the same fresh star is still findable
  // — this is exactly the difference a warp-capable hull gets to skip
  // (never needs to require one at all) and a hyperdrive-only hull doesn't.
  const withoutRequiring = pickSafeStar(fleeingShip, 'sol', [fleeingShip])
  check('...but the star is genuinely reachable, just not SAFELY reachable', withoutRequiring?.id === 'alpha-centauri')

  useHyperlaneStore.getState().addHyperlane('sol', 'alpha-centauri')
  const nowCharted = pickSafeStar(fleeingShip, 'sol', [fleeingShip], 'sol')
  check('once that lane is charted, it becomes a valid safe destination', nowCharted?.id === 'alpha-centauri')
  useHyperlaneStore.setState({ lanes: [] })
}

console.log('\n=== Escape behavior: shipCurrentStarId ===')
{
  const atStar = makeShip('destroyer', 'p1', 'player', 'sirius')
  check('a ship resting at a star resolves to that star', shipCurrentStarId(atStar) === 'sirius')

  const orbiting: ShipInstance = {
    ...atStar,
    location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 },
  }
  check('a ship orbiting a body resolves to its system id', shipCurrentStarId(orbiting) === 'sol')

  const transit: ShipInstance = { ...atStar, location: { kind: 'interstellar-point', position: [1, 2, 3] } }
  check('a ship mid-transit between stars resolves to no star', shipCurrentStarId(transit) === null)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
