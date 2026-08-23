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
  type CombatProfile,
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
  arenaCenterNode,
  arenaDistance,
  arenaPositionToNode,
  hasLineOfFire,
  isNodeBlocked,
  latticePath,
  nodeToArenaPosition,
  nodesEqual,
  startingNode,
  traversalSeconds,
  type CombatObstacle,
  type GridDensity,
  type GridNode,
} from './combatArena'
import { PLANETS } from './planetData'
import { STARS } from '../data/starData'
import { getMoonsForPlanet } from './moonData'
import { simSecondsToDays } from '../state/gameTimeStore'

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

// Where a participant actually is right now — interpolated along its current
// lattice hop. A ship mid-hop is genuinely between nodes for range purposes,
// so weapons check against this rather than snapping to either endpoint.
export function participantArenaPosition(p: CombatParticipant, density: GridDensity, simDays: number): Vector3 {
  const from = nodeToArenaPosition(p.hopFrom, density)
  const to = nodeToArenaPosition(p.node, density)
  const span = p.hopArrivalSimDays - p.hopStartSimDays
  if (span <= 0 || simDays >= p.hopArrivalSimDays) return to
  const t = Math.max(0, (simDays - p.hopStartSimDays) / span)
  return from.clone().lerp(to, t)
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
): { next: ShipCombatState; outcome: ShotOutcome } {
  const profile = DAMAGE_PROFILES[weapon.damageType]
  const nothing: ShotOutcome = {
    intercepted: false,
    shieldDamage: 0,
    armorDamage: 0,
    componentDamage: 0,
    component: null,
  }

  // Point defense gets its shot at anything physical before any layer is
  // touched. An intercepted missile does nothing at all.
  if (profile.interceptable && targetProfile.defenses.pointDefenseRating > 0) {
    if (rng() < targetProfile.defenses.pointDefenseRating) {
      return { next: target, outcome: { ...nothing, intercepted: true } }
    }
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
    outcome: { intercepted: false, shieldDamage, armorDamage, componentDamage, component },
  }
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
export function planFtlCharge(
  ship: ShipInstance,
  destination: MoveDestination,
  simDays: number,
): FtlCharge | null {
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
export function nearestEnemy(
  self: CombatParticipant,
  participants: CombatParticipant[],
  density: GridDensity,
): CombatParticipant | null {
  let best: CombatParticipant | null = null
  let bestDistance = Infinity
  for (const other of participants) {
    if (other.side === self.side || other.shipId === self.shipId) continue
    const distance = arenaDistance(self.node, other.node, density)
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

// The bodies present at a fight, placed at the window's centre so an
// engagement in orbit starts with that body squarely between the two sides —
// which is exactly the situation the design brief called out: two ships on
// opposite sides of a star should not be able to shoot each other.
//
// Moons of the primary are deliberately *not* included: they're far enough
// out at real scale that putting them in a 12-unit arena would be inventing
// geometry rather than modelling it. Only the body actually being orbited
// is here.
export function obstaclesForLocation(location: ShipLocation, density: GridDensity): CombatObstacle[] {
  const center = arenaCenterNode(density)

  if (location.kind === 'star') {
    const star = STARS.find((s) => s.id === location.starId)
    if (!star) return []
    return [
      { name: star.name, kind: 'star', color: star.color, node: center, radiusUnits: arenaBodyRadius(star.radiusKm) },
    ]
  }

  if (location.kind === 'orbiting') {
    // A system's star doubles as a body you can orbit (Sol in system view),
    // so check both rosters.
    const star = STARS.find((s) => s.name === location.bodyName)
    if (star) {
      return [
        { name: star.name, kind: 'star', color: star.color, node: center, radiusUnits: arenaBodyRadius(star.radiusKm) },
      ]
    }
    const planet = PLANETS.find((p) => p.name === location.bodyName)
    if (planet) {
      return [
        {
          name: planet.name,
          kind: 'planet',
          color: planet.color,
          node: center,
          radiusUnits: arenaBodyRadius(planet.radiusKm),
        },
      ]
    }
    // A moon being orbited directly isn't reachable as a rest location today,
    // but resolve it rather than silently producing an empty arena if it ever
    // becomes one.
    for (const p of PLANETS) {
      const moon = getMoonsForPlanet(p.name).moons.find((m) => m.name === location.bodyName)
      if (moon) {
        return [
          { name: moon.name, kind: 'moon', color: p.color, node: center, radiusUnits: arenaBodyRadius(moon.radiusKm) },
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

// How close a ship tries to get, as a fraction of its longest weapon's reach.
// Below 1 so a ship settles just *inside* effective range rather than exactly
// on the boundary, where a target drifting a fraction of a unit would drop it
// back out of range every other step.
const APPROACH_RANGE_FRACTION = 0.7

export function longestWeaponRange(profile: CombatProfile): number {
  return profile.weapons.reduce((max, w) => Math.max(max, w.rangeUnits), 0)
}

// Baseline "close to the enemy" behavior. Without this, two fleets spawn on
// opposite faces of the arena 12 units apart — outside every weapon's reach —
// and simply stare at each other forever, so a battle could never actually
// join until player-issued movement exists (Phase 2).
//
// It deliberately stops at a standoff just inside the ship's *own* longest
// range rather than closing to contact, so a long-ranged hull keeps its reach
// advantage instead of throwing it away. A player-issued move order overrides
// this entirely — the approach only runs when the ship has no path of its own
// queued (see stepEngagements), so manual control always wins.
export function approachNode(
  self: CombatParticipant,
  target: CombatParticipant,
  profile: CombatProfile,
  density: GridDensity,
  obstacles: CombatObstacle[] = [],
): GridNode | null {
  const reach = longestWeaponRange(profile)
  // An unarmed ship has nothing to close for — it holds position (and had
  // better be charging a drive).
  if (reach <= 0) return null

  const selfPos = nodeToArenaPosition(self.node, density)
  const targetPos = nodeToArenaPosition(target.node, density)
  const separation = selfPos.distanceTo(targetPos)
  const standoff = reach * APPROACH_RANGE_FRACTION
  const blocked = obstacles.length > 0 && !hasLineOfFire(selfPos, targetPos, obstacles, density)

  // Already in range with a clear shot — nothing to do.
  if (separation <= standoff && !blocked) return null

  // Deliberately does NOT check the display window: where the player has the
  // camera framed must not constrain what a ship is allowed to do, or a ship
  // that ends up outside the frame is frozen out of the fight.
  const usable = (node: GridNode): boolean => {
    if (isNodeBlocked(node, obstacles, density, OBSTACLE_CLEARANCE_UNITS)) return false
    return hasLineOfFire(nodeToArenaPosition(node, density), targetPos, obstacles, density)
  }

  // Straight in, if that works.
  const direction = selfPos.clone().sub(targetPos).normalize()
  const direct = arenaPositionToNode(targetPos.clone().add(direction.clone().multiplyScalar(standoff)), density)
  if (obstacles.length === 0) return nodesEqual(direct, self.node) ? null : direct
  if (usable(direct)) return nodesEqual(direct, self.node) ? null : direct

  // Otherwise the body is in the way, so look for a firing position *around*
  // it: sample directions on the sphere of radius `standoff` about the target
  // and take the one closest to where the ship already is. Without this, two
  // fleets on opposite sides of a star would sit forever, each unable to
  // shoot and each convinced it was already in position.
  let best: GridNode | null = null
  let bestDistance = Infinity
  for (const candidateDir of SPHERE_DIRECTIONS) {
    const candidate = arenaPositionToNode(targetPos.clone().add(candidateDir.clone().multiplyScalar(standoff)), density)
    if (!usable(candidate)) continue
    const distance = selfPos.distanceTo(nodeToArenaPosition(candidate, density))
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best && !nodesEqual(best, self.node) ? best : null
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

export interface CombatStepResult {
  engagements: Engagement[]
  // Only ships whose state actually changed this step.
  shipCombat: Record<string, ShipCombatState>
  destroyedShipIds: string[]
  // Ships whose FTL charge completed — the caller turns each into a real
  // move order (the resolver can't, since planMove is order-planning, not
  // combat).
  escapedShipIds: string[]
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

  const stateOf = (shipId: string): ShipCombatState | null => {
    if (working[shipId]) return working[shipId]
    const ship = shipsById.get(shipId)
    if (!ship) return null
    working[shipId] = ship.combat
    return working[shipId]
  }

  const nextEngagements: Engagement[] = []

  for (const engagement of engagements) {
    const { density } = engagement
    // Drop participants whose ship no longer exists (destroyed earlier, lost
    // in hyperspace, etc.) before anything else reads the roster.
    const participants = engagement.participants.filter((p) => shipsById.has(p.shipId) && !destroyed.has(p.shipId))

    // --- Approach: any ship with nothing queued and nothing in reach closes
    // on its target. Runs before movement so a freshly queued path starts its
    // first hop this same step rather than idling one. Skipped entirely for
    // a ship that already has a path (a player order in progress) or is
    // spooling a drive to leave. ---
    const withApproach: CombatParticipant[] = participants.map((p) => {
      if (p.path.length > 0) return p
      // The player has taken manual control of this ship's positioning — never
      // second-guess it by walking the ship back toward the enemy.
      if (p.holdPosition) return p
      const ship = shipsById.get(p.shipId)!
      if (ship.combat.ftlCharge) return p
      const profile = shipCombatProfile(ship)
      if (!profile) return p
      const explicit = p.targetShipId ? participants.find((o) => o.shipId === p.targetShipId) : undefined
      const target = explicit ?? nearestEnemy(p, participants, density)
      if (!target) return p
      const node = approachNode(p, target, profile, density, engagement.obstacles)
      if (!node) return p
      return orderParticipantTo(p, node, density, simDays, engagement.obstacles)
    })

    // --- Movement: complete any hop that has landed, then start the next. ---
    const moved: CombatParticipant[] = withApproach.map((p) => {
      if (simDays < p.hopArrivalSimDays) return p
      // The hop has landed: the ship is now at `node`. Start the next queued
      // hop if there is one.
      if (p.path.length === 0) {
        return { ...p, hopFrom: p.node, hopStartSimDays: simDays, hopArrivalSimDays: simDays }
      }
      const ship = shipsById.get(p.shipId)!
      const profile = shipCombatProfile(ship)
      const state = stateOf(p.shipId)
      const utility = profile && state
        ? utilityEffectiveness(state.componentHp.utility, profile.components.utility)
        : 0
      const speed = (profile?.maneuverUnitsPerSecond ?? 0) * utility
      const [nextNode, ...rest] = p.path
      // A ship with dead utility can't move — it holds position with its
      // path still queued, so repairs (or simply the path being reissued)
      // would resume it rather than silently dropping the order.
      if (speed <= 0) return { ...p, hopFrom: p.node, hopStartSimDays: simDays, hopArrivalSimDays: simDays }
      const seconds = traversalSeconds(p.node, nextNode, density, speed)
      return {
        ...p,
        hopFrom: p.node,
        node: nextNode,
        path: rest,
        hopStartSimDays: simDays,
        hopArrivalSimDays: simDays + simSecondsToDays(seconds),
      }
    })

    // --- Shield regeneration, before firing, so a shot this step meets the
    // regenerated value. Armor deliberately does not regenerate. ---
    for (const p of moved) {
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

    // --- Firing. ---
    const nextParticipants: CombatParticipant[] = moved.map((p) => {
      const ship = shipsById.get(p.shipId)!
      const profile = shipCombatProfile(ship)
      const state = stateOf(p.shipId)
      if (!profile || !state || profile.weapons.length === 0) return p

      // A ship spooling a drive has diverted everything to the charge and
      // cannot fire — the core trade the escape mechanic is built on.
      if (ship.combat.ftlCharge) return p

      const effectiveness = weaponsEffectiveness(state.componentHp.weapons, profile.components.weapons)
      if (effectiveness <= 0) return p

      const explicit = p.targetShipId ? moved.find((o) => o.shipId === p.targetShipId) : undefined
      // An explicitly chosen target that has died or fled falls back to
      // auto-targeting rather than leaving the ship idle.
      const target = explicit && !destroyed.has(explicit.shipId) ? explicit : nearestEnemy(p, moved, density)
      if (!target) return p

      const targetState = stateOf(target.shipId)
      const targetShip = shipsById.get(target.shipId)
      const targetProfile = targetShip ? shipCombatProfile(targetShip) : null
      if (!targetState || !targetProfile) return p

      const selfPos = participantArenaPosition(p, density, simDays)
      const targetPos = participantArenaPosition(target, density, simDays)
      const separation = selfPos.distanceTo(targetPos)

      // A celestial body between the two ships stops every shot, at any
      // range. Checked once per firing ship rather than per mount, since
      // line of fire is a property of the geometry, not of the weapon.
      if (!hasLineOfFire(selfPos, targetPos, engagement.obstacles, density)) return p

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
    // already there so they don't spawn on an occupied node.
    const perSideCount: Record<number, number> = { 0: 0, 1: 0 }
    for (const p of priorById.values()) perSideCount[p.side]++

    const participants: CombatParticipant[] = combatants.map((ship) => {
      const kept = priorById.get(ship.id)
      if (kept) return kept
      const side = sideFor(ship.allegiance)
      const node = startingNode(side, perSideCount[side]++, density)
      const profile = shipCombatProfile(ship)
      return {
        shipId: ship.id,
        side,
        node,
        hopFrom: node,
        hopStartSimDays: simDays,
        hopArrivalSimDays: simDays,
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
            center: arenaCenterNode(density),
            // Whatever the fleets are orbiting is physically present in the
            // arena, sitting between them at the start.
            obstacles: obstaclesForLocation(combatants[0].location, density),
            participants,
            resolvedThroughSimDays: simDays,
          },
    )
  }

  return result
}

// Queues a lattice move for one participant. Exposed here (rather than as a
// store action) so the path is computed by the same pure layer that consumes
// it, and so the caller can't queue a path the arena wouldn't accept.
export function orderParticipantTo(
  participant: CombatParticipant,
  destination: GridNode,
  density: GridDensity,
  simDays: number,
  obstacles: CombatObstacle[] = [],
): CombatParticipant {
  if (nodesEqual(participant.node, destination)) return participant
  const path = latticePath(participant.node, destination, density, {
    obstacles,
    clearance: OBSTACLE_CLEARANCE_UNITS,
  })
  // No route (destination inside a body, or unreachable within this window) —
  // the order is simply refused rather than flying the ship through it.
  if (path.length === 0) return participant
  // The current hop is abandoned in place: the ship is treated as being at
  // its current node and re-paths from there. Simpler than finishing the hop
  // first, and matches the "orders take effect now" feel of the strategic
  // layer's redirects.
  return {
    ...participant,
    hopFrom: participant.node,
    hopStartSimDays: simDays,
    hopArrivalSimDays: simDays,
    path,
  }
}

// Whether a ship is currently pinned in a fight — used to decide whether a
// move order becomes a normal order or an FTL escape charge.
export function findEngagementFor(engagements: Engagement[], shipId: string): Engagement | null {
  return engagements.find((e) => e.participants.some((p) => p.shipId === shipId)) ?? null
}
