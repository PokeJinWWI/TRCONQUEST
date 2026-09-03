// Combat resolution — pure functions over (engagements, ships, simDays).
//
// Nothing here reads or writes a store; every function takes what it needs
// and returns what changed, exactly like shipPhysics.planMove. That's what
// makes combat testable without mounting a scene (this project's browser
// sandbox can't reliably render a second WebGL context — see Context.md), and
// it's why the whole thing steps in fixed sim-second increments rather than
// resolving a variable chunk per frame: outcomes must not depend on framerate.

import { MathUtils, Vector3 } from 'three'
import {
  DAMAGE_PROFILES,
  HYPERDRIVE_CHARGE_SECONDS,
  OVERALL_WEIGHTS,
  WARP_CHARGE_SECONDS,
  COMPONENT_KINDS,
  utilityEffectiveness,
  weaponsEffectiveness,
  KITE_RANGE_FRACTION,
  KITE_TOLERANCE,
  SWARM_RANGE_FRACTION,
  CHASE_STANDOFF_UNITS,
  CHAFF_MISS_CHANCE,
  CHAFF_DURATION_SECONDS,
  scuttleDamageAt,
  ramDamageAt,
  RAM_SELF_DAMAGE_FRACTION,
  missileDamageMultiplier,
  torpedoAccuracy,
  CHAFF_AI_FIRST_THRESHOLD,
  CHAFF_AI_SECOND_THRESHOLD,
  CHAFF_CHARGES,
  projectileSpeedUnitsPerSecond,
  PROJECTILE_IMPACT_RADIUS_UNITS,
  THRUSTER_BOOST_SPEED_BONUS_FRACTION,
  THRUSTER_BOOST_EVASION_BONUS,
  THRUSTER_BOOST_LASER_DAMAGE_MULTIPLIER,
  THRUSTER_BOOST_CANNON_DAMAGE_MULTIPLIER,
  SHIELD_BOOST_REGEN_MULTIPLIER,
  SHIELD_BOOST_ENERGY_DAMAGE_MULTIPLIER,
  SHIELD_BOOST_KINETIC_DAMAGE_MULTIPLIER,
  SHIELD_BOOST_EVASION_PENALTY,
  SHIELD_BOOST_SPEED_PENALTY_FRACTION,
  SHIELD_BOOST_AI_HEALTH_ENGAGE_THRESHOLD,
  SHIELD_BOOST_AI_HEALTH_DISENGAGE_THRESHOLD,
  WEAPONS_BOOST_DAMAGE_MULTIPLIER,
  WEAPONS_BOOST_SHIELD_REGEN_MULTIPLIER,
  WEAPONS_BOOST_SPEED_PENALTY_FRACTION,
  WEAPONS_BOOST_AI_HEALTH_ENGAGE_THRESHOLD,
  WEAPONS_BOOST_AI_HEALTH_DISENGAGE_THRESHOLD,
  SPIN_THRUST_EVASION_BONUS,
  SPIN_THRUST_REDIRECT_CHANCE,
  SPIN_THRUST_SIZE_EFFECTIVENESS,
  SPIN_THRUST_AI_HEALTH_ENGAGE_THRESHOLD,
  SPIN_THRUST_AI_HEALTH_DISENGAGE_THRESHOLD,
  SPIN_THRUST_TURN_RADIANS_PER_STEP,
  SPIN_THRUST_COLLISION_LOOKAHEAD_SECONDS,
  SPIN_THRUST_COLLISION_CLEARANCE_UNITS,
  type CombatProfile,
  type CombatStance,
  type ComponentKind,
  type DamageType,
  type FleetStrategy,
  type HullSizeClass,
  type WeaponMount,
} from '../data/combatData'
import { resolveShipClass } from '../state/shipClassResolver'
import type { MoveDestination, ShipCombatState, ShipInstance, ShipLocation, FtlCharge } from '../state/shipStore'
import type { Fleet } from '../state/fleetStore'
import {
  areHostile,
  combatLocationKey,
  combatLocationLabel,
  sideFor,
  type CombatParticipant,
  type Engagement,
  type InFlightProjectile,
} from '../state/combatStore'
import {
  ARENA_ORIGIN,
  ARENA_SPAN_UNITS,
  arenaBodyRadius,
  arenaDistanceFromKm,
  arenaPositionToNode,
  arenaSurfaceGravity,
  gravitationalAcceleration,
  orbitalHoldVelocity,
  hasLineOfFire,
  isPointBlocked,
  latticePath,
  nodeToArenaPosition,
  pointDistance,
  segmentClearsObstacles,
  startingPoint,
  toVector3,
  type ArenaPoint,
  type CombatObstacle,
  type GridDensity,
} from './combatArena'
import { getPlanetsForStar } from './planetData'
import { STARS, findSystemStar } from '../data/starData'
import { getMoonsForPlanet, type MoonData } from './moonData'
import { angleForYear, getOrbitPosition, MOON_TIME_DILATION } from './orbitMath'
import { simDaysToSeconds, simSecondsToDays } from '../state/gameTimeStore'

// Fixed simulation step, in sim-seconds. Small enough that a 0.8s autocannon
// resolves smoothly, large enough that a minute of tactical combat is ~600
// steps rather than tens of thousands.
export const COMBAT_STEP_SECONDS = 0.1
export const COMBAT_STEP_DAYS = simSecondsToDays(COMBAT_STEP_SECONDS)

// Ceiling on how many steps one frame may catch up. Combat can only be
// *watched* in tactical mode; if the clock is left in normal mode (a real
// second is ~518,400 sim-seconds) the resolver would otherwise try to
// simulate millions of steps per frame. Capping it means combat simply
// resolves at its own maximum pace and the clock runs ahead — which is
// exactly the "fights resolve offscreen" behavior wanted when a player has
// opted out of auto-switching to tactical.
export const MAX_STEPS_PER_TICK = 40

// Where combat resolution should resume from, given how far it previously
// got and what time it is now.
//
// The clamp is the whole point. Combat can advance at most
// MAX_STEPS_PER_TICK * COMBAT_STEP_SECONDS of simulated time per tick, while
// strategic pace advances the CLOCK about 2,160x faster than that. Treating
// the shortfall as a debt to be repaid makes it permanent and compounding:
// one real second spent in strategic time buys roughly 36 real minutes of
// catch-up, during which the battle runs at ~240x — which is exactly the
// reported bug of a fight "still fighting in strategy time" long after the
// clock returned to tactical.
//
// Discarding the excess instead means combat always resolves against the
// CURRENT moment, so returning to tactical is immediately 1:1 again. Time the
// fight was never simulated through simply didn't happen to it — the honest
// reading of "combat is unobservable at strategic pace," which this whole
// module is already built on.
export function combatCatchUpCursor(resolvedThroughSimDays: number, simDays: number): number {
  const maxLagDays = MAX_STEPS_PER_TICK * COMBAT_STEP_DAYS
  return simDays - resolvedThroughSimDays > maxLagDays ? simDays - maxLagDays : resolvedThroughSimDays
}

// Injected so tests can supply a seeded generator and assert exact outcomes —
// the sandbox can't reliably verify combat visually, so deterministic
// pure-function testing is the primary verification path here.
export type Rng = () => number

export function shipCombatProfile(ship: Pick<ShipInstance, 'classId'>): CombatProfile | null {
  return resolveShipClass(ship.classId)?.combat ?? null
}

// The single blended readout shown above the individual bars — a weighted
// average across all five pools (see OVERALL_WEIGHTS for why shields and
// armor are included rather than treated as mere buffers).
//
// Weights are renormalized over whichever pools the hull actually has, so a
// design with no shields reads 100% when undamaged instead of being
// permanently capped at 85%.
export function overallHealthFraction(state: ShipCombatState, profile: CombatProfile): number {
  const pools: { fraction: number; weight: number }[] = []
  for (const kind of COMPONENT_KINDS) {
    const max = profile.components[kind]
    if (max <= 0) continue
    pools.push({ fraction: Math.max(0, state.componentHp[kind]) / max, weight: OVERALL_WEIGHTS[kind] })
  }
  if (profile.defenses.armorHp > 0) {
    pools.push({ fraction: Math.max(0, state.armorHp) / profile.defenses.armorHp, weight: OVERALL_WEIGHTS.armor })
  }
  if (profile.defenses.shieldHp > 0) {
    pools.push({ fraction: Math.max(0, state.shieldHp) / profile.defenses.shieldHp, weight: OVERALL_WEIGHTS.shields })
  }
  const totalWeight = pools.reduce((sum, p) => sum + p.weight, 0)
  if (totalWeight <= 0) return 0
  const blended = pools.reduce((sum, p) => sum + p.fraction * p.weight, 0) / totalWeight
  return Math.max(0, Math.min(1, blended))
}

// A hull's total HP capacity across every pool (every component, plus
// shields and armor) — the "how big is this ship" figure Screen's own
// toughness ranking and the engagement panel's aggregate health bar both
// need. Deliberately unweighted, unlike overallHealthFraction (which blends
// pools by WEIGHT, not by raw size) — "how much mass does this hull
// represent" is a different question from "how healthy is it right now."
export function totalHitPoints(profile: CombatProfile): number {
  return COMPONENT_KINDS.reduce((sum, k) => sum + profile.components[k], 0) + profile.defenses.shieldHp + profile.defenses.armorHp
}

export function isDestroyed(state: ShipCombatState): boolean {
  return state.componentHp.core <= 0
}

// Whether a ship's chaff burst is still up right now. Central so the
// resolver, the UI readout, and the tests all agree on one definition of
// "active" rather than each re-deriving the deadline comparison.
export function isChaffActive(state: ShipCombatState, simDays: number): boolean {
  return state.chaffActiveUntilSimDays !== null && simDays < state.chaffActiveUntilSimDays
}

// Spends one charge and starts a burst, or returns the state untouched when
// the ship has none left or already has one up. Returning the SAME object on
// a no-op matters: callers use identity to decide whether anything actually
// changed and needs writing back.
export function deployChaff(state: ShipCombatState, simDays: number): ShipCombatState {
  if (state.chaffRemaining <= 0) return state
  if (isChaffActive(state, simDays)) return state
  return {
    ...state,
    chaffRemaining: state.chaffRemaining - 1,
    chaffActiveUntilSimDays: simDays + simSecondsToDays(CHAFF_DURATION_SECONDS),
  }
}

// How far past its last integration step rendering may extrapolate a ship's
// position, in sim-seconds. The resolver advances in whole 0.1s steps and
// carries the remainder, so the render clock normally sits a fraction of a
// step ahead — extrapolating along the velocity vector across that gap is
// what keeps motion smooth instead of visibly updating 10 times a second.
// Clamped so that a clock racing far ahead of the simulation (normal time
// mode, or a long catch-up) can't fling ships across the arena on a stale
// velocity.
const MAX_EXTRAPOLATION_SECONDS = COMBAT_STEP_SECONDS * 2

// Where a participant actually is right now: its last integrated position,
// carried forward along its current velocity. Exact for constant velocity,
// and never more than a step or two of extrapolation off during
// acceleration.
export function participantArenaPosition(p: CombatParticipant, simDays: number): Vector3 {
  const elapsed = Math.max(0, Math.min(MAX_EXTRAPOLATION_SECONDS, simDaysToSeconds(simDays - p.positionSimDays)))
  return new Vector3(
    p.position.x + p.velocity.x * elapsed,
    p.position.y + p.velocity.y * elapsed,
    p.position.z + p.velocity.z * elapsed,
  )
}

export function participantSpeed(p: CombatParticipant): number {
  return Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z)
}

// Tactics (see combatData's Tactics section) that modify a ship's own
// maneuverUnitsPerSecond/accelerationUnitsPerSecondSq. Written as independent
// multiplicative checks (not an if/else-if chain) even though at most one of
// the three BOOST_TACTIC_IDS is ever actually true at once (see
// combatStore's setThrusterBoost/setShieldBoost/setWeaponsBoost) — this stays
// correct on its own even if that invariant were ever violated, rather than
// silently depending on it.
export function tacticSpeedMultiplier(p: CombatParticipant): number {
  let mult = 1
  if (p.thrusterBoostActive) mult *= 1 + THRUSTER_BOOST_SPEED_BONUS_FRACTION
  if (p.shieldBoostActive) mult *= 1 - SHIELD_BOOST_SPEED_PENALTY_FRACTION
  if (p.weaponsBoostActive) mult *= 1 - WEAPONS_BOOST_SPEED_PENALTY_FRACTION
  return mult
}

// Additive evasion bonus/penalty from active Tactics — consulted wherever
// DefenseProfile.evasion itself is (currently only torpedoAccuracy; see that
// function's own comment on why missiles are unaffected). Not clamped here —
// torpedoAccuracy already clamps the combined value into [0, 1]. Weapons
// Boost doesn't touch evasion at all — its trade is shields and speed only.
// `sizeClass` only matters for Spin Thrust — see SPIN_THRUST_SIZE_
// EFFECTIVENESS's own comment for why a bigger hull gets less out of it.
export function tacticEvasionBonus(p: CombatParticipant, sizeClass: HullSizeClass): number {
  let bonus = 0
  if (p.thrusterBoostActive) bonus += THRUSTER_BOOST_EVASION_BONUS
  if (p.shieldBoostActive) bonus -= SHIELD_BOOST_EVASION_PENALTY
  if (p.spinThrustActive) bonus += SPIN_THRUST_EVASION_BONUS * SPIN_THRUST_SIZE_EFFECTIVENESS[sizeClass]
  return bonus
}

// Per-weapon-family multiplier on this SHOOTER's own output from the three
// boost tactics. Thruster Boost / Shield Boost both divert power AWAY from
// the guns, at different rates for energy vs. kinetic mounts (see each
// constant's own comment for why) — and leave missile/torpedo damage
// completely alone, since those are physical rounds, not power-hungry
// beam/rail systems. Weapons Boost is the mirror case: power flows TOWARD
// the guns, and — unlike the other two — the bonus applies uniformly to
// EVERY damage type, missiles/torpedoes included (see combatData's own
// comment on WEAPONS_BOOST_DAMAGE_MULTIPLIER for why).
export function tacticWeaponDamageMultiplier(p: CombatParticipant, damageType: DamageType): number {
  let mult = 1
  if (damageType === 'energy') {
    if (p.thrusterBoostActive) mult *= THRUSTER_BOOST_LASER_DAMAGE_MULTIPLIER
    if (p.shieldBoostActive) mult *= SHIELD_BOOST_ENERGY_DAMAGE_MULTIPLIER
  } else if (damageType === 'kinetic') {
    if (p.thrusterBoostActive) mult *= THRUSTER_BOOST_CANNON_DAMAGE_MULTIPLIER
    if (p.shieldBoostActive) mult *= SHIELD_BOOST_KINETIC_DAMAGE_MULTIPLIER
  }
  if (p.weaponsBoostActive) mult *= WEAPONS_BOOST_DAMAGE_MULTIPLIER
  return mult
}

// A waypoint counts as reached inside this radius (or inside one step's
// travel, whichever is larger — otherwise a fast ship can step straight over
// a waypoint and circle back for it).
const WAYPOINT_ARRIVE_RADIUS = 0.08

