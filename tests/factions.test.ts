// Nations in combat: every ship is owned by a nation, and who fights whom is
// exactly who is at war with whom (see src/state/shipRelations.ts,
// src/state/diplomacyStore.ts, and combatResolution.syncEngagements).
//
// Run:  npx tsx tests/factions.test.ts

import { SHIP_CLASSES } from '../src/data/shipData'
import { pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { engagementIsContested, isEnemy } from '../src/state/combatStore'
import { useDiplomacyStore, atWar, atWarFrom } from '../src/state/diplomacyStore'
import { FRIENDLY_ROGUE_ID, PIRATES_ID } from '../src/data/countryRoster'
import { usePlayerStore } from '../src/state/playerStore'
import { relationOfOwner, shipsHostile } from '../src/state/shipRelations'
import { COMBAT_STEP_DAYS, nearestEnemy, stepEngagements, syncEngagements } from '../src/scene/combatResolution'
import { startingPoint } from '../src/scene/combatArena'

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
const ORION = 'orion-republic'

function makeShip(classId: string, id: string, ownerId: string, bodyName = 'Earth'): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === classId)!
  return {
    id,
    classId,
    name: `${cls.name} ${id}`,
    ownerId,
    location: { kind: 'orbiting', systemId: 'sol', bodyName, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
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
  }
}

function freshDiplomacy() {
  useDiplomacyStore.getState().reset()
  usePlayerStore.setState({ selectedCountryId: MARS })
}

console.log('\n=== 1. Hostility is national: atWar, shipsHostile, relationOfOwner ===')
{
  freshDiplomacy()
  const m = makeShip('corvette', 'm', MARS)
  const v = makeShip('corvette', 'v', VENUS)
  check('nations start at peace', !atWar(MARS, VENUS))
  check('ships of nations at peace are not hostile', !shipsHostile(m, v))
  check("the player sees a peaceful nation's ship as neutral", relationOfOwner(VENUS, MARS) === 'neutral')
  check('...and its own ship as own', relationOfOwner(MARS, MARS) === 'own')

  const result = useDiplomacyStore.getState().declareWar(MARS, VENUS, 10)
  check('declaring war succeeds', result.ok)
  check('war is symmetric', atWar(MARS, VENUS) && atWar(VENUS, MARS))
  check('ships of nations at war ARE hostile', shipsHostile(m, v) && shipsHostile(v, m))
  check("the player now sees Venus's ship as an enemy", relationOfOwner(VENUS, MARS) === 'enemy')
  check('a nation is never at war with itself', !atWar(MARS, MARS))
  check('declaring the same war twice is refused', !useDiplomacyStore.getState().declareWar(VENUS, MARS, 11).ok)
}

