// Pure-function verification of the combat system.
//
// Run:  npx tsx tests/combat.test.ts
//
// This is the PRIMARY verification path for combat. The browser sandbox
// can't reliably render a second WebGL context, and real wall-clock time
// advances between agent tool calls, so timing-sensitive combat behavior is
// asserted here rather than observed live. Every RNG-dependent check uses a
// seeded generator so outcomes are reproducible.
//
// Deliberately outside `src/` — tsconfig.app.json only includes `src`, so
// this never enters the app typecheck or the production bundle.
import { SHIP_CLASSES, TURING_HYPERDRIVE_COOLDOWN_DAYS, type HyperDrive } from '../src/data/shipData'
import { DAMAGE_PROFILES, WEAPON_TYPES, CORE_DAMAGE_MAX_RISK_BONUS, ACTIVE_ENGAGEMENT_RISK_BONUS, coreDamageRiskBonus, type WeaponMount } from '../src/data/combatData'
import { pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { useCombatStore } from '../src/state/combatStore'
import {
  applyShot,
  ftlChargeSeconds,
  overallHealthFraction,
  shipCombatProfile,
  stepEngagements,
  syncEngagements,
  planFtlCharge,
  orderParticipantTo,
  activeEnemyContacts,
  isActivelyEngaged,
  integrateMotion,
  participantArenaPosition,
  participantSpeed,
  stanceDestination,
  COMBAT_STEP_DAYS,
  COMBAT_STEP_SECONDS,
} from '../src/scene/combatResolution'
import {
  arenaDistance,
  latticePath,
  startingPoint,
  pointDistance,
  isInsideWindow,
  segmentClearsObstacles,
  hasLineOfFire,
  arenaBodyRadius,
  ARENA_ORIGIN,
  ARENA_LIGHT_SPEED_UNITS_PER_SECOND,
  GRID_DIVISIONS,
  GRID_DENSITIES,
  ARENA_SPAN_UNITS,
  PLACEMENT_DENSITY,
  gridSpacing,
  snapToLatticeNode,
  pickLatticeNode,
  type ArenaPoint,
  type CombatObstacle,
} from '../src/scene/combatArena'
import { arrowWings } from '../src/scene/routeArrow'
import {
  TACTICAL_SPEED_MULTIPLIERS,
  NORMAL_SPEED_MULTIPLIERS,
  useGameTimeStore,
  simDaysToSeconds,
  simSecondsToDays,
} from '../src/state/gameTimeStore'
import { hyperdriveLossChance, warpEscapeLossChance, coreHealthFraction, planMove } from '../src/scene/shipPhysics'
import { Vector3, PerspectiveCamera } from 'three'

function nodesEqualLocal(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function makeShip(classId: string, id: string, allegiance: ShipInstance['allegiance'], bodyName = 'Earth'): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === classId)!
  return {
    id,
    classId,
    name: `${cls.name} ${id}`,
    allegiance,
    location: { kind: 'orbiting', systemId: 'sol', bodyName, periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: false,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(cls.combat),
    stance: 'balanced',
  }
}

function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

console.log('\n=== 1. Damage matrix (unaffected by the position-model rewrite) ===')
{
  const cruiser = SHIP_CLASSES.find((c) => c.id === 'cruiser')!
  const profile = cruiser.combat
  const never = () => 1
  const laser: WeaponMount = { ...WEAPON_TYPES.laser, damage: 100 }
  const driver: WeaponMount = { ...WEAPON_TYPES.massDriver, damage: 100 }
  const target = pristineCombatState(profile)
  const energyHit = applyShot(laser, 100, target, profile, null, never)
  const kineticHit = applyShot(driver, 100, target, profile, null, never)
  check('energy soaked by shields (0.5x)', Math.abs(energyHit.outcome.shieldDamage - 50) < 0.001)
  check('kinetic tears through shields (1.5x)', Math.abs(kineticHit.outcome.shieldDamage - 150) < 0.001)
  check('torpedoes/missiles bypass shields', DAMAGE_PROFILES.torpedo.bypassesShields && DAMAGE_PROFILES.missile.bypassesShields)
}

console.log('\n=== 2. Lattice pathfinding primitives (still index-space, unaffected) ===')
{
  const density = 'standard' as const
  const a = { x: 0, y: 0, z: 0 }
  const b = { x: 3, y: 3, z: 3 }
  const path = latticePath(a, b, density)
  check('diagonal path takes 3 hops, not 9', path.length === 3, `hops: ${path.length}`)
  const faceHop = arenaDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, density)
  const bodyDiag = arenaDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, density)
  check('body diagonal costs sqrt(3)x a face hop', Math.abs(bodyDiag / faceHop - Math.sqrt(3)) < 1e-9)
}

console.log('\n=== 3. Real-coordinate positions: engagements form with obstacles anchored at real points ===')
{
  const simDays = 100
  const a = makeShip('cruiser', 'p1', 'player', 'Earth')
  const b = makeShip('cruiser', 'e1', 'hostile', 'Earth')
  const engs = syncEngagements([a, b], [], simDays)
  check('one engagement formed', engs.length === 1)
  check('body placed at the arena origin', nodesEqualLocal(engs[0].obstacles[0].position, ARENA_ORIGIN))
  check('window starts centred on the origin too', nodesEqualLocal(engs[0].center, ARENA_ORIGIN))
  const p1 = engs[0].participants.find((p) => p.shipId === 'p1')!
  check('spawn position is a real point, not a lattice index', typeof p1.position.x === 'number' && Number.isFinite(p1.position.x))
  const opening = pointDistance(p1.position, engs[0].participants.find((p) => p.shipId === 'e1')!.position)
  check('opening separation is the full arena span (12 units)', Math.abs(opening - 12) < 1e-9, `${opening.toFixed(2)}`)
}