// Advances one ship's motion by `dt` sim-seconds under a real acceleration
// limit.
//
// The whole model is a single rule: steer the velocity *vector* toward the
// velocity we'd like to have, changing it by no more than `accel * dt` per
// step. Starting, stopping, and turning all fall out of that one constraint
// rather than needing separate cases — turning costs acceleration budget
// exactly like speeding up does, so a heavy hull sweeps a wide arc while a
// corvette pivots tightly, with no special-case turn logic anywhere.
//
// Braking is handled by asking, each step, "how fast could I still be going
// and stop exactly on the final waypoint?" (v = sqrt(2*a*d)) and never
// exceeding that. Intermediate waypoints deliberately skip this — a ship
// flies *through* a corner of a detour at cruise speed rather than coming to
// a halt at every turn.
export function integrateMotion(
  p: CombatParticipant,
  maxSpeed: number,
  accel: number,
  dt: number,
  simDays: number,
  obstacles: CombatObstacle[] = [],
  // Whether this ship's owner has researched Free-Flight Maneuvering (see
  // techData.ts's Classical Mechanics branch) — defaults to true so every
  // existing caller (tests included) that doesn't pass this keeps today's
  // behavior unchanged. Only matters when there's no destination queued (see
  // the `else` branch below); a ship actively steering toward a waypoint is
  // completely unaffected either way.
  canFreeFloat: boolean = true,
): CombatParticipant {
  const position = toVector3(p.position)
  const velocity = toVector3(p.velocity)
  let path = p.path

  // The velocity we'd hold if we could change it instantly.
  const desired = new Vector3(0, 0, 0)
  if (path.length > 0 && maxSpeed > 0) {
    const target = toVector3(path[0])
    const toTarget = target.clone().sub(position)
    const distance = toTarget.length()
    if (distance > 1e-9) {
      let speed = maxSpeed
      if (path.length === 1 && accel > 0) {
        speed = Math.min(maxSpeed, Math.sqrt(2 * accel * distance))
      }
      desired.copy(toTarget.divideScalar(distance).multiplyScalar(speed))
    }
  } else if (!canFreeFloat && maxSpeed > 0 && obstacles.length > 0) {
    // Nothing queued, and this ship hasn't researched Free-Flight
    // Maneuvering — "holding position" defaults to actually orbiting the
    // primary body being fought near (obstaclesForLocation always puts the
    // real star/planet at index 0), rather than sitting stationary for
    // free. A fight with no body present (deep space) has nothing to orbit,
    // so this has no effect there regardless of canFreeFloat — matches the
    // `obstacles.length > 0` guard. Clamped to maxSpeed same as the
    // path-following branch above: a hull too slow to hold the orbital
    // speed this close in simply can't fully counter gravity and drifts
    // inward, the same honest failure mode an underpowered real engine
    // would have.
    desired.copy(orbitalHoldVelocity(p.position, obstacles[0]))
    if (desired.length() > maxSpeed) desired.setLength(maxSpeed)
  }

  // Steer toward it, budget-limited. With an empty path `desired` is zero,
  // so this is also what brings a ship to a controlled stop.
  const budget = accel * dt
  const delta = desired.clone().sub(velocity)
  if (budget > 0) {
    if (delta.length() > budget) delta.setLength(budget)
    velocity.add(delta)
    // Only enforced where there's thrust to have caused an overshoot in the
    // first place (steering delta clamped to budget above should never push
    // speed past maxSpeed by more than float noise, so this is mostly a
    // safety net) — see the budget<=0 branch below for why it must NOT run
    // when there's no thrust at all.
    if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed)
  } else {
    // budget <= 0 (utility destroyed — see the caller's utility*accel/
    // maxSpeed scaling): velocity is left untouched by STEERING — a ship
    // with no thrust can neither steer NOR brake, so the maxSpeed clamp
    // above must not run here either (it would otherwise instantly zero out
    // whatever velocity the ship had the moment thrust died, which is
    // exactly backwards from "drifts ballistically": momentum should survive
    // exactly as it was, not snap to a dead stop on the very next step).
    //
    // Gravity is not steering, though — a body's pull reaches a ship whether
    // or not its own engines still work (per the design brief: "in most
    // cases thrusters let ships treat it as flat space," but nothing is
    // countering gravity here any more). This is what turns "drifts in a
    // straight line forever" into "actually falls toward whatever it's
    // near, or curves into something like an orbit if it had sideways
    // velocity to begin with" — real Newtonian integration, not a special
    // case, so it can produce either depending on the ship's velocity at the
    // moment thrust died.
    velocity.add(gravitationalAcceleration(p.position, obstacles).multiplyScalar(dt))
  }

  position.add(velocity.clone().multiplyScalar(dt))

  if (path.length > 0) {
    const target = toVector3(path[0])
    const arriveRadius = Math.max(WAYPOINT_ARRIVE_RADIUS, velocity.length() * dt)
    if (target.distanceTo(position) <= arriveRadius) {
      // Settle exactly onto the last waypoint rather than drifting past it —
      // the ship was ordered *there*, and braking has it nearly stopped by
      // this point anyway.
      if (path.length === 1) {
        position.copy(target)
        velocity.set(0, 0, 0)
      }
      path = path.slice(1)
    }
  }

  return {
    ...p,
    position: { x: position.x, y: position.y, z: position.z },
    velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
    positionSimDays: simDays,
    path,
  }
}

function randomUnitVector(rng: Rng): Vector3 {
  const theta = rng() * Math.PI * 2
  const phi = Math.acos(2 * rng() - 1)
  return new Vector3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi))
}

// Spin Thrust's own integration: velocity is a bounded random walk instead
// of steering toward any path/stance/order — see CombatParticipant.
// spinThrustActive's own comment for why this is deliberately a separate
// function from integrateMotion rather than a variant of it. Rotates the
// CURRENT heading by a small random angle each step (bounded by
// SPIN_THRUST_TURN_RADIANS_PER_STEP) rather than picking a fresh random
// direction outright, so the result reads as a corkscrewing tumble rather
// than the ship's heading teleporting every 0.1s. Always drives at full
// maxSpeed once spinning — "cut loose," not "gently drifting" — same
// budget-limited steering integrateMotion uses, just toward a random
// desired velocity instead of one derived from a path.
export function integrateSpinThrustDrift(p: CombatParticipant, maxSpeed: number, accel: number, dt: number, simDays: number, rng: Rng): CombatParticipant {
  const position = toVector3(p.position)
  const velocity = toVector3(p.velocity)
  const currentSpeed = velocity.length()
  const heading = currentSpeed > 1e-6 ? velocity.clone().divideScalar(currentSpeed) : randomUnitVector(rng)

  // Perturb the heading by a bounded random rotation around an axis
  // perpendicular to it (a rotation AROUND the heading itself would do
  // nothing to it) — built from a random reference vector rather than a
  // fixed axis so the tumble doesn't settle into a flat circle.
  const reference = randomUnitVector(rng)
  const rotationAxis = heading.clone().cross(reference)
  const desired =
    rotationAxis.lengthSq() > 1e-9
      ? heading.clone().applyAxisAngle(rotationAxis.normalize(), (rng() * 2 - 1) * SPIN_THRUST_TURN_RADIANS_PER_STEP)
      : heading.clone()
  desired.multiplyScalar(maxSpeed)

  const budget = accel * dt
  const delta = desired.clone().sub(velocity)
  if (budget > 0) {
    if (delta.length() > budget) delta.setLength(budget)
    velocity.add(delta)
    if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed)
  }
  position.add(velocity.clone().multiplyScalar(dt))

  return {
    ...p,
    position: { x: position.x, y: position.y, z: position.z },
    velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
    positionSimDays: simDays,
  }
}

// Which of the three healthbars a shot lands on. An explicitly chosen
// component always wins while it still has HP left; otherwise damage falls on
// a random surviving component weighted by its size, so a ship's big core
// soaks proportionally more stray fire than its small weapons array without
// any component being immune.
export function pickComponent(
  preferred: ComponentKind | null,
  state: ShipCombatState,
  profile: CombatProfile,
  rng: Rng,
): ComponentKind {
  if (preferred && state.componentHp[preferred] > 0) return preferred
  const alive = COMPONENT_KINDS.filter((k) => state.componentHp[k] > 0)
  // Everything else is already gone — put it into the core so the kill
  // actually lands rather than being absorbed by a destroyed subsystem.
  if (alive.length === 0) return 'core'
  const totalWeight = alive.reduce((sum, k) => sum + profile.components[k], 0)
  let roll = rng() * totalWeight
  for (const kind of alive) {
    roll -= profile.components[kind]
    if (roll <= 0) return kind
  }
  return alive[alive.length - 1]
}

// Spin Thrust's damage redirection (see combatData's SPIN_THRUST_REDIRECT_
// CHANCE): the defender is jinking hard enough that some called shots land on
// a DIFFERENT component instead of the one the attacker actually picked.
// Deliberately excludes that component from the pool rather than just
// re-rolling pickComponent with no preference (which could still coincidentally
// land back on it) — "diverted to other portions" means somewhere else, not
// "maybe somewhere else." Falls back to null (spread as normal) if nothing
// OTHER than the excluded component is still alive to redirect to.
function pickComponentExcluding(exclude: ComponentKind, state: ShipCombatState, profile: CombatProfile, rng: Rng): ComponentKind | null {
  const alive = COMPONENT_KINDS.filter((k) => k !== exclude && state.componentHp[k] > 0)
  if (alive.length === 0) return null
  const totalWeight = alive.reduce((sum, k) => sum + profile.components[k], 0)
  let roll = rng() * totalWeight
  for (const kind of alive) {
    roll -= profile.components[kind]
    if (roll <= 0) return kind
  }
  return alive[alive.length - 1]
}

export interface ShotOutcome {
  intercepted: boolean
  // Defeated by the target's active chaff (see combatData's CHAFF_MISS_CHANCE).
  // Distinct from `intercepted`: point defense shot the round down, chaff
  // made the round miss. Both consume the mount's cooldown.
  missed: boolean
  shieldDamage: number
  armorDamage: number
  componentDamage: number
  component: ComponentKind | null
}

// The shields -> armor -> component allocation itself, shared by applyShot
// (a direct-fire shot, or a missile/torpedo at the instant it launches) and
// resolveProjectileImpact (a missile/torpedo's damage, applied later — see
// combatData's "Missile / torpedo travel time" — against whatever the
// target's layers look like AT ARRIVAL rather than at launch). Interception
// and miss/accuracy are both resolved once, at launch, by whichever of those
// two callers reaches this point first for a given shot; this function only
// ever runs for a round that's already confirmed to connect.
//
// Overflow between layers is carried in *raw* (pre-multiplier) damage rather
// than post-multiplier damage — otherwise a kinetic round that overkills a
// shield would carry its 1.5x shield bonus through into armor, where it's
// supposed to be at 0.5x. Converting back to raw at each boundary is what
// makes the counter-matrix behave correctly on partial layers.
function applyDamageLayers(
  damageType: DamageType,
  rawDamage: number,
  target: ShipCombatState,
  targetProfile: CombatProfile,
  preferredComponent: ComponentKind | null,
  rng: Rng,
): { next: ShipCombatState; outcome: Pick<ShotOutcome, 'shieldDamage' | 'armorDamage' | 'componentDamage' | 'component'> } {
  const profile = DAMAGE_PROFILES[damageType]
  let raw = rawDamage
  let shieldHp = target.shieldHp
  let armorHp = target.armorHp
  const componentHp = { ...target.componentHp }
  let shieldDamage = 0
  let armorDamage = 0

  if (!profile.bypassesShields && shieldHp > 0 && profile.shields > 0) {
    const applied = Math.min(shieldHp, raw * profile.shields)
    shieldHp -= applied
    shieldDamage = applied
    raw -= applied / profile.shields
  }

  if (raw > 0 && armorHp > 0 && profile.armor > 0) {
    const applied = Math.min(armorHp, raw * profile.armor)
    armorHp -= applied
    armorDamage = applied
    raw -= applied / profile.armor
  }

  let componentDamage = 0
  let component: ComponentKind | null = null
  if (raw > 0 && profile.components > 0) {
    component = pickComponent(preferredComponent, target, targetProfile, rng)
    componentDamage = raw * profile.components
    componentHp[component] = Math.max(0, componentHp[component] - componentDamage)
  }

  return {
    next: { ...target, shieldHp, armorHp, componentHp },
    outcome: { shieldDamage, armorDamage, componentDamage, component },
  }
}

// Resolves a missile/torpedo's damage against the target's CURRENT state at
// the moment it arrives (see combatData's "Missile / torpedo travel time")
// — deliberately re-running the layer allocation against whatever shields/
// armor look like NOW rather than replaying the exact deltas computed at
// launch, so shield regen (or any other hit the target took mid-flight)
// between launch and arrival is accounted for correctly. Interception and
// hit/miss were already decided at launch (see the firing loop's
// `willHit`) — a round that reaches this function is confirmed to connect.
export function resolveProjectileImpact(
  projectile: Pick<InFlightProjectile, 'damageType' | 'rawDamage' | 'preferredComponent'>,
  target: ShipCombatState,
  targetProfile: CombatProfile,
  rng: Rng,
): ShipCombatState {
  return applyDamageLayers(projectile.damageType, projectile.rawDamage, target, targetProfile, projectile.preferredComponent, rng).next
}

// Applies one shot, eating through shields then armor then a component.
export function applyShot(
  weapon: WeaponMount,
  rawDamage: number,
  target: ShipCombatState,
  targetProfile: CombatProfile,
  preferredComponent: ComponentKind | null,
  rng: Rng,
  // The combined chance THIS shot simply misses, for any reason that isn't
  // point defense — chaff's flat miss chance, torpedo inaccuracy at range
  // against this target's size (see combatData's torpedoAccuracy), or both
  // stacked together. Passed in already-combined rather than computed here
  // so this function stays a dumb consumer of one number and each source's
  // own curve can be tested on its own.
  missChance: number = 0,
): { next: ShipCombatState; outcome: ShotOutcome } {
  const profile = DAMAGE_PROFILES[weapon.damageType]
  const nothing: ShotOutcome = {
    intercepted: false,
    missed: false,
    shieldDamage: 0,
    armorDamage: 0,
    componentDamage: 0,
    component: null,
  }

  // Point defense gets its shot at anything physical before any layer is
  // touched. An intercepted missile does nothing at all.
  //
  // Scaled by the TARGET's own weapons-component health, which is what makes
  // point defense answerable. It was previously a flat hull stat that no
  // amount of fire could degrade, so a Destroyer's 0.55 interception rate
  // held right up until the instant it died — missiles and torpedoes had no
  // play against it at all. Point defense IS gunnery, so it lives or dies
  // with the gunnery array: shoot the weapons component out (Focus Fire ->
  // Weapons) and the screen comes down with it, which is exactly the setup a
  // torpedo boat wants and previously could not create.
  // Flak (see DefenseProfile.flakRating) only stacks onto the point-defense
  // screen against torpedoes specifically — it's a wide burst that does
  // little against a nimble missile but is disproportionately effective
  // against something big and slow.
  const pdRating =
    targetProfile.defenses.pointDefenseRating + (weapon.damageType === 'torpedo' ? targetProfile.defenses.flakRating : 0)
  if (profile.interceptable && pdRating > 0) {
    const screen = pdRating * weaponsEffectiveness(target.componentHp.weapons, targetProfile.components.weapons)
    if (screen > 0 && rng() < screen) {
      return { next: target, outcome: { ...nothing, intercepted: true } }
    }
  }

  // Chaff and/or torpedo inaccuracy: the shot simply doesn't connect. Rolled
  // AFTER point defense so the two stack the way they read — a shot has to
  // survive interception AND still find its target — and applies regardless
  // of what's degrading the attacker's aim, rather than physically stopping a
  // projectile the way point defense does.
  if (missChance > 0 && rng() < missChance) {
    return { next: target, outcome: { ...nothing, missed: true } }
  }

  const { next, outcome } = applyDamageLayers(weapon.damageType, rawDamage, target, targetProfile, preferredComponent, rng)
  return { next, outcome: { intercepted: false, missed: false, ...outcome } }
}

