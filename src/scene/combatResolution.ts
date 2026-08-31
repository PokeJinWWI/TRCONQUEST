// Combat resolution — pure functions over (engagements, ships, simDays).
//
// Nothing here reads or writes a store; every function takes what it needs
// and returns what changed, exactly like shipPhysics.planMove. That's what
// makes combat testable without mounting a scene (this project's browser
// sandbox can't reliably render a second WebGL context — see Context.md), and
// it's why the whole thing steps in fixed sim-second increments rather than
// resolving a variable chunk per frame: outcomes must not depend on framerate.

import { Vector3 } from 'three'
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
  CHAFF_MISS_CHANCE,
  CHAFF_DURATION_SECONDS,
  scuttleDamageAt,
  CHAFF_AI_FIRST_THRESHOLD,
  CHAFF_AI_SECOND_THRESHOLD,
  CHAFF_CHARGES,
  type CombatProfile,
  type CombatStance,
  type ComponentKind,
  type WeaponMount,
} from '../data/combatData'
import { SHIP_CLASSES } from '../data/shipData'
import type { MoveDestination, ShipCombatState, ShipInstance, ShipLocation, FtlCharge } from '../state/shipStore'
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
import { getMoonsForPlanet } from './moonData'
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

// Earth's radius, the reference the arena sizing below is expressed against.
const EARTH_RADIUS_KM = PLANETS.find((p) => p.name === 'Earth')?.radiusKm ?? 6371

// Real radii span four orders of magnitude (a small moon to Sol), which is
// unusable directly — Sol would swallow the whole arena and a moon would be
// invisible. A fourth-root compression against Earth keeps the *ordering*
// and rough proportions real while landing everything in a playable band:
// a moon ≈ 0.9 units, Earth 1.2, Jupiter ≈ 2.2, Sol ≈ 3.9 against a 12-unit
// arena. Same "real data in, legible game scale out" approach moonData.ts
// already uses for orbit radii, and the same honesty about it: only the
// relative sizes are physical, the absolute scale is picked.
const ARENA_BODY_RADIUS_AT_EARTH = 1.2
const MIN_BODY_RADIUS_UNITS = 0.8
const MAX_BODY_RADIUS_UNITS = 4.5

export function arenaBodyRadius(radiusKm: number): number {
  const scaled = ARENA_BODY_RADIUS_AT_EARTH * Math.pow(radiusKm / EARTH_RADIUS_KM, 0.25)
  return Math.max(MIN_BODY_RADIUS_UNITS, Math.min(MAX_BODY_RADIUS_UNITS, scaled))
}

// The bodies present at a fight, placed at the arena origin — which is where
// a fresh engagement's window is centred too (see syncEngagements), so a
// fight in orbit starts with that body squarely between the two sides. This
// is exactly the situation the design brief called out: two ships on
// opposite sides of a star should not be able to shoot each other. The
// body's position is real and fixed from here on — it does not move if the
// player later recentres the window (see combatArena.ts's header).
//
// Moons of the primary are deliberately *not* included in general: they're
// far enough out at real scale that putting them in a 12-unit arena would be
// inventing geometry rather than modelling it — Luna's real orbit radius
// alone (60 Earth radii) is 72 arena units, six times the window's own span.
// The one deliberate exception is EARTH_MOON_OFFSET below: Luna is famous
// specifically for being close relative to its primary, and a fight in
// Earth orbit reads as missing an obvious piece of terrain without it. Its
// placement is compressed exactly like every body's *size* already is (see
// arenaBodyRadius) rather than real — there's no honest way to fit a 72-unit
// separation in a 12-unit window — but it's the same kind of compromise this
// file already makes everywhere else, just applied to a position instead of
// a radius, and it's the only body-pair this file invents geometry for.
const EARTH_MOON_OFFSET: ArenaPoint = { x: 4, y: 0.8, z: -2 }