console.log('\n=== 4. THE FIX: density switch does not move anything ===')
{
  // This is the regression the whole rewrite targets: switching density used
  // to remap every stored position through a round-trip that snapped to the
  // nearest node of the NEW spacing — a real jump whenever the ship wasn't
  // already exactly on a multiple of that spacing (routine). Positions are
  // now real and density-independent, so a switch should move NOTHING.
  const simDays = 100
  const a = makeShip('frigate', 'p1', 'player', 'Earth')
  const b = makeShip('cruiser', 'e1', 'hostile', 'Earth')
  let engs = syncEngagements([a, b], [], simDays)
  // Put the player ship somewhere that is deliberately NOT a multiple of a
  // coarse spacing unit (coarse spacing = 12/4 = 3), so a remap-based old
  // implementation would have snapped it and this test would fail loudly.
  const awkward = { x: 1.7, y: -2.3, z: 4.1 }
  engs = [
    {
      ...engs[0],
      density: 'fine',
      participants: engs[0].participants.map((p) => (p.shipId === 'p1' ? { ...p, position: awkward } : p)),
    },
  ]
  const store = useCombatStore
  store.setState({ engagements: engs })
  store.getState().setDensity(engs[0].id, 'coarse')
  const after = store.getState().engagements[0].participants.find((p) => p.shipId === 'p1')!
  check(
    'position survives a density switch exactly, no snap',
    pointDistance(after.position, awkward) < 1e-9,
    `before ${JSON.stringify(awkward)}, after ${JSON.stringify(after.position)}`,
  )
  store.getState().setDensity(engs[0].id, 'fine')
  const afterBack = store.getState().engagements[0].participants.find((p) => p.shipId === 'p1')!
  check('...and switching again, and again', pointDistance(afterBack.position, awkward) < 1e-9)
}