// Applies undirected blast damage (a scuttle — see scuttleDamageAt) through
// shields, then armor, then the core. Separate from applyShot because a
// reactor breach has no damage type, no interception, and no aim: none of the
// matrix, point defense, or chaff applies to it. Shields and armor still soak
// it, since absorbing a blast is precisely their job.
export function applyRawBlast(state: ShipCombatState, damage: number): ShipCombatState {
  let remaining = damage
  let shieldHp = state.shieldHp
  let armorHp = state.armorHp

  const fromShields = Math.min(shieldHp, remaining)
  shieldHp -= fromShields
  remaining -= fromShields

  const fromArmor = Math.min(armorHp, remaining)
  armorHp -= fromArmor
  remaining -= fromArmor

  const componentHp = { ...state.componentHp }
  if (remaining > 0) componentHp.core = Math.max(0, componentHp.core - remaining)
  return { ...state, shieldHp, armorHp, componentHp }
}

// How long a drive takes to spool, stretched by utility damage. A ship whose
// utility array is half wrecked takes twice as long to escape; at zero it
// can't charge at all, which is what makes utility a genuinely decisive
// target rather than a consolation prize.
export function ftlChargeSeconds(kind: 'warp' | 'hyperdrive', utilityFraction: number): number {
  const base = kind === 'hyperdrive' ? HYPERDRIVE_CHARGE_SECONDS : WARP_CHARGE_SECONDS
  if (utilityFraction <= 0) return Infinity
  return base / utilityFraction
}

// Builds the FtlCharge a ship would begin right now for a given destination.
// Returns null when the ship has no drive of that kind, or is too wrecked to
// charge at all.
export function planFtlCharge(ship: ShipInstance, destination: MoveDestination, simDays: number): FtlCharge | null {
  const shipClass = resolveShipClass(ship.classId)
  const profile = shipClass?.combat
  if (!shipClass || !profile) return null
  // Prefer whichever drive spools fastest — hyperdrive at 5s beats warp at
  // 10s, so a hull carrying both runs on hyperdrive.
  const kinds = shipClass.ftlDrives.map((d) => d.kind)
  const kind: 'warp' | 'hyperdrive' | null = kinds.includes('hyperdrive')
    ? 'hyperdrive'
    : kinds.includes('warp')
      ? 'warp'
      : null
  if (!kind) return null
  const utility = utilityEffectiveness(ship.combat.componentHp.utility, profile.components.utility)
  const seconds = ftlChargeSeconds(kind, utility)
  if (!Number.isFinite(seconds)) return null
  return {
    kind,
    destination,
    startedSimDays: simDays,
    readySimDays: simDays + simSecondsToDays(seconds),
  }
}

// The nearest hostile participant — the default target for any ship whose
// player hasn't assigned one, and the permanent behavior of every AI ship.
export function nearestEnemy(self: CombatParticipant, participants: CombatParticipant[]): CombatParticipant | null {
  let best: CombatParticipant | null = null
  let bestDistance = Infinity
  for (const other of participants) {
    if (other.side === self.side || other.shipId === self.shipId) continue
    const distance = pointDistance(self.position, other.position)
    if (distance < bestDistance) {
      bestDistance = distance
      best = other
    }
  }
  return best
}

// --- Celestial bodies in the arena -----------------------------------------
// arenaBodyRadius itself now lives in combatArena.ts (imported above) — see
// its own comment there for the true-to-scale sizing this arena uses.

// The bodies present at a fight, placed at the arena origin — which is where
// a fresh engagement's window is centered too (see syncEngagements), so a
// fight in orbit starts with that body squarely between the two sides. This
// is exactly the situation the design brief called out: two ships on
// opposite sides of a star should not be able to shoot each other. The
// body's position is real and fixed from here on — it does not move if the
// player later recentres the window (see combatArena.ts's header).
//
// Moons of the primary are deliberately *not* included in general — most
// don't reach a body a ship can actually rest at (see obstaclesForLocation's
// last branch). Luna is the one exception, and now that body sizing is
// linear/true-to-scale (see arenaBodyRadius), its real position doesn't need
// inventing either: moonArenaState below places it at its actual ~72-unit
// orbit radius, genuinely orbiting rather than fixed, using the same real
// period/phase/dilation orbitMath.ts already animates it with in system
// view. A fight starting anywhere near Earth simply won't have Luna in easy
// reach most of the time — that's the honest consequence of the Moon
// actually being that far away, not a bug.
//
// Position AND velocity: an orbiting body isn't at rest in this frame the
// way the primary it's placed relative to always is (see this function's own
// header comment on that), and CombatParticipant.inheritVelocity needs a
// real tangential velocity to lock onto, not just a moving point.
function moonArenaState(moon: MoonData, simDays: number): { position: ArenaPoint; velocity: ArenaPoint } {
  const orbitRadiusUnits = arenaDistanceFromKm(moon.distanceKm)
  const simYears = simDays / 365.25 // same simDays -> simYears conversion angleForYear's other callers use
  const direction = moon.retrograde ? -1 : 1
  const effectivePeriodYears = (moon.periodDays * MOON_TIME_DILATION) / 365.25
  const angle = angleForYear(simYears * direction, effectivePeriodYears, MathUtils.degToRad(moon.phaseDeg))

  const position = getOrbitPosition(orbitRadiusUnits, angle, moon.inclinationDeg, 0)

  // d(angle)/d(simDays) — the derivative of angleForYear's own formula — then
  // converted to a tangential velocity in the orbital plane the same way
  // getOrbitPosition builds the position itself: a flat circle in XZ, tilted
  // by inclination. Differentiating BEFORE tilting and applying the same
  // rotation afterward is valid because that rotation is linear.
  const angularVelocityPerSimDay = ((2 * Math.PI) / (effectivePeriodYears * 365.25)) * direction
  const angularVelocityPerSimSecond = angularVelocityPerSimDay / simDaysToSeconds(1)
  const tangential = new Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(orbitRadiusUnits * angularVelocityPerSimSecond)
  tangential.applyAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(moon.inclinationDeg))

  return { position: { x: position.x, y: position.y, z: position.z }, velocity: { x: tangential.x, y: tangential.y, z: tangential.z } }
}

export function obstaclesForLocation(location: ShipLocation, simDays = 0): CombatObstacle[] {
  if (location.kind === 'star') {
    const star = STARS.find((s) => s.id === location.starId)
    if (!star) return []
    return [
      {
        name: star.name,
        kind: 'star',
        color: star.color,
        position: ARENA_ORIGIN,
        radiusUnits: arenaBodyRadius(star.radiusKm),
        surfaceGravityUnitsPerSecondSq: arenaSurfaceGravity(star.massKg, star.radiusKm),
      },
    ]
  }

  if (location.kind === 'orbiting') {
    // A star doubles as a body you can orbit (Sol, or any component star in a
    // multi-star system — Rigil Kentaurus, Sirius A, ...). findSystemStar
    // covers single- and multi-star systems alike. The arena centers on
    // whatever the fight orbits, so the star sits at the origin here
    // regardless of its position in the wider system.
    const star = findSystemStar(location.bodyName)
    if (star) {
      return [
        {
          name: star.name,
          kind: 'star',
          color: star.color,
          position: ARENA_ORIGIN,
          radiusUnits: arenaBodyRadius(star.radiusKm),
          surfaceGravityUnitsPerSecondSq: arenaSurfaceGravity(star.massKg, star.radiusKm),
        },
      ]
    }
    const systemPlanets = getPlanetsForStar(location.systemId)
    const planet = systemPlanets.find((p) => p.name === location.bodyName)
    if (planet) {
      const obstacles: CombatObstacle[] = [
        {
          name: planet.name,
          kind: 'planet',
          color: planet.color,
          position: ARENA_ORIGIN,
          radiusUnits: arenaBodyRadius(planet.radiusKm),
          surfaceGravityUnitsPerSecondSq: arenaSurfaceGravity(planet.massKg, planet.radiusKm),
        },
      ]
      // See moonArenaState above — the one moon close enough (in the "famous
      // for it," not the "conveniently nearby" sense) to be worth adding.
      if (planet.name === 'Earth') {
        const luna = getMoonsForPlanet('Earth').moons.find((m) => m.name === 'Luna')
        if (luna) {
          const { position, velocity } = moonArenaState(luna, simDays)
          obstacles.push({
            name: luna.name,
            kind: 'moon',
            color: luna.color,
            position,
            velocity,
            radiusUnits: arenaBodyRadius(luna.radiusKm),
            surfaceGravityUnitsPerSecondSq: arenaSurfaceGravity(luna.massKg ?? 0, luna.radiusKm),
          })
        }
      }
      return obstacles
    }
    // A moon being orbited directly isn't reachable as a rest location today,
    // but resolve it rather than silently producing an empty arena if it ever
    // becomes one.
    for (const p of systemPlanets) {
      const moon = getMoonsForPlanet(p.name).moons.find((m) => m.name === location.bodyName)
      if (moon) {
        return [
          {
            name: moon.name,
            kind: 'moon',
            color: p.color,
            position: ARENA_ORIGIN,
            radiusUnits: arenaBodyRadius(moon.radiusKm),
            // Only Luna carries real mass data (see MoonRawData.massKg) —
            // this branch covers every OTHER moon, none of which currently
            // reach a combat arena. 0 rather than a guess: no fictional pull
            // is more honest than an invented one.
            surfaceGravityUnitsPerSecondSq: arenaSurfaceGravity(moon.massKg ?? 0, moon.radiusKm),
          },
        ]
      }
    }
  }

  return []
}

// Ships keep this much clear of a body when pathing around it — roughly a
// ship's own standoff from a surface, and enough that a route hugging the
// body doesn't visually clip it.
export const OBSTACLE_CLEARANCE_UNITS = 0.6

// Extra room past a body's own surface (and OBSTACLE_CLEARANCE_UNITS) that
// an opening spawn face needs — not just "not inside the body," but far
// enough out for a fight to actually have room to happen. Picked so it does
// nothing at Earth's own scale (1.2 + 0.6 + 3 = 4.8, still under
// startingPoint's own 6-unit default) and only pushes the spawn faces
// outward for a body big enough to need it — Sol and Jupiter at their real,
// true-to-scale sizes (see arenaBodyRadius).
const SPAWN_FIGHTING_ROOM_UNITS = 3

// How far out the two starting faces need to be for THIS engagement's
// obstacles specifically — see startingPoint's own comment for why a fixed
// default isn't safe once a body can be arbitrarily large.
function spawnHalfSpan(obstacles: CombatObstacle[]): number {
  let clearance = 0
  for (const o of obstacles) clearance = Math.max(clearance, o.radiusUnits + OBSTACLE_CLEARANCE_UNITS + SPAWN_FIGHTING_ROOM_UNITS)
  return clearance
}

// The arena WINDOW's own span, in real arena units — proportional to the
// widest body sharing the engagement rather than a fixed 12 units. Sized
// directly off spawnHalfSpan (doubled, since a span is edge-to-edge and a
// half-span is center-to-edge) so the window a player sees, the lattice a
// click resolves against, and the faces the fleets actually spawn on are all
// the same span by construction — no separate tuning, and no "ship spawned
// outside the frame" mismatch to Recenter away. Floored at ARENA_SPAN_UNITS
// so nothing changes for a body small enough the old fixed window already
// covered it (Earth included). Every renderer/picker/router that cares about
// the window's size (CombatGrid, pickLatticeNode, orderParticipantTo) takes
// this as its `span`.
export function arenaWindowSpan(obstacles: CombatObstacle[]): number {
  return Math.max(ARENA_SPAN_UNITS, 2 * spawnHalfSpan(obstacles))
}

// Minimum center-to-center distance between any two hulls — effectively a
// ship's collision diameter. Enforced as a post-movement correction (see
// stepEngagements) so two ships can never occupy the same point, however
// their stances routed them there. Sized against the arena's own scale
// (12 units across, weapon ranges 3-11) to read as "these are separate
// ships" without meaningfully changing engagement distances.
export const SHIP_SEPARATION_UNITS = 0.45

// How close a ship tries to get, as a fraction of its longest weapon's reach.
// Below 1 so a ship settles just *inside* effective range rather than exactly
// on the boundary, where a target drifting a fraction of a unit would drop it
// back out of range every other step.
const APPROACH_RANGE_FRACTION = 0.7

export function longestWeaponRange(profile: CombatProfile): number {
  return profile.weapons.reduce((max, w) => Math.max(max, w.rangeUnits), 0)
}

// The reach of the SHORTEST mount — the distance at which a mixed loadout
// finally has everything firing, and therefore what Swarm closes to.
export function shortestWeaponRange(profile: CombatProfile): number {
  return profile.weapons.reduce((min, w) => Math.min(min, w.rangeUnits), Infinity)
}

// A fixed spread of unit directions used to search for a firing position with
// line of sight — the 26 lattice directions, normalized. Fixed and ordered so
// the search is deterministic (the same situation always resolves the same
// way), matching the no-randomness rule the rest of the arena follows.
const SPHERE_DIRECTIONS: Vector3[] = (() => {
  const dirs: Vector3[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        dirs.push(new Vector3(dx, dy, dz).normalize())
      }
    }
  }
  return dirs
})()

const EPSILON = 1e-6

