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
  CHAFF_AI_FIRST_THRESHOLD,
  CHAFF_AI_SECOND_THRESHOLD,
  CHAFF_CHARGES,
  type CombatProfile,
  type CombatStance,
  type ComponentKind,
  type FleetStrategy,
  type WeaponMount,
} from '../data/combatData'
import { SHIP_CLASSES } from '../data/shipData'
import type { MoveDestination, ShipCombatState, ShipInstance, ShipLocation, FtlCharge } from '../state/shipStore'
import type { Fleet } from '../state/fleetStore'
import {
  areHostile,
  combatLocationKey,
  combatLocationLabel,
  sideFor,
  type CombatParticipant,
  type Engagement,
} from '../state/combatStore'
import {
  ARENA_ORIGIN,
  ARENA_SPAN_UNITS,
  arenaBodyRadius,
  arenaDistanceFromKm,
  arenaPositionToNode,
  arenaSurfaceGravity,
  gravitationalAcceleration,
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
import { PLANETS } from './planetData'
import { STARS } from '../data/starData'
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
  return SHIP_CLASSES.find((c) => c.id === ship.classId)?.combat ?? null
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

// Applies one shot, eating through shields then armor then a component.
//
// Overflow between layers is carried in *raw* (pre-multiplier) damage rather
// than post-multiplier damage — otherwise a kinetic round that overkills a
// shield would carry its 1.5x shield bonus through into armor, where it's
// supposed to be at 0.5x. Converting back to raw at each boundary is what
// makes the counter-matrix behave correctly on partial layers.
export function applyShot(
  weapon: WeaponMount,
  rawDamage: number,
  target: ShipCombatState,
  targetProfile: CombatProfile,
  preferredComponent: ComponentKind | null,
  rng: Rng,
  // Chaff's miss chance for THIS shot, already resolved against the range it
  // crosses (see combatData's chaffMissChance). Passed in rather than
  // computed here so this function stays a dumb consumer of one number and
  // the falloff curve can be tested on its own.
  chaffMiss: number = 0,
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
  if (profile.interceptable && targetProfile.defenses.pointDefenseRating > 0) {
    const screen =
      targetProfile.defenses.pointDefenseRating *
      weaponsEffectiveness(target.componentHp.weapons, targetProfile.components.weapons)
    if (screen > 0 && rng() < screen) {
      return { next: target, outcome: { ...nothing, intercepted: true } }
    }
  }

  // Chaff: the target's decoys spoil the shot outright. Rolled AFTER point
  // defense so the two stack the way they read — a missile has to survive
  // interception AND still find its target — and applies to every damage
  // type, since it degrades the attacker's aim rather than physically
  // stopping a projectile the way point defense does.
  if (chaffMiss > 0 && rng() < chaffMiss) {
    return { next: target, outcome: { ...nothing, missed: true } }
  }

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
    outcome: { intercepted: false, missed: false, shieldDamage, armorDamage, componentDamage, component },
  }
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
  const shipClass = SHIP_CLASSES.find((c) => c.id === ship.classId)
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
// a fresh engagement's window is centred too (see syncEngagements), so a
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
    // A system's star doubles as a body you can orbit (Sol in system view),
    // so check both rosters.
    const star = STARS.find((s) => s.name === location.bodyName)
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
    const planet = PLANETS.find((p) => p.name === location.bodyName)
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
    for (const p of PLANETS) {
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
// half-span is centre-to-edge) so the window a player sees, the lattice a
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

// Minimum centre-to-centre distance between any two hulls — effectively a
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
//              not just the nearest one. The automatic behaviour for any
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
      // (see each function's own comment). Chase still wins over all of it,
      // same precedence it already had over a plain stance.
      const strategy = effectiveStrategy(ship, fleets)
      let point: ArenaPoint | null
      let newTargetShipId: string | undefined
      if (p.chasing) {
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

    // --- Movement: integrate one step of real accelerated motion. ---
    const moved: CombatParticipant[] = withApproach.map((p) => {
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
      return integrateMotion(
        p,
        profile.maneuverUnitsPerSecond * utility,
        profile.accelerationUnitsPerSecondSq * utility,
        COMBAT_STEP_SECONDS,
        simDays,
        engagement.obstacles,
      )
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
      working[p.shipId] = {
        ...state,
        shieldHp: Math.min(
          profile.defenses.shieldHp,
          state.shieldHp + profile.defenses.shieldRegenPerSecond * COMBAT_STEP_SECONDS,
        ),
      }
      touched.add(p.shipId)
    }

    // --- Scuttling: a hull the player has written off detonates, damaging
    // every hostile inside the blast. Resolved here — after movement and
    // separation, before firing — so the blast uses this step's real
    // positions and a ship killed by it doesn't also get to shoot this step.
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
        if (other.side === p.side || destroyed.has(other.shipId)) continue
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

    // --- Firing. ---
    const nextParticipants: CombatParticipant[] = separated.map((p) => {
      const ship = shipsById.get(p.shipId)!
      const profile = shipCombatProfile(ship)
      const state = stateOf(p.shipId)
      if (!profile || !state || profile.weapons.length === 0) return p

      // A ship spooling a drive has diverted everything to the charge and
      // cannot fire — the core trade the escape mechanic is built on.
      if (ship.combat.ftlCharge) return p

      const effectiveness = weaponsEffectiveness(state.componentHp.weapons, profile.components.weapons)
      if (effectiveness <= 0) return p

      const explicit = p.targetShipId ? separated.find((o) => o.shipId === p.targetShipId) : undefined
      // An explicitly chosen target that has died or fled falls back to
      // auto-targeting rather than leaving the ship idle.
      const target = explicit && !destroyed.has(explicit.shipId) ? explicit : nearestEnemy(p, separated)
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

      profile.weapons.forEach((weapon, index) => {
        if ((weaponReady[index] ?? 0) > simDays) return
        // Out of range: the mount holds its shot rather than burning the
        // cooldown, so closing to range produces an immediate volley.
        if (separation > weapon.rangeUnits) return
        if (current.componentHp.core <= 0) return

        const { next, outcome } = applyShot(
          weapon,
          weapon.damage * effectiveness,
          current,
          targetProfile,
          p.targetComponent,
          rng,
          isChaffActive(current, simDays) ? CHAFF_MISS_CHANCE : 0,
        )
        current = next
        // An intercepted shot still consumed the round.
        void outcome
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
// than it re-approaches that exact point. The old behaviour treated every
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
