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
import { DAMAGE_PROFILES, WEAPON_TYPES, CORE_DAMAGE_MAX_RISK_BONUS, ACTIVE_ENGAGEMENT_RISK_BONUS, coreDamageRiskBonus, CHAFF_CHARGES, CHAFF_DURATION_SECONDS, CHAFF_MISS_CHANCE, weaponsEffectiveness, SCUTTLE_MAX_DAMAGE, SCUTTLE_BLAST_RADIUS_UNITS, scuttleDamageAt, CHASE_STANDOFF_UNITS, RAM_MAX_TARGET_DAMAGE, RAM_SELF_DAMAGE_FRACTION, ramDamageAt, rangeEffectiveness, missileDamageMultiplier, torpedoAccuracy, MISSILE_FALLOFF_FLOOR, MISSILE_SPEED_UNITS_PER_SECOND, TORPEDO_SPEED_UNITS_PER_SECOND, THRUSTER_BOOST_SPEED_BONUS_FRACTION, THRUSTER_BOOST_EVASION_BONUS, THRUSTER_BOOST_LASER_DAMAGE_MULTIPLIER, THRUSTER_BOOST_CANNON_DAMAGE_MULTIPLIER, SHIELD_BOOST_REGEN_MULTIPLIER, SHIELD_BOOST_ENERGY_DAMAGE_MULTIPLIER, SHIELD_BOOST_KINETIC_DAMAGE_MULTIPLIER, SHIELD_BOOST_EVASION_PENALTY, SHIELD_BOOST_SPEED_PENALTY_FRACTION, WEAPONS_BOOST_DAMAGE_MULTIPLIER, WEAPONS_BOOST_SHIELD_REGEN_MULTIPLIER, WEAPONS_BOOST_SPEED_PENALTY_FRACTION, WEAPONS_BOOST_AI_HEALTH_ENGAGE_THRESHOLD, WEAPONS_BOOST_AI_HEALTH_DISENGAGE_THRESHOLD, BOOST_TACTIC_IDS, SPIN_THRUST_EVASION_BONUS, TACTIC_IDS, tacticBadge, type WeaponMount } from '../src/data/combatData'
import { pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { activeTacticIds, engagementIsContested, useCombatStore } from '../src/state/combatStore'
import {
  applyShot,
  ftlChargeSeconds,
  overallHealthFraction,
  shipCombatProfile,
  stepEngagements,
  syncEngagements,
  createSoloEngagement,
  planFtlCharge,
  orderParticipantTo,
  activeEnemyContacts,
  isActivelyEngaged,
  integrateMotion,
  participantArenaPosition,
  participantSpeed,
  stanceDestination,
  approachNode,
  pruneOvershotWaypoints,
  obstaclesForLocation,
  isChaffActive,
  deployChaff,
  SHIP_SEPARATION_UNITS,
  DISENGAGE_DISTANCE_UNITS,
  combatCatchUpCursor,
  MAX_STEPS_PER_TICK,
  COMBAT_STEP_DAYS,
  COMBAT_STEP_SECONDS,
  effectiveStrategy,
  divideAssignment,
  condenseDestination,
  screenDestination,
  rangeContactStatus,
  rangeFavor,
  tacticSpeedMultiplier,
  tacticEvasionBonus,
  tacticWeaponDamageMultiplier,
  resolveProjectileImpact,
} from '../src/scene/combatResolution'
import type { Fleet } from '../src/state/fleetStore'
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
  arenaSurfaceGravity,
  gravitationalAcceleration,
  orbitalHoldVelocity,
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
import { hyperdriveLossChance, warpEscapeLossChance, coreHealthFraction, planMove, systemGravityAcceleration, systemBodyContaining, bodyLivePosition, bodyOrbitalVelocity } from '../src/scene/shipPhysics'
import { usePlayerStore } from '../src/state/playerStore'
import { useTechStore } from '../src/state/techStore'
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

function makeShip(
  classId: string,
  id: string,
  allegiance: ShipInstance['allegiance'],
  bodyName = 'Earth',
  fleetId = `solo-${id}`,
): ShipInstance {
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
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(cls.combat),
    stance: 'balanced',
    fleetId,
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
  check('window starts centered on the origin too', nodesEqualLocal(engs[0].center, ARENA_ORIGIN))
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
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2, surfaceGravityUnitsPerSecondSq: 0 }
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
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2, surfaceGravityUnitsPerSecondSq: 0 }
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
  // The engagement itself no longer disappears when it does (see
  // syncEngagements/stepEngagements — a one-sided roster now persists
  // instead of vanishing, exactly so a just-won fight doesn't yank the
  // player out of the arena), so "the battle ended" is measured by a kill
  // happening, not by `engagements` emptying out.
  while (destroyed.length === 0 && steps < 20000) {
    simDays += COMBAT_STEP_DAYS
    steps++
    const result = stepEngagements(engagements, ships, simDays, rng)
    engagements = result.engagements
    ships = ships.filter((s) => !result.destroyedShipIds.includes(s.id)).map((s) => (result.shipCombat[s.id] ? { ...s, combat: result.shipCombat[s.id] } : s))
    destroyed = [...destroyed, ...result.destroyedShipIds]
  }
  check('the battle resolved before the step cap', steps < 20000, `${steps} steps`)
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
  // The engagement itself now persists with the corvette alone (see
  // syncEngagements/stepEngagements — a one-sided roster doesn't vanish
  // anymore) — what actually matters here is that the escapee is gone FROM
  // it, not that the whole thing disappeared.
  check('the escapee is no longer in the engagement', !result.engagements[0]?.participants.some((p) => p.shipId === 'p1'))
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
  // Capped well short of 1500: this is a positioning test, not a survival
  // one, and the held frigate is a sitting duck for the battleship it's
  // sharing the arena with — it reaches and settles at the corner by ~step
  // 400, so 600 confirms the hold sticks with a comfortable margin while
  // stopping before the battleship (still closing at this point) can catch
  // and kill it, which would tell this test nothing about the hold latch.
  const rng = seededRng(21)
  for (let i = 0; i < 600; i++) {
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
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2, surfaceGravityUnitsPerSecondSq: 0 }
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
    // Pin both ships apart with no queued path each step, so the approach AI
    // can't close the gap and start a firefight — isolates the regen rate as
    // the only thing under test.
    //
    // The gap (20 units) is chosen to sit in a specific window: comfortably
    // beyond the longest weapon range (11) so nothing fires, but INSIDE
    // DISENGAGE_DISTANCE_UNITS (30) so neither ship counts as having broken
    // contact and left. An earlier version of this fixture used 200 units
    // apart, which is now — correctly — a disengagement: the engagement ended
    // on step 1 and only one step of regen ever ran.
    engagements = engagements.map((e) => ({
      ...e,
      participants: e.participants.map((p, idx) => {
        const pos = { x: idx === 0 ? -10 : 10, y: 0, z: 0 }
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
  // ARENA_LIGHT_SPEED_UNITS_PER_SECOND is no longer derived from Sol's own
  // (now true-to-scale, ~131-unit) arena radius — see its own comment for
  // why re-deriving it from a body whose SIZE can change would silently
  // retune every hull's absolute speed too. It's a fixed pacing constant
  // now, so the honest sanity check is just that it still equals the exact
  // value this project has always paced ship speed against, not a claim
  // about how long light takes to cross whatever Sol's radius happens to be
  // today.
  const solDiameterUnits = 2 * arenaBodyRadius(696_000)
  const lightSeconds = solDiameterUnits / ARENA_LIGHT_SPEED_UNITS_PER_SECOND
  check(
    'the light-speed pacing constant is still the fixed value this project has always used',
    Math.abs(ARENA_LIGHT_SPEED_UNITS_PER_SECOND - 1.671) < 0.01,
    `${ARENA_LIGHT_SPEED_UNITS_PER_SECOND.toFixed(3)} units/s`,
  )

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
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2, surfaceGravityUnitsPerSecondSq: 0 }
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
    const star: CombatObstacle = { name: 'Sol', kind: 'star', color: '#ffcc66', position: ARENA_ORIGIN, radiusUnits: 3.9, surfaceGravityUnitsPerSecondSq: 0 }
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
  // window center, not the arena origin, so anything reasoning about nodes
  // has to use the same origin the grid is drawn with.
  {
    const center: ArenaPoint = { x: 3.37, y: -1.11, z: 0.42 }
    const snapped = snapToLatticeNode({ x: center.x + 0.1, y: center.y - 0.1, z: center.z + 0.05 }, center, 'fine')
    check(
      'a point beside the window center snaps to the center node',
      pointDistance(snapped, center) < 1e-9,
      `(${snapped.x.toFixed(2)}, ${snapped.y.toFixed(2)}, ${snapped.z.toFixed(2)})`,
    )
    const offset = fineSpacing * 3
    const snappedOffset = snapToLatticeNode({ x: center.x + offset + 0.2, y: center.y, z: center.z }, center, 'fine')
    check(
      'snapping lands a whole number of fine steps from the center',
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

const STANCE_REPLAN_TOLERANCE_TEST = 0.25

console.log('\n=== 30. Overshot sub-waypoints are dropped, not treated as sub-destinations ===')
{
  const dest: ArenaPoint = { x: 10, y: 0, z: 0 }
  const sub: ArenaPoint = { x: 5, y: 0, z: 0 }
  const path = [sub, dest]

  // Overshot: closer to the destination than the sub-node is, and the
  // direct line onward is clear — the sub-node is dropped.
  {
    const position: ArenaPoint = { x: 8, y: 0, z: 0 }
    const pruned = pruneOvershotWaypoints(path, position, [])
    check('an overshot, unobstructed sub-node is dropped', pruned.length === 1 && pruned[0] === dest, JSON.stringify(pruned))
  }

  // Same geometry, but a body now sits on the direct line to the
  // destination — the detour is still needed, so the sub-node stays.
  {
    const position: ArenaPoint = { x: 8, y: 0, z: 0 }
    const blocker: CombatObstacle = { name: 'Body', kind: 'planet', color: '#fff', position: { x: 9, y: 0, z: 0 }, radiusUnits: 1.5, surfaceGravityUnitsPerSecondSq: 0 }
    const pruned = pruneOvershotWaypoints(path, position, [blocker])
    check('a still-blocked sub-node is kept even after overshoot geometry', pruned.length === 2 && pruned[0] === sub, JSON.stringify(pruned))
  }

  // Not actually overshot — still farther from the destination than the
  // sub-node is — so the sub-node is the honest next step and stays.
  {
    const position: ArenaPoint = { x: 1, y: 0, z: 0 }
    const pruned = pruneOvershotWaypoints(path, position, [])
    check('a sub-node not yet reached is never dropped', pruned.length === 2 && pruned[0] === sub, JSON.stringify(pruned))
  }

  // A single-waypoint path (already just the destination) has nothing to
  // prune — the loop must not touch it.
  {
    const position: ArenaPoint = { x: 1, y: 0, z: 0 }
    const single = [dest]
    const pruned = pruneOvershotWaypoints(single, position, [])
    check('a path with only a destination is returned unchanged', pruned === single)
  }

  // A three-leg detour drops ONLY the sub-nodes that are actually overshot,
  // never the final destination itself.
  {
    const legs: ArenaPoint[] = [{ x: 3, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, dest]
    const position: ArenaPoint = { x: 9, y: 0, z: 0 } // past both sub-nodes, short of the destination
    const pruned = pruneOvershotWaypoints(legs, position, [])
    check('multiple overshot sub-nodes are all dropped, destination retained', pruned.length === 1 && pruned[0] === dest, JSON.stringify(pruned))
  }
}

console.log('\n=== 31. Auto-controlled ships re-track a moving stance destination in real time ===')
{
  const simDays = 100
  let ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  check('engagement forms', engagements.length === 1)

  // Push the hostile far off to one side so the player's balanced-stance
  // approach has real distance to close, then step once so a route locks in.
  engagements[0] = {
    ...engagements[0],
    participants: engagements[0].participants.map((p) => (p.shipId === 'e1' ? { ...p, position: { x: 8, y: 0, z: 8 } } : p)),
  }
  let result = stepEngagements([engagements[0]], ships, simDays)
  let engagement = result.engagements[0]
  const p1After1 = engagement.participants.find((p) => p.shipId === 'p1')!
  check('the player ship queued a route toward the (first) enemy position', p1After1.path.length > 0)
  const firstDestination = p1After1.path[p1After1.path.length - 1]

  // Relocate the enemy FAR away — a real change in "where should I be" —
  // and step again. The route's own endpoint must move to follow it; the
  // old bug was that any ship with SOME path queued was never reconsidered
  // again until it physically arrived.
  engagement = {
    ...engagement,
    participants: engagement.participants.map((p) => (p.shipId === 'e1' ? { ...p, position: { x: -9, y: 0, z: -9 } } : p)),
  }
  result = stepEngagements([engagement], ships, simDays + COMBAT_STEP_DAYS)
  const p1After2 = result.engagements[0].participants.find((p) => p.shipId === 'p1')!
  check(
    'a real, out-of-tolerance target move re-plans the route',
    p1After2.path.length > 0 && pointDistance(p1After2.path[p1After2.path.length - 1], firstDestination) > STANCE_REPLAN_TOLERANCE_TEST,
    `old dest ${JSON.stringify(firstDestination)} -> new dest ${JSON.stringify(p1After2.path[p1After2.path.length - 1])}`,
  )

  // Tiny target jitter, well under the tolerance, must NOT trigger a fresh
  // plan — the participant object should come back completely untouched
  // (same reference), not just "close to the same destination."
  const before = result.engagements[0]
  const jittered = {
    ...before,
    participants: before.participants.map((p) => (p.shipId === 'e1' ? { ...p, position: { x: p.position.x + 0.01, y: p.position.y, z: p.position.z } } : p)),
  }
  const stillResult = stepEngagements([jittered], ships, simDays + COMBAT_STEP_DAYS * 2)
  const p1Before = jittered.participants.find((p) => p.shipId === 'p1')!
  const p1After3 = stillResult.engagements[0].participants.find((p) => p.shipId === 'p1')!
  check('negligible target movement does not force a fresh replan', p1After3.path === p1Before.path)
}

console.log('\n=== 32. A manual (held) order is never overridden by stance re-tracking ===')
{
  const simDays = 100
  let ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  const manualDestination: ArenaPoint = { x: -5, y: 4, z: 1 }
  engagements[0] = {
    ...engagements[0],
    participants: engagements[0].participants.map((p) =>
      p.shipId === 'p1'
        ? { ...orderParticipantTo(p, manualDestination, engagements[0].density, simDays, []), holdPosition: true }
        : p.shipId === 'e1'
          ? { ...p, position: { x: 8, y: 0, z: 8 } }
          : p,
    ),
  }
  const held = engagements[0].participants.find((p) => p.shipId === 'p1')!
  check('manual order is queued and latched', held.path.length > 0 && held.holdPosition)

  const result = stepEngagements([engagements[0]], ships, simDays + COMBAT_STEP_DAYS)
  const after = result.engagements[0].participants.find((p) => p.shipId === 'p1')!
  check(
    'a held manual order still ends on the exact commanded point, untouched by stance tracking',
    pointDistance(after.path[after.path.length - 1] ?? after.position, manualDestination) < 1e-6 || after.path.length === 0,
  )
}

console.log('\n=== 33. Earth combat brings Luna along; other bodies are unaffected ===')
{
  const earthObstacles = obstaclesForLocation({ kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
  check('a fight at Earth includes both Earth and Luna', earthObstacles.length === 2, earthObstacles.map((o) => o.name).join(', '))
  check('Earth itself is still centered at the arena origin', earthObstacles.some((o) => o.name === 'Earth' && nodesEqualLocal(o.position, ARENA_ORIGIN)))
  const luna = earthObstacles.find((o) => o.name === 'Luna')
  check('Luna is present, offset from Earth, and sized smaller than Earth', !!luna && pointDistance(luna.position, ARENA_ORIGIN) > 0)
  if (luna) {
    const earth = earthObstacles.find((o) => o.name === 'Earth')!
    check('Luna is smaller than Earth in the arena', luna.radiusUnits < earth.radiusUnits, `Luna ${luna.radiusUnits.toFixed(2)} vs Earth ${earth.radiusUnits.toFixed(2)}`)
    check('Luna does not overlap Earth', pointDistance(luna.position, earth.position) > luna.radiusUnits + earth.radiusUnits)
  }

  // Not a general moon policy — every other body still gets exactly the one
  // obstacle it always did.
  const marsObstacles = obstaclesForLocation({ kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 })
  check('a fight at Mars is unaffected — still just the one body', marsObstacles.length === 1 && marsObstacles[0].name === 'Mars')
  const solObstacles = obstaclesForLocation({ kind: 'star', starId: 'sol', offset: [0, 0, 0] })
  check('a fight at Sol is unaffected — still just the one body', solObstacles.length === 1 && solObstacles[0].name === 'Sol')
}

console.log('\n=== 34. A ship with dead utility drifts ballistically and can collide with a body ===')
{
  const simDays = 100
  let ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  check('Earth is the obstacle in this fight', engagements[0].obstacles.some((o) => o.name === 'Earth'))
  const earth = engagements[0].obstacles.find((o) => o.name === 'Earth')!

  // Utility offline: zero acceleration/max-speed, so integrateMotion leaves
  // whatever velocity the ship already had completely untouched — see
  // combatResolution's own comment on this at the movement step.
  ships = ships.map((s) => (s.id === 'p1' ? { ...s, combat: { ...s.combat, componentHp: { ...s.combat.componentHp, utility: 0 } } } : s))

  // Positioned just outside the body, already moving straight at its center
  // at a fixed speed — with utility dead this velocity can never change.
  const approachSpeed = 1.5
  const startDistance = earth.radiusUnits + 3
  engagements[0] = {
    ...engagements[0],
    participants: engagements[0].participants.map((p) =>
      p.shipId === 'p1'
        ? { ...p, position: { x: startDistance, y: 0, z: 0 }, velocity: { x: -approachSpeed, y: 0, z: 0 }, holdPosition: true }
        : { ...p, position: { x: 8, y: 8, z: 8 } }, // keep the enemy far away and irrelevant to this scenario
    ),
  }

  let engs = engagements
  let died = false
  let stepsRun = 0
  for (let i = 0; i < 100 && !died; i++) {
    const result = stepEngagements(engs, ships, simDays + i * COMBAT_STEP_DAYS)
    if (result.destroyedShipIds.includes('p1')) died = true
    engs = result.engagements
    stepsRun = i + 1
  }
  check('a ballistic ship that flies into a body is destroyed', died, `after ${stepsRun} steps`)
}

console.log('\n=== 35. integrateMotion: zero thrust preserves velocity exactly (real ballistic drift) ===')
{
  const p: any = {
    shipId: 'p1', side: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 2.3, y: -0.7, z: 1.1 },
    positionSimDays: 0, path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  // maxSpeed=0 and accel=0 together are exactly what zero utility produces
  // (see combatResolution's utility*maneuverUnitsPerSecond/accelerationUnitsPerSecondSq
  // scaling) — the regression this guards is the maxSpeed clamp firing even
  // with no thrust available, snapping velocity to zero on the very next step.
  const next = integrateMotion(p, 0, 0, COMBAT_STEP_SECONDS, simSecondsToDays(COMBAT_STEP_SECONDS))
  check(
    'velocity survives a zero-thrust step completely unchanged',
    next.velocity.x === 2.3 && next.velocity.y === -0.7 && next.velocity.z === 1.1,
    JSON.stringify(next.velocity),
  )
  check(
    'position advances by exactly velocity * dt (real ballistic motion, not a stop)',
    Math.abs(next.position.x - 2.3 * COMBAT_STEP_SECONDS) < 1e-9 &&
      Math.abs(next.position.y - -0.7 * COMBAT_STEP_SECONDS) < 1e-9 &&
      Math.abs(next.position.z - 1.1 * COMBAT_STEP_SECONDS) < 1e-9,
    JSON.stringify(next.position),
  )

  // Sanity check the OTHER direction still works: real thrust (accel>0)
  // still enforces its own maxSpeed ceiling exactly as before.
  const fast: any = { ...p, velocity: { x: 10, y: 0, z: 0 } }
  const throttled = integrateMotion(fast, 1, 5, COMBAT_STEP_SECONDS, 0)
  const speed = Math.hypot(throttled.velocity.x, throttled.velocity.y, throttled.velocity.z)
  check('with real thrust, an over-speed velocity is still clamped down to maxSpeed (1)', Math.abs(speed - 1) < 1e-9, `${speed.toFixed(4)}`)
}

console.log('\n=== 36. Flee stance: runs from the combined enemy fleet, and is the auto-default when disarmed ===')
{
  const profile = SHIP_CLASSES.find((c) => c.id === 'cruiser')!.combat // armed — reach 9
  const mk = (id: string, side: 0 | 1, position: ArenaPoint) => ({
    shipId: id, side, position, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  })
  // Deliberately far: close enough and 'balanced' returns null ("already in
  // range, hold") rather than a real point, same reasoning section 25 uses
  // for its own 'far' fixture.
  const self = mk('p1', 0, { x: 0, y: 0, z: 0 })
  const enemyA = mk('e1', 1, { x: 30, y: 0, z: 0 })
  const enemyB = mk('e2', 1, { x: -30, y: 10, z: 0 })
  const all = [self, enemyA, enemyB]

  const flee = stanceDestination(self, enemyA, profile, 'flee', [], all, true)!
  check('flee produces a real destination', flee !== null)
  const centroid = { x: (enemyA.position.x + enemyB.position.x) / 2, y: (enemyA.position.y + enemyB.position.y) / 2, z: 0 }
  check(
    'flee moves AWAY from the centroid of every hostile, not just the nearest one',
    pointDistance(flee, centroid) > pointDistance(self.position, centroid),
    `self->centroid ${pointDistance(self.position, centroid).toFixed(2)}, dest->centroid ${pointDistance(flee, centroid).toFixed(2)}`,
  )

  // Explicitly chosen, even for an armed ship with a perfectly good weapon.
  const balanced = stanceDestination(self, enemyA, profile, 'balanced', [], all, true)!
  check('flee and balanced genuinely differ for the same armed ship', pointDistance(flee, enemyA.position) > pointDistance(balanced, enemyA.position))

  // No hostiles present — nothing to flee from, so null (same "hold" contract
  // as every other stance's no-op case).
  check('flee with no hostiles present returns null', stanceDestination(self, enemyA, profile, 'flee', [], [self], true) === null)

  // An unarmed hull (no weapon mounts at all) defaults to flee-like behavior
  // regardless of the stance actually stored on it — same fallback rule as
  // the old stall-based one, just pointed at flee per the design ask.
  const unarmedProfile = SHIP_CLASSES.find((c) => c.id === 'swift-courier')!.combat
  check('the fixture really is unarmed', unarmedProfile.weapons.length === 0)
  const unarmedBalanced = stanceDestination(self, enemyA, unarmedProfile, 'balanced', [], all, true)!
  const unarmedFlee = stanceDestination(self, enemyA, unarmedProfile, 'flee', [], all, true)!
  check(
    'an unarmed ship on ANY other stance behaves exactly like flee',
    pointDistance(unarmedBalanced, unarmedFlee) < 1e-9,
    JSON.stringify({ unarmedBalanced, unarmedFlee }),
  )

  // An ARMED ship whose weapons are currently offline (weaponsOnline=false)
  // gets the same automatic override — this is the "or with offline
  // weapons" half of the ask, which a spawn-time default alone could never
  // satisfy (weapons go offline mid-fight, not at spawn).
  const offlineWeapons = stanceDestination(self, enemyA, profile, 'balanced', [], all, false)!
  const onlineWeapons = stanceDestination(self, enemyA, profile, 'balanced', [], all, true)!
  check(
    'the SAME armed ship with weapons knocked offline also defaults to flee',
    pointDistance(offlineWeapons, onlineWeapons) > 1,
    `offline dest ${JSON.stringify(offlineWeapons)}, online (balanced) dest ${JSON.stringify(onlineWeapons)}`,
  )

  // Stall remains an explicit, deliberate choice even for an unarmed ship —
  // it should NOT be silently rerouted to flee (that override only applies
  // to the OTHER stances).
  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#fff', position: ARENA_ORIGIN, radiusUnits: 1.2, surfaceGravityUnitsPerSecondSq: 0 }
  const unarmedStall = stanceDestination({ ...self, position: { x: 4, y: 3, z: 0 } }, enemyA, unarmedProfile, 'stall', [earth], all, true)
  check(
    'an unarmed ship can still explicitly choose stall (not silently overridden to flee)',
    unarmedStall !== null && !hasLineOfFire(new Vector3(unarmedStall.x, unarmedStall.y, unarmedStall.z), new Vector3(enemyA.position.x, enemyA.position.y, enemyA.position.z), [earth]),
  )
}

console.log('\n=== 37. Gravity: real relative strength, inverse-square falloff, thrust exemption ===')
{
  const SOL_MASS_KG = 1.989e30, SOL_RADIUS_KM = 696_000
  const EARTH_MASS_KG = 5.972e24, EARTH_RADIUS_KM = 6371
  const LUNA_MASS_KG = 7.342e22, LUNA_RADIUS_KM = 1737.4

  const gSol = arenaSurfaceGravity(SOL_MASS_KG, SOL_RADIUS_KM)
  const gEarth = arenaSurfaceGravity(EARTH_MASS_KG, EARTH_RADIUS_KM)
  const gLuna = arenaSurfaceGravity(LUNA_MASS_KG, LUNA_RADIUS_KM)

  check('Sol pulls harder than Earth, Earth harder than Luna — real ordering preserved', gSol > gEarth && gEarth > gLuna, `Sol ${gSol.toFixed(4)}, Earth ${gEarth.toFixed(4)}, Luna ${gLuna.toFixed(4)}`)
  // Real ratio g_sol/g_earth ~= 27.9 (694000km/6371km compressed away, but
  // the RATIO is exactly the real one, unaffected by any arena-scale pick).
  check('Sol/Earth ratio matches the real ~28x, not an arbitrary one', Math.abs(gSol / gEarth - 27.9) < 0.5, `${(gSol / gEarth).toFixed(2)}`)
  // Real Luna gravity is famously ~1/6th Earth's.
  check('Luna/Earth ratio matches the real ~1/6', Math.abs(gLuna / gEarth - 1 / 6) < 0.01, `${(gLuna / gEarth).toFixed(4)}`)

  const earth: CombatObstacle = { name: 'Earth', kind: 'planet', color: '#4da6ff', position: ARENA_ORIGIN, radiusUnits: 1.2, surfaceGravityUnitsPerSecondSq: gEarth }

  // At the surface, pull should equal the obstacle's own surface gravity
  // exactly (that's the whole point of parameterising it that way).
  const atSurface = gravitationalAcceleration({ x: earth.radiusUnits, y: 0, z: 0 }, [earth])
  check('at the surface, pull magnitude equals surfaceGravityUnitsPerSecondSq exactly', Math.abs(atSurface.length() - gEarth) < 1e-9, `${atSurface.length().toFixed(6)} vs ${gEarth.toFixed(6)}`)
  check('pull points toward the body (negative x, standing on the +x side)', atSurface.x < 0)

  // Inverse-square: doubling distance from the Center should quarter the pull.
  const atOneRadius = gravitationalAcceleration({ x: earth.radiusUnits, y: 0, z: 0 }, [earth]).length()
  const atTwoRadii = gravitationalAcceleration({ x: earth.radiusUnits * 2, y: 0, z: 0 }, [earth]).length()
  check('doubling distance quarters the pull (inverse-square)', Math.abs(atOneRadius / atTwoRadii - 4) < 1e-6, `ratio ${(atOneRadius / atTwoRadii).toFixed(4)}`)

  // No obstacles, no pull.
  check('with no obstacles, gravity is exactly zero', gravitationalAcceleration({ x: 3, y: 3, z: 3 }, []).length() === 0)

  // Two nearby bodies (Earth + Luna, matching the real arena setup) — a ship
  // between them should feel BOTH, added as real vectors. Checked via
  // superposition (combined == sum of each alone) rather than "combined
  // magnitude is bigger than either alone" — at a point roughly BETWEEN two
  // bodies the two pulls partially point opposite directions and partially
  // cancel, which is correct physics, not a bug, so that comparison isn't a
  // safe way to tell "both counted" from "only one did."
  const luna: CombatObstacle = { name: 'Luna', kind: 'moon', color: '#c9c9c9', position: { x: 4, y: 0.8, z: -2 }, radiusUnits: 0.87, surfaceGravityUnitsPerSecondSq: gLuna }
  const midpoint = { x: (earth.position.x + luna.position.x) / 2, y: (earth.position.y + luna.position.y) / 2, z: (earth.position.z + luna.position.z) / 2 }
  const fromEarthAlone = gravitationalAcceleration(midpoint, [earth])
  const fromLunaAlone = gravitationalAcceleration(midpoint, [luna])
  const fromBoth = gravitationalAcceleration(midpoint, [earth, luna])
  const summed = { x: fromEarthAlone.x + fromLunaAlone.x, y: fromEarthAlone.y + fromLunaAlone.y, z: fromEarthAlone.z + fromLunaAlone.z }
  check(
    'two bodies sum as real vectors (superposition), not "nearest wins"',
    Math.abs(fromBoth.x - summed.x) < 1e-9 && Math.abs(fromBoth.y - summed.y) < 1e-9 && Math.abs(fromBoth.z - summed.z) < 1e-9,
    `combined ${JSON.stringify({ x: fromBoth.x, y: fromBoth.y, z: fromBoth.z })} vs summed ${JSON.stringify(summed)}`,
  )
  check('...and each body alone is nonzero (both genuinely contribute, neither is silently dropped)', fromEarthAlone.length() > 0 && fromLunaAlone.length() > 0)

  // THE CORE DESIGN CONSTRAINT: a ship with WORKING thrust never feels
  // gravity at all — "thrusters let ships treat it as flat space." Only a
  // ship with zero thrust budget (utility destroyed) should be affected.
  const nearBody: any = {
    shipId: 'p1', side: 0, position: { x: earth.radiusUnits + 0.5, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    positionSimDays: 0, path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  const poweredResult = integrateMotion(nearBody, 1, 5, COMBAT_STEP_SECONDS, 0, [earth])
  check('a ship with real thrust is completely unaffected by gravity (flat space)', poweredResult.velocity.x === 0 && poweredResult.velocity.y === 0 && poweredResult.velocity.z === 0, JSON.stringify(poweredResult.velocity))

  // With thrust dead (accel=0, maxSpeed=0), the SAME ship in the SAME spot
  // DOES start falling toward the body.
  const poweredOff = integrateMotion(nearBody, 0, 0, COMBAT_STEP_SECONDS, 0, [earth])
  check('the same ship with dead thrust picks up real velocity toward the body', poweredOff.velocity.x < 0, JSON.stringify(poweredOff.velocity))
  // Ship starts 0.5 units above the surface, not AT it, so the expected
  // pull is gEarth scaled by inverse-square at that distance — not raw
  // surface gravity (this is the actual distance dependence being tested,
  // matching the standalone inverse-square check above).
  const expectedPullAtStart = gEarth * (earth.radiusUnits / (earth.radiusUnits + 0.5)) ** 2
  check(
    '...at exactly gravity(distance) * dt (real Newtonian integration, not a snap)',
    Math.abs(poweredOff.velocity.x - -expectedPullAtStart * COMBAT_STEP_SECONDS) < 1e-9,
    `${poweredOff.velocity.x.toFixed(6)} vs expected ${(-expectedPullAtStart * COMBAT_STEP_SECONDS).toFixed(6)}`,
  )

  // Far from anything, a dead-thrust ship barely accelerates at all —
  // gravity genuinely falls off, it isn't a constant background pull.
  const farAway: any = { ...nearBody, position: { x: 50, y: 0, z: 0 } }
  const farResult = integrateMotion(farAway, 0, 0, COMBAT_STEP_SECONDS, 0, [earth])
  check('far from any body, gravity is negligible over one step', Math.abs(farResult.velocity.x) < 1e-4, `${farResult.velocity.x}`)

  // Sideways velocity at the moment thrust dies should curve under gravity
  // rather than falling straight in — "an orbit of sorts."
  const withSidewaysVelocity: any = { ...nearBody, velocity: { x: 0, y: 0.3, z: 0 } }
  const curved = integrateMotion(withSidewaysVelocity, 0, 0, COMBAT_STEP_SECONDS, 0, [earth])
  check('sideways velocity survives (not overwritten) while gravity also pulls inward — a curve, not a straight fall', curved.velocity.y === 0.3 && curved.velocity.x < 0, JSON.stringify(curved.velocity))
}

console.log('\n=== 38. Chaff: charges, duration, and a severe accuracy penalty at any range ===')
{
  const profile = SHIP_CLASSES.find((c) => c.id === 'cruiser')!.combat
  const fresh = pristineCombatState(profile)
  check('a fresh hull carries the full charge count', fresh.chaffRemaining === CHAFF_CHARGES, `${fresh.chaffRemaining}`)
  check('...and starts with no burst up', !isChaffActive(fresh, 0))

  // Deploying spends exactly one charge and starts a burst of the documented
  // length.
  const deployed = deployChaff(fresh, 100)
  check('deploying spends one charge', deployed.chaffRemaining === CHAFF_CHARGES - 1)
  check('...and the burst is live immediately', isChaffActive(deployed, 100))
  check(
    `...for exactly ${CHAFF_DURATION_SECONDS} sim-seconds`,
    isChaffActive(deployed, 100 + simSecondsToDays(CHAFF_DURATION_SECONDS - 0.01)) &&
      !isChaffActive(deployed, 100 + simSecondsToDays(CHAFF_DURATION_SECONDS + 0.01)),
  )

  // No double-dipping, and no spending past empty. Both return the SAME
  // object, which callers rely on to detect a no-op.
  check('deploying while already active is a no-op (same object)', deployChaff(deployed, 100 + simSecondsToDays(1)) === deployed)
  const spentBoth = deployChaff({ ...deployed, chaffActiveUntilSimDays: null }, 200)
  check('the second charge can be spent once the first lapses', spentBoth.chaffRemaining === 0)
  const empty = { ...spentBoth, chaffActiveUntilSimDays: null }
  check('an empty hull cannot deploy at all (same object back)', deployChaff(empty, 300) === empty)

  // The actual mechanic: a non-interceptable weapon (so point defense can't
  // confound the measurement) fired many times against a chaffed target
  // should land about half as often.
  const laser: WeaponMount = { ...WEAPON_TYPES.laser, damage: 10 }
  check('the test weapon is genuinely not interceptable', !DAMAGE_PROFILES[laser.damageType].interceptable)
  const trials = 4000
  let hitsWithout = 0
  let hitsWith = 0
  const rng = seededRng(97)
  for (let i = 0; i < trials; i++) {
    if (!applyShot(laser, 10, pristineCombatState(profile), profile, null, rng, 0).outcome.missed) hitsWithout++
    if (!applyShot(laser, 10, pristineCombatState(profile), profile, null, rng, CHAFF_MISS_CHANCE).outcome.missed) hitsWith++
  }
  check('without chaff, every shot connects', hitsWithout === trials, `${hitsWithout}/${trials}`)
  const observedMissRate = 1 - hitsWith / trials
  check(
    `with chaff up, about ${CHAFF_MISS_CHANCE * 100}% of shots miss`,
    Math.abs(observedMissRate - CHAFF_MISS_CHANCE) < 0.03,
    `observed ${(observedMissRate * 100).toFixed(1)}%`,
  )

  // A missed shot must do NOTHING — not reduced damage, nothing.
  const target = pristineCombatState(profile)
  const alwaysMiss = () => 0 // rng below the miss chance => miss
  const missed = applyShot(laser, 10, target, profile, null, alwaysMiss, CHAFF_MISS_CHANCE)
  check('a chaffed miss deals no damage at all', missed.next === target && missed.outcome.missed)
  check('...and is reported as a miss, not an interception', missed.outcome.missed && !missed.outcome.intercepted)

}

console.log('\n=== 39. Two hulls can never occupy the same point ===')
{
  const simDays = 100
  const ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)

  // Force both onto EXACTLY the same coordinate — the degenerate case, where
  // there's no line between them to push along.
  engagements[0] = {
    ...engagements[0],
    participants: engagements[0].participants.map((p) => ({
      ...p,
      position: { x: 2, y: 2, z: 2 },
      velocity: { x: 0, y: 0, z: 0 },
      path: [],
      holdPosition: true,
    })),
  }
  const result = stepEngagements([engagements[0]], ships, simDays + COMBAT_STEP_DAYS)
  const [a, b] = result.engagements[0].participants
  const gap = pointDistance(a.position, b.position)
  check('two exactly-coincident hulls are pushed apart', gap > 0, `gap ${gap.toFixed(3)}`)
  check(
    `...to at least the separation distance (${SHIP_SEPARATION_UNITS})`,
    gap >= SHIP_SEPARATION_UNITS - 1e-9,
    `gap ${gap.toFixed(3)}`,
  )

  // A partial overlap resolves symmetrically — neither ship is privileged.
  {
    const engagement = {
      ...engagements[0],
      participants: engagements[0].participants.map((p, i) => ({
        ...p,
        // y: 5 keeps the pair clear of the body at the arena origin — see
        // the collision rule; a fixture sitting inside Earth is destroyed,
        // not separated.
        position: { x: i === 0 ? -0.1 : 0.1, y: 5, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        path: [],
        holdPosition: true,
      })),
    }
    const r = stepEngagements([engagement], ships, simDays + COMBAT_STEP_DAYS)
    const [x, y] = r.engagements[0].participants
    check('a partial overlap is also resolved', pointDistance(x.position, y.position) >= SHIP_SEPARATION_UNITS - 1e-9)
    check(
      '...symmetrically, with the midpoint unmoved',
      Math.abs((x.position.x + y.position.x) / 2) < 1e-9,
      `midpoint x ${((x.position.x + y.position.x) / 2).toFixed(6)}`,
    )
  }

  // Ships that were already comfortably apart must not be nudged at all.
  {
    const engagement = {
      ...engagements[0],
      participants: engagements[0].participants.map((p, i) => ({
        ...p,
        position: { x: i === 0 ? -3 : 3, y: 5, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        path: [],
        holdPosition: true,
      })),
    }
    const r = stepEngagements([engagement], ships, simDays + COMBAT_STEP_DAYS)
    const [x, y] = r.engagements[0].participants
    check('already-separated hulls are left exactly where they were', Math.abs(x.position.x + 3) < 1e-9 && Math.abs(y.position.x - 3) < 1e-9)
  }
}

console.log('\n=== 40. Outrunning everyone disengages a ship without needing FTL ===')
{
  const simDays = 100
  // Open space (no orbiting body) means zero obstacles, so the disengage
  // threshold is exactly DISENGAGE_DISTANCE_UNITS with no body-clearance
  // padding — the flat-constant case. The padded, body-scaled case (Sol) is
  // covered separately by section 51.
  const ships = [makeShip('cruiser', 'p1', 'player', 'Deep Space'), makeShip('cruiser', 'e1', 'hostile', 'Deep Space')]
  let engagements = syncEngagements(ships, [], simDays)

  // Just inside the threshold: still a participant.
  {
    const engagement = {
      ...engagements[0],
      participants: engagements[0].participants.map((p, i) => ({
        ...p,
        position: { x: i === 0 ? 0 : DISENGAGE_DISTANCE_UNITS - 1, y: 5, z: 0 },
        path: [],
        holdPosition: true,
      })),
    }
    const r = stepEngagements([engagement], ships, simDays + COMBAT_STEP_DAYS)
    check('inside the disengage distance, nobody leaves', r.disengagedShipIds.length === 0 && r.engagements.length === 1)
  }

  // Past it: the ship leaves, and the fight ends because only one side is left.
  {
    const engagement = {
      ...engagements[0],
      participants: engagements[0].participants.map((p, i) => ({
        ...p,
        position: { x: i === 0 ? 0 : DISENGAGE_DISTANCE_UNITS + 5, y: 5, z: 0 },
        path: [],
        holdPosition: true,
      })),
    }
    const r = stepEngagements([engagement], ships, simDays + COMBAT_STEP_DAYS)
    check('past the disengage distance, both ships break contact', r.disengagedShipIds.length === 2, r.disengagedShipIds.join(', '))
    check('...and the engagement is over', r.engagements.length === 0)
    check('...without anyone being destroyed', r.destroyedShipIds.length === 0)
    check('...and without any FTL escape', r.escapedShipIds.length === 0)
  }
}

console.log('\n=== 41. Combat catch-up is bounded — no permanent debt from a strategy-time excursion ===')
{
  const maxLagDays = MAX_STEPS_PER_TICK * COMBAT_STEP_DAYS
  const now = 1000

  // Normal case: resolution is a step or two behind, which is just the
  // sub-step remainder being carried. Must be returned untouched, or combat
  // would silently skip time during ordinary tactical play.
  const slightlyBehind = now - COMBAT_STEP_DAYS * 2
  check('a small, ordinary lag is preserved exactly', combatCatchUpCursor(slightlyBehind, now) === slightlyBehind)
  check('being fully caught up is preserved exactly', combatCatchUpCursor(now, now) === now)

  // Exactly at the boundary is still "reachable this tick", so still untouched.
  const atLimit = now - maxLagDays
  check('a lag exactly at the one-tick limit is preserved', combatCatchUpCursor(atLimit, now) === atLimit)

  // The bug: one real second at strategic pace (6 sim-days/sec) leaves the
  // resolver ~6 sim-days behind, which it could only work off at 4
  // sim-seconds per tick.
  const oneRealSecondOfStrategy = 6
  const wayBehind = now - oneRealSecondOfStrategy
  const clamped = combatCatchUpCursor(wayBehind, now)
  check('a huge backlog is discarded, not queued', clamped > wayBehind, `${wayBehind} -> ${clamped}`)
  check(
    '...leaving exactly one tick of work, never more',
    Math.abs(now - clamped - maxLagDays) < 1e-12,
    `lag ${(now - clamped).toFixed(9)}d vs one tick ${maxLagDays.toFixed(9)}d`,
  )

  // Quantify what the old behavior would have cost, so the regression is
  // legible rather than abstract: at 60fps the resolver clears
  // MAX_STEPS_PER_TICK*COMBAT_STEP_SECONDS per frame.
  const secondsOfCombatPerRealSecond = MAX_STEPS_PER_TICK * COMBAT_STEP_SECONDS * 60
  const unclampedBacklogSeconds = simDaysToSeconds(oneRealSecondOfStrategy)
  const realMinutesToBurnDown = unclampedBacklogSeconds / secondsOfCombatPerRealSecond / 60
  check(
    'without the clamp, 1s of strategy time would mean >30 real minutes of hyperspeed combat',
    realMinutesToBurnDown > 30,
    `${realMinutesToBurnDown.toFixed(1)} minutes`,
  )

  // And a very long absence (a real pause, or minutes in strategic time) is
  // bounded identically — the clamp is not a function of how far behind it got.
  check(
    'an arbitrarily long absence still leaves exactly one tick of work',
    Math.abs(now - combatCatchUpCursor(now - 10_000, now) - maxLagDays) < 1e-12,
  )
}

console.log('\n=== 42. System-scale gravity: a stranded hull stays with its body and falls in ===')
{
  const simDays = 100
  const earthPosition = bodyLivePosition('Earth', simDays)

  // Earth really is moving, and inheriting that is the whole point below.
  const earthVelocity = bodyOrbitalVelocity('Earth', simDays)
  check('Earth has real orbital velocity in system units/day', earthVelocity.length() > 0.3 && earthVelocity.length() < 0.4, `${earthVelocity.length().toFixed(4)}`)

  // What actually binds a ship to a planet is the DIFFERENTIAL field, not the
  // net one. At 0.08 units out, the Sun pulls on the ship about five times
  // harder than Earth does — but the Sun pulls Earth essentially the same
  // way, and both are in free fall around it, so the common part cancels.
  // (This is exactly why the Hill sphere exists, and why the stranded-hull
  // simulation below stays bound to Earth despite the Sun dominating the raw
  // field.) Asserting on the net vector would be testing the wrong quantity —
  // an earlier version of this test did, and failed while the behavior it
  // was checking was correct.
  const relativeGravity = (offsetUnits: number) => {
    const at = earthPosition.clone().add(new Vector3(offsetUnits, 0, 0))
    return systemGravityAcceleration(at, simDays).sub(systemGravityAcceleration(earthPosition, simDays))
  }
  const near = earthPosition.clone().add(new Vector3(0.08, 0, 0))
  const gRelNear = relativeGravity(0.08)
  check(
    'relative to its body, gravity near Earth pulls a ship toward Earth',
    gRelNear.clone().normalize().dot(earthPosition.clone().sub(near).normalize()) > 0.99,
  )
  const ratio = gRelNear.length() / relativeGravity(0.16).length()
  check('doubling distance from Earth roughly quarters that pull', ratio > 3 && ratio < 4.2, `ratio ${ratio.toFixed(2)}`)

  check('a point inside Earth is detected as a collision', systemBodyContaining(earthPosition.clone(), simDays) === 'Earth')
  check('open space is not', systemBodyContaining(earthPosition.clone().add(new Vector3(0.08, 0, 0)), simDays) === null)

  // The real scenario: seeded exactly the way useCombatResolver seeds a
  // stranded hull. It must stay gravitationally bound to Earth (never
  // wandering outside roughly its Hill sphere) and eventually strike it —
  // NOT drift off and fall into the Sun, which is what happened before the
  // seed inherited Earth's own orbital velocity.
  const OFFSET = 0.08
  const NUDGE = 0.003
  let position = earthPosition.clone().add(new Vector3(OFFSET, 0, 0))
  let velocity = bodyOrbitalVelocity('Earth', simDays).add(new Vector3(1, 0, 0).multiplyScalar(NUDGE))
  const dt = 0.001
  let days = 0
  let struck: string | null = null
  let maxDistanceFromEarth = 0
  for (let i = 0; i < 250000 && !struck; i++) {
    velocity.add(systemGravityAcceleration(position, simDays + days).multiplyScalar(dt))
    position.add(velocity.clone().multiplyScalar(dt))
    days += dt
    maxDistanceFromEarth = Math.max(maxDistanceFromEarth, position.distanceTo(bodyLivePosition('Earth', simDays + days)))
    struck = systemBodyContaining(position, simDays + days)
    if (days > 200) break
  }
  check('a stranded hull stays gravitationally bound to its body', maxDistanceFromEarth < 0.2, `wandered at most ${maxDistanceFromEarth.toFixed(4)} units (Earth Hill sphere ~0.2)`)
  check('...and eventually falls into that body, not the Sun', struck === 'Earth', `struck ${struck} after ${days.toFixed(1)} days`)
  check('...within an observable span of sim-days', days < 60, `${days.toFixed(1)} days`)
}

console.log('\n=== 43. Point defense is answerable — it dies with the gunnery array ===')
{
  const destroyer = SHIP_CLASSES.find((c) => c.id === 'destroyer')!.combat
  check('the destroyer fixture really has point defense', destroyer.defenses.pointDefenseRating > 0.5, `${destroyer.defenses.pointDefenseRating}`)
  const torpedo: WeaponMount = { ...WEAPON_TYPES.torpedoTube, damage: 40 }
  check('the test weapon is interceptable', DAMAGE_PROFILES[torpedo.damageType].interceptable)

  const interceptRate = (weaponsHp: number) => {
    const rng = seededRng(31)
    let intercepted = 0
    const trials = 4000
    for (let i = 0; i < trials; i++) {
      const state = { ...pristineCombatState(destroyer), componentHp: { ...destroyer.components, weapons: weaponsHp } }
      if (applyShot(torpedo, 40, state, destroyer, null, rng, 0).outcome.intercepted) intercepted++
    }
    return intercepted / trials
  }

  const full = interceptRate(destroyer.components.weapons)
  const half = interceptRate(destroyer.components.weapons / 2)
  const dead = interceptRate(0)

  check('at full weapons health, point defense intercepts at its rated chance',
    Math.abs(full - destroyer.defenses.pointDefenseRating) < 0.03, `${(full * 100).toFixed(1)}% vs rated ${(destroyer.defenses.pointDefenseRating * 100).toFixed(0)}%`)
  check('at half weapons health it intercepts about half as often',
    Math.abs(half - destroyer.defenses.pointDefenseRating / 2) < 0.03, `${(half * 100).toFixed(1)}%`)
  check('with the gunnery array destroyed, point defense is GONE',
    dead === 0, `${(dead * 100).toFixed(1)}%`)
  check('...which is the whole point: torpedoes finally have a setup',
    weaponsEffectiveness(0, destroyer.components.weapons) === 0)
}

console.log('\n=== 44. Fleet-wide focus fire — the answer to being outnumbered ===')
{
  const simDays = 100
  const ships = [
    makeShip('cruiser', 'p1', 'player'),
    makeShip('cruiser', 'p2', 'player'),
    makeShip('cruiser', 'e1', 'hostile'),
    makeShip('cruiser', 'e2', 'hostile'),
  ]
  const engagements = syncEngagements(ships, [], simDays)
  const store = useCombatStore
  store.setState({ engagements })
  const engId = engagements[0].id

  const playerIds = ['p1', 'p2']
  store.getState().setFleetTarget(engId, playerIds, 'e2')
  const after = store.getState().engagements[0].participants
  check('every commanded ship is pointed at the same enemy', playerIds.every((id) => after.find((p) => p.shipId === id)?.targetShipId === 'e2'))
  check('...and enemy ships are left alone', after.filter((p) => p.side === 1).every((p) => p.targetShipId === null))

  store.getState().setFleetTarget(engId, playerIds, null)
  const released = store.getState().engagements[0].participants
  check('the whole fleet can be released back to auto in one action', playerIds.every((id) => released.find((p) => p.shipId === id)?.targetShipId === null))
  store.setState({ engagements: [] })
}

console.log('\n=== 45. Scuttle: a doomed hull converts itself into a trade ===')
{
  // Falloff curve first, on its own.
  check('a scuttle at zero range does full damage at full core', Math.abs(scuttleDamageAt(0, 1) - SCUTTLE_MAX_DAMAGE) < 1e-9)
  check('...and nothing at or beyond the blast radius', scuttleDamageAt(SCUTTLE_BLAST_RADIUS_UNITS, 1) === 0 && scuttleDamageAt(99, 1) === 0)
  check('halfway out it does about half', Math.abs(scuttleDamageAt(SCUTTLE_BLAST_RADIUS_UNITS / 2, 1) - SCUTTLE_MAX_DAMAGE / 2) < 1e-9)
  // The design tension: a healthy hull detonates hard, a nearly-dead one doesn't.
  check('a half-wrecked core yields half the blast', Math.abs(scuttleDamageAt(0, 0.5) - SCUTTLE_MAX_DAMAGE / 2) < 1e-9)
  check('a nearly-dead hull is a poor bomb', scuttleDamageAt(0, 0.05) < SCUTTLE_MAX_DAMAGE * 0.1)

  // End to end through the resolver.
  const simDays = 100
  const ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile'), makeShip('cruiser', 'e2', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  engagements[0] = {
    ...engagements[0],
    participants: engagements[0].participants.map((p) => {
      const base = { ...p, path: [], holdPosition: true, velocity: { x: 0, y: 0, z: 0 } }
      // p1 detonates; e1 is right next to it; e2 is well outside the blast.
      if (p.shipId === 'p1') return { ...base, position: { x: 0, y: 6, z: 0 }, scuttleOrdered: true }
      if (p.shipId === 'e1') return { ...base, position: { x: 0.6, y: 6, z: 0 } }
      return { ...base, position: { x: 20, y: 6, z: 0 } }
    }),
  }

  const before = ships.find((s) => s.id === 'e1')!.combat
  const result = stepEngagements([engagements[0]], ships, simDays + COMBAT_STEP_DAYS)

  check('the scuttling ship destroys itself', result.destroyedShipIds.includes('p1'))
  const e1After = result.shipCombat['e1']
  check('a hostile inside the blast is really hit', !!e1After)
  if (e1After) {
    const shieldsLost = before.shieldHp - e1After.shieldHp
    const armorLost = before.armorHp - e1After.armorHp
    check('...eating shields first', shieldsLost > 0, `shields -${shieldsLost.toFixed(0)}`)
    check('...then armor', armorLost > 0, `armor -${armorLost.toFixed(0)}`)
  }
  const e2After = result.shipCombat['e2']
  const e2Untouched = !e2After || (e2After.shieldHp === before.shieldHp && e2After.armorHp === before.armorHp && e2After.componentHp.core === before.componentHp.core)
  check('a hostile outside the blast radius is untouched', e2Untouched)

  // Friendly fire IS a thing here — a reactor breach doesn't check IFF, so an
  // ally standing right next to a scuttling hull eats the blast exactly like
  // a hostile would. This is the whole point: it's a last resort, not a free
  // area-denial tool that's safe to use inside your own formation.
  {
    const allies = [makeShip('cruiser', 'a1', 'player'), makeShip('cruiser', 'a2', 'player'), makeShip('cruiser', 'x1', 'hostile')]
    let e = syncEngagements(allies, [], simDays)
    e[0] = {
      ...e[0],
      participants: e[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true, velocity: { x: 0, y: 0, z: 0 } }
        if (p.shipId === 'a1') return { ...base, position: { x: 0, y: 6, z: 0 }, scuttleOrdered: true }
        if (p.shipId === 'a2') return { ...base, position: { x: 0.5, y: 6, z: 0 } }
        return { ...base, position: { x: 25, y: 6, z: 0 } }
      }),
    }
    const r = stepEngagements([e[0]], allies, simDays + COMBAT_STEP_DAYS)
    const a2 = r.shipCombat['a2']
    const pristine = allies.find((s) => s.id === 'a2')!.combat
    check('an ally standing right beside the blast is really hit', !!a2 && a2.shieldHp < pristine.shieldHp)
    const x1 = r.shipCombat['x1']
    check('...and the far-off hostile is untouched (still governed by the same falloff)', !x1 || x1.shieldHp === allies.find((s) => s.id === 'x1')!.combat.shieldHp)
  }
}

console.log('\n=== 46. Chaff auto-deploys by default, for every allegiance, and can be turned off ===')
{
  const simDays = 100
  const armPlayer = (p: any) => ({ ...p, position: { x: 2, y: 5, z: 2 }, path: [], holdPosition: true, velocity: { x: 0, y: 0, z: 0 } })

  const runOnce = (playerAuto: boolean) => {
    let ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile')]
    ships = ships.map((s) => (s.id === 'p1' ? { ...s, chaffAutoDeploy: playerAuto } : s))
    let engagements = syncEngagements(ships, [], simDays)
    engagements[0] = {
      ...engagements[0],
      participants: engagements[0].participants.map((p) =>
        p.shipId === 'p1' ? armPlayer(p) : { ...p, position: { x: 4, y: 5, z: 4 }, path: [], holdPosition: true, velocity: { x: 0, y: 0, z: 0 } },
      ),
    }
    // Damage p1 down into the AI threshold band so there is something to react to.
    let dmg = ships[0].combat
    dmg = { ...dmg, componentHp: { ...dmg.componentHp }, shieldHp: 0, armorHp: 0 }
    ships = ships.map((s) => (s.id === 'p1' ? { ...s, combat: dmg } : s))
    const result = stepEngagements(engagements, ships, simDays + COMBAT_STEP_DAYS)
    const after = result.shipCombat['p1']
    return after ? after.chaffRemaining < CHAFF_CHARGES : false
  }

  check('with auto-deploy on, a player ship spends a charge on its own', runOnce(true))
  check('with auto-deploy off, the SAME player ship does not', !runOnce(false))
}

console.log('\n=== 47. Chase overrides the stance\'s own range-holding ===')
{
  const profile = SHIP_CLASSES.find((c) => c.id === 'cruiser')!.combat // reach 9, standoff 0.7*9=6.3
  const mk = (position: any, extra: Partial<ReturnType<typeof mk>> = {}) => ({
    shipId: 'x', side: 0 as const, position, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
    ...extra,
  })
  const enemy = { ...mk({ x: 0, y: 0, z: 0 }), shipId: 'e', side: 1 as const }

  // Already well inside Balanced's own hold range — a non-chasing ship would
  // stop advancing here (stanceDestination returns null, same as the
  // in-band Kite case above).
  const settled = mk({ x: 5, y: 0, z: 0 })
  check('sanity: Balanced already holds station at this range', stanceDestination(settled, enemy, profile, 'balanced', []) === null)

  const chaseDest = approachNode(settled, enemy, profile, [], CHASE_STANDOFF_UNITS)!
  const chaseDist = pointDistance(chaseDest, enemy.position)
  check('chase keeps closing well past where Balanced would have stopped', chaseDist < 5, `${chaseDist.toFixed(2)}`)
  check('chase closes to near point-blank, not any weapon range', chaseDist < 1, `${chaseDist.toFixed(2)}`)

  // holdPosition must win outright over chasing in the real resolver
  // pipeline, not just in isolated destination math — a ship latched to a
  // manual order shouldn't drift toward the enemy just because `chasing` is
  // still (harmlessly, per CombatViewScene) true underneath it.
  {
    const simDays = 100
    const ships = [
      { ...makeShip('cruiser', 'p1', 'player'), stance: 'swarm' as const },
      makeShip('corvette', 'e1', 'hostile'),
    ]
    let engagements = syncEngagements(ships, [], simDays)
    engagements = [
      {
        ...engagements[0],
        participants: engagements[0].participants.map((p) =>
          p.shipId === 'p1' ? { ...p, holdPosition: true, chasing: true, path: [] } : p,
        ),
      },
    ]
    const before = engagements[0].participants.find((p) => p.shipId === 'p1')!.position
    const result = stepEngagements(engagements, ships, simDays + COMBAT_STEP_DAYS)
    const after = result.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check('holdPosition still wins over a stale chasing flag', !!after && pointDistance(after.position, before) < 1e-9)
  }
}

console.log('\n=== 48. Entering the arena with no fight — and staying after one ends ===')
{
  const simDays = 100

  // A lone player ship, no hostiles anywhere — the normal sync path refuses
  // this outright (nothing contested), but the manual "just let me look"
  // path should still produce a real, usable engagement.
  {
    const ship = makeShip('cruiser', 'p1', 'player')
    const solo = createSoloEngagement(ship, [ship], simDays)
    check('createSoloEngagement works with zero hostiles present', !!solo && solo.participants.length === 1)
    check('...and the normal sync path refuses the same roster', syncEngagements([ship], [], simDays).length === 0)

    // Once it exists, syncEngagements must not immediately erase it again —
    // this is what keeps a manually-opened arena (or a just-won battle) from
    // vanishing on the very next resolver tick.
    if (solo) {
      const resynced = syncEngagements([ship], [solo], simDays + COMBAT_STEP_DAYS)
      check('an already-open engagement survives a sync pass with no hostiles', resynced.length === 1)
      check('...keeping the same id', resynced[0]?.id === solo.id)
    }
  }

  // A real fight that resolves down to one side shouldn't vanish either —
  // same mechanism, reached the normal way instead of the manual button.
  {
    const ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile')]
    const contested = syncEngagements(ships, [], simDays)
    check('sanity: a real hostile pair still opens an engagement normally', contested.length === 1)

    const victorOnly = [ships[0]] // the hostile is gone — destroyed, disengaged, whatever
    const afterVictory = syncEngagements(victorOnly, contested, simDays + COMBAT_STEP_DAYS)
    check('a fight that resolves to one side lingers rather than disappearing', afterVictory.length === 1)
    check('...with only the survivor on the roster', afterVictory[0]?.participants.length === 1)
  }

  // createSoloEngagement should still refuse a ship that isn't actually at
  // rest anywhere combat-relevant.
  {
    const ship = { ...makeShip('cruiser', 'p1', 'player'), location: { kind: 'interstellar-point' as const, position: [1, 2, 3] as [number, number, number] } }
    check('refuses a ship with no combat-location key', createSoloEngagement(ship, [ship], simDays) === null)
  }
}

console.log('\n=== 49. Bodies are true to scale, and Luna actually orbits ===')
{
  // Earth is the anchor — unchanged by the switch from fourth-root
  // compression to a real linear ratio, since its own ratio against itself
  // is always 1. Everything ELSE should now be proportionally real.
  const earthRadius = arenaBodyRadius(6371)
  const solRadius = arenaBodyRadius(696_000)
  check('Earth stays at its historical 1.2-unit radius (the scale anchor)', Math.abs(earthRadius - 1.2) < 0.001)
  check('Sol is now genuinely vast next to Earth (~109x), not the old ~3x', solRadius / earthRadius > 100, `${(solRadius / earthRadius).toFixed(1)}x`)

  const earthObstaclesA = obstaclesForLocation({ kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, 0)
  const lunaA = earthObstaclesA.find((o) => o.name === 'Luna')!
  const earthObstaclesB = obstaclesForLocation({ kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, 5)
  const lunaB = earthObstaclesB.find((o) => o.name === 'Luna')!
  check('Luna is genuinely far from Earth now (~72 units, real scale) rather than the old ~4.5', pointDistance(lunaA.position, ARENA_ORIGIN) > 60, pointDistance(lunaA.position, ARENA_ORIGIN).toFixed(1))
  check('Luna has moved between two different simDays — it actually orbits', pointDistance(lunaA.position, lunaB.position) > 0.01, pointDistance(lunaA.position, lunaB.position).toFixed(3))
  check('Luna carries a live (nonzero) tangential velocity', lunaA.velocity !== undefined && pointDistance(lunaA.velocity, ARENA_ORIGIN) > 0)
  // A static planet/star has no velocity at all in this frame (undefined,
  // not zero — see CombatObstacle's own comment on why that distinction
  // matters), which is the flip side of Luna actually having one.
  const earth = earthObstaclesA.find((o) => o.name === 'Earth')!
  check('Earth itself carries no velocity — it defines this frame, it doesn\'t move within it', earth.velocity === undefined)

  // And it keeps moving step-to-step WITHIN a running engagement, not just
  // between two independent obstaclesForLocation calls.
  const simDays = 100
  const ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  const lunaStart = engagements[0].obstacles.find((o) => o.name === 'Luna')!.position
  const rng = seededRng(3)
  for (let i = 0; i < 50; i++) {
    const now = simDays + COMBAT_STEP_DAYS * (i + 1)
    const r = stepEngagements(engagements, ships, now, rng)
    engagements = r.engagements
  }
  const lunaEnd = engagements[0]?.obstacles.find((o) => o.name === 'Luna')?.position
  check('Luna keeps moving across steps within one live engagement', !!lunaEnd && pointDistance(lunaStart, lunaEnd) > 0)
}

console.log('\n=== 50. Inherit Velocity — locking a ship\'s motion onto a body\'s own ===')
{
  const simDays = 100
  const ships = [makeShip('cruiser', 'p1', 'player'), makeShip('cruiser', 'e1', 'hostile')]
  let engagements = syncEngagements(ships, [], simDays)
  const luna = engagements[0].obstacles.find((o) => o.name === 'Luna')!
  engagements = [
    {
      ...engagements[0],
      participants: engagements[0].participants.map((p) =>
        p.shipId === 'p1' ? { ...p, inheritVelocityFrom: 'Luna', path: [], holdPosition: false } : p,
      ),
    },
  ]
  const before = engagements[0].participants.find((p) => p.shipId === 'p1')!.position
  const rng = seededRng(11)
  const r = stepEngagements(engagements, ships, simDays + COMBAT_STEP_DAYS, rng)
  const after = r.engagements[0]?.participants.find((p) => p.shipId === 'p1')
  check('a ship locked to Luna picks up Luna\'s own velocity', !!after && pointDistance(after.velocity, luna.velocity!) < 1e-9)
  const expectedMove = { x: luna.velocity!.x * COMBAT_STEP_SECONDS, y: luna.velocity!.y * COMBAT_STEP_SECONDS, z: luna.velocity!.z * COMBAT_STEP_SECONDS }
  const expectedPos = { x: before.x + expectedMove.x, y: before.y + expectedMove.y, z: before.z + expectedMove.z }
  check('...and moved by exactly that velocity times one step', !!after && pointDistance(after.position, expectedPos) < 1e-9)

  // holdPosition still wins outright, same as it does over chasing.
  const held = [
    {
      ...engagements[0],
      participants: engagements[0].participants.map((p) =>
        p.shipId === 'p1' ? { ...p, inheritVelocityFrom: 'Luna', holdPosition: true, path: [] } : p,
      ),
    },
  ]
  const heldBefore = held[0].participants.find((p) => p.shipId === 'p1')!.position
  const heldResult = stepEngagements(held, ships, simDays + COMBAT_STEP_DAYS, seededRng(11))
  const heldAfter = heldResult.engagements[0]?.participants.find((p) => p.shipId === 'p1')
  check('holdPosition overrides a stale inherit-velocity lock, same as it does chasing', !!heldAfter && pointDistance(heldAfter.position, heldBefore) < 1e-9)
}

console.log('\n=== 51. Fleets never spawn inside a body bigger than the old fixed spawn face ===')
{
  // The actual reported bug: two ships spawned "at Sol" (a real star, whose
  // true-to-scale arena radius — see arenaBodyRadius — is now ~131 units)
  // used to spawn at a fixed ±6-unit face, which is WELL inside the star.
  // The resolver's own body-collision check (a ship whose position lies
  // inside an obstacle is destroyed) then killed both of them on step one —
  // "both ships disappear" the instant you unpause. startingPoint now takes
  // a minimum half-span computed from the engagement's own obstacles.
  const ships = [makeShip('corvette', 'p1', 'player', 'Sol'), makeShip('corvette', 'e1', 'hostile', 'Sol')]
  const engagements = syncEngagements(ships, [], 0)
  check('a fight opens at Sol', engagements.length === 1)
  const sol = engagements[0].obstacles.find((o) => o.name === 'Sol')
  check('sanity: Sol really is enormous in the arena now', !!sol && sol.radiusUnits > 100, sol?.radiusUnits.toFixed(1))
  const insideSol = engagements[0].participants.some((p) => pointDistance(p.position, ARENA_ORIGIN) < (sol?.radiusUnits ?? 0))
  check('neither fleet spawns inside the star', !insideSol)

  const rng = seededRng(1)
  const result = stepEngagements(engagements, ships, COMBAT_STEP_DAYS, rng)
  check('nobody is destroyed on the very first step just by existing there', result.destroyedShipIds.length === 0, result.destroyedShipIds.join(','))
}

console.log('\n=== 52. The "fleet" stance is a sentinel — it borrows its Fleet\'s actual strategy ===')
{
  const ship = { ...makeShip('cruiser', 'p1', 'player'), stance: 'fleet' as const, fleetId: 'f1' }
  const withStrategy: Fleet[] = [{ id: 'f1', name: '1st Fleet', allegiance: 'player', strategy: 'kite' }]
  check("resolves to the fleet's own strategy", effectiveStrategy(ship, withStrategy) === 'kite')

  const noStrategy: Fleet[] = [{ id: 'f1', name: '1st Fleet', allegiance: 'player', strategy: null }]
  check('falls back to Balanced when the fleet has no strategy set', effectiveStrategy(ship, noStrategy) === 'balanced')

  const normalShip = { ...makeShip('cruiser', 'p2', 'player'), stance: 'kite' as const }
  check("a ship not on 'fleet' just uses its own stance, fleets or not", effectiveStrategy(normalShip, withStrategy) === 'kite')
}

console.log('\n=== 53. Divide — spreads target assignment across the fleet, not just movement ===')
{
  const simDays = 100
  const p1 = makeShip('cruiser', 'p1', 'player', 'Earth', 'divide-fleet')
  const p2 = makeShip('cruiser', 'p2', 'player', 'Earth', 'divide-fleet')
  const e1 = makeShip('cruiser', 'e1', 'hostile', 'Earth')
  const e2 = makeShip('cruiser', 'e2', 'hostile', 'Earth')
  const ships = [p1, p2, e1, e2]
  const fleets: Fleet[] = [{ id: 'divide-fleet', name: 'Test', allegiance: 'player', strategy: 'divide' }]
  const shipsById = new Map(ships.map((s) => [s.id, s]))
  const engagements = syncEngagements(ships, [], simDays)
  check('a real fight opens', engagements.length === 1)
  const eng = engagements[0]

  const profile1 = shipCombatProfile(p1)!
  const assign1 = divideAssignment(
    eng.participants.find((p) => p.shipId === 'p1')!,
    p1,
    profile1,
    eng.participants,
    shipsById,
    fleets,
    eng.obstacles,
  )
  check('divide assigns p1 a real target', !!assign1.targetShipId)

  // p1 has now locked onto its pick, same as stepEngagements would persist
  // it (see the approach step's targetShipId handling) — p2's own pick has
  // to route around that claim.
  const afterP1 = eng.participants.map((p) => (p.shipId === 'p1' ? { ...p, targetShipId: assign1.targetShipId ?? null } : p))
  const profile2 = shipCombatProfile(p2)!
  const assign2 = divideAssignment(
    afterP1.find((p) => p.shipId === 'p2')!,
    p2,
    profile2,
    afterP1,
    shipsById,
    fleets,
    eng.obstacles,
  )
  check(
    "divide gives p2 the OTHER enemy, not the one p1 already claimed",
    !!assign2.targetShipId && assign2.targetShipId !== assign1.targetShipId,
    `p1 -> ${assign1.targetShipId}, p2 -> ${assign2.targetShipId}`,
  )

  // Once p2 is ALSO locked on, asking again should keep both picks stable
  // rather than reshuffling every call — same "don't flicker" reasoning the
  // real per-step replan tolerance relies on.
  const afterBoth = afterP1.map((p) => (p.shipId === 'p2' ? { ...p, targetShipId: assign2.targetShipId ?? null } : p))
  const reassign1 = divideAssignment(
    afterBoth.find((p) => p.shipId === 'p1')!,
    p1,
    profile1,
    afterBoth,
    shipsById,
    fleets,
    eng.obstacles,
  )
  check('an already-locked ship keeps its own pick rather than re-rolling', reassign1.targetShipId === assign1.targetShipId)
}

console.log('\n=== 54. Condense — regroups the fleet on its own centroid ===')
{
  const simDays = 100
  const p1 = makeShip('cruiser', 'p1', 'player', 'Earth', 'condense-fleet')
  const p2 = makeShip('cruiser', 'p2', 'player', 'Earth', 'condense-fleet')
  const p3 = makeShip('cruiser', 'p3', 'player', 'Earth', 'condense-fleet')
  const ships = [p1, p2, p3]
  const shipsById = new Map(ships.map((s) => [s.id, s]))
  const solo = createSoloEngagement(p1, ships, simDays)!
  check('a solo (no-fight) engagement opens for the whole fleet', solo.participants.length === 3)

  // Spread out along x so the centroid (x=0) is unambiguous and distinct
  // from any one ship's own position.
  const spread = solo.participants.map((p) => {
    if (p.shipId === 'p1') return { ...p, position: { x: -9, y: 0, z: p.position.z } }
    if (p.shipId === 'p2') return { ...p, position: { x: 0, y: 0, z: p.position.z } }
    return { ...p, position: { x: 9, y: 0, z: p.position.z } }
  })

  const dest1 = condenseDestination(spread.find((p) => p.shipId === 'p1')!, p1, spread, shipsById)
  check('condense pulls an off-center ship toward the centroid', !!dest1 && Math.abs(dest1.x) < 1, dest1 ? dest1.x.toFixed(2) : 'null')

  const dest2 = condenseDestination(spread.find((p) => p.shipId === 'p2')!, p2, spread, shipsById)
  check('a ship already at the centroid holds rather than nudging in place', dest2 === null)

  const lonely = makeShip('cruiser', 'lonely', 'player', 'Earth', 'lonely-fleet')
  const loneEngagement = createSoloEngagement(lonely, [lonely], simDays)!
  const loneShipsById = new Map([[lonely.id, lonely]])
  check(
    'alone in the fight, condense has nothing to regroup toward',
    condenseDestination(loneEngagement.participants[0], lonely, loneEngagement.participants, loneShipsById) === null,
  )
}

console.log('\n=== 55. Screen — the toughest half forms a wall between the fleet and the enemy ===')
{
  const simDays = 100
  const b1 = makeShip('battleship', 'b1', 'player', 'Earth', 'screen-fleet')
  const b2 = makeShip('battleship', 'b2', 'player', 'Earth', 'screen-fleet')
  const c1 = makeShip('corvette', 'c1', 'player', 'Earth', 'screen-fleet')
  const c2 = makeShip('corvette', 'c2', 'player', 'Earth', 'screen-fleet')
  const e1 = makeShip('cruiser', 'e1', 'hostile', 'Earth')
  const ships = [b1, b2, c1, c2, e1]
  const shipsById = new Map(ships.map((s) => [s.id, s]))
  const engagements = syncEngagements(ships, [], simDays)
  check('a real fight opens', engagements.length === 1)
  const eng = engagements[0]

  // Cluster the fleet together, off to one side, so its centroid is
  // well-defined and distinct both from the enemy and from any one member's
  // own position.
  const clustered = eng.participants.map((p) => {
    if (p.shipId === 'b1') return { ...p, position: { x: -1, y: 0, z: -5 } }
    if (p.shipId === 'b2') return { ...p, position: { x: 1, y: 0, z: -5 } }
    if (p.shipId === 'c1') return { ...p, position: { x: -1, y: 0, z: -4 } }
    if (p.shipId === 'c2') return { ...p, position: { x: 1, y: 0, z: -4 } }
    return p
  })
  const enemyPos = clustered.find((p) => p.shipId === 'e1')!.position

  const screenerDest = screenDestination(clustered.find((p) => p.shipId === 'b1')!, b1, clustered, shipsById, eng.obstacles)
  const screenedDest = screenDestination(clustered.find((p) => p.shipId === 'c1')!, c1, clustered, shipsById, eng.obstacles)
  check('the tougher (battleship) half gets a wall position', !!screenerDest)
  check('the frailer (corvette) half falls back toward the centroid instead', !!screenedDest)
  if (screenerDest && screenedDest) {
    const dScreener = pointDistance(screenerDest, enemyPos)
    const dScreened = pointDistance(screenedDest, enemyPos)
    check(
      'the wall position sits closer to the enemy than the fallback position',
      dScreener < dScreened,
      `wall ${dScreener.toFixed(2)} vs fallback ${dScreened.toFixed(2)}`,
    )
  }

  const lonelyScreen = makeShip('battleship', 'lonely', 'player', 'Earth', 'lonely-screen-fleet')
  const loneEngagement = createSoloEngagement(lonelyScreen, [lonelyScreen], simDays)!
  const loneShipsById = new Map([[lonelyScreen.id, lonelyScreen]])
  check(
    'alone in the fight, screen has no one to shield and no wall to form',
    screenDestination(loneEngagement.participants[0], lonelyScreen, loneEngagement.participants, loneShipsById, loneEngagement.obstacles) === null,
  )
}

console.log('\n=== 56. Range favor — who can hit whom, and who\'s "favored" overall ===')
{
  const simDays = 100
  const frigate = makeShip('frigate', 'p1', 'player', 'Earth') // longest range: missile battery, 11 units
  const corvette = makeShip('corvette', 'e1', 'hostile', 'Earth') // longest range: autocannon, 3 units
  const ships = [frigate, corvette]
  const base = syncEngagements(ships, [], simDays)[0]
  // Positioned well clear of Earth's own position (the arena origin) so the
  // segment between them never clips the body itself — same fix the live
  // browser check needed.
  const at = (engagement: typeof base, px: number, ex: number) => ({
    ...engagement,
    participants: engagement.participants.map((p) => (p.shipId === 'p1' ? { ...p, position: { x: px, y: 0, z: 0 } } : { ...p, position: { x: ex, y: 0, z: 0 } })),
  })

  // Distance 7: inside the frigate's 11-unit reach, outside the corvette's 3.
  const asym = at(base, 20, 27)
  const p1 = asym.participants.find((p) => p.shipId === 'p1')!
  const e1 = asym.participants.find((p) => p.shipId === 'e1')!
  const status = rangeContactStatus(p1, frigate, e1, corvette, simDays)
  check('at distance 7, the longer-ranged frigate can hit', status.aCanHit)
  check('...but the shorter-ranged corvette cannot hit back', !status.bCanHit)
  check('the frigate itself reads as favored', rangeFavor(p1, asym, ships, simDays) === 'favored')
  check('the corvette itself reads as unfavored', rangeFavor(e1, asym, ships, simDays) === 'unfavored')

  // Distance 1.5: inside both ranges.
  const mutual = at(base, 20, 21.5)
  const p1m = mutual.participants.find((p) => p.shipId === 'p1')!
  const e1m = mutual.participants.find((p) => p.shipId === 'e1')!
  const mutualStatus = rangeContactStatus(p1m, frigate, e1m, corvette, simDays)
  check('at close range both can hit', mutualStatus.aCanHit && mutualStatus.bCanHit)
  check('a purely mutual contact reads as even, not favored either way', rangeFavor(p1m, mutual, ships, simDays) === 'even')

  // Distance 80: outside both ranges — activeEnemyContacts excludes the
  // pair entirely, so there's nothing to be favored or unfavored about.
  const far = at(base, 20, 100)
  const p1f = far.participants.find((p) => p.shipId === 'p1')!
  check('too far apart for either — no live contact at all — reads as even', rangeFavor(p1f, far, ships, simDays) === 'even')
}

console.log('\n=== 57. Ramming: a committed collision that hurts both hulls ===')
{
  // Falloff curve first, on its own — mirrors scuttleDamageAt's own checks.
  check('a stationary bump does no damage', ramDamageAt(0) === 0)
  check('a full-speed ram does the max', ramDamageAt(1) === RAM_MAX_TARGET_DAMAGE)
  check('...and clamps rather than exceeding the max beyond a fraction of 1', ramDamageAt(1.5) === RAM_MAX_TARGET_DAMAGE)
  check('...and clamps at zero below a fraction of 0', ramDamageAt(-1) === 0)
  check('halfway does about half', Math.abs(ramDamageAt(0.5) - RAM_MAX_TARGET_DAMAGE / 2) < 1e-9)

  // End to end through the resolver: two unarmed couriers already in
  // contact, the rammer closing at a known fraction of its own top speed.
  // Unarmed on BOTH sides deliberately — this isolates the ramming-impact
  // step's own math from ordinary weapons fire, which would otherwise also
  // land this same step (point-blank range is well inside every mount's
  // reach) and throw off the exact-value check below. The separate
  // unarmed-vs-armed check further down covers a real gun exchange layered
  // on top.
  const simDays = 100
  const rammer = makeShip('swift-courier', 'p1', 'player')
  const victim = makeShip('swift-courier', 'e1', 'hostile')
  const ships = [rammer, victim]
  const profile = shipCombatProfile(rammer)!
  // Deliberately well under top speed (not 0.9x) — a courier's total HP pool
  // (shields+armor+core) is thin enough that a near-max-speed ram would
  // overkill it outright, which would cap the MEASURED loss at the ship's
  // own HP total rather than at what the ram actually dealt, breaking the
  // exact-value check below. A moderate closing speed keeps the hit survivable
  // so what's measured is the ram's own damage, not a destruction cap.
  const closingSpeed = profile.maneuverUnitsPerSecond * 0.4
  const engagements = syncEngagements(ships, [], simDays)
  engagements[0] = {
    ...engagements[0],
    participants: engagements[0].participants.map((p) => {
      const base = { ...p, path: [], holdPosition: true }
      // holdPosition is deliberate here — it makes the approach step a no-op
      // (see stepEngagements' own top-of-loop check), so this test exercises
      // the ramming-impact step in isolation rather than also depending on
      // this step's lattice-planning outcome.
      if (p.shipId === 'p1') {
        return { ...base, position: { x: 0, y: 6, z: 0 }, velocity: { x: closingSpeed, y: 0, z: 0 }, ramming: true, targetShipId: 'e1' }
      }
      return { ...base, position: { x: 0.3, y: 6, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }
    }),
  }

  // Predicted via the exact same integration rule integrateMotion uses for an
  // empty path (steer toward zero, budget-limited by accel*dt) — the ram
  // order doesn't touch movement, so the rammer decelerates by its own
  // acceleration budget for this one step before the impact is measured.
  const expectedNewSpeed = Math.max(0, closingSpeed - profile.accelerationUnitsPerSecondSq * COMBAT_STEP_SECONDS)
  const expectedFraction = Math.min(1, expectedNewSpeed / profile.maneuverUnitsPerSecond)
  const expectedTargetDamage = ramDamageAt(expectedFraction)
  const expectedSelfDamage = expectedTargetDamage * RAM_SELF_DAMAGE_FRACTION

  const beforeRammer = rammer.combat
  const beforeVictim = victim.combat
  const result = stepEngagements([engagements[0]], ships, simDays + COMBAT_STEP_DAYS)

  const victimAfter = result.shipCombat['e1']
  const rammerAfter = result.shipCombat['p1']
  check('the rammed ship is really hit', !!victimAfter)
  check('the rammer takes damage too', !!rammerAfter)
  if (victimAfter && rammerAfter) {
    const totalLoss = (before: typeof beforeVictim, after: typeof victimAfter) =>
      before.shieldHp - after!.shieldHp + (before.armorHp - after!.armorHp) + (before.componentHp.core - after!.componentHp.core)
    const victimLoss = totalLoss(beforeVictim, victimAfter)
    const rammerLoss = totalLoss(beforeRammer, rammerAfter)
    check(
      'the target takes exactly the speed-scaled damage predicted',
      Math.abs(victimLoss - expectedTargetDamage) < 1e-6,
      `expected ${expectedTargetDamage.toFixed(2)}, got ${victimLoss.toFixed(2)}`,
    )
    check(
      'the rammer takes exactly its fixed share of what it dealt',
      Math.abs(rammerLoss - expectedSelfDamage) < 1e-6,
      `expected ${expectedSelfDamage.toFixed(2)}, got ${rammerLoss.toFixed(2)}`,
    )
  }

  const rammerParticipantAfter = result.engagements[0]?.participants.find((p) => p.shipId === 'p1')
  check(
    'the ram order is spent the instant it connects — one hit, not continuous grinding contact',
    !!rammerParticipantAfter && rammerParticipantAfter.ramming === false,
  )

  // A ram works even for a totally unarmed ship — chase/approachNode refuse
  // to close for one (nothing to bring into weapon range), but ramming has no
  // such gate, since colliding isn't gated on having a gun.
  {
    const unarmedRammer = makeShip('swift-courier', 'u1', 'player')
    const unarmedVictim = makeShip('corvette', 'e2', 'hostile')
    const unarmedShips = [unarmedRammer, unarmedVictim]
    const unarmedProfile = shipCombatProfile(unarmedRammer)!
    check('the courier really is unarmed', unarmedProfile.weapons.length === 0)
    const e = syncEngagements(unarmedShips, [], simDays)
    e[0] = {
      ...e[0],
      participants: e[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        if (p.shipId === 'u1') {
          return {
            ...base,
            position: { x: 0, y: 6, z: 0 },
            velocity: { x: unarmedProfile.maneuverUnitsPerSecond * 0.9, y: 0, z: 0 },
            ramming: true,
            targetShipId: 'e2',
          }
        }
        return { ...base, position: { x: 0.3, y: 6, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }
      }),
    }
    const r = stepEngagements([e[0]], unarmedShips, simDays + COMBAT_STEP_DAYS)
    check('an unarmed ship can still ram and hurt its target', !!r.shipCombat['e2'])
    check('...and takes damage itself doing it', !!r.shipCombat['u1'])
  }
}

console.log('\n=== 58. Missile damage falloff and torpedo accuracy (range + target size) ===')
{
  check('rangeEffectiveness is full strength at and inside optimal', rangeEffectiveness(3, 5, 10, 0.6) === 1 && rangeEffectiveness(5, 5, 10, 0.6) === 1)
  check(
    'rangeEffectiveness tapers linearly to the floor exactly at max range',
    Math.abs(rangeEffectiveness(10, 5, 10, 0.6) - 0.6) < 1e-9,
  )
  check(
    'rangeEffectiveness is halfway between 1 and floor at the midpoint',
    Math.abs(rangeEffectiveness(7.5, 5, 10, 0.6) - 0.8) < 1e-9,
  )
  check('rangeEffectiveness never extrapolates past max range', rangeEffectiveness(50, 5, 10, 0.6) === 0.6)

  const missile: WeaponMount = { ...WEAPON_TYPES.missileBattery }
  check('missile damage is full at optimal range', missileDamageMultiplier(missile.optimalRangeUnits!, missile) === 1)
  check(
    'missile damage falls off toward the floor at max range',
    Math.abs(missileDamageMultiplier(missile.rangeUnits, missile) - MISSILE_FALLOFF_FLOOR) < 1e-9,
  )
  check('missile damage is unaffected closer than optimal', missileDamageMultiplier(1, missile) === 1)

  const torpedo: WeaponMount = { ...WEAPON_TYPES.torpedoTube }
  const accAtOptimal = torpedoAccuracy(torpedo.optimalRangeUnits!, torpedo, 'large', 0)
  const accAtMax = torpedoAccuracy(torpedo.rangeUnits, torpedo, 'large', 0)
  check('torpedo accuracy is higher at optimal range than at max range', accAtOptimal > accAtMax)
  check(
    'torpedo accuracy vs a small target is worse than vs an X-class target, same range',
    torpedoAccuracy(torpedo.optimalRangeUnits!, torpedo, 'small', 0) < torpedoAccuracy(torpedo.optimalRangeUnits!, torpedo, 'x', 0),
  )
  check(
    'evasion reduces torpedo accuracy',
    torpedoAccuracy(torpedo.optimalRangeUnits!, torpedo, 'medium', 0.3) < torpedoAccuracy(torpedo.optimalRangeUnits!, torpedo, 'medium', 0),
  )
  check(
    'torpedo accuracy never hits the hard 0%/100% edges',
    torpedoAccuracy(torpedo.rangeUnits, torpedo, 'small', 0.9) > 0 && torpedoAccuracy(0, torpedo, 'x', 0) < 1,
  )

  // End-to-end through applyShot: a torpedo fired at max range against a
  // small, evasive target should connect far less often than the same shot
  // at optimal range against a stationary X-class target. Uses a Cruiser
  // (no point defense of its own to muddy the roll) as the dummy substrate
  // for both — only the precomputed missChance passed to applyShot differs.
  const cruiser = SHIP_CLASSES.find((c) => c.id === 'cruiser')!.combat
  check('cruiser is large-sized (sizeClass wiring reaches a real preset)', cruiser.sizeClass === 'large')
  const hardMiss = 1 - torpedoAccuracy(torpedo.rangeUnits, torpedo, 'small', 0.4)
  const easyMiss = 1 - torpedoAccuracy(torpedo.optimalRangeUnits!, torpedo, 'x', 0)
  const rng = seededRng(1)
  let hardHits = 0
  let easyHits = 0
  const trials = 300
  for (let i = 0; i < trials; i++) {
    if (!applyShot(torpedo, torpedo.damage, pristineCombatState(cruiser), cruiser, null, rng, hardMiss).outcome.missed) hardHits++
    if (!applyShot(torpedo, torpedo.damage, pristineCombatState(cruiser), cruiser, null, rng, easyMiss).outcome.missed) easyHits++
  }
  check(
    'statistically: a max-range torpedo vs a small, evasive target lands far less often than an optimal-range shot vs an X-class one',
    hardHits < easyHits,
    `${hardHits}/${trials} vs ${easyHits}/${trials}`,
  )
}

console.log('\n=== 59. Warp/Hyperdrive are genuinely tech-gated, but the default seed means nothing regresses ===')
{
  useGameTimeStore.setState({ paused: false })
  const countryId = 'tech-gate-test-country'
  usePlayerStore.setState({ selectedCountryId: countryId })
  const simDays = 100

  // Corvette: warp only, no hyperdrive.
  const corvette = makeShip('corvette', 'p1', 'player', 'Mars')
  const farStar = { kind: 'star' as const, starId: 'alpha-centauri' }

  // Default-seeded (warp-theory pre-researched) — warp is genuinely usable:
  // for a destination this far, it must arrive strictly faster than a
  // reaction-only trip would.
  const withWarp = planMove(corvette, farStar, simDays)
  check("warp-theory is pre-seeded, so a fresh country's ship can still warp today", withWarp.kind === 'order')
  const reactionOnlyDaysNoWarp = withWarp.kind === 'order' ? withWarp.order.arrivalSimDays - simDays : Infinity

  // Strip warp-theory out (simulating a country that genuinely hasn't
  // researched it) and try the identical trip.
  useTechStore.setState((s) => {
    const current = s.stateFor(countryId)
    const stripped = new Set(current.researched)
    stripped.delete('warp-theory')
    return { byCountry: { ...s.byCountry, [countryId]: { ...current, researched: stripped } } }
  })
  const withoutWarp = planMove(corvette, farStar, simDays)
  check('without Warp Theory, the ship falls back to a plain reaction-drive order', withoutWarp.kind === 'order' && withoutWarp.order.usedWarp === false)
  const reactionOnlyDaysGated = withoutWarp.kind === 'order' ? withoutWarp.order.arrivalSimDays - simDays : -Infinity
  check(
    'the gated trip takes the full reaction-only time, genuinely slower than the warp-capable one',
    reactionOnlyDaysGated > reactionOnlyDaysNoWarp,
    `${reactionOnlyDaysGated.toFixed(1)}d gated vs ${reactionOnlyDaysNoWarp.toFixed(1)}d with warp`,
  )

  // Restore warp-theory for the destroyer (hyperdrive-only) half of this
  // check.
  useTechStore.setState((s) => {
    const current = s.stateFor(countryId)
    return { byCountry: { ...s.byCountry, [countryId]: { ...current, researched: new Set(current.researched).add('warp-theory') } } }
  })
  const destroyer = makeShip('destroyer', 'p2', 'player', 'Mars')
  const starDest = { kind: 'star' as const, starId: 'sol' }
  const hyperdriveAttempt = planMove(destroyer, starDest, simDays)
  check(
    'hyperspace-theory is pre-seeded, so a fresh country can still attempt a hyperdrive jump today',
    hyperdriveAttempt.kind !== 'order',
    hyperdriveAttempt.kind,
  )

  useTechStore.setState((s) => {
    const current = s.stateFor(countryId)
    const stripped = new Set(current.researched)
    stripped.delete('hyperspace-theory')
    return { byCountry: { ...s.byCountry, [countryId]: { ...current, researched: stripped } } }
  })
  const withoutHyperdrive = planMove(destroyer, starDest, simDays)
  check(
    'without Hyperspace Theory, a hyperdrive-only hull falls all the way back to a plain reaction-drive order — no jump attempted at all',
    withoutHyperdrive.kind === 'order' && withoutHyperdrive.order.usedWarp === false,
  )

  usePlayerStore.setState({ selectedCountryId: null })
}

console.log('\n=== 60. orbitalHoldVelocity: the physics of "holding position" defaults to a real orbit ===')
{
  const body: CombatObstacle = {
    name: 'Test Body',
    kind: 'planet',
    color: '#fff',
    position: { x: 0, y: 0, z: 0 },
    radiusUnits: 1,
    surfaceGravityUnitsPerSecondSq: 0.03,
  }

  const near: ArenaPoint = { x: 5, y: 0, z: 0 }
  const far: ArenaPoint = { x: 20, y: 0, z: 0 }
  const vNear = orbitalHoldVelocity(near, body)
  const vFar = orbitalHoldVelocity(far, body)
  const gNear = body.surfaceGravityUnitsPerSecondSq * (body.radiusUnits / 5) ** 2
  const gFar = body.surfaceGravityUnitsPerSecondSq * (body.radiusUnits / 20) ** 2
  check('orbital speed matches v = sqrt(g(d) * d) at a close distance', Math.abs(vNear.length() - Math.sqrt(gNear * 5)) < 1e-9)
  check('orbital speed matches v = sqrt(g(d) * d) at a far distance', Math.abs(vFar.length() - Math.sqrt(gFar * 20)) < 1e-9)
  check('a closer orbit needs a higher speed than a farther one (stronger local gravity to counter)', vNear.length() > vFar.length())

  const radial = { x: near.x - body.position.x, y: near.y - body.position.y, z: near.z - body.position.z }
  const dot = vNear.x * radial.x + vNear.y * radial.y + vNear.z * radial.z
  check('the orbital velocity is perpendicular to the radial direction (a real tangential orbit, not drifting in/out)', Math.abs(dot) < 1e-9)

  // Two ships on opposite sides of the same body should circle the SAME
  // way (a shared rotational sense), not toward or away from each other.
  const opposite: ArenaPoint = { x: -5, y: 0, z: 0 }
  const vOpposite = orbitalHoldVelocity(opposite, body)
  check(
    'two ships on opposite sides of the same body share one consistent rotational sense',
    Math.sign(vNear.z) !== 0 && Math.sign(vNear.z) === -Math.sign(vOpposite.z),
    `${vNear.z.toFixed(3)} vs ${vOpposite.z.toFixed(3)}`,
  )

  check('at the body\'s own center, orbital velocity is the zero vector (nothing to orbit around)', orbitalHoldVelocity(body.position, body).length() === 0)
}

console.log('\n=== 61. integrateMotion: holding position defaults to orbiting unless Free-Flight Maneuvering is unlocked ===')
{
  const body: CombatObstacle = {
    name: 'Test Body',
    kind: 'planet',
    color: '#fff',
    position: { x: 0, y: 0, z: 0 },
    radiusUnits: 1,
    surfaceGravityUnitsPerSecondSq: 0.03,
  }
  const resting: CombatParticipant = {
    shipId: 'p1',
    side: 0,
    position: { x: 5, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    positionSimDays: 100,
    path: [],
    weaponReadySimDays: [],
    targetShipId: null,
    targetComponent: null,
    holdPosition: true,
    ramming: false,
  }

  const withFreeFlight = integrateMotion(resting, 1, 0.5, 1, 101, [body], true)
  check('with Free-Flight Maneuvering, a resting ship stays exactly at rest (today\'s unchanged behavior)', pointDistance(withFreeFlight.position, resting.position) < 1e-9 && withFreeFlight.velocity.x === 0)

  const withoutFreeFlight = integrateMotion(resting, 1, 0.5, 1, 101, [body], false)
  check(
    'without it, the SAME resting ship starts moving instead — it defaults to orbiting rather than holding for free',
    pointDistance(withoutFreeFlight.position, resting.position) > 1e-6 || Math.hypot(withoutFreeFlight.velocity.x, withoutFreeFlight.velocity.y, withoutFreeFlight.velocity.z) > 1e-6,
  )

  const noBody = integrateMotion(resting, 1, 0.5, 1, 101, [], false)
  check('with nothing to orbit (deep space, no obstacles), the gate has no effect either way', pointDistance(noBody.position, resting.position) < 1e-9)

  check('canFreeFloat defaults to true when omitted — every pre-existing caller/test is unaffected', pointDistance(integrateMotion(resting, 1, 0.5, 1, 200, [body]).position, resting.position) < 1e-9)
}

console.log('\n=== 62. stepEngagements: only the PLAYER is gated — hostiles keep free-floating regardless ===')
{
  useCombatStore.setState({ engagements: [], viewedEngagementId: null })
  const simDays = 100
  let ships = [makeShip('cruiser', 'p1', 'player', 'Earth'), makeShip('cruiser', 'e1', 'hostile', 'Earth')]
  let engagements = syncEngagements(ships, [], simDays)
  // Hold both ships exactly in place — no auto-approach, nothing queued —
  // so any movement over the next several steps is purely the orbit-hold
  // effect, not stance-driven maneuvering.
  engagements = engagements.map((e) => ({
    ...e,
    participants: e.participants.map((p) => ({ ...p, path: [], holdPosition: true })),
  }))
  const startPositions = Object.fromEntries(engagements[0].participants.map((p) => [p.shipId, { ...p.position }]))

  let cursor = simDays
  for (let i = 0; i < 50; i++) {
    cursor += COMBAT_STEP_DAYS
    const result = stepEngagements(engagements, ships, cursor, () => 0.999, [], false) // playerCanFreeFloat = false
    engagements = result.engagements
    ships = ships.map((s) => (result.shipCombat[s.id] ? { ...s, combat: result.shipCombat[s.id] } : s))
  }
  const playerAfter = engagements[0].participants.find((p) => p.shipId === 'p1')!
  const hostileAfter = engagements[0].participants.find((p) => p.shipId === 'e1')!
  check(
    "the player's ship, without Free-Flight Maneuvering, has actually moved (orbiting) after holding position for 5 real seconds",
    pointDistance(playerAfter.position, startPositions['p1']) > 0.01,
    `moved ${pointDistance(playerAfter.position, startPositions['p1']).toFixed(3)} units`,
  )
  check(
    'the hostile ship — no country-tech link modeled for it — stayed exactly where it was, unaffected',
    pointDistance(hostileAfter.position, startPositions['e1']) < 1e-6,
  )

  // Now the same scenario, but with Free-Flight Maneuvering "researched" —
  // restores today's hold-still behavior for the player too.
  useCombatStore.setState({ engagements: [], viewedEngagementId: null })
  let ships2 = [makeShip('cruiser', 'p2', 'player', 'Earth'), makeShip('cruiser', 'e2', 'hostile', 'Earth')]
  let engagements2 = syncEngagements(ships2, [], simDays)
  engagements2 = engagements2.map((e) => ({
    ...e,
    participants: e.participants.map((p) => ({ ...p, path: [], holdPosition: true })),
  }))
  const start2 = Object.fromEntries(engagements2[0].participants.map((p) => [p.shipId, { ...p.position }]))
  let cursor2 = simDays
  for (let i = 0; i < 50; i++) {
    cursor2 += COMBAT_STEP_DAYS
    const result = stepEngagements(engagements2, ships2, cursor2, () => 0.999, [], true) // playerCanFreeFloat = true
    engagements2 = result.engagements
    ships2 = ships2.map((s) => (result.shipCombat[s.id] ? { ...s, combat: result.shipCombat[s.id] } : s))
  }
  const player2After = engagements2[0].participants.find((p) => p.shipId === 'p2')!
  check(
    "researching Free-Flight Maneuvering restores today's behavior — the player's ship holds still again",
    pointDistance(player2After.position, start2['p2']) < 1e-6,
  )
}

console.log('\n=== 63. Missile/torpedo travel time: damage arrives late, not instantly ===')
{
  check('torpedoes are the slower round', TORPEDO_SPEED_UNITS_PER_SECOND < MISSILE_SPEED_UNITS_PER_SECOND)

  // Both fired at the same real separation, against an unarmed, zero-point-
  // defense target (swift-courier — see CIVILIAN_COMBAT_PROFILE) so neither
  // shot can be intercepted or answered, isolating travel time itself from
  // accuracy/interception noise.
  const separation = 6
  const simDays = 400

  function fireAndCountStepsToResolve(
    shooterClass: string,
    weapon: WeaponMount,
  ): { projectileQueuedImmediately: boolean; stepsToResolve: number; targetEverDamaged: boolean; progressSamples: number[] } {
    const shooter = makeShip(shooterClass, 'p1', 'player')
    const target = makeShip('swift-courier', 'e1', 'hostile')
    let ships = [shooter, target]
    let engagements = syncEngagements(ships, [], simDays)
    engagements[0] = {
      ...engagements[0],
      participants: engagements[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        if (p.shipId === 'p1') return { ...base, position: { x: 0, y: 6, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, targetShipId: 'e1' }
        return { ...base, position: { x: separation, y: 6, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }
      }),
    }
    const rng = seededRng(7)
    let cursor = simDays
    cursor += COMBAT_STEP_DAYS
    const fired = stepEngagements(engagements, ships, cursor, rng)
    engagements = fired.engagements
    ships = ships.map((s) => (fired.shipCombat[s.id] ? { ...s, combat: fired.shipCombat[s.id] } : s))
    // Checked right after firing rather than "no damage this step" — a
    // multi-mount hull (the battleship, for the torpedo case) also carries
    // OTHER weapons whose ranges overlap the torpedo tube's own and which
    // legitimately DO hit instantly (heavy beam, mass driver — direct-fire,
    // no travel time), so "the target took no damage at all this step"
    // isn't a claim specific to travel time on that hull. "A round of THIS
    // damage type is now physically in flight" is the same claim, without
    // that confound.
    const launchedProjectile = fired.engagements[0]?.projectiles?.find((pr) => pr.damageType === weapon.damageType)
    const projectileQueuedImmediately = !!launchedProjectile
    const progressSamples: number[] = launchedProjectile ? [launchedProjectile.progress] : []
    let stepsToResolve = 1
    let targetEverDamaged = false
    for (let i = 0; i < 200; i++) {
      const inFlight = engagements[0]?.projectiles?.find((pr) => pr.damageType === weapon.damageType)
      if (!inFlight) break
      cursor += COMBAT_STEP_DAYS
      const step = stepEngagements(engagements, ships, cursor, rng)
      engagements = step.engagements
      ships = ships.map((s) => (step.shipCombat[s.id] ? { ...s, combat: step.shipCombat[s.id] } : s))
      if (step.shipCombat['e1']) targetEverDamaged = true
      const stillInFlight = engagements[0]?.projectiles?.find((pr) => pr.damageType === weapon.damageType)
      if (stillInFlight) progressSamples.push(stillInFlight.progress)
      stepsToResolve++
    }
    return { projectileQueuedImmediately, stepsToResolve, targetEverDamaged, progressSamples }
  }

  const missile = fireAndCountStepsToResolve('frigate', WEAPON_TYPES.missileBattery)
  check('firing a missile queues a real in-flight round rather than resolving instantly', missile.projectileQueuedImmediately)
  check('...and it eventually resolves', missile.stepsToResolve > 1 && missile.stepsToResolve < 200)
  check(
    "...landing REAL damage once it arrives (missiles never miss an unarmed, zero-point-defense target)",
    missile.targetEverDamaged,
  )
  check('progress starts at (or very near) 0 right at launch', missile.progressSamples[0] < 0.1, `${missile.progressSamples[0]}`)
  check(
    'progress climbs monotonically — never goes backwards while a round is closing on a stationary target',
    missile.progressSamples.every((v, i) => i === 0 || v >= missile.progressSamples[i - 1] - 1e-9),
  )
  check(
    'progress reaches (or very nearly reaches) 1 by the time it resolves',
    missile.progressSamples[missile.progressSamples.length - 1] > 0.9,
    `${missile.progressSamples[missile.progressSamples.length - 1]}`,
  )

  const torpedo = fireAndCountStepsToResolve('battleship', WEAPON_TYPES.torpedoTube)
  check('firing a torpedo queues a real in-flight round rather than resolving instantly', torpedo.projectileQueuedImmediately)
  check('...and it also eventually resolves', torpedo.stepsToResolve > 1 && torpedo.stepsToResolve < 200)

  check(
    'at the SAME distance, the torpedo (slower) takes more steps to resolve than the missile',
    torpedo.stepsToResolve > missile.stepsToResolve,
    `missile ${missile.stepsToResolve} steps, torpedo ${torpedo.stepsToResolve} steps`,
  )

  // Rough sanity: the missile's own resolve time should be in the right
  // ballpark of distance/speed (plus the one step it was launched on) — not
  // an exact match, since COMBAT_STEP_SECONDS granularity and the target's
  // own (here zero) motion both nudge it, but should be well within a
  // handful of steps either way.
  const expectedMissileSteps = Math.ceil(separation / MISSILE_SPEED_UNITS_PER_SECOND / COMBAT_STEP_SECONDS) + 1
  check(
    "the missile's actual resolve time is close to distance/speed",
    Math.abs(missile.stepsToResolve - expectedMissileSteps) <= 3,
    `expected ~${expectedMissileSteps} steps, got ${missile.stepsToResolve}`,
  )
}

console.log('\n=== 64. Thruster Boost: a speed/evasion toggle that trades away weapon output ===')
{
  const baseParticipant = {
    shipId: 'p1', side: 0 as const, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false, thrusterBoostActive: true,
  }
  check(
    'tacticSpeedMultiplier includes the bonus while active',
    Math.abs(tacticSpeedMultiplier(baseParticipant) - (1 + THRUSTER_BOOST_SPEED_BONUS_FRACTION)) < 1e-9,
  )
  check('tacticSpeedMultiplier is 1x when inactive', tacticSpeedMultiplier({ ...baseParticipant, thrusterBoostActive: false }) === 1)
  check(
    'tacticEvasionBonus includes the bonus while active',
    Math.abs(tacticEvasionBonus(baseParticipant, 'medium') - THRUSTER_BOOST_EVASION_BONUS) < 1e-9,
  )
  check(
    'laser (energy) output is cut GREATLY',
    tacticWeaponDamageMultiplier(baseParticipant, 'energy') === THRUSTER_BOOST_LASER_DAMAGE_MULTIPLIER,
  )
  check(
    'cannon (kinetic) output is cut only MODERATELY — a smaller cut than energy',
    tacticWeaponDamageMultiplier(baseParticipant, 'kinetic') === THRUSTER_BOOST_CANNON_DAMAGE_MULTIPLIER &&
      THRUSTER_BOOST_CANNON_DAMAGE_MULTIPLIER > THRUSTER_BOOST_LASER_DAMAGE_MULTIPLIER,
  )
  check(
    'missile/torpedo output is untouched — physical rounds, not power-hungry systems',
    tacticWeaponDamageMultiplier(baseParticipant, 'missile') === 1 && tacticWeaponDamageMultiplier(baseParticipant, 'torpedo') === 1,
  )

  // End-to-end: a boosted ship covers more real distance in one combat step
  // than an identical ship without it.
  const simDays = 500
  const shooter = makeShip('frigate', 'p1', 'player')
  const other = makeShip('frigate', 'e1', 'hostile')
  const profile = shipCombatProfile(shooter)!
  const engs = syncEngagements([shooter, other], [], simDays)
  const withBoost = engs[0].participants.map((p) =>
    p.shipId === 'p1' ? { ...p, path: [{ x: 1000, y: 0, z: 0 }], holdPosition: true, thrusterBoostActive: true } : { ...p, path: [], holdPosition: true },
  )
  const withoutBoost = engs[0].participants.map((p) => (p.shipId === 'p1' ? { ...p, path: [{ x: 1000, y: 0, z: 0 }], holdPosition: true } : { ...p, path: [], holdPosition: true }))
  const boostedP1 = withBoost.find((p) => p.shipId === 'p1')!
  const plainP1 = withoutBoost.find((p) => p.shipId === 'p1')!
  const boosted = integrateMotion(
    boostedP1,
    profile.maneuverUnitsPerSecond * tacticSpeedMultiplier(boostedP1),
    profile.accelerationUnitsPerSecondSq * tacticSpeedMultiplier(boostedP1),
    COMBAT_STEP_SECONDS,
    simDays,
    [],
  )
  const plain = integrateMotion(plainP1, profile.maneuverUnitsPerSecond, profile.accelerationUnitsPerSecondSq, COMBAT_STEP_SECONDS, simDays, [])
  check(
    'a boosted ship actually moves farther in one step than an identical one without it',
    pointDistance(boosted.position, boostedP1.position) > pointDistance(plain.position, plainP1.position),
  )

  // Auto-criteria: engages the instant nothing is actively trading fire,
  // drops the instant it is.
  const farShooter = makeShip('frigate', 'p1', 'player')
  const farTarget = makeShip('frigate', 'e1', 'hostile')
  let farShips = [farShooter, farTarget]
  let farEngs = syncEngagements(farShips, [], simDays)
  farEngs[0] = { ...farEngs[0], participants: farEngs[0].participants.map((p) => ({ ...p, path: [], holdPosition: true })) }
  const farStep = stepEngagements(farEngs, farShips, simDays + COMBAT_STEP_DAYS)
  const farP1 = farStep.engagements[0]?.participants.find((p) => p.shipId === 'p1')
  check('auto-engages the instant nothing is actively trading fire (spawn separation is out of every weapon range)', !!farP1?.thrusterBoostActive)

  const nearShooter = makeShip('frigate', 'p1', 'player')
  const nearTarget = makeShip('frigate', 'e1', 'hostile')
  let nearShips = [nearShooter, nearTarget]
  let nearEngs = syncEngagements(nearShips, [], simDays)
  nearEngs[0] = {
    ...nearEngs[0],
    participants: nearEngs[0].participants.map((p) => {
      const base = { ...p, path: [], holdPosition: true }
      return p.shipId === 'p1' ? { ...base, position: { x: 0, y: 6, z: 0 }, targetShipId: 'e1' } : { ...base, position: { x: 3, y: 6, z: 0 } }
    }),
  }
  const nearStep = stepEngagements(nearEngs, nearShips, simDays + COMBAT_STEP_DAYS)
  const nearP1 = nearStep.engagements[0]?.participants.find((p) => p.shipId === 'p1')
  check('...but drops once actively trading fire (well within weapon range of a live target)', nearP1?.thrusterBoostActive === false)
}

console.log('\n=== 65. Shield Boost: a last resort, not a free upgrade ===')
{
  const baseParticipant = {
    shipId: 'p1', side: 0 as const, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false, shieldBoostActive: true,
  }
  check(
    'tacticSpeedMultiplier is reduced while Shield Boost is active',
    Math.abs(tacticSpeedMultiplier(baseParticipant) - (1 - SHIELD_BOOST_SPEED_PENALTY_FRACTION)) < 1e-9,
  )
  check(
    'tacticEvasionBonus is reduced (a penalty) while Shield Boost is active',
    Math.abs(tacticEvasionBonus(baseParticipant, 'medium') - -SHIELD_BOOST_EVASION_PENALTY) < 1e-9,
  )
  check(
    'BOTH energy and kinetic output are cut — not energy-only (see why: a kinetic weapon never rolls to-hit, so an energy-only cut would leave a kinetic loadout with zero cost for the extra regen)',
    tacticWeaponDamageMultiplier(baseParticipant, 'energy') === SHIELD_BOOST_ENERGY_DAMAGE_MULTIPLIER &&
      tacticWeaponDamageMultiplier(baseParticipant, 'kinetic') === SHIELD_BOOST_KINETIC_DAMAGE_MULTIPLIER &&
      SHIELD_BOOST_ENERGY_DAMAGE_MULTIPLIER < SHIELD_BOOST_KINETIC_DAMAGE_MULTIPLIER,
  )

  // Shield regen: boosted vs. unboosted, same starting damage, one step.
  const simDays = 600
  const cruiser = makeShip('cruiser', 'p1', 'player')
  const profile = shipCombatProfile(cruiser)!
  const damaged = { ...pristineCombatState(profile), shieldHp: profile.defenses.shieldHp * 0.5 }
  const boostedShip = { ...cruiser, id: 'boosted', combat: damaged }
  const plainShip = { ...cruiser, id: 'plain', combat: damaged }
  const withBoost = [boostedShip]
  const withoutBoost = [plainShip]
  const engBoost = [createSoloEngagement(boostedShip, withBoost, simDays)!]
  engBoost[0] = { ...engBoost[0], participants: engBoost[0].participants.map((p) => ({ ...p, path: [], holdPosition: true, shieldBoostActive: true })) }
  const engPlain = [createSoloEngagement(plainShip, withoutBoost, simDays)!]
  engPlain[0] = { ...engPlain[0], participants: engPlain[0].participants.map((p) => ({ ...p, path: [], holdPosition: true })) }
  const boostResult = stepEngagements(engBoost, withBoost, simDays + COMBAT_STEP_DAYS)
  const plainResult = stepEngagements(engPlain, withoutBoost, simDays + COMBAT_STEP_DAYS)
  const boostGain = (boostResult.shipCombat['boosted']?.shieldHp ?? damaged.shieldHp) - damaged.shieldHp
  const plainGain = (plainResult.shipCombat['plain']?.shieldHp ?? damaged.shieldHp) - damaged.shieldHp
  check(
    'a Shield-Boosted hull regenerates shields roughly SHIELD_BOOST_REGEN_MULTIPLIER times faster',
    Math.abs(boostGain / plainGain - SHIELD_BOOST_REGEN_MULTIPLIER) < 0.01,
    `boosted +${boostGain.toFixed(3)}, plain +${plainGain.toFixed(3)}, ratio ${(boostGain / plainGain).toFixed(2)}`,
  )

  // Auto-criteria: a routine scratch is NOT enough to engage it any more —
  // only genuine trouble (critically low health) or fleeing is.
  {
    const scratchedShip = makeShip('cruiser', 'p1', 'player')
    const scratchedProfile = shipCombatProfile(scratchedShip)!
    // Healthy overall (core/armor untouched), shields merely dipped — the
    // OLD "shields below 60%" trigger would have engaged here; the new
    // health-based one should not.
    scratchedShip.combat = { ...pristineCombatState(scratchedProfile), shieldHp: scratchedProfile.defenses.shieldHp * 0.5 }
    const hostile = makeShip('cruiser', 'e1', 'hostile')
    let ships = [scratchedShip, hostile]
    let engs = syncEngagements(ships, [], simDays)
    engs[0] = {
      ...engs[0],
      participants: engs[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        return p.shipId === 'p1' ? { ...base, position: { x: 0, y: 6, z: 0 }, targetShipId: 'e1' } : { ...base, position: { x: 2, y: 6, z: 0 } }
      }),
    }
    const step = stepEngagements(engs, ships, simDays + COMBAT_STEP_DAYS)
    const p1After = step.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check(
      'a merely-scratched, otherwise-healthy, under-fire ship does NOT auto-engage Shield Boost (the old routine trigger is gone)',
      p1After?.shieldBoostActive !== true,
    )
  }
  {
    const dyingShip = makeShip('cruiser', 'p1', 'player')
    const dyingProfile = shipCombatProfile(dyingShip)!
    dyingShip.combat = {
      ...pristineCombatState(dyingProfile),
      shieldHp: 0,
      armorHp: 0,
      componentHp: { weapons: dyingProfile.components.weapons * 0.2, utility: dyingProfile.components.utility * 0.2, core: dyingProfile.components.core * 0.2 },
    }
    const hostile = makeShip('cruiser', 'e1', 'hostile')
    let ships = [dyingShip, hostile]
    let engs = syncEngagements(ships, [], simDays)
    engs[0] = {
      ...engs[0],
      participants: engs[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        return p.shipId === 'p1' ? { ...base, position: { x: 0, y: 6, z: 0 }, targetShipId: 'e1' } : { ...base, position: { x: 2, y: 6, z: 0 } }
      }),
    }
    const step = stepEngagements(engs, ships, simDays + COMBAT_STEP_DAYS)
    const p1After = step.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check('...but a critically damaged, under-fire ship DOES (stalling/holding out)', p1After?.shieldBoostActive === true)
  }
  {
    const fleeingShip = { ...makeShip('cruiser', 'p1', 'player'), stance: 'flee' as const }
    const hostile = makeShip('cruiser', 'e1', 'hostile')
    let ships = [fleeingShip, hostile]
    let engs = syncEngagements(ships, [], simDays)
    engs[0] = {
      ...engs[0],
      participants: engs[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        return p.shipId === 'p1' ? { ...base, position: { x: 0, y: 6, z: 0 } } : { ...base, position: { x: 2, y: 6, z: 0 } }
      }),
    }
    const step = stepEngagements(engs, ships, simDays + COMBAT_STEP_DAYS)
    const p1After = step.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check('...and a full-health ship that is actively FLEEING also engages it, regardless of health', p1After?.shieldBoostActive === true)
  }

  // THE balance requirement: two otherwise-identical ships, one running
  // Shield Boost the ENTIRE fight (auto disabled, forced on by hand — the
  // worst case a player could actually set up), should reliably LOSE to the
  // plain one. Checked against BOTH a kinetic-only loadout (corvette —
  // kinetic weapons never roll to-hit at all, so evasion/speed penalties
  // alone can't be what makes this lose; the kinetic damage cut has to be
  // doing real work) and an energy-heavy one (destroyer), so the balance
  // holds regardless of what the boosted ship is actually armed with.
  function simulateShieldBoostMirror(classId: string, seed: number, maxSteps = 3000): 'boosted' | 'plain' | 'draw' | 'timeout' {
    const boosted = { ...makeShip(classId, 'boosted', 'player'), shieldBoostAuto: false }
    const plain = makeShip(classId, 'plain', 'hostile')
    let ships = [boosted, plain]
    let engagements = syncEngagements(ships, [], 0)
    engagements[0] = {
      ...engagements[0],
      participants: engagements[0].participants.map((p) => (p.shipId === 'boosted' ? { ...p, shieldBoostActive: true } : p)),
    }
    const rng = seededRng(seed)
    const alive = new Map(ships.map((s) => [s.id, s]))
    for (let i = 0; i < maxSteps; i++) {
      if (engagements.length === 0) break
      const simDays = (i + 1) * COMBAT_STEP_DAYS
      const result = stepEngagements(engagements, [...alive.values()], simDays, rng)
      for (const id of result.destroyedShipIds) alive.delete(id)
      for (const id of result.disengagedShipIds) alive.delete(id)
      for (const [id, combat] of Object.entries(result.shipCombat)) {
        const ship = alive.get(id)
        if (ship) alive.set(id, { ...ship, combat })
      }
      engagements = result.engagements
      const boostedLeft = alive.has('boosted')
      const plainLeft = alive.has('plain')
      if (!boostedLeft && !plainLeft) return 'draw'
      if (!plainLeft) return 'boosted'
      if (!boostedLeft) return 'plain'
    }
    return 'timeout'
  }

  const SHIELD_BOOST_TRIAL_SEEDS = Array.from({ length: 12 }, (_, i) => i + 1)
  for (const classId of ['corvette', 'destroyer']) {
    const boostedWins = SHIELD_BOOST_TRIAL_SEEDS.filter((seed) => simulateShieldBoostMirror(classId, seed) === 'boosted').length
    const rate = boostedWins / SHIELD_BOOST_TRIAL_SEEDS.length
    check(
      `${classId} mirror: a permanently Shield-Boosted hull does NOT reliably win against an identical unboosted one (<=15%)`,
      rate <= 0.15,
      `${(rate * 100).toFixed(0)}% (${boostedWins}/${SHIELD_BOOST_TRIAL_SEEDS.length})`,
    )
  }
}

console.log('\n=== 66. Spin Thrust: genuinely uncontrollable, with a collision safety valve ===')
{
  const baseParticipant = {
    shipId: 'e1', side: 1 as const, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false, spinThrustActive: true,
  }
  check(
    'tacticEvasionBonus includes the FULL Spin Thrust bonus for a small hull',
    Math.abs(tacticEvasionBonus(baseParticipant, 'small') - SPIN_THRUST_EVASION_BONUS) < 1e-9,
  )
  check(
    'a bigger hull gets progressively LESS out of it — the whole point of SPIN_THRUST_SIZE_EFFECTIVENESS',
    tacticEvasionBonus(baseParticipant, 'small') > tacticEvasionBonus(baseParticipant, 'medium') &&
      tacticEvasionBonus(baseParticipant, 'medium') > tacticEvasionBonus(baseParticipant, 'large') &&
      tacticEvasionBonus(baseParticipant, 'large') > tacticEvasionBonus(baseParticipant, 'x') &&
      tacticEvasionBonus(baseParticipant, 'x') > 0, // never negative — it's a diminished benefit, not a penalty
  )

  // Uncontrollable: a spin-thrusting ship with an explicit manual hold AND a
  // queued path still ends up moving, not sitting still — proving the
  // random walk overrides holdPosition/path rather than respecting them.
  {
    const simDays = 650
    const ship = makeShip('frigate', 'p1', 'player')
    const other = makeShip('frigate', 'e1', 'hostile')
    let ships = [ship, other]
    let engs = syncEngagements(ships, [], simDays)
    const startPos = engs[0].participants.find((p) => p.shipId === 'p1')!.position
    engs[0] = {
      ...engs[0],
      participants: engs[0].participants.map((p) =>
        p.shipId === 'p1'
          ? { ...p, spinThrustActive: true, holdPosition: true, path: [{ x: startPos.x, y: startPos.y, z: startPos.z }] }
          : { ...p, path: [], holdPosition: true },
      ),
    }
    const rng = seededRng(3)
    let cursor = simDays
    let moved = false
    for (let i = 0; i < 10; i++) {
      cursor += COMBAT_STEP_DAYS
      const step = stepEngagements(engs, ships, cursor, rng)
      engs = step.engagements
      ships = ships.map((s) => (step.shipCombat[s.id] ? { ...s, combat: step.shipCombat[s.id] } : s))
      const p1 = engs[0]?.participants.find((p) => p.shipId === 'p1')
      if (p1 && pointDistance(p1.position, startPos) > 1e-6) moved = true
      if (!p1 || !p1.spinThrustActive) break
    }
    check('a spin-thrusting ship drifts away from its held position despite holdPosition + a queued path', moved)
  }

  // Collision safety: a ship spinning on a heading straight at a nearby body
  // gets Spin Thrust switched OFF for it before movement integrates into
  // the body, rather than being allowed to drift in.
  {
    const body = { name: 'TestBody', kind: 'planet' as const, color: '#fff', position: { x: 10, y: 0, z: 0 }, radiusUnits: 1, surfaceGravityUnitsPerSecondSq: 0 }
    const participant = {
      shipId: 'p1', side: 0 as const,
      position: { x: 5, y: 0, z: 0 },
      // Heading straight at the body, fast enough to close the remaining
      // distance well within the lookahead window.
      velocity: { x: 5, y: 0, z: 0 },
      positionSimDays: 0, path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null,
      holdPosition: false, spinThrustActive: true,
    }
    const ship = makeShip('frigate', 'p1', 'player')
    const engagement = {
      id: 'safety-test', locationKey: 'k', locationLabel: 'l', startedSimDays: 0, density: 'standard' as const,
      center: { x: 0, y: 0, z: 0 }, obstacles: [body], participants: [participant], resolvedThroughSimDays: 0,
    }
    const result = stepEngagements([engagement], [ship], COMBAT_STEP_DAYS)
    const p1After = result.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check('Spin Thrust auto-cancels when a collision is imminent, before the ship actually reaches the body', p1After?.spinThrustActive === false)
    check('...and the ship has NOT ended up inside/past the body this same step', !!p1After && p1After.position.x < body.position.x - body.radiusUnits)
  }

  // Damage redirection, end to end through the real firing loop: a destroyer
  // (mass drivers — kinetic, never intercepted, never misses, and hard-
  // hitting enough to blow through the target's own shield regen between
  // shots) called-shots a cruiser's weapons component. The target's
  // shields/armor are zeroed out up front so damage reaches the component
  // layer quickly rather than this test's whole window going to stripping
  // them back down. Both ships hold position (spin-thrust drift is real now
  // — see above — so the target CAN wander; the shooter tracks it via
  // targetShipId regardless of where it drifts to, same as any other
  // target). EVERY auto-tactics flag is forced off on both ships — not just
  // spinThrustAuto — so the auto-tactics pass can't manage ANY tactic for
  // itself here: an auto-engaged Weapons Boost on the shooter, for instance,
  // would raise its per-shot damage enough to burn through the target's
  // weapons pool faster than this test's step count was calibrated for,
  // tripping pickComponent's OWN "preferred component already dead, spread
  // elsewhere" fallback — a second source of off-target damage this test
  // isn't trying to measure, confounding the one (Spin Thrust's redirect)
  // that it is.
  function runRedirectTrial(spinThrustActive: boolean, targetClassId: string = 'cruiser'): { weaponsFraction: number } {
    const simDays = 700
    const noAuto = { thrusterBoostAuto: false, shieldBoostAuto: false, weaponsBoostAuto: false, spinThrustAuto: false }
    const shooter = { ...makeShip('destroyer', 'p1', 'player'), ...noAuto }
    const target = { ...makeShip(targetClassId, 'e1', 'hostile'), ...noAuto }
    target.combat = { ...target.combat, shieldHp: 0, armorHp: 0 }
    let ships = [shooter, target]
    let engagements = syncEngagements(ships, [], simDays)
    engagements[0] = {
      ...engagements[0],
      participants: engagements[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        if (p.shipId === 'p1') return { ...base, position: { x: 0, y: 6, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, targetShipId: 'e1', targetComponent: 'weapons' as const }
        return { ...base, position: { x: 2, y: 6, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, spinThrustActive }
      }),
    }
    const before = target.combat.componentHp
    const rng = seededRng(11)
    let cursor = simDays
    let cumulative = target.combat
    for (let i = 0; i < 100; i++) {
      cursor += COMBAT_STEP_DAYS
      const step = stepEngagements(engagements, ships, cursor, rng)
      engagements = step.engagements
      ships = ships.map((s) => (step.shipCombat[s.id] ? { ...s, combat: step.shipCombat[s.id] } : s))
      if (step.shipCombat['e1']) cumulative = step.shipCombat['e1']
    }
    const weaponsLoss = before.weapons - cumulative.componentHp.weapons
    const utilityLoss = before.utility - cumulative.componentHp.utility
    const coreLoss = before.core - cumulative.componentHp.core
    const totalLoss = weaponsLoss + utilityLoss + coreLoss
    return { weaponsFraction: totalLoss > 0 ? weaponsLoss / totalLoss : 1 }
  }

  const control = runRedirectTrial(false)
  check('control (no Spin Thrust): a called shot lands on the targeted component almost every time', control.weaponsFraction > 0.9, `${(control.weaponsFraction * 100).toFixed(0)}%`)

  // The target here is a Cruiser (large — SPIN_THRUST_SIZE_EFFECTIVENESS.
  // large = 0.5), so the EFFECTIVE redirect chance is SPIN_THRUST_REDIRECT_
  // CHANCE * 0.5 (~25%), not the raw 50% — roughly a quarter diverted, not a
  // half. The dedicated size-scaling comparison right below is what proves
  // the scaling itself; this just confirms it's really landing somewhere,
  // not zero and not the full un-scaled rate.
  const jinking = runRedirectTrial(true)
  check(
    'with Spin Thrust active, a meaningfully smaller share lands on the targeted component',
    jinking.weaponsFraction < control.weaponsFraction - 0.1,
    `control ${(control.weaponsFraction * 100).toFixed(0)}%, jinking ${(jinking.weaponsFraction * 100).toFixed(0)}%`,
  )
  check(
    "...roughly a quarter for this LARGE target, not zero and not the full un-scaled ~half",
    jinking.weaponsFraction > 0.55 && jinking.weaponsFraction < 0.95,
    `${(jinking.weaponsFraction * 100).toFixed(0)}%`,
  )

  // The actual size-scaling claim, end to end: the SAME shooter, SAME
  // Spin-Thrust-active setup, against a SMALL target (Corvette) instead of a
  // Large one — SPIN_THRUST_SIZE_EFFECTIVENESS.small (1.0) means the small
  // target should get noticeably MORE redirection (a lower weaponsFraction)
  // than the large one just measured, proving "the bigger the ship, the
  // less effective Spin Thrust" rather than just asserting the constant
  // table exists.
  const jinkingSmall = runRedirectTrial(true, 'corvette')
  check(
    'a SMALL target gets meaningfully MORE redirection than the LARGE one — bigger ships get less out of Spin Thrust',
    jinkingSmall.weaponsFraction < jinking.weaponsFraction - 0.1,
    `small ${(jinkingSmall.weaponsFraction * 100).toFixed(0)}%, large ${(jinking.weaponsFraction * 100).toFixed(0)}%`,
  )
}

console.log('\n=== 67. Ramming, categorized as a Tactic (no behavior change — see section 57) ===')
{
  check('all five tactics are registered', TACTIC_IDS.length === 5 && TACTIC_IDS.includes('ramming'))
  check(
    'the other four are the maneuvers',
    TACTIC_IDS.includes('thruster-boost') &&
      TACTIC_IDS.includes('shield-boost') &&
      TACTIC_IDS.includes('weapons-boost') &&
      TACTIC_IDS.includes('spin-thrust'),
  )
  // resolveProjectileImpact is exercised indirectly by section 63 (through
  // the resolver); a direct unit check that it agrees with applyShot's own
  // damage-layer math on a simple case, since both now share one
  // implementation (see applyDamageLayers).
  const cruiser = SHIP_CLASSES.find((c) => c.id === 'cruiser')!
  const profile = cruiser.combat
  const target = pristineCombatState(profile)
  const never = () => 1
  const viaApplyShot = applyShot(WEAPON_TYPES.missileBattery, 50, target, profile, null, never)
  const viaProjectile = resolveProjectileImpact({ damageType: 'missile', rawDamage: 50, preferredComponent: null }, target, profile, never)
  check(
    'a projectile impact and an equivalent direct applyShot agree exactly (shared damage-layer code)',
    Math.abs(viaApplyShot.next.shieldHp - viaProjectile.shieldHp) < 1e-9 &&
      Math.abs(viaApplyShot.next.armorHp - viaProjectile.armorHp) < 1e-9,
  )
}

console.log('\n=== 68. Weapons Boost: real bonus damage, at the cost of shields and speed ===')
{
  const baseParticipant = {
    shipId: 'p1', side: 0 as const, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false, weaponsBoostActive: true,
  }
  check(
    'tacticSpeedMultiplier is reduced while Weapons Boost is active',
    Math.abs(tacticSpeedMultiplier(baseParticipant) - (1 - WEAPONS_BOOST_SPEED_PENALTY_FRACTION)) < 1e-9,
  )
  check('tacticEvasionBonus is untouched by Weapons Boost — its trade is shields and speed only, not evasion', tacticEvasionBonus(baseParticipant, 'medium') === 0)
  check(
    'EVERY damage type gets the bonus — including missile/torpedo, unlike Thruster/Shield Boost which leave physical rounds alone',
    tacticWeaponDamageMultiplier(baseParticipant, 'energy') === WEAPONS_BOOST_DAMAGE_MULTIPLIER &&
      tacticWeaponDamageMultiplier(baseParticipant, 'kinetic') === WEAPONS_BOOST_DAMAGE_MULTIPLIER &&
      tacticWeaponDamageMultiplier(baseParticipant, 'missile') === WEAPONS_BOOST_DAMAGE_MULTIPLIER &&
      tacticWeaponDamageMultiplier(baseParticipant, 'torpedo') === WEAPONS_BOOST_DAMAGE_MULTIPLIER,
  )
  check('the bonus is a real increase, not a penalty dressed up as one', WEAPONS_BOOST_DAMAGE_MULTIPLIER > 1)

  // Shield regen: reduced, not stopped — mirrors Shield Boost's own regen
  // test (section 65) but in the other direction.
  const simDays = 800
  const cruiser = makeShip('cruiser', 'p1', 'player')
  const profile = shipCombatProfile(cruiser)!
  const damaged = { ...pristineCombatState(profile), shieldHp: profile.defenses.shieldHp * 0.5 }
  const boostedShip = { ...cruiser, id: 'wboosted', combat: damaged }
  const plainShip = { ...cruiser, id: 'wplain', combat: damaged }
  const engBoost = [createSoloEngagement(boostedShip, [boostedShip], simDays)!]
  engBoost[0] = { ...engBoost[0], participants: engBoost[0].participants.map((p) => ({ ...p, path: [], holdPosition: true, weaponsBoostActive: true })) }
  const engPlain = [createSoloEngagement(plainShip, [plainShip], simDays)!]
  engPlain[0] = { ...engPlain[0], participants: engPlain[0].participants.map((p) => ({ ...p, path: [], holdPosition: true })) }
  const boostResult = stepEngagements(engBoost, [boostedShip], simDays + COMBAT_STEP_DAYS)
  const plainResult = stepEngagements(engPlain, [plainShip], simDays + COMBAT_STEP_DAYS)
  const boostGain = (boostResult.shipCombat['wboosted']?.shieldHp ?? damaged.shieldHp) - damaged.shieldHp
  const plainGain = (plainResult.shipCombat['wplain']?.shieldHp ?? damaged.shieldHp) - damaged.shieldHp
  check(
    'a Weapons-Boosted hull regenerates shields SLOWER, by roughly WEAPONS_BOOST_SHIELD_REGEN_MULTIPLIER',
    Math.abs(boostGain / plainGain - WEAPONS_BOOST_SHIELD_REGEN_MULTIPLIER) < 0.01,
    `boosted +${boostGain.toFixed(3)}, plain +${plainGain.toFixed(3)}, ratio ${(boostGain / plainGain).toFixed(2)}`,
  )

  // Damage output, end to end through applyShot.
  const laser: WeaponMount = { ...WEAPON_TYPES.laser, damage: 100 }
  const target = pristineCombatState(profile)
  const never = () => 1
  const normalShot = applyShot(laser, 100, target, profile, null, never)
  const boostedShot = applyShot(laser, 100 * WEAPONS_BOOST_DAMAGE_MULTIPLIER, target, profile, null, never)
  check(
    'boosting the raw damage before applyShot scales the shield damage dealt by the same factor',
    Math.abs(boostedShot.outcome.shieldDamage / normalShot.outcome.shieldDamage - WEAPONS_BOOST_DAMAGE_MULTIPLIER) < 1e-9,
  )

  // Auto-criteria: the inverse gate from Shield Boost's — engages while
  // HEALTHY and actively trading fire, not while in danger.
  {
    const healthyShip = makeShip('cruiser', 'p1', 'player')
    const hostile = makeShip('cruiser', 'e1', 'hostile')
    let ships = [healthyShip, hostile]
    let engs = syncEngagements(ships, [], simDays)
    engs[0] = {
      ...engs[0],
      participants: engs[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        return p.shipId === 'p1' ? { ...base, position: { x: 0, y: 6, z: 0 }, targetShipId: 'e1' } : { ...base, position: { x: 2, y: 6, z: 0 } }
      }),
    }
    const step = stepEngagements(engs, ships, simDays + COMBAT_STEP_DAYS)
    const p1After = step.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check('a healthy ship actively trading fire auto-engages Weapons Boost', p1After?.weaponsBoostActive === true)
  }
  {
    const dyingShip = makeShip('cruiser', 'p1', 'player')
    const dyingProfile = shipCombatProfile(dyingShip)!
    dyingShip.combat = {
      ...pristineCombatState(dyingProfile),
      shieldHp: 0,
      armorHp: 0,
      componentHp: { weapons: dyingProfile.components.weapons * 0.2, utility: dyingProfile.components.utility * 0.2, core: dyingProfile.components.core * 0.2 },
    }
    const hostile = makeShip('cruiser', 'e1', 'hostile')
    let ships = [dyingShip, hostile]
    let engs = syncEngagements(ships, [], simDays)
    engs[0] = {
      ...engs[0],
      participants: engs[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        return p.shipId === 'p1' ? { ...base, position: { x: 0, y: 6, z: 0 }, targetShipId: 'e1' } : { ...base, position: { x: 2, y: 6, z: 0 } }
      }),
    }
    const step = stepEngagements(engs, ships, simDays + COMBAT_STEP_DAYS)
    const p1After = step.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check(
      "...but a critically damaged ship does NOT — Shield Boost's own auto-logic claims the grid instead (see the priority test below)",
      p1After?.weaponsBoostActive !== true,
    )
  }
}

console.log('\n=== 69. The three Boost tactics share one power grid: mutual exclusion + priority ===')
{
  check('exactly three tactics are grouped as boosts', BOOST_TACTIC_IDS.length === 3)
  check(
    'the boost group is exactly Thruster/Shield/Weapons — not Spin Thrust or Ramming',
    BOOST_TACTIC_IDS.includes('thruster-boost') && BOOST_TACTIC_IDS.includes('shield-boost') && BOOST_TACTIC_IDS.includes('weapons-boost'),
  )

  // Manual toggles (the store actions) clear the other two.
  {
    const engagementId = 'mutex-test'
    const shipId = 'p1'
    const participant = {
      shipId, side: 0 as const, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
      path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
    }
    useCombatStore.setState({
      engagements: [
        {
          id: engagementId, locationKey: 'k', locationLabel: 'l', startedSimDays: 0, density: 'standard' as const,
          center: { x: 0, y: 0, z: 0 }, obstacles: [], participants: [participant], resolvedThroughSimDays: 0,
        },
      ],
    })
    const store = useCombatStore.getState()
    store.setShieldBoost(engagementId, shipId, true)
    let p = useCombatStore.getState().engagements[0].participants[0]
    check('Shield Boost switches on', p.shieldBoostActive === true)

    store.setThrusterBoost(engagementId, shipId, true)
    p = useCombatStore.getState().engagements[0].participants[0]
    check('...and switching Thruster Boost on turns Shield Boost back off', p.thrusterBoostActive === true && p.shieldBoostActive === false)

    store.setWeaponsBoost(engagementId, shipId, true)
    p = useCombatStore.getState().engagements[0].participants[0]
    check(
      '...and switching Weapons Boost on turns Thruster Boost back off too — never more than one at once',
      p.weaponsBoostActive === true && p.thrusterBoostActive === false && p.shieldBoostActive === false,
    )
    useCombatStore.setState({ engagements: [] })
  }

  // Auto-tactics priority: a ship that's simultaneously "critically damaged"
  // (Shield Boost's own trigger) AND "actively trading fire" is exactly the
  // overlap case both Shield Boost's and Weapons Boost's auto-criteria could
  // independently want to claim — Shield Boost, the survival call, has to
  // win. (Covered from the Weapons Boost side already in section 68; this
  // checks it holds from Shield Boost's side too, and that nothing ends up
  // with two boosts on at once.)
  {
    const simDays = 900
    const dyingShip = makeShip('cruiser', 'p1', 'player')
    const dyingProfile = shipCombatProfile(dyingShip)!
    dyingShip.combat = {
      ...pristineCombatState(dyingProfile),
      shieldHp: 0,
      armorHp: 0,
      componentHp: { weapons: dyingProfile.components.weapons * 0.2, utility: dyingProfile.components.utility * 0.2, core: dyingProfile.components.core * 0.2 },
    }
    const hostile = makeShip('cruiser', 'e1', 'hostile')
    let ships = [dyingShip, hostile]
    let engs = syncEngagements(ships, [], simDays)
    engs[0] = {
      ...engs[0],
      participants: engs[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        return p.shipId === 'p1' ? { ...base, position: { x: 0, y: 6, z: 0 }, targetShipId: 'e1' } : { ...base, position: { x: 2, y: 6, z: 0 } }
      }),
    }
    const step = stepEngagements(engs, ships, simDays + COMBAT_STEP_DAYS)
    const p1After = step.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check('Shield Boost wins the grid for a critically damaged, under-fire ship', p1After?.shieldBoostActive === true)
    check(
      '...and NEITHER other boost is also active — the auto-tactics pass never double-claims the grid',
      p1After?.thrusterBoostActive !== true && p1After?.weaponsBoostActive !== true,
    )
  }

  // Thruster Boost additionally can never coexist with Spin Thrust — a
  // directed speed/evasion push makes no sense on a ship that has already
  // given up steering to a random walk (see CombatParticipant.
  // thrusterBoostActive's own comment).
  {
    const engagementId = 'mutex-spin-test'
    const shipId = 'p1'
    const participant = {
      shipId, side: 0 as const, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
      path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
    }
    useCombatStore.setState({
      engagements: [
        {
          id: engagementId, locationKey: 'k', locationLabel: 'l', startedSimDays: 0, density: 'standard' as const,
          center: { x: 0, y: 0, z: 0 }, obstacles: [], participants: [participant], resolvedThroughSimDays: 0,
        },
      ],
    })
    const store = useCombatStore.getState()

    store.setThrusterBoost(engagementId, shipId, true)
    let p = useCombatStore.getState().engagements[0].participants[0]
    check('Thruster Boost switches on with nothing else active', p.thrusterBoostActive === true)

    store.setSpinThrust(engagementId, shipId, true)
    p = useCombatStore.getState().engagements[0].participants[0]
    check('...and switching Spin Thrust on cancels Thruster Boost', p.spinThrustActive === true && p.thrusterBoostActive === false)

    store.setThrusterBoost(engagementId, shipId, true)
    p = useCombatStore.getState().engagements[0].participants[0]
    check(
      '...and trying to activate Thruster Boost while Spin Thrust still has the ship is refused',
      p.thrusterBoostActive === false && p.spinThrustActive === true,
    )

    store.setSpinThrust(engagementId, shipId, false)
    store.setThrusterBoost(engagementId, shipId, true)
    p = useCombatStore.getState().engagements[0].participants[0]
    check('...but it activates normally once Spin Thrust is canceled', p.thrusterBoostActive === true && p.spinThrustActive === false)
    useCombatStore.setState({ engagements: [] })
  }

  // Same rule holds for the AI's own auto-tactics pass, not just the manual
  // store setters.
  {
    const simDays = 900
    const scaredShip = makeShip('cruiser', 'p1', 'player')
    const scaredProfile = shipCombatProfile(scaredShip)!
    scaredShip.combat = { ...pristineCombatState(scaredProfile), shieldHp: scaredProfile.defenses.shieldHp * 0.1 }
    const hostile = makeShip('cruiser', 'e1', 'hostile')
    let ships = [scaredShip, hostile]
    let engs = syncEngagements(ships, [], simDays)
    engs[0] = {
      ...engs[0],
      participants: engs[0].participants.map((p) => {
        const base = { ...p, path: [], holdPosition: true }
        return p.shipId === 'p1'
          ? { ...base, position: { x: 0, y: 6, z: 0 }, targetShipId: 'e1', spinThrustActive: true }
          : { ...base, position: { x: 2, y: 6, z: 0 } }
      }),
    }
    const step = stepEngagements(engs, ships, simDays + COMBAT_STEP_DAYS)
    const p1After = step.engagements[0]?.participants.find((p) => p.shipId === 'p1')
    check(
      'the auto-tactics pass never turns Thruster Boost on for a ship Spin Thrust already has, even with nothing else shooting',
      p1After?.thrusterBoostActive !== true,
    )
  }
}

console.log('\n=== 70. Tactic badges: activeTacticIds + tacticBadge, with a "???" fallback for the unknown ===')
{
  const none = {
    shipId: 'p1', side: 0 as const, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  check('a participant running nothing has no active tactic ids', activeTacticIds(none).length === 0)

  const busy = { ...none, shieldBoostActive: true, spinThrustActive: true, ramming: true }
  const ids = activeTacticIds(busy)
  check('every active flag shows up as an id', ids.includes('shield-boost') && ids.includes('spin-thrust') && ids.includes('ramming'))
  check('an inactive flag does not', !ids.includes('thruster-boost') && !ids.includes('weapons-boost'))

  for (const id of TACTIC_IDS) {
    const badge = tacticBadge(id)
    check(`tacticBadge recognizes '${id}'`, badge.label !== '???' && badge.label.length > 0 && !!badge.title)
  }

  const unknown = tacticBadge('some-tactic-not-added-yet')
  check('an id with no registered label/description falls back to "???"', unknown.label === '???')
  check('...with no tooltip, rather than printing "undefined"', unknown.title === undefined)
}

console.log('\n=== 71. engagementIsContested: "an Engagement exists" is not "a fight is happening" ===')
{
  // Mirrors the two real bugs this exists to fix (see its own comment):
  // ShipPanel showing "In combat" for a hostile-free persisted arena, and
  // the clock not re-engaging tactical time when a fresh scenario silently
  // reuses an existing engagement id at the same location.
  const p1 = {
    shipId: 'p1', side: 0 as const, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, positionSimDays: 0,
    path: [], weaponReadySimDays: [], targetShipId: null, targetComponent: null, holdPosition: false,
  }
  const e1 = { ...p1, shipId: 'e1', side: 1 as const }
  const p2 = { ...p1, shipId: 'p2' }
  const allegiances: Record<string, 'player' | 'hostile'> = { p1: 'player', e1: 'hostile', p2: 'player' }
  const allegianceOf = (id: string) => allegiances[id]

  check('a two-sided hostile roster IS contested', engagementIsContested({ participants: [p1, e1] }, allegianceOf))
  check('an all-player roster (the winning side lingering, or a solo lookaround) is NOT contested', !engagementIsContested({ participants: [p1, p2] }, allegianceOf))
  check('a single-ship roster is NOT contested (nothing to be hostile to)', !engagementIsContested({ participants: [p1] }, allegianceOf))
  check('an empty roster is NOT contested', !engagementIsContested({ participants: [] }, allegianceOf))
  check(
    "a participant whose ship no longer exists (allegianceOf returns undefined) doesn't count toward contesting — matches a stale engagement whose old roster was already removed",
    !engagementIsContested({ participants: [p1, e1] }, (id) => (id === 'e1' ? undefined : allegiances[id])),
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