// Baseline "close to the enemy" behavior. Without this, two fleets spawn on
// opposite faces of the arena 12 units apart — outside every weapon's reach —
// and simply stare at each other forever, so a battle could never actually
// join until player-issued movement exists.
//
// It deliberately stops at a standoff just inside the ship's *own* longest
// range rather than closing to contact, so a long-ranged hull keeps its reach
// advantage instead of throwing it away. A player-issued move order overrides
// this entirely — the approach only runs when the ship has no path of its own
// queued (see stepEngagements), so manual control always wins.
//
// Entirely in real coordinates now — no density, no lattice. Returns the
// destination point directly; the caller (orderParticipantTo) is the only
// place that ever needs to touch the lattice, and only when that destination
// turns out to be obstructed.
export function approachNode(
  self: CombatParticipant,
  target: CombatParticipant,
  profile: CombatProfile,
  obstacles: CombatObstacle[] = [],
  standoffOverride?: number,
): ArenaPoint | null {
  const reach = longestWeaponRange(profile)
  // An unarmed ship has nothing to close for — it holds position (and had
  // better be charging a drive).
  if (reach <= 0) return null

  const selfPos = toVector3(self.position)
  const targetPos = toVector3(target.position)
  const separation = selfPos.distanceTo(targetPos)
  const standoff = standoffOverride ?? reach * APPROACH_RANGE_FRACTION
  const blocked = obstacles.length > 0 && !hasLineOfFire(selfPos, targetPos, obstacles)

  // Already in range with a clear shot — nothing to do.
  if (separation <= standoff && !blocked) return null

  const usable = (point: Vector3): boolean => {
    if (isPointBlocked({ x: point.x, y: point.y, z: point.z }, obstacles, OBSTACLE_CLEARANCE_UNITS)) return false
    return hasLineOfFire(point, targetPos, obstacles)
  }
  const toArenaPoint = (v: Vector3): ArenaPoint | null => (v.distanceTo(selfPos) < EPSILON ? null : { x: v.x, y: v.y, z: v.z })

  // Straight in, if that works.
  const direction = selfPos.clone().sub(targetPos).normalize()
  const direct = targetPos.clone().add(direction.clone().multiplyScalar(standoff))
  if (obstacles.length === 0) return toArenaPoint(direct)
  if (usable(direct)) return toArenaPoint(direct)

  // Otherwise the body is in the way, so look for a firing position *around*
  // it: sample directions on the sphere of radius `standoff` about the target
  // and take the one closest to where the ship already is. Without this, two
  // fleets on opposite sides of a star would sit forever, each unable to
  // shoot and each convinced it was already in position.
  let best: Vector3 | null = null
  let bestDistance = Infinity
  for (const candidateDir of SPHERE_DIRECTIONS) {
    const candidate = targetPos.clone().add(candidateDir.clone().multiplyScalar(standoff))
    if (!usable(candidate)) continue
    const distance = selfPos.distanceTo(candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best ? toArenaPoint(best) : null
}

// Where a ship wants to be, given its standing doctrine. Returns null for
// "already positioned, hold". Each stance is a genuinely different answer,
// not a tuning knob on one behavior:
//
//   balanced — close to just inside longest range and hold (the original,
//              and still the default).
//   swarm    — drive all the way in to the SHORTEST mount's range, so every
//              gun on the hull bears at once.
//   kite     — sit at the outer edge of longest range and actively back off
//              when the target closes, within a tolerance band so it isn't
//              re-planning every step.
//   stall    — refuse the fight: put the nearest body between itself and the
//              enemy so line of fire is broken, and stay there. Still a
//              deliberate CHOICE — an armed ship can pick it to ambush or
//              hide, which is why it's checked before the disarmed fallback
//              below rather than being folded into it.
//   flee     — run from the combined position of every hostile in the fight,
//              not just the nearest one. The automatic behavior for any
//              ship with no weapon mounts at all, or whose weapons are
//              currently knocked out (weaponsOnline=false) — holding a
//              firing line makes no sense for a ship that cannot fire,
//              regardless of which OTHER stance is actually selected.
//
// `allParticipants` and `weaponsOnline` only matter for flee (both default
// to values that make every other stance behave exactly as before) — the
// other four stances only ever needed the single `target` they're passed.
export function stanceDestination(
  self: CombatParticipant,
  target: CombatParticipant,
  profile: CombatProfile,
  stance: CombatStance,
  obstacles: CombatObstacle[] = [],
  allParticipants: CombatParticipant[] = [],
  weaponsOnline: boolean = true,
): ArenaPoint | null {
  const reach = longestWeaponRange(profile)

  if (stance === 'stall') return stallDestination(self, target, obstacles)
  if (stance === 'flee') return fleeDestination(self, allParticipants)

  // An unarmed hull (no mounts at all) or one whose weapons are currently
  // knocked out has no firing line worth holding for ANY of the remaining
  // stances — they all assume a working weapon to close or hold range for.
  if (reach <= 0 || !weaponsOnline) return fleeDestination(self, allParticipants)

  if (stance === 'swarm') {
    const shortest = shortestWeaponRange(profile)
    const closeTo = Number.isFinite(shortest) ? shortest * SWARM_RANGE_FRACTION : reach * SWARM_RANGE_FRACTION
    return approachNode(self, target, profile, obstacles, closeTo)
  }

  if (stance === 'kite') {
    const hold = reach * KITE_RANGE_FRACTION
    const selfPos = toVector3(self.position)
    const targetPos = toVector3(target.position)
    const separation = selfPos.distanceTo(targetPos)
    const blocked = obstacles.length > 0 && !hasLineOfFire(selfPos, targetPos, obstacles)
    // Inside the band and shooting freely — hold station rather than
    // twitching back and forth over fractions of a unit.
    if (!blocked && Math.abs(separation - hold) <= hold * KITE_TOLERANCE) return null
    // Too close is the case that makes kiting a real behavior: back straight
    // off along the line from the target, rather than waiting to be caught.
    if (!blocked && separation < hold) {
      const away = selfPos.clone().sub(targetPos)
      if (away.length() < EPSILON) away.set(1, 0, 0)
      const retreat = targetPos.clone().add(away.normalize().multiplyScalar(hold))
      if (!isPointBlocked({ x: retreat.x, y: retreat.y, z: retreat.z }, obstacles, OBSTACLE_CLEARANCE_UNITS)) {
        return { x: retreat.x, y: retreat.y, z: retreat.z }
      }
    }
    return approachNode(self, target, profile, obstacles, hold)
  }

  return approachNode(self, target, profile, obstacles)
}

// Flee: run from the combined position of every hostile in the fight, not
// just the single nearest one — the literal reading of "as far from hostile
// fleets as possible", and what actually distinguishes this from Kite
// (which only ever backs off the one ship it's tracking). Deliberately NOT
// terrain-aware the way Stall is: Stall's whole point is breaking line of
// fire behind cover, Flee's is pure distance, and folding the two together
// would erase the reason they're separate stances.
function fleeDestination(self: CombatParticipant, allParticipants: CombatParticipant[]): ArenaPoint | null {
  const hostiles = allParticipants.filter((p) => p.side !== self.side)
  if (hostiles.length === 0) return null

  const selfPos = toVector3(self.position)
  const centroid = hostiles
    .reduce((sum, h) => sum.add(toVector3(h.position)), new Vector3())
    .divideScalar(hostiles.length)
  const away = selfPos.clone().sub(centroid)
  if (away.length() < EPSILON) away.set(1, 0, 0)
  const flee = selfPos.clone().add(away.normalize().multiplyScalar(STALL_FLEE_DISTANCE))
  return { x: flee.x, y: flee.y, z: flee.z }
}

// Stall: break line of fire and stay broken. Puts the ship on the far side
// of the nearest body from its enemy — the one position in the arena where
// the terrain rules guarantee it can't be shot (and, symmetrically, can't
// shoot). With no body anywhere to hide behind, the best available move is
// simply to open the distance.
function stallDestination(
  self: CombatParticipant,
  target: CombatParticipant,
  obstacles: CombatObstacle[],
): ArenaPoint | null {
  const selfPos = toVector3(self.position)
  const targetPos = toVector3(target.position)

  if (obstacles.length === 0) {
    const away = selfPos.clone().sub(targetPos)
    if (away.length() < EPSILON) away.set(1, 0, 0)
    const flee = selfPos.clone().add(away.normalize().multiplyScalar(STALL_FLEE_DISTANCE))
    return { x: flee.x, y: flee.y, z: flee.z }
  }

  // Nearest body to hide behind.
  let body = obstacles[0]
  let bodyDistance = pointDistance(self.position, body.position)
  for (const candidate of obstacles) {
    const d = pointDistance(self.position, candidate.position)
    if (d < bodyDistance) {
      bodyDistance = d
      body = candidate
    }
  }

  const bodyPos = toVector3(body.position)
  const fromTarget = bodyPos.clone().sub(targetPos)
  if (fromTarget.length() < EPSILON) fromTarget.set(1, 0, 0)
  // Directly behind the body, far enough out to clear its surface.
  const hide = bodyPos
    .clone()
    .add(fromTarget.normalize().multiplyScalar(body.radiusUnits + OBSTACLE_CLEARANCE_UNITS + STALL_SHELTER_MARGIN))

  // Already sheltered — no line of fire either way, so stay put rather than
  // shuffling around behind the body as the enemy drifts.
  if (!hasLineOfFire(selfPos, targetPos, obstacles) && selfPos.distanceTo(hide) < STALL_SHELTER_MARGIN * 2) return null
  if (selfPos.distanceTo(hide) < EPSILON) return null
  return { x: hide.x, y: hide.y, z: hide.z }
}

// How far a stalling ship runs when there's no body to hide behind, and how
// far a fleeing ship runs, period — one shared "get real distance between us"
// constant for both.
const STALL_FLEE_DISTANCE = 6

// Put this much space between yourself and every hostile and you have simply
// left the battle — no FTL required. Comfortably beyond the longest weapon in
// the game (11 units) and beyond the arena window's own 12-unit span, so
// disengaging means genuinely out of contact and off the board, not merely
// "currently out of range and about to come back". Without this, a ship with
// the Flee stance could run forever and never actually escape, because the
// only exit from an engagement was an FTL charge — which a ship with wrecked
// utility can't even attempt.
export const DISENGAGE_DISTANCE_UNITS = 30
// Clearance beyond a body's surface a stalling ship holds station at.
const STALL_SHELTER_MARGIN = 1

// --- Fleet-wide coordinated strategies -------------------------------------
//
// A ship whose own stance is 'fleet' has no behavior of its own — it
// borrows its Fleet's (see fleetStore.ts). Five of the eight possible fleet
// strategies are just the ordinary per-ship stances above, bulk-applied;
// the other three (Divide, Condense, Screen) only mean anything for a
// GROUP, so they're resolved here instead of by stanceDestination.

// Resolves a ship's actual behavior for this step. 'fleet' is a sentinel
// (see CombatStance's own comment) — everything else is already a real
// stance/strategy and passes through unchanged. Falls back to Balanced if a
// ship is somehow left on 'fleet' with no active fleet strategy to follow
// (shouldn't happen — shipStore.setFleetStrategy keeps the two in lockstep
// — but a ship needs SOME behavior rather than silently freezing).
export function effectiveStrategy(ship: ShipInstance, fleets: Fleet[]): FleetStrategy {
  if (ship.stance !== 'fleet') return ship.stance
  return fleets.find((f) => f.id === ship.fleetId)?.strategy ?? 'balanced'
}

// Every fleet-mate of `self` actually present in this fight — the group
// Divide/Condense/Screen coordinate across. Never includes ships from other
// fleets, even same-side ones (a Balanced escort flying alongside a Screen
// fleet doesn't get pulled into the wall).
function fleetMatesPresent(
  participants: CombatParticipant[],
  shipsById: Map<string, ShipInstance>,
  fleetId: string,
): CombatParticipant[] {
  return participants.filter((p) => shipsById.get(p.shipId)?.fleetId === fleetId)
}

function centroidOf(points: CombatParticipant[]): Vector3 {
  return points.reduce((sum, p) => sum.add(toVector3(p.position)), new Vector3()).divideScalar(points.length)
}

// Divide: spreads the fleet's fire and position across multiple enemies
// instead of everyone dogpiling whoever's nearest. Sets targetShipId
// directly (not just a movement destination) so firing — which reads
// targetShipId first, same as an explicit player order — actually follows
// through on the diversified pick, rather than the ship walking toward one
// enemy while shooting at whichever one is nearest. A ship already locked
// onto a live target (its own past Divide pick, or the player's explicit
// choice) stays locked — re-deciding every step would make the fleet's
// fire visibly flicker between targets for no reason. Only once un-anchored
// does it pick again, preferring whichever enemy no OTHER Divide-mode
// fleet-mate has already claimed.
export function divideAssignment(
  self: CombatParticipant,
  selfShip: ShipInstance,
  profile: CombatProfile,
  participants: CombatParticipant[],
  shipsById: Map<string, ShipInstance>,
  fleets: Fleet[],
  obstacles: CombatObstacle[],
): { point: ArenaPoint | null; targetShipId?: string } {
  const enemies = participants.filter((p) => p.side !== self.side)
  if (enemies.length === 0) return { point: null }

  const already = self.targetShipId ? enemies.find((e) => e.shipId === self.targetShipId) : undefined
  let target = already
  if (!target) {
    const claimed = new Set<string>()
    for (const p of participants) {
      if (p.side !== self.side || p.shipId === self.shipId || !p.targetShipId) continue
      const mateShip = shipsById.get(p.shipId)
      if (mateShip && mateShip.fleetId === selfShip.fleetId && effectiveStrategy(mateShip, fleets) === 'divide') {
        claimed.add(p.targetShipId)
      }
    }
    const pool = enemies.filter((e) => !claimed.has(e.shipId))
    const candidates = pool.length > 0 ? pool : enemies
    target = candidates.reduce((best, e) =>
      pointDistance(self.position, e.position) < pointDistance(self.position, best.position) ? e : best,
    )
  }

  return { point: approachNode(self, target, profile, obstacles), targetShipId: target.shipId }
}

// How close to a rally point (the fleet centroid, for Condense; the wall
// line, for Screen) counts as "arrived" — below this, holding station
// exactly rather than endlessly nudging into place.
const RALLY_ARRIVAL_TOLERANCE = 1

// Condense: every member just moves toward the fleet's own centroid,
// ignoring the enemy entirely for POSITIONING (targeting/firing is
// unaffected — a condensing ship still defends itself on the way in, it's
// not disengaging). Alone in the fight, there's nothing to condense toward.
export function condenseDestination(
  self: CombatParticipant,
  selfShip: ShipInstance,
  participants: CombatParticipant[],
  shipsById: Map<string, ShipInstance>,
): ArenaPoint | null {
  const mates = fleetMatesPresent(participants, shipsById, selfShip.fleetId)
  if (mates.length <= 1) return null
  const centroid = centroidOf(mates)
  if (toVector3(self.position).distanceTo(centroid) < RALLY_ARRIVAL_TOLERANCE) return null
  return { x: centroid.x, y: centroid.y, z: centroid.z }
}

// How far in front of the fleet's own centroid, toward the nearest enemy,
// the wall holds.
const SCREEN_STANDOFF_UNITS = 2

// A hull's design toughness (max shields + armor, NOT current damage —
// reshuffling who's "the tank" every time someone takes a hit would make
// the wall visibly crumble and reform for no tactical reason) — Screen's
// own ranking for who stands the line.
function toughness(ship: ShipInstance): number {
  const profile = shipCombatProfile(ship)
  return profile ? profile.defenses.shieldHp + profile.defenses.armorHp : 0
}

// Screen: the toughest half of the fleet (by design toughness — see
// toughness above) holds a line between the fleet's own centroid and
// whichever enemy is nearest to that centroid; everyone else falls back to
// the centroid itself, the same rally point Condense uses. Existing nearest-
// enemy targeting (see nearestEnemy) is left completely alone — the wall
// draws fire PURELY by being the closest thing to shoot at, not by any
// artificial taunt mechanic, which is also why this only affects
// positioning, never targetShipId, unlike Divide. A ship's role is which
// HALF it's in, not a fixed identity — toggle Screen off and back on and the
// ranking is recomputed fresh from who's actually present.
export function screenDestination(
  self: CombatParticipant,
  selfShip: ShipInstance,
  participants: CombatParticipant[],
  shipsById: Map<string, ShipInstance>,
  obstacles: CombatObstacle[],
): ArenaPoint | null {
  const mates = fleetMatesPresent(participants, shipsById, selfShip.fleetId)
  const enemies = participants.filter((p) => p.side !== self.side)
  if (enemies.length === 0 || mates.length <= 1) return null

  const centroid = centroidOf(mates)
  let nearestToFleet = enemies[0]
  let bestDist = centroid.distanceTo(toVector3(enemies[0].position))
  for (const e of enemies) {
    const d = centroid.distanceTo(toVector3(e.position))
    if (d < bestDist) {
      bestDist = d
      nearestToFleet = e
    }
  }

  const ranked = [...mates].sort((a, b) => {
    const shipA = shipsById.get(a.shipId)
    const shipB = shipsById.get(b.shipId)
    return (shipB ? toughness(shipB) : 0) - (shipA ? toughness(shipA) : 0)
  })
  const screenerCount = Math.max(1, Math.ceil(ranked.length / 2))
  const isScreener = ranked.slice(0, screenerCount).some((p) => p.shipId === self.shipId)

  if (!isScreener) {
    if (toVector3(self.position).distanceTo(centroid) < RALLY_ARRIVAL_TOLERANCE) return null
    return { x: centroid.x, y: centroid.y, z: centroid.z }
  }

  const towardEnemy = toVector3(nearestToFleet.position).sub(centroid)
  if (towardEnemy.length() < EPSILON) towardEnemy.set(1, 0, 0)
  const wallPoint = centroid.clone().add(towardEnemy.normalize().multiplyScalar(SCREEN_STANDOFF_UNITS))
  if (isPointBlocked({ x: wallPoint.x, y: wallPoint.y, z: wallPoint.z }, obstacles, OBSTACLE_CLEARANCE_UNITS)) return null
  if (toVector3(self.position).distanceTo(wallPoint) < RALLY_ARRIVAL_TOLERANCE) return null
  return { x: wallPoint.x, y: wallPoint.y, z: wallPoint.z }
}

// How far a stance's freshly computed destination has to have moved from
// where the ship's existing route already ends before that's treated as a
// real change worth re-planning for. Below this, a moving target's own
// per-step jitter (or plain floating-point noise) would otherwise trigger a
// fresh lattice route every single 0.1s step for a target that's actually
// holding roughly still.
const STANCE_REPLAN_TOLERANCE = 0.25
// The same idea, but for a destination that needs an actual lattice route
// around a body — a straight-line replan is ~free (one segment/obstacle
// check), but a lattice route costs a real A* search (see
// combatArena.astarPath), and a ship closing on a moving target near a large
// body has its destination drift past the tight tolerance above on nearly
// every step, which was re-running that search up to ten times a second per
// ship — the actual source of "laggy near bigger planets," not the search
// itself being slow so much as being asked for constantly. Wide enough that
// ordinary closing/maneuvering near a body doesn't retrigger a search every
// step; still tight enough that a real change (target reverses, a new body
// enters the way) is caught within a second or so.
const STANCE_REPLAN_TOLERANCE_ROUTED = 5

export interface CombatStepResult {
  engagements: Engagement[]
  // Only ships whose state actually changed this step.
  shipCombat: Record<string, ShipCombatState>
  destroyedShipIds: string[]
  // Ships whose FTL charge completed — the caller turns each into a real
  // move order (the resolver can't, since planMove is order-planning, not
  // combat).
  escapedShipIds: string[]
  // Ships that broke contact by simply outrunning everyone (see
  // DISENGAGE_DISTANCE_UNITS) rather than by jumping out. The caller relocates
  // each into open system space — the resolver deliberately doesn't, since
  // where a ship sits on the system map is strategic-layer state.
  disengagedShipIds: string[]
}

// Advances every engagement by exactly one COMBAT_STEP_SECONDS.
export function stepEngagements(
  engagements: Engagement[],
  ships: ShipInstance[],
  simDays: number,
  rng: Rng = Math.random,
  fleets: Fleet[] = [],
  // Whether the PLAYER's own country has researched Free-Flight Maneuvering
  // (see techData.ts) — defaults to true so every existing caller/test that
  // doesn't pass this keeps today's behavior. Only the player's ships are
  // ever gated by this (see integrateMotion's call below): hostile/friendly/
  // neutral ships have no country-tech link modeled at all and always keep
  // today's free-floating behavior, matching the same scope cut the
  // warp/hyperdrive gate already made. Deliberately a plain boolean, not a
  // store read — stepEngagements stays a pure function; useCombatResolver.ts
  // is what resolves the player's actual researched set into this one flag.
  playerCanFreeFloat: boolean = true,
): CombatStepResult {
  const shipsById = new Map(ships.map((s) => [s.id, s]))
  // Working copy of every participant ship's combat state, mutated across the
  // whole step so damage accumulates correctly when several attackers fire at
  // the same target within one step.
  const working: Record<string, ShipCombatState> = {}
  const touched = new Set<string>()
  const destroyed = new Set<string>()
  const escaped = new Set<string>()
  const disengaged = new Set<string>()

  const stateOf = (shipId: string): ShipCombatState | null => {
    if (working[shipId]) return working[shipId]
    const ship = shipsById.get(shipId)
    if (!ship) return null
    working[shipId] = ship.combat
    return working[shipId]
  }

  const nextEngagements: Engagement[] = []

  for (const rawEngagement of engagements) {
    // Refresh any moving obstacle (Luna, currently the only one — see
    // moonArenaState) to its live position for THIS step's simDays, rather
    // than leaving it wherever it was when the engagement was first synced —
    // that's what makes the Moon actually orbit during a fight instead of
    // sitting fixed. Deliberately touches ONLY the moving entries rather
    // than re-deriving the whole list through obstaclesForLocation: this
    // runs on every 0.1s step of every engagement (potentially thousands of
    // times per resolver tick during catch-up), so re-doing the
    // planet/star lookup and rebuilding every obstacle from scratch that
    // often is real, needless work — and for every non-Earth engagement
    // (the overwhelming majority) there's no moving obstacle at all, so this
    // is a no-op `.some()` scan rather than any reconstruction. Shadows
    // `engagement` itself (rather than threading a separate `obstacles`
    // variable through the rest of this loop body) so every existing
    // `engagement.obstacles` reference below picks this up for free.
    const hasMovingObstacle = rawEngagement.obstacles.some((o) => o.kind === 'moon')
    const engagement = hasMovingObstacle
      ? {
          ...rawEngagement,
          obstacles: rawEngagement.obstacles.map((o) => {
            if (o.kind !== 'moon') return o
            const luna = getMoonsForPlanet('Earth').moons.find((m) => m.name === o.name)
            if (!luna) return o
            const { position, velocity } = moonArenaState(luna, simDays)
            return { ...o, position, velocity }
          }),
        }
      : rawEngagement

    // Drop participants whose ship no longer exists (destroyed earlier, lost
    // in hyperspace, etc.) before anything else reads the roster.
    const participants = engagement.participants
      .filter((p) => shipsById.has(p.shipId) && !destroyed.has(p.shipId))
      // Drop any stale sub-waypoint the ship has effectively already passed
      // — see pruneOvershotWaypoints. Applies to every route regardless of
      // who queued it (manual order or stance), and runs before approach so
      // a stance's own "has the destination moved" check below compares
      // against an already-current path rather than a stale one.
      .map((p) => (p.path.length > 1 ? { ...p, path: pruneOvershotWaypoints(p.path, p.position, engagement.obstacles) } : p))

    // --- Approach: a ship under auto-control (not holding position for a
    // manual order, not spooling a drive) keeps its route pointed at its
    // stance's current destination — recomputed every step, not just once
    // when idle, so a target that moves keeps being tracked instead of the
    // ship committing to wherever the target happened to be when the route
    // was first queued. Only actually replans (which re-touches lattice
    // routing) when the fresh destination has moved meaningfully from where
    // the existing route already ends, so a target holding still doesn't
    // cost a fresh plan every 0.1s step. ---
    const withApproach: CombatParticipant[] = participants.map((p) => {
      // Genuinely uncontrollable while Spin Thrust is active (see
      // CombatParticipant.spinThrustActive's own comment) — no destination
      // planning of any kind, not even a manual hold. The movement step
      // below is what actually turns this into a random walk; this just
      // makes sure nothing re-populates `path` underneath it.
      if (p.spinThrustActive) return p
      // The player has taken manual control of this ship's positioning — never
      // second-guess it by walking the ship back toward the enemy.
      if (p.holdPosition) return p
      const ship = shipsById.get(p.shipId)!
      if (ship.combat.ftlCharge) return p
      const profile = shipCombatProfile(ship)
      if (!profile) return p
      const explicit = p.targetShipId ? participants.find((o) => o.shipId === p.targetShipId) : undefined
      const target = explicit ?? nearestEnemy(p, participants)
      const state = stateOf(p.shipId)
      const weaponsOnline = !!state && weaponsEffectiveness(state.componentHp.weapons, profile.components.weapons) > 0

      // 'fleet' on the ship resolves to whatever its Fleet is actually
      // running (see effectiveStrategy) — five of the eight possible values
      // are just the stances below with a different name; Divide/Condense/
      // Screen are coordinated, multi-ship behaviors resolved separately
      // (see each function's own comment). Ramming, then chase, still win
      // over all of it, same precedence chase already had over a plain
      // stance — both are explicit per-ship orders, not fleet coordination.
      const strategy = effectiveStrategy(ship, fleets)
      let point: ArenaPoint | null
      let newTargetShipId: string | undefined
      if (p.ramming) {
        // Drives straight at the exact target position (no standoff at all)
        // rather than going through approachNode — that helper bails out for
        // an unarmed ship (nothing to close weapon range for) and picks a
        // standoff based on weapon reach, neither of which applies here: a
        // ram works with no weapons at all, and the whole point is closing
        // to contact, not to firing range.
        if (!target) return p
        point = { x: target.position.x, y: target.position.y, z: target.position.z }
      } else if (p.chasing) {
        if (!target) return p
        point = approachNode(p, target, profile, engagement.obstacles, CHASE_STANDOFF_UNITS)
      } else if (strategy === 'divide') {
        const assignment = divideAssignment(p, ship, profile, participants, shipsById, fleets, engagement.obstacles)
        point = assignment.point
        newTargetShipId = assignment.targetShipId
      } else if (strategy === 'condense') {
        point = condenseDestination(p, ship, participants, shipsById)
      } else if (strategy === 'screen') {
        point = screenDestination(p, ship, participants, shipsById, engagement.obstacles)
      } else {
        if (!target) return p
        point = stanceDestination(p, target, profile, strategy, engagement.obstacles, participants, weaponsOnline)
      }

      const retargeted = newTargetShipId && newTargetShipId !== p.targetShipId ? { targetShipId: newTargetShipId } : null
      if (!point) return retargeted ? { ...p, ...retargeted } : p
      // Checked against the last destination actually PLANNED for, not just
      // path's own final point — orderParticipantTo leaves path untouched
      // when no route exists (see its own comment), so falling back to
      // path's final point here would re-trigger the exact same doomed,
      // potentially-expensive lattice search every single step for as long
      // as the destination stays unreachable (a body big enough to exhaust
      // the A* search near it makes this common, not rare). Recording the
      // attempt regardless of outcome — below — is what makes a failure
      // count as "handled" until the destination itself moves.
      const lastAttempt = p.lastPlanAttempt ?? (p.path.length > 0 ? p.path[p.path.length - 1] : null)
      // A clear line straight to the destination is ~free to re-check every
      // step; a destination a body is actually in the way of costs a real
      // lattice search (see STANCE_REPLAN_TOLERANCE_ROUTED's own comment) —
      // so only that case gets the wider tolerance.
      const needsRouting = !segmentClearsObstacles(toVector3(p.position), toVector3(point), engagement.obstacles, OBSTACLE_CLEARANCE_UNITS)
      const tolerance = needsRouting ? STANCE_REPLAN_TOLERANCE_ROUTED : STANCE_REPLAN_TOLERANCE
      if (lastAttempt && pointDistance(lastAttempt, point) <= tolerance) return retargeted ? { ...p, ...retargeted } : p
      const ordered = orderParticipantTo(p, point, engagement.density, simDays, engagement.obstacles)
      return { ...ordered, lastPlanAttempt: point, ...retargeted }
    })

    // --- Spin Thrust collision safety: an uncontrolled ship on a random
    // walk (see CombatParticipant.spinThrustActive) gets the tactic switched
    // back OFF for it the instant continuing on its current heading would
    // carry it into a body within SPIN_THRUST_COLLISION_LOOKAHEAD_SECONDS —
    // a real, persisted state change (control reverts to normal navigation
    // for good), not a one-step dodge, so the same close call doesn't just
    // recur next step. Runs BEFORE movement integrates this step's motion,
    // so the ship that triggers it never actually drifts into the body in
    // the first place — it steers away under normal navigation starting
    // this very step instead. Uses the CURRENT heading as the lookahead
    // direction (not a random future one, which is unknowable) — a
    // reasonable proxy given the drift's own per-step turn is bounded (see
    // SPIN_THRUST_TURN_RADIANS_PER_STEP), so it can't suddenly swing away
    // from danger in a single step either. ---
    const withSpinSafety: CombatParticipant[] = withApproach.map((p) => {
      if (!p.spinThrustActive) return p
      if (engagement.obstacles.length === 0) return p
      const lookahead = toVector3(p.position).add(toVector3(p.velocity).multiplyScalar(SPIN_THRUST_COLLISION_LOOKAHEAD_SECONDS))
      const imminent = engagement.obstacles.some(
        (o) => pointDistance({ x: lookahead.x, y: lookahead.y, z: lookahead.z }, o.position) <= o.radiusUnits + SPIN_THRUST_COLLISION_CLEARANCE_UNITS,
      )
      if (!imminent) return p
      return { ...p, spinThrustActive: false, path: [] }
    })

    // --- Movement: integrate one step of real accelerated motion. ---
    const moved: CombatParticipant[] = withSpinSafety.map((p) => {
      // Locked onto a body's own velocity (see CombatParticipant.
      // inheritVelocityFrom) — bypasses thrust/gravity/obstacle-avoidance
      // integration entirely in favor of just matching however that body is
      // actually moving THIS step. Only a moving obstacle (currently just an
      // orbiting Luna — see moonArenaState) has anything but zero here, so
      // locking onto anything else is a valid, if inert, "hold still in this
      // frame" choice rather than a special case worth refusing.
      if (p.inheritVelocityFrom && !p.holdPosition) {
        const target = engagement.obstacles.find((o) => o.name === p.inheritVelocityFrom)
        if (target) {
          const velocity = target.velocity ?? { x: 0, y: 0, z: 0 }
          return {
            ...p,
            velocity,
            position: {
              x: p.position.x + velocity.x * COMBAT_STEP_SECONDS,
              y: p.position.y + velocity.y * COMBAT_STEP_SECONDS,
              z: p.position.z + velocity.z * COMBAT_STEP_SECONDS,
            },
            positionSimDays: simDays,
          }
        }
      }
      const ship = shipsById.get(p.shipId)!
      const profile = shipCombatProfile(ship)
      const state = stateOf(p.shipId)
      if (!profile || !state) return p
      // Utility damage scales BOTH cruise speed and acceleration — a wrecked
      // drive array is sluggish as well as slow, and at zero the ship simply
      // stops responding (keeping its queued path, so repairs would resume
      // it rather than silently dropping the order).
      const utility = utilityEffectiveness(state.componentHp.utility, profile.components.utility)
      // Only a player ship is ever gated by the player's own tech — see
      // stepEngagements' own comment on playerCanFreeFloat.
      const canFreeFloat = ship.allegiance !== 'player' || playerCanFreeFloat
      // Thruster Boost / Shield Boost both scale this ship's own speed —
      // see combatData's Tactics section and tacticSpeedMultiplier above.
      const tacticMult = tacticSpeedMultiplier(p)
      const maxSpeed = profile.maneuverUnitsPerSecond * utility * tacticMult
      const accel = profile.accelerationUnitsPerSecondSq * utility * tacticMult

      // Spin Thrust REPLACES normal steering entirely rather than layering
      // on top of it — see CombatParticipant.spinThrustActive's own comment
      // on why this tactic is genuinely uncontrollable. (The collision
      // safety check that can turn this back off runs earlier in the step —
      // see the auto-tactics pass below — so by the time movement runs here,
      // spinThrustActive is already false again for any ship it just saved.)
      if (p.spinThrustActive) {
        return integrateSpinThrustDrift(p, maxSpeed, accel, COMBAT_STEP_SECONDS, simDays, rng)
      }

      return integrateMotion(p, maxSpeed, accel, COMBAT_STEP_SECONDS, simDays, engagement.obstacles, canFreeFloat)
    })

    // --- Separation: no two hulls may occupy the same point. Ships are
    // treated as spheres of SHIP_SEPARATION_UNITS diameter and pushed apart
    // symmetrically along the line between them until they no longer
    // overlap, each giving half the overlap.
    //
    // Done as a post-movement correction rather than by teaching the
    // steering to avoid other ships, deliberately: every stance resolves to
    // a destination based on the ENEMY's position, so a whole fleet on one
    // stance legitimately wants the same spot, and any number of them can
    // converge on it. Trying to encode "and also avoid your squadmates" into
    // that destination choice would fight the stance logic for control of
    // the same value. Resolving the overlap afterwards leaves the stance's
    // intent intact and just enforces that hulls are solid.
    //
    // Two passes: one displacement can push a ship into a third one, and a
    // second sweep settles the common cases without the cost (or the
    // oscillation risk) of iterating to convergence. A residual overlap on a
    // dense pile-up is acceptable — this is a readability rule, not a rigid
    // physical constraint.
    const separated: CombatParticipant[] = moved.map((p) => ({ ...p, position: { ...p.position } }))
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < separated.length; i++) {
        for (let j = i + 1; j < separated.length; j++) {
          const a = separated[i]
          const b = separated[j]
          const gap = pointDistance(a.position, b.position)
          if (gap >= SHIP_SEPARATION_UNITS) continue
          // Exactly coincident (a fresh spawn stack, or two ships ordered to
          // the identical point) has no line to push along — nudge along a
          // fixed axis instead of leaving them fused or dividing by zero.
          const axis =
            gap < EPSILON
              ? new Vector3(1, 0, 0)
              : toVector3(b.position).sub(toVector3(a.position)).normalize()
          const push = (SHIP_SEPARATION_UNITS - gap) / 2
          const shift = axis.multiplyScalar(push)
          a.position = { x: a.position.x - shift.x, y: a.position.y - shift.y, z: a.position.z - shift.z }
          b.position = { x: b.position.x + shift.x, y: b.position.y + shift.y, z: b.position.z + shift.z }
        }
      }
    }

    // --- Collision: a ship whose position now lies inside a body is
    // destroyed. Under ordinary (utility-alive) flight this never fires —
    // every planned route already refuses a destination inside a body and
    // detours around one in the way (see isPointBlocked's other call sites,
    // all of them in planning, above). It exists for the one case that
    // bypasses planning entirely: a ship with utility knocked out integrates
    // on pure ballistic momentum (see the movement step just above, and
    // integrateMotion's own comment on it) — nothing is steering it around
    // anything any more, and without this it would silently clip straight
    // through a star or planet's collision sphere as if it weren't there.
    // Applies the exact same consequence a shot to the core does (zero the
    // core, let the existing destroyed/surviving machinery take it from
    // there) rather than a bespoke death path, so a collision this step
    // correctly also stops that ship firing this same step.
    for (const p of separated) {
      if (destroyed.has(p.shipId)) continue
      if (!isPointBlocked(p.position, engagement.obstacles)) continue
      const state = stateOf(p.shipId)
      if (!state) continue
      working[p.shipId] = { ...state, componentHp: { ...state.componentHp, core: 0 } }
      touched.add(p.shipId)
      destroyed.add(p.shipId)
    }

    // --- Shield regeneration, before firing, so a shot this step meets the
    // regenerated value. Armor deliberately does not regenerate. ---
    for (const p of separated) {
      const ship = shipsById.get(p.shipId)!
      const profile = shipCombatProfile(ship)
      const state = stateOf(p.shipId)
      if (!profile || !state) continue
      if (state.shieldHp >= profile.defenses.shieldHp) continue
      // Shield Boost diverts power INTO the regen rate; Weapons Boost
      // diverts it AWAY (see combatData's SHIELD_BOOST_REGEN_MULTIPLIER and
      // WEAPONS_BOOST_SHIELD_REGEN_MULTIPLIER) — mutually exclusive in
      // practice (see BOOST_TACTIC_IDS), so only one branch ever actually
      // fires, but written as independent checks rather than assuming that.
      const regenMult = p.shieldBoostActive ? SHIELD_BOOST_REGEN_MULTIPLIER : p.weaponsBoostActive ? WEAPONS_BOOST_SHIELD_REGEN_MULTIPLIER : 1
      working[p.shipId] = {
        ...state,
        shieldHp: Math.min(
          profile.defenses.shieldHp,
          state.shieldHp + profile.defenses.shieldRegenPerSecond * regenMult * COMBAT_STEP_SECONDS,
        ),
      }
      touched.add(p.shipId)
    }

    // --- Scuttling: a hull the player has written off detonates, damaging
    // everything inside the blast — friend or foe alike, since a reactor
    // breach doesn't check IFF before it goes off. Resolved here — after
    // movement and separation, before firing — so the blast uses this step's
    // real positions and a ship killed by it doesn't also get to shoot this
    // step.
    //
    // Damage lands as raw component damage rather than going through
    // applyShot, deliberately: a reactor breach isn't a weapon, so there's no
    // damage type for the matrix to resolve, nothing for point defense to
    // intercept, and no firing solution for chaff to spoil. It does still eat
    // shields and armor first, because those are physical layers and stopping
    // a blast is exactly what they're for.
    for (const p of separated) {
      if (!p.scuttleOrdered || destroyed.has(p.shipId)) continue
      const ship = shipsById.get(p.shipId)
      const profile = shipCombatProfile(ship!)
      const state = stateOf(p.shipId)
      if (!ship || !profile || !state) continue

      const coreFraction = profile.components.core > 0 ? state.componentHp.core / profile.components.core : 0
      for (const other of separated) {
        if (other.shipId === p.shipId || destroyed.has(other.shipId)) continue
        const damage = scuttleDamageAt(pointDistance(p.position, other.position), coreFraction)
        if (damage <= 0) continue
        const otherState = stateOf(other.shipId)
        if (!otherState) continue
        const next = applyRawBlast(otherState, damage)
        working[other.shipId] = next
        touched.add(other.shipId)
        if (next.componentHp.core <= 0) destroyed.add(other.shipId)
      }

      // The scuttling ship is gone regardless of what it hit.
      working[p.shipId] = { ...stateOf(p.shipId)!, componentHp: { ...state.componentHp, core: 0 } }
      touched.add(p.shipId)
      destroyed.add(p.shipId)
    }

    // --- Ramming impact: a ship ordered to ram (see CombatParticipant.
    // ramming) collides with its target once their PRE-separation positions
    // actually overlap. Checked against `moved`, not `separated` — the
    // separation pass above exists specifically to push overlapping hulls
    // apart, so checking post-separation positions would almost never see a
    // "collision" to begin with; `moved` still holds the raw, unpushed
    // result of this step's own physics.
    //
    // Target is resolved exactly like firing does (explicit targetShipId,
    // falling back to nearest enemy) rather than stored separately — the ram
    // order says "collide with whatever this ship is bearing down on," which
    // is the same ship it would otherwise be shooting at.
    //
    // Damage scales with the RAMMER's own closing speed as a fraction of its
    // top cruise speed — a slow bump barely scratches either hull, a
    // full-speed charge is a real trade — and lands as raw component damage
    // on BOTH hulls (shields/armor first, same as Scuttle just above), since
    // a collision isn't a weapon the damage matrix or point defense has any
    // business resolving. One-shot: `ramming` is cleared the moment it
    // connects (mutated in place on `separated`'s own entry, same pattern the
    // separation pass itself uses for position) so a hit is a single
    // deliberate collision, not continuous grinding contact.
    const movedById = new Map(moved.map((m) => [m.shipId, m]))
    for (const p of separated) {
      if (destroyed.has(p.shipId) || !p.ramming) continue
      const explicitTarget = p.targetShipId ? separated.find((o) => o.shipId === p.targetShipId) : undefined
      const ramTarget = explicitTarget && !destroyed.has(explicitTarget.shipId) ? explicitTarget : nearestEnemy(p, separated)
      if (!ramTarget || destroyed.has(ramTarget.shipId)) continue

      const rammerMoved = movedById.get(p.shipId)
      const targetMoved = movedById.get(ramTarget.shipId)
      if (!rammerMoved || !targetMoved) continue
      if (pointDistance(rammerMoved.position, targetMoved.position) >= SHIP_SEPARATION_UNITS) continue

      // Contact confirmed — the order is spent regardless of what happens
      // below (a missing profile/state is a degenerate case, not a reason to
      // leave the ship stuck lunging at something forever).
      p.ramming = false

      const ship = shipsById.get(p.shipId)
      const profile = ship ? shipCombatProfile(ship) : null
      const state = stateOf(p.shipId)
      const targetState = stateOf(ramTarget.shipId)
      if (!profile || !state || !targetState) continue

      const closingFraction = profile.maneuverUnitsPerSecond > 0 ? participantSpeed(rammerMoved) / profile.maneuverUnitsPerSecond : 0
      const targetDamage = ramDamageAt(closingFraction)
      const selfDamage = targetDamage * RAM_SELF_DAMAGE_FRACTION

      const nextTarget = applyRawBlast(targetState, targetDamage)
      working[ramTarget.shipId] = nextTarget
      touched.add(ramTarget.shipId)
      if (nextTarget.componentHp.core <= 0) destroyed.add(ramTarget.shipId)

      const nextSelf = applyRawBlast(state, selfDamage)
      working[p.shipId] = nextSelf
      touched.add(p.shipId)
      if (nextSelf.componentHp.core <= 0) destroyed.add(p.shipId)
    }

    // --- AI countermeasures: a non-player ship spends a chaff charge when
    // it's actually under threat and hurt enough to be worth it.
    //
    // Runs BEFORE firing so a burst started this step already degrades this
    // step's incoming volley — a countermeasure that only took effect next
    // step would routinely be a step late against the exact alpha strike it
    // was deployed to answer.
    //
    // Gated on being ACTIVELY engaged (a live enemy in range with line of
    // fire — the same test the "Engaged Against" readout uses), not merely
    // present in the engagement: chaff wasted while nothing can shoot you is
    // exactly the mistake a player wouldn't make, and there are only two
    // charges. Applies to every allegiance now, gated on ShipInstance.chaffAutoDeploy
    // (default true — see its own comment) rather than excluding player ships
    // outright: the common case is spending chaff automatically the instant
    // it's worth it, same as the AI always did, with the panel's Deploy
    // button (and turning this off) there for a player who wants to hold a
    // charge for a specific moment instead.
    for (const p of separated) {
      if (destroyed.has(p.shipId)) continue
      const ship = shipsById.get(p.shipId)
      if (!ship || !ship.chaffAutoDeploy) continue
      const profile = shipCombatProfile(ship)
      const state = stateOf(p.shipId)
      if (!profile || !state) continue
      if (state.chaffRemaining <= 0 || isChaffActive(state, simDays)) continue
      if (activeEnemyContacts(p, { ...engagement, participants: separated }, ships, simDays).length === 0) continue

      // Which threshold applies depends on how many charges are already
      // spent, so the first goes in on real damage and the second is held
      // back for genuine trouble rather than both firing at the same instant.
      const spent = CHAFF_CHARGES - state.chaffRemaining
      const threshold = spent === 0 ? CHAFF_AI_FIRST_THRESHOLD : CHAFF_AI_SECOND_THRESHOLD
      if (overallHealthFraction(state, profile) > threshold) continue

      const next = deployChaff(state, simDays)
      if (next === state) continue
      working[p.shipId] = next
      touched.add(p.shipId)
    }

    // --- Auto-tactics: a ship whose owner has left a Tactic (see
    // combatData's Tactics section) on "auto" manages it for itself — same
    // "auto with a manual override" relationship (see each ShipInstance.
    // *Auto flag's own comment). Independent flags, not one shared switch,
    // since a player might want one tactic automated and another under hand
    // control. Each tactic's own gate reflects what it's actually FOR, not a
    // single shared "under threat" trigger — see each constant's own comment
    // in combatData.ts for why Thruster Boost, Shield Boost, Weapons Boost,
    // and Spin Thrust each need a different signal.
    const withTactics: CombatParticipant[] = separated.map((p) => {
      if (destroyed.has(p.shipId)) return p
      const ship = shipsById.get(p.shipId)
      const profile = ship ? shipCombatProfile(ship) : null
      const state = stateOf(p.shipId)
      if (!ship || !profile || !state) return p
      const underThreat = activeEnemyContacts(p, { ...engagement, participants: separated }, ships, simDays).length > 0
      const healthFraction = overallHealthFraction(state, profile)
      const fleeing = ship.stance === 'flee' || !!ship.combat.ftlCharge

      let next = p

      // Shield Boost, Weapons Boost, and Thruster Boost draw from the same
      // power grid (see combatData.BOOST_TACTIC_IDS) — evaluated in that
      // priority order, each one only considered if a higher-priority boost
      // didn't already claim the grid THIS step, so the auto logic never
      // tries to turn on two at once. Shield Boost wins outright over the
      // other two when it wants the grid at all: it's a last resort (see its
      // own comment), a survival call that should never be preempted by an
      // offensive or mobility pick.
      if (ship.shieldBoostAuto ?? true) {
        if (!next.shieldBoostActive && (fleeing || healthFraction < SHIELD_BOOST_AI_HEALTH_ENGAGE_THRESHOLD)) {
          next = { ...next, shieldBoostActive: true, thrusterBoostActive: false, weaponsBoostActive: false }
        } else if (next.shieldBoostActive && !fleeing && healthFraction > SHIELD_BOOST_AI_HEALTH_DISENGAGE_THRESHOLD) {
          next = { ...next, shieldBoostActive: false }
        }
      }

      // Weapons Boost: a confident push while healthy and actively trading
      // fire — the inverse gate from Shield Boost's, and only considered if
      // Shield Boost didn't just claim the grid above.
      if ((ship.weaponsBoostAuto ?? true) && !next.shieldBoostActive) {
        if (!next.weaponsBoostActive && underThreat && healthFraction > WEAPONS_BOOST_AI_HEALTH_ENGAGE_THRESHOLD) {
          next = { ...next, weaponsBoostActive: true, thrusterBoostActive: false }
        } else if (next.weaponsBoostActive && (!underThreat || healthFraction < WEAPONS_BOOST_AI_HEALTH_DISENGAGE_THRESHOLD)) {
          next = { ...next, weaponsBoostActive: false }
        }
      }

      // Thruster Boost: free mobility whenever there's nothing to shoot at
      // (or nothing shooting back) — the weapon penalty costs nothing in
      // that moment — dropped the instant that stops being true, and only
      // considered if neither of the other two boosts is holding the grid,
      // nor Spin Thrust already has the ship (see setThrusterBoost's own
      // comment on why the two never coexist).
      if (
        (ship.thrusterBoostAuto ?? true) &&
        !next.shieldBoostActive &&
        !next.weaponsBoostActive &&
        !next.spinThrustActive &&
        next.thrusterBoostActive !== !underThreat
      ) {
        next = { ...next, thrusterBoostActive: !underThreat }
      }

      // Spin Thrust: giving up steering is a real cost to the ship's own
      // effectiveness (it can no longer hold range, chase, or disengage on
      // purpose), so — like Shield Boost — this is gated to genuine trouble,
      // not "any live fire." UNLIKE Shield Boost, fleeing does NOT trigger
      // it: going uncontrollable actively works against a ship trying to run
      // in a chosen direction. Also drops the instant nothing is shooting at
      // this ship any more, regardless of health — no reason to stay
      // uncontrollable once safe.
      if (ship.spinThrustAuto ?? true) {
        if (!next.spinThrustActive && underThreat && healthFraction < SPIN_THRUST_AI_HEALTH_ENGAGE_THRESHOLD) {
          // Takes steering away from Thruster Boost the same instant it
          // engages — see setThrusterBoost's own comment on why the two
          // never coexist.
          next = { ...next, spinThrustActive: true, thrusterBoostActive: false }
        } else if (next.spinThrustActive && (!underThreat || healthFraction > SPIN_THRUST_AI_HEALTH_DISENGAGE_THRESHOLD)) {
          next = { ...next, spinThrustActive: false }
        }
      }

      return next
    })

    // --- Projectile flight: missiles/torpedoes launched on an earlier step
    // (see combatData's "Missile / torpedo travel time") advance toward
    // whichever position their target is at THIS step and resolve on
    // arrival. Runs before this step's own firing so a round that arrives
    // this exact step is settled before any new one launches. ---
    const carriedProjectiles: InFlightProjectile[] = []
    for (const proj of engagement.projectiles ?? []) {
      const targetParticipant = withTactics.find((p) => p.shipId === proj.targetShipId)
      // The target died, fled, or disengaged since this round launched —
      // nothing left to hit. It simply doesn't arrive; no damage anywhere.
      if (destroyed.has(proj.targetShipId) || !targetParticipant) continue

      const targetPos = participantArenaPosition(targetParticipant, simDays)
      const current = new Vector3(proj.position.x, proj.position.y, proj.position.z)
      const toTarget = targetPos.clone().sub(current)
      const distance = toTarget.length()
      const travel = proj.speedUnitsPerSecond * COMBAT_STEP_SECONDS

      if (distance <= Math.max(travel, PROJECTILE_IMPACT_RADIUS_UNITS)) {
        // Arrived. Hit/miss/interception were already decided at launch (see
        // the firing loop below) — a round that reaches here either applies
        // its damage or, if it was always going to miss, simply doesn't.
        if (proj.willHit) {
          const targetShip = shipsById.get(proj.targetShipId)
          const targetProfile = targetShip ? shipCombatProfile(targetShip) : null
          const state = stateOf(proj.targetShipId)
          if (targetShip && targetProfile && state && state.componentHp.core > 0) {
            const next = resolveProjectileImpact(proj, state, targetProfile, rng)
            working[proj.targetShipId] = next
            touched.add(proj.targetShipId)
            if (next.componentHp.core <= 0) destroyed.add(proj.targetShipId)
          }
        }
        continue
      }

      // Still closing — home on wherever the target actually is this step,
      // exactly like a missile's real 100% tracking (torpedoes home too:
      // the harder-to-land part of their design is the accuracy roll
      // already resolved at launch, not the guidance in flight).
      const direction = toTarget.divideScalar(distance).multiplyScalar(travel)
      // Purely a display value (see InFlightProjectile.progress's own
      // comment) — clamped since a homing target that's moved CLOSER than
      // its launch distance would otherwise push this above 1 before arrival
      // actually triggers.
      const progress = proj.initialDistanceUnits > 0 ? Math.min(1, Math.max(0, 1 - distance / proj.initialDistanceUnits)) : 1
      carriedProjectiles.push({
        ...proj,
        position: { x: current.x + direction.x, y: current.y + direction.y, z: current.z + direction.z },
        progress,
      })
    }

    // --- Firing. ---
    const newProjectiles: InFlightProjectile[] = []
    const nextParticipants: CombatParticipant[] = withTactics.map((p) => {
      const ship = shipsById.get(p.shipId)!
      const profile = shipCombatProfile(ship)
      const state = stateOf(p.shipId)
      if (!profile || !state || profile.weapons.length === 0) return p

      // A ship spooling a drive has diverted everything to the charge and
      // cannot fire — the core trade the escape mechanic is built on.
      if (ship.combat.ftlCharge) return p

      const effectiveness = weaponsEffectiveness(state.componentHp.weapons, profile.components.weapons)
      if (effectiveness <= 0) return p

      const explicit = p.targetShipId ? withTactics.find((o) => o.shipId === p.targetShipId) : undefined
      // An explicitly chosen target that has died or fled falls back to
      // auto-targeting rather than leaving the ship idle.
      const target = explicit && !destroyed.has(explicit.shipId) ? explicit : nearestEnemy(p, withTactics)
      if (!target) return p

      const targetState = stateOf(target.shipId)
      const targetShip = shipsById.get(target.shipId)
      const targetProfile = targetShip ? shipCombatProfile(targetShip) : null
      if (!targetState || !targetProfile) return p

      const selfPos = participantArenaPosition(p, simDays)
      const targetPos = participantArenaPosition(target, simDays)
      const separation = selfPos.distanceTo(targetPos)

      // A celestial body between the two ships stops every shot, at any
      // range. Checked once per firing ship rather than per mount, since
      // line of fire is a property of the geometry, not of the weapon.
      if (!hasLineOfFire(selfPos, targetPos, engagement.obstacles)) return p

      const weaponReady = [...p.weaponReadySimDays]
      let current = targetState
      // Evasion Tactics (Thruster Boost/Shield Boost/Spin Thrust) only ever
      // matter to torpedoAccuracy — see tacticEvasionBonus's own comment.
      const effectiveEvasion = targetProfile.defenses.evasion + tacticEvasionBonus(target, targetProfile.sizeClass)

      profile.weapons.forEach((weapon, index) => {
        if ((weaponReady[index] ?? 0) > simDays) return
        // Out of range: the mount holds its shot rather than burning the
        // cooldown, so closing to range produces an immediate volley.
        if (separation > weapon.rangeUnits) return
        if (current.componentHp.core <= 0) return

        // Missiles: 100% tracking (no accuracy roll at all — see
        // torpedoAccuracy's own comment for why this stays a torpedo-only
        // mechanic), but damage falls off past optimal range.
        let rawDamage =
          weapon.damage * effectiveness * (weapon.damageType === 'missile' ? missileDamageMultiplier(separation, weapon) : 1)
        // Thruster Boost / Shield Boost both starve the SHOOTER's OWN guns to
        // feed the drive/shield array respectively — see
        // tacticWeaponDamageMultiplier's own comment. Missiles/torpedoes are
        // untouched by either (physical rounds, not power-hungry systems).
        rawDamage *= tacticWeaponDamageMultiplier(p, weapon.damageType)

        // Torpedoes: fixed damage, but the hit itself is a roll — harder to
        // land past optimal range, and against a smaller/more evasive hull.
        const torpedoMiss =
          weapon.damageType === 'torpedo' ? 1 - torpedoAccuracy(separation, weapon, targetProfile.sizeClass, effectiveEvasion) : 0
        const chaffMiss = isChaffActive(current, simDays) ? CHAFF_MISS_CHANCE : 0
        // Combined as independent chances of failure — a shot has to clear
        // both to connect.
        const missChance = 1 - (1 - chaffMiss) * (1 - torpedoMiss)

        // Spin Thrust: some of what should have landed on the defender's
        // explicitly targeted component goes elsewhere instead — see
        // combatData's SPIN_THRUST_REDIRECT_CHANCE and
        // pickComponentExcluding's own comment. Scaled down for a bigger
        // hull, same as the evasion bonus (see SPIN_THRUST_SIZE_
        // EFFECTIVENESS) — a Battleship simply can't throw off a called shot
        // by jinking the way a Corvette can.
        const preferredComponent =
          p.targetComponent &&
          target.spinThrustActive &&
          rng() < SPIN_THRUST_REDIRECT_CHANCE * SPIN_THRUST_SIZE_EFFECTIVENESS[targetProfile.sizeClass]
            ? pickComponentExcluding(p.targetComponent, current, targetProfile, rng)
            : p.targetComponent

        if (weapon.damageType === 'missile' || weapon.damageType === 'torpedo') {
          // Travel time (see combatData's "Missile / torpedo travel time"):
          // interception and hit/miss are resolved right now, at launch —
          // reusing applyShot for exactly that roll and discarding its
          // (otherwise-unused) damage numbers — but the damage itself is
          // deferred to a projectile that has to physically cross the
          // distance first (see the projectile-flight step above).
          const { outcome } = applyShot(weapon, rawDamage, current, targetProfile, preferredComponent, rng, missChance)
          if (!outcome.intercepted) {
            newProjectiles.push({
              id: `proj-${p.shipId}-${index}-${simDays.toFixed(6)}`,
              sourceShipId: p.shipId,
              targetShipId: target.shipId,
              damageType: weapon.damageType,
              rawDamage,
              preferredComponent,
              willHit: !outcome.missed,
              position: { x: selfPos.x, y: selfPos.y, z: selfPos.z },
              speedUnitsPerSecond: projectileSpeedUnitsPerSecond(weapon.damageType),
              initialDistanceUnits: separation,
              progress: 0,
            })
          }
        } else {
          const { next, outcome } = applyShot(weapon, rawDamage, current, targetProfile, preferredComponent, rng, missChance)
          current = next
          void outcome
        }
        weaponReady[index] = simDays + simSecondsToDays(weapon.cooldownSeconds)
      })

      if (current !== targetState) {
        working[target.shipId] = current
        touched.add(target.shipId)
        if (current.componentHp.core <= 0) destroyed.add(target.shipId)
      }

      return { ...p, weaponReadySimDays: weaponReady }
    })

    // --- FTL escapes: a completed charge removes the ship from the fight. ---
    const surviving = nextParticipants.filter((p) => {
      if (destroyed.has(p.shipId)) return false
      const ship = shipsById.get(p.shipId)!
      const charge = ship.combat.ftlCharge
      if (charge && simDays >= charge.readySimDays) {
        escaped.add(p.shipId)
        return false
      }
      // Broke contact under its own power: every hostile is now further away
      // than the disengage threshold, so this ship has left the battle. The
      // second exit from a fight, and the only one available to a hull whose
      // utility is too wrecked to charge a drive.
      //
      // DISENGAGE_DISTANCE_UNITS alone isn't safe to use directly any more —
      // it was calibrated against the old fixed ~12-unit arena, and a fight
      // near a true-to-scale huge body (see arenaBodyRadius) now starts BOTH
      // fleets already spawned farther apart than that (Sol's own spawn
      // clearance alone is well over 260 units — see spawnHalfSpan). Without
      // this, every fight at a big body would disengage both sides on step
      // one, before anyone could even close distance — from the player's
      // seat, entering combat and immediately getting bounced back to system
      // view, indistinguishable from the fight just not working. Scaled to
      // whatever THIS engagement's own obstacles actually needed for a safe
      // spawn, so a normal small-body fight is completely unaffected.
      const disengageDistance = Math.max(DISENGAGE_DISTANCE_UNITS, 2 * spawnHalfSpan(engagement.obstacles) + DISENGAGE_DISTANCE_UNITS)
      const enemies = nextParticipants.filter((o) => o.side !== p.side && !destroyed.has(o.shipId))
      if (enemies.length > 0 && enemies.every((o) => pointDistance(p.position, o.position) > disengageDistance)) {
        disengaged.add(p.shipId)
        return false
      }
      return true
    })

    // An engagement only actually ends when literally nobody is left in it —
    // not merely when one side is. A one-sided roster is exactly what a
    // fight that just resolved (see syncEngagements' own `prior` handling)
    // or a manually-opened practice arena (createSoloEngagement) looks like,
    // and both are meant to persist: there's simply nothing left to shoot at
    // or be shot by, which the rest of this step already handles as a no-op
    // (nearestEnemy finds nothing, no shots fire) rather than needing this
    // check to do it.
    if (surviving.length === 0) continue

    nextEngagements.push({
      ...engagement,
      participants: surviving,
      projectiles: [...carriedProjectiles, ...newProjectiles],
      resolvedThroughSimDays: simDays,
    })
  }

  const shipCombat: Record<string, ShipCombatState> = {}
  for (const id of touched) if (working[id]) shipCombat[id] = working[id]

  return {
    engagements: nextEngagements,
    shipCombat,
    destroyedShipIds: [...destroyed],
    escapedShipIds: [...escaped],
    disengagedShipIds: [...disengaged],
  }
}