console.log('\n=== 5. "Nodes are simply a pathfinding tool": unobstructed moves go anywhere, not just intersections ===')
{
  // No obstacles at all here (deliberately not going through an
  // orbit-a-body engagement, which would put a planet in the arena) — this
  // isolates the "nothing in the way" case from the "something in the way"
  // case covered in section 6.
  //
  // NOTE this is the MOVEMENT primitive, which still accepts any real point.
  // Clicking is a separate layer that resolves a cursor to a lattice node
  // before calling this (section 27) — the lattice constrains what the player
  // can ask for, not what a ship is capable of occupying.
  const participant = {
    shipId: 'p1', side: 0 as const, position: { x: -4, y: -4, z: -4 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0, path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  // A destination deliberately off any coarse/standard/fine intersection.
  const offGrid = { x: 0.37, y: -1.91, z: 2.66 }
  const ordered = orderParticipantTo(participant, offGrid, 'standard', 0, [])
  check('unobstructed order is a single direct hop', ordered.path.length === 1, `${ordered.path.length} waypoints`)
  check('the ship can rest EXACTLY on the clicked point, not the nearest node', pointDistance(ordered.path[0], offGrid) < 1e-9)
}

console.log('\n=== 6. Obstructed moves detour via the lattice, but land exactly on the requested point ===')
{
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2 }
  const from = { x: 0, y: 0, z: -4 }
  const to = { x: 0.42, y: 0.11, z: 4 } // off-grid, but the straight line clips Earth
  const density = 'standard' as const
  check('the direct segment really is blocked', !segmentClearsObstacles(new Vector3(...Object.values(from)), new Vector3(...Object.values(to)), [earth], 0.6))
  const participant = {
    shipId: 'p1', side: 0 as const, position: from, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  const ordered = orderParticipantTo(participant, to, density, 0, [earth])
  check('a multi-waypoint detour was planned', ordered.path.length > 1, `${ordered.path.length} waypoints`)
  check('no waypoint passes through the body', ordered.path.every((wp) => pointDistance(wp, ARENA_ORIGIN) >= 1.2))
  check(
    'the FINAL waypoint is the exact requested point, not a lattice-snapped one',
    pointDistance(ordered.path[ordered.path.length - 1], to) < 1e-9,
  )
}

console.log('\n=== 7. Celestial bodies still block line of fire (Phase 3 behavior preserved) ===')
{
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2 }
  const near = new Vector3(0, 0, -3)
  const far = new Vector3(0, 0, 3)
  const side = new Vector3(3, 0, -3)
  check('opposite sides of the body cannot see each other', !hasLineOfFire(near, far, [earth]))
  check('same side, can', hasLineOfFire(near, side, [earth]))
}

console.log('\n=== 8. A full battle still resolves from a cold start ===')
{
  useCombatStore.setState({ engagements: [], viewedEngagementId: null })
  let simDays = 100
  let ships = [makeShip('cruiser', 'p1', 'player'), makeShip('battleship', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  const opening = pointDistance(engagements[0].participants[0].position, engagements[0].participants[1].position)
  check('fleets start out of every weapon range', Math.abs(opening - 12) < 1e-9)
  const rng = seededRng(7)
  let steps = 0
  let destroyed: string[] = []
  while (engagements.length > 0 && steps < 20000) {
    simDays += COMBAT_STEP_DAYS
    steps++
    const result = stepEngagements(engagements, ships, simDays, rng)
    engagements = result.engagements
    ships = ships.filter((s) => !result.destroyedShipIds.includes(s.id)).map((s) => (result.shipCombat[s.id] ? { ...s, combat: result.shipCombat[s.id] } : s))
    destroyed = [...destroyed, ...result.destroyedShipIds]
  }
  check('the battle ended', engagements.length === 0)
  check('exactly one ship died', destroyed.length === 1, destroyed.join(','))
}

console.log('\n=== 9. FTL charge timing (unaffected) ===')
{
  check('hyperdrive charges in 5s at full utility', ftlChargeSeconds('hyperdrive', 1) === 5)
  check('half-wrecked utility doubles the charge', ftlChargeSeconds('hyperdrive', 0.5) === 10)
  check('dead utility makes escape impossible', !Number.isFinite(ftlChargeSeconds('hyperdrive', 0)))
}

console.log('\n=== 10. Turing Scout hyperdrive cooldown is 7 days ===')
{
  const turing = SHIP_CLASSES.find((c) => c.id === 'turing-scout')!
  const drive = turing.ftlDrives.find((d) => d.kind === 'hyperdrive') as HyperDrive & { cooldownDays: number }
  check('cooldown constant is 7', TURING_HYPERDRIVE_COOLDOWN_DAYS === 7)
  check('the ship class actually uses it', drive.cooldownDays === 7, `${drive.cooldownDays}`)
}

console.log('\n=== 11. "Engaged Against": active contacts vs. mere co-location ===')
{
  const simDays = 100
  // Two hostile Cruisers, both armed, but placed FAR apart within the same
  // engagement (beyond even a Cruiser's longest range) — both "in combat"
  // (same Engagement) but neither should read as "actively engaged." Kept
  // well clear of the arena origin (where Mars, the obstacle, sits) so
  // "out of range" is the only reason they can't see each other, not "one
  // of them is standing inside the planet."
  const a = makeShip('cruiser', 'p1', 'player', 'Mars')
  const b = makeShip('cruiser', 'e1', 'hostile', 'Mars')
  let engs = syncEngagements([a, b], [], simDays)
  const nearOrigin = { x: 3, y: 3, z: 0 }
  const reallyFar = { x: 500, y: 3, z: 0 } // far outside any weapon range
  engs = [
    {
      ...engs[0],
      participants: engs[0].participants.map((p) =>
        p.side === 0 ? { ...p, position: nearOrigin } : { ...p, position: reallyFar },
      ),
    },
  ]
  const p1 = engs[0].participants.find((p) => p.side === 0)!
  const contactsWhenFar = activeEnemyContacts(p1, engs[0], [a, b], simDays)
  check('out of range = not actively engaged, despite being in the same Engagement', contactsWhenFar.length === 0)
  check('isActivelyEngaged agrees', !isActivelyEngaged(p1, engs[0], [a, b], simDays))

  // Now bring them into range (and still clear of the planet at the origin).
  const close = { x: 6, y: 3, z: 0 }
  const engs2 = [
    {
      ...engs[0],
      participants: engs[0].participants.map((p) => (p.side === 1 ? { ...p, position: close } : p)),
    },
  ]
  const p1b = engs2[0].participants.find((p) => p.side === 0)!
  const contactsWhenClose = activeEnemyContacts(p1b, engs2[0], [a, b], simDays)
  check('in range + clear LOF = actively engaged', contactsWhenClose.length === 1)

  // A longer-ranged ship should count as an active threat even if the
  // target itself can't reach back. Built as a synthetic engagement with NO
  // obstacles (rather than through syncEngagements, which — as the previous
  // debug run found — would anchor Sol itself as an obstacle for a 'star'
  // location and contaminate this range-only test), so range is the only
  // variable under test.
  const frigate = makeShip('frigate', 'p2', 'player')
  const corvette = makeShip('corvette', 'e2', 'hostile')
  const frigatePos = { x: 0, y: 0, z: 0 }
  const corvettePos = { x: 8, y: 0, z: 0 } // inside frigate's missile range (11), outside corvette's autocannon (3)
  const mkParticipant = (shipId: string, side: 0 | 1, position: { x: number; y: number; z: number }) => ({
    shipId, side, position, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: simDays,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  })
  const engs3 = [
    {
      id: 'e-test', locationKey: 'test', locationLabel: 'test', startedSimDays: simDays, density: 'standard' as const,
      center: { x: 0, y: 0, z: 0 }, obstacles: [], resolvedThroughSimDays: simDays,
      participants: [mkParticipant('p2', 0, frigatePos), mkParticipant('e2', 1, corvettePos)],
    },
  ]
  const frigateP = engs3[0].participants.find((p) => p.side === 0)!
  const corvetteP = engs3[0].participants.find((p) => p.side === 1)!
  check(
    'a kiting long-range ship counts as actively engaging its target',
    activeEnemyContacts(frigateP, engs3[0], [frigate, corvette], simDays).length === 1,
  )
  check(
    "...and symmetrically, the target counts the frigate as engaging IT too (either side's reach counts)",
    activeEnemyContacts(corvetteP, engs3[0], [frigate, corvette], simDays).length === 1,
  )
}

console.log('\n=== 12. FTL risk modifiers ===')
{
  // Core damage: universal, small, applies even outside combat.
  check('undamaged core adds no risk', coreDamageRiskBonus(1) === 0)
  check('fully-gone core adds the max bonus', Math.abs(coreDamageRiskBonus(0) - CORE_DAMAGE_MAX_RISK_BONUS) < 1e-9)
  check('half-damaged core adds half the max bonus', Math.abs(coreDamageRiskBonus(0.5) - CORE_DAMAGE_MAX_RISK_BONUS / 2) < 1e-9)

  const drive: HyperDrive = { kind: 'hyperdrive', cooldownDays: 27 }
  const base = hyperdriveLossChance(drive, false, 1, false)
  const damaged = hyperdriveLossChance(drive, false, 0, false)
  const engaged = hyperdriveLossChance(drive, false, 1, true)
  check('damaged core raises hyperdrive risk', damaged > base, `${damaged} vs ${base}`)
  check('active engagement raises hyperdrive risk MORE than core damage does', engaged - base > damaged - base, `+${engaged - base} vs +${damaged - base}`)
  check('engagement bonus matches the named constant', Math.abs(engaged - base - ACTIVE_ENGAGEMENT_RISK_BONUS) < 1e-9)

  // A lossChanceOverride (Turing Scout) wins outright regardless of damage
  // or engagement — the whole point of that field.
  const turingDrive: HyperDrive = { kind: 'hyperdrive', cooldownDays: 7, lossChanceOverride: 0 }
  check('Turing Scout override ignores every modifier', hyperdriveLossChance(turingDrive, false, 0, true) === 0)

  // Warp: zero for an ordinary trip, only nonzero when there's something to
  // elevate it.
  check('warp escape risk is 0 for a healthy, unengaged ship', warpEscapeLossChance(1, false) === 0)
  check('warp escape risk rises with core damage', warpEscapeLossChance(0.5, false) > 0)
  check('warp escape risk rises more with active engagement', warpEscapeLossChance(1, true) > warpEscapeLossChance(0.5, false))
}

console.log('\n=== 13. Ordinary warp orders are UNCHANGED — no new risk without riskContext ===')
{
  // The critical scoping guarantee: a plain player-issued warp order (no
  // riskContext) must never roll against the new warp-escape risk, even for
  // a badly damaged ship, since that would be a silent behavior change to
  // something that was always 100% safe.
  const simDays = 100
  const ship = makeShip('corvette', 'p1', 'player', 'Mars')
  // Wreck its core almost completely.
  const wrecked: ShipInstance = { ...ship, combat: { ...ship.combat, componentHp: { ...ship.combat.componentHp, core: 1 } } }
  let anyLost = false
  for (let i = 0; i < 200; i++) {
    const result = planMove(wrecked, { kind: 'star', starId: 'sol' }, simDays) // no riskContext passed
    if (result.kind === 'lost-in-hyperspace') anyLost = true
  }
  check('a badly-damaged ship never loses an ordinary warp order to the new risk', !anyLost)
}

console.log('\n=== 14. Escaping still actually leaves the fight (regression) ===')
{
  const simDays = 100
  const cruiser = makeShip('cruiser', 'p1', 'player')
  const charge = planFtlCharge(cruiser, { kind: 'star', starId: 'sol' }, simDays)!
  let ships = [{ ...cruiser, combat: { ...cruiser.combat, ftlCharge: charge } }, makeShip('corvette', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  const rng = seededRng(9)
  const past = simDays + simSecondsToDays(5.5)
  const result = stepEngagements(engagements, ships, past, rng)
  check('the escapee is reported as escaped', result.escapedShipIds.includes('p1'))
  check('the engagement ends when one side leaves', result.engagements.length === 0)
}

console.log('\n=== 15. isInsideWindow no longer needs density (window size is constant) ===')
{
  const center = { x: 0, y: 0, z: 0 }
  const inside = { x: 5.9, y: 0, z: 0 }
  const outside = { x: 6.1, y: 0, z: 0 }
  check('just inside the 12-unit window', isInsideWindow(inside, center))
  check('just outside it', !isInsideWindow(outside, center))
}

console.log('\n=== 16. Layer overflow keeps the right multiplier (ported from the Phase 1-3 suite) ===')
{
  const profile = SHIP_CLASSES.find((c) => c.id === 'corvette')!.combat
  const never = () => 1
  const huge: WeaponMount = { ...WEAPON_TYPES.massDriver, damage: 1000 }
  const state = pristineCombatState(profile)
  const { next, outcome } = applyShot(huge, 1000, state, profile, 'core', never)
  // Corvette: 90 shields, 40 armor. Raw consumed by shields = 90/1.5 = 60.
  // Raw consumed by armor = 40/0.5 = 80. Remaining = 1000-60-80 = 860, at 1.0x.
  check('shields fully stripped', next.shieldHp === 0)
  check('armor fully stripped', next.armorHp === 0)
  check(
    'component damage used raw carryover, not the shield bonus',
    Math.abs(outcome.componentDamage - 860) < 0.001,
    `${outcome.componentDamage.toFixed(1)} (expected 860)`,
  )
}

console.log('\n=== 17. Point defense intercepts at its stated rate (statistical, ported) ===')
{
  const destroyer = SHIP_CLASSES.find((c) => c.id === 'destroyer')!.combat
  const torpedo = WEAPON_TYPES.torpedoTube
  let intercepted = 0
  const rng = seededRng(42)
  for (let i = 0; i < 2000; i++) {
    if (applyShot(torpedo, torpedo.damage, pristineCombatState(destroyer), destroyer, null, rng).outcome.intercepted) intercepted++
  }
  const rate = intercepted / 2000
  check('destroyer intercepts near its 55% rating', Math.abs(rate - 0.55) < 0.05, `observed ${(rate * 100).toFixed(1)}%`)
}

console.log('\n=== 18. Player movement latches against the approach AI (ported, adapted to real coordinates) ===')
{
  const simDays = 100
  let ships = [makeShip('frigate', 'p1', 'player'), makeShip('battleship', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  const me = engagements[0].participants.find((p) => p.shipId === 'p1')!
  // Kept modest: ships are now sub-light and genuinely slow, so a far
  // corner would need thousands of steps just to reach.
  const corner = { x: -8, y: -8, z: -8 }
  const ordered = orderParticipantTo(me, corner, engagements[0].density, simDays, [])
  check('a route was planned', ordered.path.length > 0)
  engagements = [
    { ...engagements[0], participants: engagements[0].participants.map((p) => (p.shipId === 'p1' ? { ...ordered, holdPosition: true } : p)) },
  ]
  const rng = seededRng(21)
  for (let i = 0; i < 1500; i++) {
    const now = simDays + COMBAT_STEP_DAYS * (i + 1)
    const r = stepEngagements(engagements, ships, now, rng)
    if (r.engagements.length === 0) break
    engagements = r.engagements
    ships = ships.filter((s) => !r.destroyedShipIds.includes(s.id)).map((s) => (r.shipCombat[s.id] ? { ...s, combat: r.shipCombat[s.id] } : s))
  }
  const after = engagements[0]?.participants.find((p) => p.shipId === 'p1')
  if (!after) {
    check('player ship survived to be measured', false, 'destroyed')
  } else {
    check('held ship reached its ordered point and stayed', pointDistance(after.position, corner) < 0.2, `ended at ${JSON.stringify(after.position)}`)
    check('hold latch persisted', after.holdPosition === true)
  }
  const enemy = engagements[0]?.participants.find((p) => p.shipId === 'e1')
  if (enemy) {
    check('un-held ship auto-approached instead of holding', pointDistance(enemy.position, { x: -1.5, y: -1.5, z: 6 }) > 0.5)
  }
}

console.log('\n=== 19. Regression: pathing works even far from the display window (ported) ===')
{
  // The Phase 3 fix decoupled A*'s search box from the display window, since
  // bounding it to the window deadlocked any ship outside it. Phase 4 keeps
  // that guarantee — verified here at real coordinates far from the origin.
  const density = 'standard' as const
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2 }
  const wayOut = { x: 0, y: 0, z: 40 }
  const target = { x: 0, y: 0, z: -3 }
  const ordered = orderParticipantTo(
    { shipId: 'p1', side: 0, position: wayOut, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0, path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false },
    target,
    density,
    0,
    [earth],
  )
  check('a ship far from the origin can still plan a route around a body', ordered.path.length > 0, `${ordered.path.length} waypoints`)
  check('it actually arrives', pointDistance(ordered.path[ordered.path.length - 1], target) < 1e-9)
}

console.log('\n=== 20. Shield regen is exactly one step per step — framerate independence (ported) ===')
{
  const simDays = 100
  const profile = SHIP_CLASSES.find((c) => c.id === 'cruiser')!.combat
  const half = profile.defenses.shieldHp / 2
  const a = makeShip('cruiser', 'p1', 'player')
  const b = makeShip('cruiser', 'e1', 'hostile')
  let ships = [{ ...a, combat: { ...a.combat, shieldHp: half } }, { ...b, combat: { ...b.combat, shieldHp: half } }]
  let engagements = syncEngagements(ships, [], simDays)
  const rng = seededRng(11)
  const STEPS = 50
  for (let i = 0; i < STEPS; i++) {
    // Pin both ships far apart with no queued path each step, so the
    // approach AI can't close the gap and start a firefight — isolates the
    // regen rate as the only thing under test.
    engagements = engagements.map((e) => ({
      ...e,
      participants: e.participants.map((p, idx) => {
        const pos = { x: idx === 0 ? -100 : 100, y: 0, z: 0 }
        return { ...p, position: pos, path: [] }
      }),
    }))
    const now = simDays + COMBAT_STEP_DAYS * (i + 1)
    const r = stepEngagements(engagements, ships, now, rng)
    engagements = r.engagements
    ships = ships.map((s) => (r.shipCombat[s.id] ? { ...s, combat: r.shipCombat[s.id] } : s))
  }
  const gained = ships[0].combat.shieldHp - half
  const expected = profile.defenses.shieldRegenPerSecond * 0.1 * STEPS
  check('regen is exactly rate x stepSeconds x steps', Math.abs(gained - expected) < 0.001, `gained ${gained.toFixed(2)}, expected ${expected.toFixed(2)}`)
  check('no shots exchanged at that range', ships[0].combat.armorHp === profile.defenses.armorHp)
}

console.log('\n=== 21. Ships are genuinely sub-light (the reported "faster than light" bug) ===')
{
  // The physical claim: light takes ~4.6s to cross the Sun's real diameter.
  // Every hull must take meaningfully LONGER than that to cross Sol as it's
  // actually rendered in the arena.
  const solDiameterUnits = 2 * arenaBodyRadius(696_000)
  const lightSeconds = solDiameterUnits / ARENA_LIGHT_SPEED_UNITS_PER_SECOND
  check('light crosses Sol in ~4.6s, as physics says', Math.abs(lightSeconds - 4.64) < 0.1, `${lightSeconds.toFixed(2)}s`)

  let slowest = Infinity
  let fastest = 0
  for (const cls of SHIP_CLASSES) {
    const speed = cls.combat.maneuverUnitsPerSecond
    const crossing = solDiameterUnits / speed
    check(
      `${cls.name} is slower than light`,
      speed < ARENA_LIGHT_SPEED_UNITS_PER_SECOND && crossing > lightSeconds,
      `crosses Sol in ${crossing.toFixed(1)}s vs light's ${lightSeconds.toFixed(1)}s`,
    )
    slowest = Math.min(slowest, speed)
    fastest = Math.max(fastest, speed)
  }
  check('even the fastest hull needs >4-5s to cross Sol', solDiameterUnits / fastest > 5)
  check('hulls still differ meaningfully in speed', fastest / slowest > 2, `${(fastest / slowest).toFixed(1)}x spread`)
}

console.log('\n=== 22. Acceleration and deceleration ===')
{
  const maxSpeed = 0.4
  const accel = 0.1 // reaches cruise in 4s
  const dt = COMBAT_STEP_SECONDS
  const start = { x: 0, y: 0, z: 0 }
  let p: any = {
    shipId: 'p1', side: 0, position: start, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [{ x: 100, y: 0, z: 0 }], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  // One step from rest must NOT be at cruise speed.
  p = integrateMotion(p, maxSpeed, accel, dt, simSecondsToDays(dt))
  const afterOne = participantSpeed(p)
  check('a ship does not jump to cruise speed instantly', afterOne < maxSpeed * 0.5, `${afterOne.toFixed(4)} u/s after one 0.1s step`)
  check('...but it is moving', afterOne > 0)

  // It should reach cruise after roughly maxSpeed/accel seconds.
  let t = dt
  for (let i = 0; i < 200 && participantSpeed(p) < maxSpeed - 1e-6; i++) {
    t += dt
    p = integrateMotion(p, maxSpeed, accel, dt, simSecondsToDays(t))
  }
  check('reaches cruise in ~maxSpeed/accel seconds', Math.abs(t - maxSpeed / accel) < 0.5, `${t.toFixed(1)}s (expected ~${(maxSpeed / accel).toFixed(1)}s)`)

  // Deceleration: aim at a nearby point and confirm it arrives stopped.
  let q: any = {
    shipId: 'p2', side: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [{ x: 5, y: 0, z: 0 }], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  let qt = 0
  for (let i = 0; i < 2000 && q.path.length > 0; i++) {
    qt += dt
    q = integrateMotion(q, maxSpeed, accel, dt, simSecondsToDays(qt))
  }
  check('arrives at its destination', pointDistance(q.position, { x: 5, y: 0, z: 0 }) < 0.01, JSON.stringify(q.position))
  check('and arrives AT REST, having decelerated', participantSpeed(q) < 1e-9, `${participantSpeed(q)} u/s`)
}

console.log('\n=== 23. REGRESSION: re-ordering mid-flight does not teleport the ship ===')
{
  // The reported bug: giving a new move order snapped the ship to the
  // destination it had previously been sent to. Root cause was `position`
  // holding the current leg's ENDPOINT rather than the ship's real location.
  const dt = COMBAT_STEP_SECONDS
  const origin = { x: 0, y: 0, z: 0 }
  const firstDestination = { x: 30, y: 0, z: 0 }
  let p: any = {
    shipId: 'p1', side: 0, position: origin, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  p = orderParticipantTo(p, firstDestination, 'standard', 0, [])
  // Fly for a couple of seconds — nowhere near arriving.
  let t = 0
  for (let i = 0; i < 20; i++) {
    t += dt
    p = integrateMotion(p, 0.4, 0.1, dt, simSecondsToDays(t))
  }
  const midFlight = { ...p.position }
  check('ship is genuinely mid-flight, not at either endpoint', pointDistance(midFlight, origin) > 0.1 && pointDistance(midFlight, firstDestination) > 5)

  // Now redirect somewhere completely different.
  const before = { ...p.position }
  p = orderParticipantTo(p, { x: 0, y: 30, z: 0 }, 'standard', simSecondsToDays(t), [])
  check(
    'redirecting does NOT move the ship at all',
    pointDistance(p.position, before) < 1e-12,
    `was ${JSON.stringify(before)}, now ${JSON.stringify(p.position)}`,
  )
  check(
    'and specifically does not snap it to the OLD destination',
    pointDistance(p.position, firstDestination) > 5,
  )
  check('momentum is carried into the turn, not discarded', participantSpeed(p) > 0)
}

console.log('\n=== 24. REGRESSION: the route line survives being given (path stays populated) ===')
{
  // The reported glitch: the line showing where a ship is going vanished the
  // instant an order was issued. The resolver consumed the single waypoint on
  // the first movement step, emptying `path` while the ship was still flying.
  const simDays = 100
  let ships = [makeShip('cruiser', 'p1', 'player', 'Earth'), makeShip('cruiser', 'e1', 'hostile', 'Earth')]
  let engagements = syncEngagements(ships, [], simDays)
  const me = engagements[0].participants.find((p) => p.shipId === 'p1')!
  // Somewhere far enough that it takes many steps to reach.
  const ordered = orderParticipantTo(me, { x: me.position.x, y: me.position.y + 9, z: me.position.z }, 'standard', simDays, [])
  check('the order queued a route', ordered.path.length > 0)
  engagements = [
    { ...engagements[0], participants: engagements[0].participants.map((p) => (p.shipId === 'p1' ? { ...ordered, holdPosition: true } : p)) },
  ]
  const rng = seededRng(5)
  let stillHasRouteAfterFirstStep = false
  for (let i = 0; i < 10; i++) {
    const now = simDays + COMBAT_STEP_DAYS * (i + 1)
    const r = stepEngagements(engagements, ships, now, rng)
    if (r.engagements.length === 0) break
    engagements = r.engagements
    ships = ships.map((s) => (r.shipCombat[s.id] ? { ...s, combat: r.shipCombat[s.id] } : s))
    if (i === 0) {
      const p = engagements[0].participants.find((x) => x.shipId === 'p1')!
      stillHasRouteAfterFirstStep = p.path.length > 0
    }
  }
  check('route is still queued after the first movement step', stillHasRouteAfterFirstStep)
  const after = engagements[0]?.participants.find((x) => x.shipId === 'p1')
  check('and still queued a full second into the flight', !!after && after.path.length > 0)
}

console.log('\n=== 25. Stances place ships differently ===')
{
  const profile = SHIP_CLASSES.find((c) => c.id === 'cruiser')!.combat // reach 9, shortest 5
  const mk = (position: any) => ({
    shipId: 'x', side: 0 as const, position, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  })
  const enemy = { ...mk({ x: 0, y: 0, z: 0 }), shipId: 'e', side: 1 as const }
  const far = mk({ x: 30, y: 0, z: 0 })

  const balanced = stanceDestination(far, enemy, profile, 'balanced', [])!
  const swarm = stanceDestination(far, enemy, profile, 'swarm', [])!
  const kite = stanceDestination(far, enemy, profile, 'kite', [])!
  const dist = (d: any) => pointDistance(d, enemy.position)

  check('swarm closes nearer than balanced', dist(swarm) < dist(balanced), `swarm ${dist(swarm).toFixed(2)} vs balanced ${dist(balanced).toFixed(2)}`)
  check('kite holds farther out than balanced', dist(kite) > dist(balanced), `kite ${dist(kite).toFixed(2)} vs balanced ${dist(balanced).toFixed(2)}`)
  check('kite sits just inside max weapon range (9)', dist(kite) > 8 && dist(kite) < 9, `${dist(kite).toFixed(2)}`)
  check('swarm closes to inside the shortest mount range (5)', dist(swarm) <= 5, `${dist(swarm).toFixed(2)}`)

  // Kite actively backs off when crowded.
  const crowded = mk({ x: 2, y: 0, z: 0 })
  const retreat = stanceDestination(crowded, enemy, profile, 'kite', [])!
  check('kite backs off when the enemy gets close', dist(retreat) > dist(crowded.position), `retreating to ${dist(retreat).toFixed(2)} from ${dist(crowded.position).toFixed(2)}`)

  // Kite holds station when already in the band.
  const inBand = mk({ x: 9 * 0.92, y: 0, z: 0 })
  check('kite holds station inside its tolerance band', stanceDestination(inBand, enemy, profile, 'kite', []) === null)

  // Stall hides behind the body and breaks line of fire.
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2 }
  const attacker = { ...mk({ x: -8, y: 0, z: 0 }), shipId: 'e', side: 1 as const }
  const staller = mk({ x: 4, y: 3, z: 0 })
  const hide = stanceDestination(staller, attacker, profile, 'stall', [earth])!
  check(
    'stall moves to a spot with NO line of fire from the attacker',
    !hasLineOfFire(new Vector3(hide.x, hide.y, hide.z), new Vector3(attacker.position.x, attacker.position.y, attacker.position.z), [earth]),
    `hides at ${JSON.stringify(hide)}`,
  )
  check('stall stays clear of the body surface', pointDistance(hide, ARENA_ORIGIN) > earth.radiusUnits)
}

console.log('\n=== 26. Time controls: five tactical tiers, speed adjustable while paused ===')
{
  check('tactical now has five tiers', TACTICAL_SPEED_MULTIPLIERS.length === 5, TACTICAL_SPEED_MULTIPLIERS.join(','))
  check('the slowest tactical tier is unchanged at 1x', TACTICAL_SPEED_MULTIPLIERS[0] === 1)
  check('normal still has five tiers', NORMAL_SPEED_MULTIPLIERS.length === 5)

  const store = useGameTimeStore
  store.setState({ mode: 'tactical', paused: true, speedIndex: 0 })
  store.getState().speedUp()
  check('speeding up works WHILE PAUSED', store.getState().speedIndex === 1)
  check('...and does not silently unpause', store.getState().paused === true)
  store.getState().slowDown()
  check('slowing down works while paused too', store.getState().speedIndex === 0)
  check('...still paused', store.getState().paused === true)

  // Clamps at both ends.
  for (let i = 0; i < 10; i++) store.getState().speedUp()
  check('clamps at the top tier', store.getState().speedIndex === TACTICAL_SPEED_MULTIPLIERS.length - 1)
  for (let i = 0; i < 10; i++) store.getState().slowDown()
  check('clamps at the bottom tier', store.getState().speedIndex === 0)

  // Switching to a mode with fewer tiers must not strand the index.
  store.setState({ mode: 'tactical', speedIndex: 4, paused: false })
  store.getState().setMode('normal')
  check('mode switch keeps speedIndex in range', store.getState().speedIndex <= NORMAL_SPEED_MULTIPLIERS.length - 1)
  store.setState({ mode: 'normal', paused: false, speedIndex: 0 })
}

console.log('\n=== 27. Click picking resolves a real 3D node, not a box-shell point ===')
{
  // The bug this section exists for: the click-catcher was a solid box and
  // the handler used the raycast hit as the destination. A box raycast can
  // only ever return a point on the box's SURFACE, so every order landed on
  // the arena's outer shell at whatever spot lay along the view ray —
  // visually correct from the angle it was issued at, wrong from every other.
  //
  // The spec picking replaces it with: a click selects the FRONT-MOST node
  // whose dot the cursor is within captureRadius of. Depth ties are
  // irreducible (several nodes really do share a view ray), so the assertion
  // below is not "clicking a node always returns that node" — that is
  // impossible — but the exact rule: unoccluded nodes return themselves, and
  // occluded ones return a node in front of them on the same ray.
  const width = 1920
  const height = 950
  const camera = new PerspectiveCamera(50, width / height, 0.1, 1000)
  const center: ArenaPoint = { x: 0, y: 0, z: 0 }
  const CAPTURE = 4

  const toPixels = (ndcX: number, ndcY: number) => ({
    x: (ndcX * 0.5 + 0.5) * width,
    y: (-ndcY * 0.5 + 0.5) * height,
  })
  const projector = (point: ArenaPoint) => {
    const v = new Vector3(point.x - center.x, point.y - center.y, point.z - center.z)
    const depth = v.distanceTo(camera.position)
    v.project(camera)
    return { ...toPixels(v.x, v.y), depth, visible: v.z >= -1 && v.z <= 1 }
  }
  const pickAimedAt = (node: ArenaPoint, obstacles: CombatObstacle[] = [], density: 'coarse' | 'standard' | 'fine' = 'standard') => {
    const aim = projector(node)
    return pickLatticeNode(center, density, { x: aim.x, y: aim.y }, projector, {
      tieRadius: CAPTURE,
      isBlocked: obstacles.length
        ? (q: ArenaPoint) => obstacles.some((o) => pointDistance(q, o.position) <= o.radiusUnits)
        : undefined,
    })
  }

  // Four camera angles including the app's own initial framing. Two are
  // axis-aligned, where whole rows of nodes collapse onto a single screen
  // point — the hardest case for any depth rule, and deliberately included.
  const angles: [string, [number, number, number]][] = [
    ['initial framing', [26 * 0.6, 26 * 0.5, 26 * 0.7]],
    ['side-on', [30, 0, 0]],
    ['top-down', [0, 30, 0.001]],
    ['opposite corner', [-18, -14, -20]],
  ]

  for (const density of ['coarse', 'standard', 'fine'] as const) {
    const divisions = GRID_DIVISIONS[density]
    const spacing = gridSpacing(density)
    const half = divisions / 2
    const every: ArenaPoint[] = []
    for (let ix = 0; ix <= divisions; ix++)
      for (let iy = 0; iy <= divisions; iy++)
        for (let iz = 0; iz <= divisions; iz++)
          every.push({ x: (ix - half) * spacing, y: (iy - half) * spacing, z: (iz - half) * spacing })

    // Subsample which nodes get aimed at; every node is still a candidate.
    const step = density === 'fine' ? 4 : density === 'standard' ? 2 : 1
    const aimed: ArenaPoint[] = []
    for (let ix = 0; ix <= divisions; ix += step)
      for (let iy = 0; iy <= divisions; iy += step)
        for (let iz = 0; iz <= divisions; iz += step)
          aimed.push({ x: (ix - half) * spacing, y: (iy - half) * spacing, z: (iz - half) * spacing })

    let unoccludedTested = 0
    let unoccludedExact = 0
    let ruleViolations = 0
    let outsideWindow = 0

    for (const [, position] of angles) {
      camera.position.set(position[0], position[1], position[2])
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld(true)

      for (const node of aimed) {
        const aim = projector(node)
        if (!aim.visible) continue
        const picked = pickAimedAt(node, [], density)
        if (!picked) { ruleViolations++; continue }

        if (Math.max(Math.abs(picked.x), Math.abs(picked.y), Math.abs(picked.z)) > ARENA_SPAN_UNITS / 2 + 1e-9) outsideWindow++

        // Is anything genuinely in front of this node on the same ray?
        let occluder = false
        for (const other of every) {
          if (other === node) continue
          const o = projector(other)
          if (!o.visible) continue
          if (o.depth >= aim.depth - 1e-9) continue
          if (Math.hypot(o.x - aim.x, o.y - aim.y) <= CAPTURE) { occluder = true; break }
        }

        if (!occluder) {
          unoccludedTested++
          if (pointDistance(picked, node) < 1e-9) unoccludedExact++
          else ruleViolations++
        } else {
          // Must still be a node under the cursor, and in front of the aim.
          const pp = projector(picked)
          const underCursor = Math.hypot(pp.x - aim.x, pp.y - aim.y) <= CAPTURE
          if (!underCursor || pp.depth > aim.depth + 1e-9) ruleViolations++
        }
      }
    }

    check(
      `[${density}] an unoccluded node always picks itself`,
      unoccludedTested > 0 && unoccludedExact === unoccludedTested,
      `${unoccludedExact}/${unoccludedTested}`,
    )
    check(`[${density}] every pick is the front-most node under the cursor`, ruleViolations === 0, `${ruleViolations} violations`)
    check(`[${density}] no pick lands outside the arena window (the old shell bug)`, outsideWindow === 0, `${outsideWindow} outside`)
  }

  // Depth is the whole point: two nodes on one view ray resolve to the nearer.
  {
    camera.position.set(0, 0, 30)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const behind: ArenaPoint = { x: 0, y: 0, z: -6 }
    const picked = pickAimedAt(behind)
    check('collinear nodes resolve to the one nearest the camera', picked !== null && picked.z === 6, picked ? `z=${picked.z}` : 'null')
  }

  // A node buried inside a body is never a legal destination, so it must not
  // be pickable — clicking across a star should reach past it, not silently
  // produce an order orderParticipantTo will refuse.
  {
    camera.position.set(0, 0, 30)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const star: CombatObstacle = { name: 'Sol', kind: 'star', color: '#ffcc66', position: ARENA_ORIGIN, radiusUnits: 3.9 }
    const picked = pickAimedAt(ARENA_ORIGIN, [star])
    const insideStar = picked ? pointDistance(picked, star.position) <= star.radiusUnits : true
    check('picking never returns a node buried inside a body', !insideStar, picked ? `picked z=${picked.z}` : 'null')
  }
}

console.log('\n=== 28. The densities nest, so every placement is a fine-lattice point ===')
{
  // Placement resolves to a node DRAWN at the current density. That is only
  // consistent with "the fine lattice is the game's resolution" if the
  // coarser lattices are subsets of it — otherwise ordering at standard
  // density would put a ship somewhere fine can't express.
  const fineSpacing = gridSpacing('fine')
  let nonNesting = 0
  for (const density of GRID_DENSITIES) {
    const spacing = gridSpacing(density)
    const divisions = GRID_DIVISIONS[density]
    for (let i = 0; i <= divisions; i++) {
      const offset = (i - divisions / 2) * spacing
      if (Math.abs(offset / fineSpacing - Math.round(offset / fineSpacing)) > 1e-9) nonNesting++
    }
  }
  check('every coarse/standard node is also a fine node', nonNesting === 0, `${nonNesting} off-lattice`)
  check(
    'fine divisions are a multiple of standard, standard of coarse',
    GRID_DIVISIONS.fine % GRID_DIVISIONS.standard === 0 && GRID_DIVISIONS.standard % GRID_DIVISIONS.coarse === 0,
    `${GRID_DIVISIONS.coarse}/${GRID_DIVISIONS.standard}/${GRID_DIVISIONS.fine}`,
  )

  // snapToLatticeNode is window-RELATIVE: the drawn lattice hangs off the
  // window centre, not the arena origin, so anything reasoning about nodes
  // has to use the same origin the grid is drawn with.
  {
    const center: ArenaPoint = { x: 3.37, y: -1.11, z: 0.42 }
    const snapped = snapToLatticeNode({ x: center.x + 0.1, y: center.y - 0.1, z: center.z + 0.05 }, center, 'fine')
    check(
      'a point beside the window centre snaps to the centre node',
      pointDistance(snapped, center) < 1e-9,
      `(${snapped.x.toFixed(2)}, ${snapped.y.toFixed(2)}, ${snapped.z.toFixed(2)})`,
    )
    const offset = fineSpacing * 3
    const snappedOffset = snapToLatticeNode({ x: center.x + offset + 0.2, y: center.y, z: center.z }, center, 'fine')
    check(
      'snapping lands a whole number of fine steps from the centre',
      Math.abs((snappedOffset.x - center.x) / fineSpacing - 3) < 1e-9,
      `${((snappedOffset.x - center.x) / fineSpacing).toFixed(3)} steps`,
    )
    const far = snapToLatticeNode({ x: 500, y: -500, z: 500 }, ARENA_ORIGIN, 'fine')
    check('snapping clamps to the window rather than escaping it', isInsideWindow(far, ARENA_ORIGIN), `(${far.x}, ${far.y}, ${far.z})`)
  }

  // The movement primitive is unchanged — it still accepts any real point
  // (section 5 covers that). Constraining destinations is the PICKER's job,
  // one layer up. This just confirms a picked node is a destination the
  // mover accepts and lands on exactly.
  {
    const participant = {
      shipId: 'p1', side: 0 as const, position: { x: -4, y: -4, z: -4 }, velocity: { x: 0, y: 0, z: 0 },
      positionSimDays: 0, path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
    }
    const node = snapToLatticeNode({ x: 2.3, y: 1.1, z: -0.7 }, ARENA_ORIGIN, 'fine')
    const ordered = orderParticipantTo(participant, node, 'standard', 0, [])
    check('a picked node is a valid move order', ordered !== participant && ordered.path.length > 0)
    check('the route ends exactly on the picked node', pointDistance(ordered.path[ordered.path.length - 1], node) < 1e-9)
  }
}

console.log('\n=== 29. Route-line arrowheads: pure chevron geometry ===')
{
  const start = new Vector3(0, 0, 0)
  const end = new Vector3(10, 0, 0)
  const camera = new Vector3(5, 0, 20) // off to the side, not staring down the segment
  const length = 2
  const wings = arrowWings(start, end, camera, length)

  check('arrowWings returns wings for an ordinary segment', wings !== null)
  if (wings) {
    const d1 = wings.wing1.distanceTo(end)
    const d2 = wings.wing2.distanceTo(end)
    check('both wings sit exactly `length` from the endpoint', Math.abs(d1 - length) < 1e-9 && Math.abs(d2 - length) < 1e-9, `${d1.toFixed(4)}, ${d2.toFixed(4)}`)

    const backDir = start.clone().sub(end).normalize()
    const angle1 = wings.wing1.clone().sub(end).normalize().angleTo(backDir) * (180 / Math.PI)
    const angle2 = wings.wing2.clone().sub(end).normalize().angleTo(backDir) * (180 / Math.PI)
    check('both wings sit at the requested half-angle off the reverse direction', Math.abs(angle1 - 22) < 1e-6 && Math.abs(angle2 - 22) < 1e-6, `${angle1.toFixed(3)}°, ${angle2.toFixed(3)}°`)

    const mid = wings.wing1.clone().add(wings.wing2).multiplyScalar(0.5)
    const midOffset = mid.clone().sub(end)
    check('the two wings are symmetric about the segment axis', midOffset.clone().normalize().distanceTo(backDir) < 1e-6, `mid offset ${midOffset.toArray().map((v) => v.toFixed(3))}`)

    check('wings do not coincide (a real chevron, not a degenerate line)', wings.wing1.distanceTo(wings.wing2) > 1e-6)
  }

  // Zero-length segment (start === end) is degenerate — must not throw or
  // fabricate a direction.
  check('a zero-length segment returns null rather than a fabricated arrow', arrowWings(new Vector3(3, 3, 3), new Vector3(3, 3, 3), camera, 1) === null)

  // Zero-length arrow request (e.g. a leg too short to draw one) is a no-op.
  check('a zero requested length returns null', arrowWings(start, end, camera, 0) === null)

  // View looking straight down the segment axis is the degenerate perpendicular
  // case the fallback exists for — must still produce a valid, non-degenerate chevron.
  const dead_ahead = arrowWings(start, end, new Vector3(20, 0, 0), length)
  check('a camera looking straight down the segment still produces a chevron (fallback perpendicular)', dead_ahead !== null && dead_ahead.wing1.distanceTo(dead_ahead.wing2) > 1e-6)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