console.log('\n=== 2. Three nations in Sol: Mars at war with both, Venus and Orion at peace with each other ===')
{
  freshDiplomacy()
  useDiplomacyStore.getState().declareWar(MARS, VENUS, 0)
  useDiplomacyStore.getState().declareWar(MARS, ORION, 0)
  const ships = [makeShip('cruiser', 'm1', MARS), makeShip('cruiser', 'v1', VENUS), makeShip('cruiser', 'o1', ORION)]
  const engagements = syncEngagements(ships, [], 0)
  check('one engagement forms at the shared body', engagements.length === 1)
  const e = engagements[0]
  const byId = new Map(e.participants.map((p) => [p.shipId, p]))
  const m1 = byId.get('m1')!
  const v1 = byId.get('v1')!
  const o1 = byId.get('o1')!
  check('all three nations are on the roster', !!m1 && !!v1 && !!o1)
  check('each nation gets its OWN side — three sides', new Set([m1.side, v1.side, o1.side]).size === 3)
  check("the player's nation (Mars) holds side 0", m1.side === 0)
  check('nations list maps each side back to its nation', e.nations?.[m1.side] === MARS && e.nations?.[v1.side] === VENUS && e.nations?.[o1.side] === ORION)
  check('Mars is hostile to both others', isEnemy(m1, v1) && isEnemy(m1, o1))
  check('Venus is hostile to Mars only — NOT to Orion', isEnemy(v1, m1) && !isEnemy(v1, o1))
  check('Orion is hostile to Mars only — NOT to Venus', isEnemy(o1, m1) && !isEnemy(o1, v1))
  check("Venus's nearest enemy is Mars, never Orion", nearestEnemy(v1, e.participants)?.shipId === 'm1')
  check("Orion's nearest enemy is Mars, never Venus", nearestEnemy(o1, e.participants)?.shipId === 'm1')

  const faces = [0, 1, 2].map((side) => startingPoint(side, 0, 'standard'))
  const distinct = faces.every((a, i) => faces.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1))
  check('the three sides start on three distinct faces of the arena', distinct)

  // Run the fight for a while; no ship may ever be targeting a nation it's at
  // peace with.
  let live = engagements
  let current = ships
  let violated = false
  for (let i = 0; i < 200 && live.length > 0; i++) {
    const r = stepEngagements(live, current, (i + 1) * COMBAT_STEP_DAYS, () => 0.5)
    live = r.engagements
    current = current.filter((s) => !r.destroyedShipIds.includes(s.id)).map((s) => (r.shipCombat[s.id] ? { ...s, combat: r.shipCombat[s.id] } : s))
    for (const eng of live) {
      for (const p of eng.participants) {
        if (!p.targetShipId) continue
        const target = eng.participants.find((o) => o.shipId === p.targetShipId)
        if (target && !isEnemy(p, target)) violated = true
      }
    }
  }
  check('over a real fight, no ship ever targets a nation it is at peace with', !violated)
}

console.log('\n=== 3. A nation at peace with everyone present stays out of a new fight ===')
{
  freshDiplomacy()
  useDiplomacyStore.getState().declareWar(MARS, VENUS, 0)
  const ships = [makeShip('cruiser', 'm1', MARS), makeShip('cruiser', 'v1', VENUS), makeShip('cruiser', 'o1', ORION)]
  const [e] = syncEngagements(ships, [], 0)
  check('the Mars–Venus war forms an engagement', !!e)
  check('Orion — at peace with both — is not on the roster', !e.participants.some((p) => p.shipId === 'o1'))

  const peacefulOnly = syncEngagements([makeShip('cruiser', 'v2', VENUS), makeShip('cruiser', 'o2', ORION)], [], 0)
  check('two nations at peace parked together never start a fight', peacefulOnly.length === 0)
}

console.log('\n=== 4. Diplomacy changes take effect mid-fight ===')
{
  freshDiplomacy()
  const war = useDiplomacyStore.getState().declareWar(MARS, VENUS, 0)
  const ships = [makeShip('cruiser', 'm1', MARS), makeShip('cruiser', 'v1', VENUS), makeShip('cruiser', 'o1', ORION)]
  let engagements = syncEngagements(ships, [], 0)
  // Once the fight is open, everyone at the location is on its roster.
  engagements = syncEngagements(ships, engagements, 0)
  const orionBefore = engagements[0].participants.find((p) => p.shipId === 'o1')
  check('a bystander at an open fight is on the roster but hostile to no one', !!orionBefore && orionBefore.hostileSides?.length === 0)

  useDiplomacyStore.getState().declareWar(ORION, MARS, 1)
  engagements = syncEngagements(ships, engagements, 1)
  const orionAfter = engagements[0].participants.find((p) => p.shipId === 'o1')!
  const marsAfter = engagements[0].participants.find((p) => p.shipId === 'm1')!
  check('once Orion declares war on Mars, the very next sync makes them enemies', isEnemy(orionAfter, marsAfter) && isEnemy(marsAfter, orionAfter))
  check('...and Orion stays keeping its own side, not joining Venus', orionAfter.side !== engagements[0].participants.find((p) => p.shipId === 'v1')!.side)

  // Peace between Mars and Venus: they stop being enemies immediately, and
  // an explicit target on the old enemy no longer counts.
  if (war.ok) useDiplomacyStore.getState().endWar(war.warId, 2)
  useDiplomacyStore.getState().endWar(useDiplomacyStore.getState().wars[0].id, 2)
  engagements = syncEngagements(ships, engagements, 2).map((e) => ({
    ...e,
    participants: e.participants.map((p) => (p.shipId === 'm1' ? { ...p, targetShipId: 'v1' } : p)),
  }))
  const m = engagements[0].participants.find((p) => p.shipId === 'm1')!
  const v = engagements[0].participants.find((p) => p.shipId === 'v1')!
  check('after peace, Mars and Venus are no longer enemies', !isEnemy(m, v) && !isEnemy(v, m))
  check('with every war over, the arena is no longer contested', !engagementIsContested(engagements[0]))
  const before = pristineCombatState(SHIP_CLASSES.find((c) => c.id === 'cruiser')!.combat)
  const r = stepEngagements(engagements, ships, 2 + COMBAT_STEP_DAYS * 30, () => 0.5)
  const venusHp = r.shipCombat['v1']
  check(
    "a leftover explicit target on a nation now at peace is NOT fired on",
    !venusHp || (venusHp.shieldHp >= before.shieldHp - 1e-6 && venusHp.armorHp === before.armorHp),
  )
}