// Opens the tactical arena at a ship's current rest location with no fight
// required — the player looking around, pre-positioning a fleet before an
// enemy arrives, or just staying to survey the field after a battle they
// already won. Everyone currently resting at that same location joins the
// roster (whatever their allegiance — there may be no hostile at all), and
// syncEngagements' own "an existing engagement persists regardless of
// contest" rule (see its `prior` handling) is what keeps this alive on
// later ticks without needing any special-casing there once it exists.
// Returns null if the ship isn't anywhere a fight could happen (mid-order,
// or a location with no obstaclesForLocation entry at all).
export function createSoloEngagement(
  ship: ShipInstance,
  allShips: ShipInstance[],
  simDays: number,
  density: GridDensity = 'standard',
): Engagement | null {
  if (ship.order) return null
  const key = combatLocationKey(ship.location)
  if (!key) return null

  const obstacles = obstaclesForLocation(ship.location, simDays)
  const windowSpan = arenaWindowSpan(obstacles)
  const here = allShips.filter((s) => !s.order && combatLocationKey(s.location) === key)
  const perSideCount: Record<number, number> = { 0: 0, 1: 0 }
  const participants: CombatParticipant[] = here.map((s) => {
    const side = sideFor(s.allegiance)
    const spawnPosition = startingPoint(side, perSideCount[side]++, density, windowSpan)
    const profile = shipCombatProfile(s)
    return {
      shipId: s.id,
      side,
      position: spawnPosition,
      velocity: { x: 0, y: 0, z: 0 },
      positionSimDays: simDays,
      path: [],
      weaponReadySimDays: (profile?.weapons ?? []).map(() => simDays),
      targetShipId: null,
      targetComponent: null,
      holdPosition: false,
    }
  })

  return {
    id: `engagement-${key}-${Math.round(simDays * 1000)}`,
    locationKey: key,
    locationLabel: combatLocationLabel(ship.location),
    startedSimDays: simDays,
    density,
    center: ARENA_ORIGIN,
    obstacles,
    participants,
    resolvedThroughSimDays: simDays,
  }
}