export function obstaclesForLocation(location: ShipLocation): CombatObstacle[] {
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
      // See EARTH_MOON_OFFSET above — the one moon close enough (in the
      // "famous for it," not the "fits to scale" sense) to be worth adding.
      if (planet.name === 'Earth') {
        const luna = getMoonsForPlanet('Earth').moons.find((m) => m.name === 'Luna')
        if (luna) {
          obstacles.push({
            name: luna.name,
            kind: 'moon',
            color: luna.color,
            position: EARTH_MOON_OFFSET,
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

// How far a stance's freshly computed destination has to have moved from
// where the ship's existing route already ends before that's treated as a
// real change worth re-planning for. Below this, a moving target's own
// per-step jitter (or plain floating-point noise) would otherwise trigger a
// fresh lattice route every single 0.1s step for a target that's actually
// holding roughly still.
const STANCE_REPLAN_TOLERANCE = 0.25

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

  for (const engagement of engagements) {
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
      if (!target) return p
      const state = stateOf(p.shipId)
      const weaponsOnline = !!state && weaponsEffectiveness(state.componentHp.weapons, profile.components.weapons) > 0
      const point = stanceDestination(p, target, profile, ship.stance ?? 'balanced', engagement.obstacles, participants, weaponsOnline)
      if (!point) return p
      const currentFinal = p.path.length > 0 ? p.path[p.path.length - 1] : null
      if (currentFinal && pointDistance(currentFinal, point) <= STANCE_REPLAN_TOLERANCE) return p
      return orderParticipantTo(p, point, engagement.density, simDays, engagement.obstacles)
    })

    // --- Movement: integrate one step of real accelerated motion. ---
    const moved: CombatParticipant[] = withApproach.map((p) => {
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
      // than DISENGAGE_DISTANCE_UNITS, so this ship has left the battle. The
      // second exit from a fight, and the only one available to a hull whose
      // utility is too wrecked to charge a drive.
      const enemies = nextParticipants.filter((o) => o.side !== p.side && !destroyed.has(o.shipId))
      if (enemies.length > 0 && enemies.every((o) => pointDistance(p.position, o.position) > DISENGAGE_DISTANCE_UNITS)) {
        disengaged.add(p.shipId)
        return false
      }
      return true
    })

    // An engagement with no live opposition is over.
    const sidesPresent = new Set(surviving.map((p) => p.side))
    if (sidesPresent.size < 2) continue

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
  // Only ships at rest at a real anchor can meet. A ship mid-order is
  // crossing interplanetary distance and isn't anywhere another fleet could
  // be sitting.
  const byLocation = new Map<string, ShipInstance[]>()
  for (const ship of ships) {
    if (ship.order) continue
    const key = combatLocationKey(ship.location)
    if (!key) continue
    const group = byLocation.get(key)
    if (group) group.push(ship)
    else byLocation.set(key, [ship])
  }

  const existingByKey = new Map(existing.map((e) => [e.locationKey, e]))
  const result: Engagement[] = []

  for (const [key, group] of byLocation) {
    // A location is contested only if some pair in it is actually hostile —
    // three player fleets parked together is not a battle.
    const contested = group.some((a) => group.some((b) => a.id !== b.id && areHostile(a.allegiance, b.allegiance)))
    if (!contested) continue

    // Neutrals present at a contested location simply aren't part of it.
    const combatants = group.filter((ship) =>
      group.some((other) => other.id !== ship.id && areHostile(ship.allegiance, other.allegiance)),
    )

    const prior = existingByKey.get(key)
    const density = prior?.density ?? defaultDensity
    const priorById = new Map(prior?.participants.map((p) => [p.shipId, p]) ?? [])

    // Ships already in the fight keep their arena position and timers;
    // newcomers are placed on their side's face, indexed past whoever's
    // already there so they don't spawn on an occupied point.
    const perSideCount: Record<number, number> = { 0: 0, 1: 0 }
    for (const p of priorById.values()) perSideCount[p.side]++

    const participants: CombatParticipant[] = combatants.map((ship) => {
      const kept = priorById.get(ship.id)
      if (kept) return kept
      const side = sideFor(ship.allegiance)
      const spawnPosition = startingPoint(side, perSideCount[side]++, density)
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

    if (new Set(participants.map((p) => p.side)).size < 2) continue

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
            obstacles: obstaclesForLocation(combatants[0].location),
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
    const fromNode = arenaPositionToNode(toVector3(current), density)
    const toNode = arenaPositionToNode(toVector3(destination), density)
    const latticeNodes = latticePath(fromNode, toNode, density, { obstacles, clearance: OBSTACLE_CLEARANCE_UNITS })
    // No route (destination inside a body, or unreachable) — the order is
    // simply refused rather than flying the ship through the obstacle.
    if (latticeNodes.length === 0) return participant
    path = latticeNodes.map((n) => {
      const v = nodeToArenaPosition(n, density)
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