console.log('\n=== 5. Truces ===')
{
  freshDiplomacy()
  const war = useDiplomacyStore.getState().declareWar(MARS, VENUS, 0)
  if (war.ok) useDiplomacyStore.getState().endWar(war.warId, 100)
  check('a peace leaves the two nations at peace', !atWar(MARS, VENUS))
  check('a new war inside the truce is refused', !useDiplomacyStore.getState().declareWar(MARS, VENUS, 200).ok)
  check('...and allowed again once the truce runs out', useDiplomacyStore.getState().declareWar(MARS, VENUS, 100 + 731).ok)
}

console.log('\n=== 6. No-nation factions: pirates and friendly irregulars ===')
{
  freshDiplomacy()
  usePlayerStore.setState({ selectedCountryId: MARS })
  check('pirates are at war with every nation', [MARS, VENUS, ORION].every((n) => atWar(PIRATES_ID, n) && atWar(n, PIRATES_ID)))
  check('...and with the friendlies', atWar(PIRATES_ID, FRIENDLY_ROGUE_ID))
  check('friendlies fight nobody else', ![MARS, VENUS, ORION].some((n) => atWar(FRIENDLY_ROGUE_ID, n)))
  check('pirates never fight pirates', !atWar(PIRATES_ID, PIRATES_ID))
  check('none of it is stored as a war', useDiplomacyStore.getState().wars.length === 0)
  check('pirates read as hostile to the player', relationOfOwner(PIRATES_ID, MARS) === 'enemy')
  check('friendlies read as allied', relationOfOwner(FRIENDLY_ROGUE_ID, MARS) === 'allied')
  check('a snapshot atWar agrees', atWarFrom({})(PIRATES_ID, VENUS) && !atWarFrom({})(FRIENDLY_ROGUE_ID, MARS))

  // Mars, Venus (at peace with each other), pirates and friendlies at one body.
  const ships = [
    makeShip('cruiser', 'm', MARS),
    makeShip('cruiser', 'v', VENUS),
    makeShip('cruiser', 'p', PIRATES_ID),
    makeShip('cruiser', 'f', FRIENDLY_ROGUE_ID),
  ]
  const [e] = syncEngagements(ships, [], 0)
  const part = (id: string) => e.participants.find((p) => p.shipId === id)!
  check('pirates spark a four-sided engagement', !!e && e.participants.length === 4 && (e.nations?.length ?? 0) === 4)
  check('everyone is the pirates\' enemy', ['m', 'v', 'f'].every((id) => isEnemy(part(id), part('p')) && isEnemy(part('p'), part(id))))
  check('...but Mars, Venus and the friendlies leave each other alone', !isEnemy(part('m'), part('v')) && !isEnemy(part('m'), part('f')) && !isEnemy(part('v'), part('f')))

  const calm = syncEngagements([makeShip('cruiser', 'm2', MARS), makeShip('cruiser', 'f2', FRIENDLY_ROGUE_ID)], [], 0)
  check('friendlies alone with Mars start no fight', calm.length === 0)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