// Reconciles the engagement list against where every ship currently is:
// creates engagements where mutually hostile fleets have come to rest at the
// same place, adds latecomers to a fight already in progress, and drops
// participants that have left. Called every tick before stepping — a ship
// that arrives mid-battle should join it, not wait for the next one.
export function syncEngagements(
  ships: ShipInstance[],
  existing: Engagement[],
  simDays: number,
  defaultDensity: GridDensity = 'standard',
): Engagement[] {
  // Only ships at rest at a real anchor can meet, so a ship mid-order can't
  // be party to a BRAND NEW encounter. But dropping an already-ordered ship
  // the instant the order is issued — rather than once it's actually gone —
  // erases a lingering/solo engagement (see createSoloEngagement's "pre-
  // position a fleet" case) before the ship has moved an inch, kicking the
  // player straight back out of a view they just opened. Only a ship
  // leaving a genuinely two-sided hostile standoff gets pulled immediately,
  // preserving the existing "ordering a ship away from combat extracts it
  // now" behavior; everyone else (a lone looker, or the last ship on a
  // fight that already resolved) keeps their seat until their location key
  // actually changes.
  const existingByKey = new Map(existing.map((e) => [e.locationKey, e]))
  const rawByLocation = new Map<string, ShipInstance[]>()
  for (const ship of ships) {
    const key = combatLocationKey(ship.location)
    if (!key) continue
    const group = rawByLocation.get(key)
    if (group) group.push(ship)
    else rawByLocation.set(key, [ship])
  }
  const byLocation = new Map<string, ShipInstance[]>()
  for (const [key, raw] of rawByLocation) {
    const prior = existingByKey.get(key)
    const hostilePairPresent = raw.some((a) => raw.some((b) => a.id !== b.id && areHostile(a.allegiance, b.allegiance)))
    const kept = raw.filter((ship) => !ship.order || (!!prior && !hostilePairPresent))
    if (kept.length > 0) byLocation.set(key, kept)
  }

  const result: Engagement[] = []

  for (const [key, group] of byLocation) {
    const prior = existingByKey.get(key)
    // A location is contested only if some pair in it is actually hostile —
    // three player fleets parked together doesn't spontaneously start a
    // battle. An engagement that already exists is exempt from this check
    // once it's open, though — see createSoloEngagement's own comment for
    // why (letting the player open/linger in an arena with no fight is a
    // deliberate feature, not a bug this would otherwise be guarding
    // against), and it's also what keeps the view from yanking the player
    // back to system space the instant a real fight resolves in their favor.
    const contested = group.some((a) => group.some((b) => a.id !== b.id && areHostile(a.allegiance, b.allegiance)))
    if (!contested && !prior) continue

    // Neutrals present at a contested location simply aren't part of it. An
    // already-open engagement has no such filter — everyone still present
    // belongs on its roster, hostile pairing or not.
    const combatants = prior
      ? group
      : group.filter((ship) => group.some((other) => other.id !== ship.id && areHostile(ship.allegiance, other.allegiance)))

    const density = prior?.density ?? defaultDensity
    const priorById = new Map(prior?.participants.map((p) => [p.shipId, p]) ?? [])
    // Reuse the already-open engagement's own obstacles rather than
    // recomputing — a latecomer joining a fight in progress spawns clear of
    // the SAME body everyone else is already fighting near.
    const obstacles = prior?.obstacles ?? obstaclesForLocation((combatants[0] ?? group[0]).location, simDays)
    const windowSpan = arenaWindowSpan(obstacles)

    // Ships already in the fight keep their arena position and timers;
    // newcomers are placed on their side's face, indexed past whoever's
    // already there so they don't spawn on an occupied point.
    const perSideCount: Record<number, number> = { 0: 0, 1: 0 }
    for (const p of priorById.values()) perSideCount[p.side]++

    const participants: CombatParticipant[] = combatants.map((ship) => {
      const kept = priorById.get(ship.id)
      if (kept) return kept
      const side = sideFor(ship.allegiance)
      const spawnPosition = startingPoint(side, perSideCount[side]++, density, windowSpan)
      const profile = shipCombatProfile(ship)
      return {
        shipId: ship.id,
        side,
        position: spawnPosition,
        velocity: { x: 0, y: 0, z: 0 },
        positionSimDays: simDays,
        path: [],
        weaponReadySimDays: (profile?.weapons ?? []).map(() => simDays),
        targetShipId: null,
        targetComponent: null,
        holdPosition: false,
      }
    })

    // A brand-new engagement still needs both sides actually represented —
    // that's what "contested" means. An already-open one doesn't: it may
    // now hold only the victor's side (the fight it was tracking just
    // resolved) or, for a manually-opened arena, only ever had one.
    if (!prior && new Set(participants.map((p) => p.side)).size < 2) continue
    if (participants.length === 0) continue

    result.push(
      prior
        ? { ...prior, density, participants }
        : {
            id: `engagement-${key}-${Math.round(simDays * 1000)}`,
            locationKey: key,
            locationLabel: combatLocationLabel(combatants[0].location),
            startedSimDays: simDays,
            density,
            center: ARENA_ORIGIN,
            // Whatever the fleets are orbiting is physically present in the
            // arena, sitting between them at the start (see
            // obstaclesForLocation — it anchors at the same origin).
            obstacles,
            participants,
            resolvedThroughSimDays: simDays,
          },
    )
  }

  return result
}

