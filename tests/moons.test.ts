// Moons are real destinations: a ship orbits a moon as its own place (own
// orbital superiority, landing, arena), travels to and draws at its planet at
// system scale, and circles the moon itself in the satellite view.
// Run: npx tsx tests/moons.test.ts
import { bodyLivePosition, moonParent, resolveArrivalLocation, planMoveUnchecked, satelliteShipLocalPosition } from '../src/scene/shipPhysics'
import { getMoonPosition } from '../src/scene/orbitMath'
import { getMoonsForPlanet } from '../src/scene/moonData'
import { UNITS_PER_AU } from '../src/scene/planetData'
import { hasOrbitalSuperiority, landingCheck, type ShipLike } from '../src/scene/armyLogic'
import { obstaclesForLocation } from '../src/scene/combatResolution'
import { seedBodyOwners } from '../src/scene/territory'
import { atWar, useDiplomacyStore } from '../src/state/diplomacyStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { DAYS_PER_YEAR } from '../src/state/gameTimeStore'
import type { Army } from '../src/state/armyStore'

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

console.log('\n=== 1. A moon sits on its planet at system scale ===')
{
  check('Luna is a moon of Earth', moonParent('Luna') === 'Earth')
  check('Earth is not a moon', moonParent('Earth') === undefined)
  for (const day of [0, 137, 2000]) {
    const luna = bodyLivePosition('Luna', day)
    const earth = bodyLivePosition('Earth', day)
    check(`day ${day}: Luna is at Earth, not at the Sun`, luna.distanceTo(earth) < 1e-9 && luna.length() > 0.5 * UNITS_PER_AU, `|Luna| ${luna.length().toFixed(1)}`)
  }
  check('Phobos is at Mars', bodyLivePosition('Phobos', 50).distanceTo(bodyLivePosition('Mars', 50)) < 1e-9)
}

console.log('\n=== 2. Ordering a ship to a moon ===')
{
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false })
  useShipStore.setState({ ships: [] })
  const arrival = resolveArrivalLocation({ kind: 'body', systemId: 'sol', bodyName: 'Luna' }, 'x')
  check('arriving puts the ship in orbit of Luna itself', arrival.kind === 'orbiting' && arrival.bodyName === 'Luna')
  const id = spawnOwnedShip('cruiser', MARS, 'sol', 'Mars')!
  const ship = useShipStore.getState().ships.find((s) => s.id === id)!
  const r = planMoveUnchecked(ship, { kind: 'body', systemId: 'sol', bodyName: 'Luna' }, 0)
  check('a move from Mars to Luna is a real trip', r.kind === 'order', r.kind)
  if (r.kind === 'order') {
    const end = r.order.endPosition
    const len = Math.hypot(...end)
    check('...that ends out at Earth, not at the Sun', len > 0.5 * UNITS_PER_AU, `|end| ${len.toFixed(1)}`)
    check('...and takes time', r.order.arrivalSimDays > r.order.departSimDays)
  }
}

console.log('\n=== 3. A moon orbit is its own orbit ===')
{
  useDiplomacyStore.getState().reset()
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  const orbiting = (id: string, ownerId: string, classId: string, bodyName: string): ShipLike => ({
    id,
    ownerId,
    classId,
    location: { kind: 'orbiting', systemId: 'sol', bodyName, periodDays: 1, phaseDeg: 0, inclinationDeg: 0 },
  })
  const marsAtEarth = orbiting('m1', MARS, 'cruiser', 'Earth')
  const marsAtLuna = orbiting('m2', MARS, 'cruiser', 'Luna')
  check("a Martian cruiser over Earth doesn't deny Venus Luna's orbit", hasOrbitalSuperiority(VENUS, 'Luna', [marsAtEarth], atWar))
  check('one orbiting Luna does', !hasOrbitalSuperiority(VENUS, 'Luna', [marsAtLuna], atWar))
  check("...and doesn't deny Earth's", hasOrbitalSuperiority(VENUS, 'Earth', [marsAtLuna], atWar))

  const owners = seedBodyOwners()
  check('Luna starts as Mars\'s', owners['Luna'] === MARS)
  const t = orbiting('vt', VENUS, 'troop-transport', 'Luna')
  const cargo: Army[] = [{ id: 'a1', ownerId: VENUS, kind: 'assault', location: { kind: 'embarked', shipId: 'vt' }, units: [] } as unknown as Army]
  const clear = landingCheck(t, cargo, [t, marsAtEarth], owners, {}, atWar)
  check('a Venusian transport orbiting Luna can invade Luna', clear.ok && clear.kind === 'invade' && clear.bodyName === 'Luna', JSON.stringify(clear))
  const denied = landingCheck(t, cargo, [t, marsAtLuna], owners, {}, atWar)
  check('...unless a Martian warship holds Luna\'s orbit', !denied.ok, JSON.stringify(denied))
}

console.log('\n=== 4. The arena and the satellite view ===')
{
  const obstacles = obstaclesForLocation({ kind: 'orbiting', systemId: 'sol', bodyName: 'Luna', periodDays: 1, phaseDeg: 0, inclinationDeg: 0 })
  const luna = getMoonsForPlanet('Earth').moons.find((m) => m.name === 'Luna')!
  check('a fight over Luna has Luna at its centre', obstacles.length === 1 && obstacles[0].name === 'Luna' && obstacles[0].color === luna.color)

  const moons = getMoonsForPlanet('Earth').moons
  const day = 321
  const loc = { bodyName: 'Luna', periodDays: 20, phaseDeg: 40, inclinationDeg: 0 }
  const at = satelliteShipLocalPosition(loc, 3, moons, day)
  const moonAt = getMoonPosition(luna, day / DAYS_PER_YEAR)
  const d = Math.hypot(at[0] - moonAt.x, at[1] - moonAt.y, at[2] - moonAt.z)
  check('in the satellite view a ship orbiting Luna circles Luna', Math.abs(d - (luna.visualRadius + 0.35)) < 1e-6, `distance ${d.toFixed(3)}`)
  const home = satelliteShipLocalPosition({ ...loc, bodyName: 'Earth' }, 3, moons, day)
  check('...and one orbiting Earth circles Earth', Math.abs(Math.hypot(...home) - 4.2) < 1e-6)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