// Queues a move for one participant, to an exact real destination point —
// exposed here (rather than as a store action) so the route is computed by
// the same pure layer that consumes it, and so the caller can't queue a
// route the arena wouldn't accept.
//
// The lattice is consulted only as a last resort: if the straight real-space
// segment from the ship's current position to `destination` is clear, the
// ship simply walks that line — the destination can be anywhere, including a
// point that isn't on any grid intersection ("nodes are simply a
// pathfinding tool," per the design brief). Only when that direct line is
// blocked does this snap both ends to the lattice, route around the
// obstacle, and convert the result back to real waypoints — and even then,
// the FINAL waypoint is overwritten with the exact requested `destination`
// rather than left at its lattice-snapped position, so only the detour
// itself is grid-quantized, not the resting place. (This is an approximation
// for the last leg from the final detour waypoint to the exact destination —
// good enough given the waypoint sits within half a grid cell of it, but not
// a rigorous guarantee against every possible obstacle geometry.)
export function orderParticipantTo(
  participant: CombatParticipant,
  destination: ArenaPoint,
  density: GridDensity,
  _simDays: number,
  obstacles: CombatObstacle[] = [],
): CombatParticipant {
  const current = participant.position
  if (pointDistance(current, destination) < EPSILON) return participant

  let path: ArenaPoint[]
  if (segmentClearsObstacles(toVector3(current), toVector3(destination), obstacles, OBSTACLE_CLEARANCE_UNITS)) {
    path = [destination]
  } else {
    // Must match the SAME span the rendered/clickable lattice uses (see
    // arenaWindowSpan) — otherwise a click resolves against one lattice
    // (CombatGrid's, sized to this engagement's window) while the route gets
    // planned against a different, unscaled one, and the two disagree about
    // where the nodes even are.
    const windowSpan = arenaWindowSpan(obstacles)
    const fromNode = arenaPositionToNode(toVector3(current), density, windowSpan)
    const toNode = arenaPositionToNode(toVector3(destination), density, windowSpan)
    const latticeNodes = latticePath(fromNode, toNode, density, {
      obstacles,
      clearance: OBSTACLE_CLEARANCE_UNITS,
      span: windowSpan,
    })
    // No route (destination inside a body, or unreachable) — the order is
    // simply refused rather than flying the ship through the obstacle.
    if (latticeNodes.length === 0) return participant
    path = latticeNodes.map((n) => {
      const v = nodeToArenaPosition(n, density, windowSpan)
      return { x: v.x, y: v.y, z: v.z }
    })
    path[path.length - 1] = destination
  }

  // Only the route changes. Position and velocity are deliberately left
  // untouched, which is what makes redirecting a ship mid-flight behave like
  // a real course change: it carries its momentum into the turn and arcs
  // onto the new heading under the same acceleration limit as everything
  // else. (It's also why the old teleport bug can't recur — this function no
  // longer has any reason to write a position at all.)
  return { ...participant, path }
}

// A ship can end up closer to some LATER point on its route than to the very
// next waypoint on it — steering (integrateMotion's velocity budget means a
// turn isn't instant) can carry it wide of an intermediate corner faster
// than it re-approaches that exact point. The old behavior treated every
// waypoint as its own sub-destination the ship was required to actually
// touch, which reads as a real bug once it happens: the ship visibly
// arrives, then peels back AWAY from the destination to go tag a point
// behind it that the route no longer needs. The destination is the only
// point a route is ever required to reach (see combatArena.ts's header —
// intermediate nodes are a pathfinding aid, not a checkpoint); this drops
// every stale waypoint up to the FARTHEST remaining one that's both closer to
// here than the immediate next waypoint is, and actually reachable in a
// straight line.
//
// Farthest first (not "only the final destination", and not "only one
// waypoint at a time"): checking only the final destination meant this
// essentially never fired mid-detour, since the whole reason a multi-leg
// route exists is that no direct shot to the end exists yet — a ship that
// overshoot the first corner of a five-node detour just sat there aimed
// back at that corner until it was nearly at the last leg. Checking only the
// very next waypoint fixes that case but then UNDER-prunes the opposite one:
// overshooting two corners at once (a sharp turn, or a big catch-up step)
// would only ever drop one of them per call. Trying candidates from the end
// of the path backward and taking the first that clears gets both right in
// one pass.
//
// Deliberately independent of who or what queued the route — a manual
// player order through a detour benefits from this exactly as much as a
// stance's does, since the underlying route data looks identical either way.
export function pruneOvershotWaypoints(path: ArenaPoint[], position: ArenaPoint, obstacles: CombatObstacle[]): ArenaPoint[] {
  if (path.length <= 1) return path
  const next = path[0]
  for (let i = path.length - 1; i >= 1; i--) {
    const candidate = path[i]
    if (pointDistance(position, candidate) >= pointDistance(next, candidate)) continue
    if (!segmentClearsObstacles(toVector3(position), toVector3(candidate), obstacles, OBSTACLE_CLEARANCE_UNITS)) continue
    return path.slice(i)
  }
  return path
}

// Whether a ship is currently pinned in a fight — used to decide whether a
// move order becomes a normal order or an FTL escape charge.
export function findEngagementFor(engagements: Engagement[], shipId: string): Engagement | null {
  return engagements.find((e) => e.participants.some((p) => p.shipId === shipId)) ?? null
}

// Enemies a participant could genuinely exchange fire with right now — within
// EITHER side's weapon range and with a clear line of fire. Deliberately
// narrower than "everyone in the same Engagement": a fleet fight can easily
// include ships sitting well outside anyone's range, or blocked by a body,
// that are technically part of the battle but aren't actually fighting
// anyone. "In combat" (present in an Engagement) and "actively engaged" (has
// a live target) are different questions — see ShipPanel, which surfaces
// both, and shipPhysics's FTL risk functions, which only the second one
// affects.
//
// The range check uses EITHER ship's reach on purpose: a longer-ranged ship
// is a real, active threat to a target it can hit even if that target can't
// hit back — exactly the situation a kiting Frigate creates, and it should
// still count as "actively engaged" from the target's perspective.
export function activeEnemyContacts(
  participant: CombatParticipant,
  engagement: Engagement,
  ships: ShipInstance[],
  simDays: number,
): CombatParticipant[] {
  const shipsById = new Map(ships.map((s) => [s.id, s]))
  const selfShip = shipsById.get(participant.shipId)
  const selfProfile = selfShip ? shipCombatProfile(selfShip) : null
  const selfReach = selfProfile ? longestWeaponRange(selfProfile) : 0
  const selfPos = participantArenaPosition(participant, simDays)

  return engagement.participants.filter((other) => {
    if (other.side === participant.side) return false
    const otherShip = shipsById.get(other.shipId)
    if (!otherShip) return false
    const otherProfile = shipCombatProfile(otherShip)
    const otherReach = otherProfile ? longestWeaponRange(otherProfile) : 0
    const otherPos = participantArenaPosition(other, simDays)
    const distance = selfPos.distanceTo(otherPos)
    if (distance > selfReach && distance > otherReach) return false
    return hasLineOfFire(selfPos, otherPos, engagement.obstacles)
  })
}

export function isActivelyEngaged(
  participant: CombatParticipant,
  engagement: Engagement,
  ships: ShipInstance[],
  simDays: number,
): boolean {
  return activeEnemyContacts(participant, engagement, ships, simDays).length > 0
}

// Whether each side of one specific contact can actually reach the other —
// the same question CombatEngagementLine colors a line by (mutual/hostile-
// only/friendly-only) and rangeFavor below aggregates across every current
// contact. "a"/"b" here are just the two ships in whichever order the
// caller passed them; it's the caller's job to know which one it cares
// about.
export function rangeContactStatus(
  a: CombatParticipant,
  aShip: ShipInstance,
  b: CombatParticipant,
  bShip: ShipInstance,
  simDays: number,
): { aCanHit: boolean; bCanHit: boolean } {
  const aProfile = shipCombatProfile(aShip)
  const bProfile = shipCombatProfile(bShip)
  const distance = participantArenaPosition(a, simDays).distanceTo(participantArenaPosition(b, simDays))
  return {
    aCanHit: distance <= (aProfile ? longestWeaponRange(aProfile) : 0),
    bCanHit: distance <= (bProfile ? longestWeaponRange(bProfile) : 0),
  }
}

// Whether THIS ship is coming out ahead on range across every contact it
// currently has, not just how many it has — the same per-pair question
// CombatEngagementLine's color answers (see rangeContactStatus), rolled up
// into one read for a ship's own panel. Works for inspecting an enemy ship
// exactly the same as an owned one (see ShipPanel's own "Engaged Against"
// row) — "favored" always means the inspected ship itself, not "the
// player," since there's no other ship-agnostic way to read this that's
// still meaningful when the selection is a hostile.
export type RangeFavor = 'favored' | 'unfavored' | 'even'

export function rangeFavor(
  participant: CombatParticipant,
  engagement: Engagement,
  ships: ShipInstance[],
  simDays: number,
): RangeFavor {
  const shipsById = new Map(ships.map((s) => [s.id, s]))
  const selfShip = shipsById.get(participant.shipId)
  if (!selfShip) return 'even'

  let favorable = 0
  let unfavorable = 0
  for (const other of activeEnemyContacts(participant, engagement, ships, simDays)) {
    const otherShip = shipsById.get(other.shipId)
    if (!otherShip) continue
    const { aCanHit: selfCanHit, bCanHit: otherCanHit } = rangeContactStatus(participant, selfShip, other, otherShip, simDays)
    if (selfCanHit && !otherCanHit) favorable++
    else if (otherCanHit && !selfCanHit) unfavorable++
  }
  if (favorable > unfavorable) return 'favored'
  if (unfavorable > favorable) return 'unfavored'
  return 'even'
}
