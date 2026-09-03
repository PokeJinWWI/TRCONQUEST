import { Vector3 } from 'three'
import type { ShipInstance, ShipLocation, MoveDestination, MoveOrder, FtlCharge } from '../state/shipStore'
import { useCombatStore, combatLocationKey } from '../state/combatStore'
import { findEngagementFor, planFtlCharge } from './combatResolution'
import {
  HYPERDRIVE_BASE_LOSS_CHANCE,
  HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE,
  type WarpDrive,
  type HyperDrive,
  type ShipClass,
} from '../data/shipData'
import { resolveShipClass } from '../state/shipClassResolver'
import { ACTIVE_ENGAGEMENT_RISK_BONUS, WARP_BASE_ESCAPE_LOSS_CHANCE, coreDamageRiskBonus } from '../data/combatData'
import { PLANETS, PLANETS_BY_STAR, getPlanetsForStar, UNITS_PER_AU, AU_IN_KM, type PlanetData } from './planetData'
import { getPlanetPosition, getOrbitPosition, angleForYear, MOON_TIME_DILATION } from './orbitMath'
import type { MoonData } from './moonData'
import { STARS, UNITS_PER_LY, starScenePosition, getSystemStars, findSystemStar, type StarComponent } from '../data/starData'
import { DAYS_PER_YEAR, formatDate, simDaysToDate, useGameTimeStore } from '../state/gameTimeStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { usePlayerStore } from '../state/playerStore'
import { useTechStore } from '../state/techStore'

export const SOL_SYSTEM_ID = 'sol'
export const SOL_BODY_NAME = 'Sol'

export const SPEED_OF_LIGHT_KM_S = 299_792.458
const SECONDS_PER_DAY = 86_400
// A light-year, derived the same way as everywhere else in this project:
// real constants multiplied together, not a looked-up approximation.
export const LY_IN_KM = SPEED_OF_LIGHT_KM_S * SECONDS_PER_DAY * DAYS_PER_YEAR

export const KM_PER_SYSTEM_UNIT = AU_IN_KM / UNITS_PER_AU
export const KM_PER_INTERSTELLAR_UNIT = LY_IN_KM / UNITS_PER_LY

// "Normal thrusters" — a modest, deliberately unglamorous sublight cruise
// speed (~0.01c). Real enough to be meaningfully slow at real distances
// (weeks to cross a system, millennia between stars) without pretending
// precision this project has no propulsion tech-tree to back up yet — see
// Context.md's Design Decisions for the reasoning.
export const REACTION_DRIVE_SPEED_KM_S = 3_000

// --- System-scale gravity, for unpowered hulls -------------------------------
//
// Unlike the combat arena — whose body radii are fourth-root compressed and
// which therefore has NO consistent km-per-unit scale (see combatArena's
// arenaBodyRadius) — system view IS true-to-scale: planetData applies one
// AU->units factor to orbital distances and body radii alike. That means real
// gravity can be computed honestly here, with no invented anchor constant of
// the kind the arena needs. (Reuses KM_PER_SYSTEM_UNIT, already defined above
// for travel-time math — same conversion, same reason.)
// Newton's constant in km^3 kg^-1 s^-2 (the SI value scaled by 1e-9, since
// 1 m^3 = 1e-9 km^3) — keeps everything below in the km/s the rest of this
// file already works in.
const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.6743e-20

// Net gravitational acceleration at a system-space point, in system units per
// sim-day squared (the units drift integration works in — see
// useShipDriftIntegrator). Sums the star and every planet; each planet's
// position is live, so a drifting hull is pulled by where the planets
// actually are at that moment, not where they started.
// `starId` scopes which system's star + planets actually pull — defaults to
// Sol so every call site written before other systems had any data keeps
// behaving exactly as before. Every system renders in its own star-at-origin
// local frame (see starData.ts/planetData.ts), so a position in one system
// must never be summed against another system's bodies — their coordinates
// are only numerically comparable within the same system.
export function systemGravityAcceleration(position: Vector3, simDays: number, starId: string = SOL_SYSTEM_ID): Vector3 {
  const total = new Vector3()
  const pull = (bodyPosition: Vector3, massKg: number) => {
    const toBody = bodyPosition.clone().sub(position)
    const distanceUnits = toBody.length()
    if (distanceUnits < 1e-12) return
    const distanceKm = distanceUnits * KM_PER_SYSTEM_UNIT
    const accelKmPerS2 = (GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * massKg) / (distanceKm * distanceKm)
    // km/s^2 -> system units/day^2.
    const accelUnitsPerDay2 = (accelKmPerS2 * SECONDS_PER_DAY * SECONDS_PER_DAY) / KM_PER_SYSTEM_UNIT
    total.add(toBody.normalize().multiplyScalar(accelUnitsPerDay2))
  }

  // Every star in the system pulls from its own position — one at the origin
  // for a single-star system, several at their offsets for a multi-star one
  // (see getSystemStars).
  for (const star of getSystemStars(starId)) pull(systemStarOffset(star), star.massKg)
  for (const planet of getPlanetsForStar(starId)) pull(bodyLivePosition(planet.name, simDays), planet.massKg)
  return total
}

// A body's own velocity through system space, in units per sim-day, by
// finite-differencing its live position. Central-differenced so it's accurate
// to second order rather than lagging half a step.
//
// This exists so a hull stranded near a body inherits that body's motion. A
// ship orbiting Earth is ALSO traveling with Earth around the Sun at roughly
// 0.34 units/day; seeding a drifting wreck at rest in the heliocentric frame
// instead makes it drop the Sun-ward velocity it actually had, and it spirals
// into Sol over a couple of months. Verified: a hull stranded 0.02 units from
// Earth at heliocentric rest struck Sol after 64 sim-days rather than staying
// anywhere near Earth. Inheriting the body's velocity keeps the local physics
// local — Earth's pull dominates at that range, so the wreck falls toward
// Earth or loops around it, which is the behavior that reads correctly.
const ORBIT_VELOCITY_SAMPLE_DAYS = 0.01

export function bodyOrbitalVelocity(bodyName: string, simDays: number): Vector3 {
  const ahead = bodyLivePosition(bodyName, simDays + ORBIT_VELOCITY_SAMPLE_DAYS)
  const behind = bodyLivePosition(bodyName, simDays - ORBIT_VELOCITY_SAMPLE_DAYS)
  return ahead.sub(behind).divideScalar(2 * ORBIT_VELOCITY_SAMPLE_DAYS)
}

// Whether a system-space point lies inside a body's real surface — the
// collision test for a drifting hull. Uses each body's true-to-scale rendered
// radius, so "it fell into the sun" means exactly what it looks like on the
// map.
export function systemBodyContaining(position: Vector3, simDays: number, starId: string = SOL_SYSTEM_ID): string | null {
  // Each star at its own position, radius from its real km (same AU->units
  // ratio SUN_RADIUS is built from, generalized since component stars differ
  // in size — a white dwarf is Earth-sized, a giant is huge).
  for (const star of getSystemStars(starId)) {
    const starRadiusUnits = (star.radiusKm / AU_IN_KM) * UNITS_PER_AU
    if (systemStarOffset(star).distanceTo(position) <= starRadiusUnits) return star.name
  }
  for (const planet of getPlanetsForStar(starId)) {
    if (bodyLivePosition(planet.name, simDays).distanceTo(position) <= planet.radius) return planet.name
  }
  return null
}

export function warpSpeedKmS(speedC: number): number {
  return speedC * SPEED_OF_LIGHT_KM_S
}

export interface ShipRenderInfo {
  space: 'system' | 'interstellar'
  systemId?: string
  position: Vector3
}

// Every planet across every system, searched by name — safe because
// planet/dwarf-planet names are unique game-wide by construction (see
// planetData.ts), so this needs no starId to disambiguate. Each planet's
// position is already expressed in its own system's local star-at-origin
// frame (see getPlanetPosition), which is exactly the frame a caller already
// operating within that same system wants.
function findPlanetByName(bodyName: string): PlanetData | undefined {
  for (const planets of Object.values(PLANETS_BY_STAR)) {
    const found = planets.find((p) => p.name === bodyName)
    if (found) return found
  }
  return undefined
}

// A component star's scene-unit position within its own system (barycenter at
// origin). Zero for a single-star system, offset for a multi-star one — see
// starData's StarComponent.offsetAU.
export function systemStarOffset(star: StarComponent): Vector3 {
  return new Vector3(star.offsetAU[0] * UNITS_PER_AU, 0, star.offsetAU[1] * UNITS_PER_AU)
}

export function bodyLivePosition(bodyName: string, simDays: number): Vector3 {
  // A star sits at its own position in its system's local frame — the
  // barycenter (origin) in a single-star system, an offset in a multi-star
  // one. findSystemStar covers both (single-star systems synthesize one star
  // at [0,0]), so this correctly handles a ship resting at any star.
  const star = findSystemStar(bodyName)
  if (star) return systemStarOffset(star)
  const planet = findPlanetByName(bodyName)
  if (!planet) return new Vector3(0, 0, 0)
  return getPlanetPosition(planet, simDays / DAYS_PER_YEAR)
}

function starPosition(starId: string): Vector3 {
  const star = STARS.find((s) => s.id === starId)
  return star ? new Vector3(...starScenePosition(star)) : new Vector3(0, 0, 0)
}

export function systemDisplayName(systemId: string): string {
  return STARS.find((s) => s.id === systemId)?.name ?? systemId
}

// Which system a ship currently belongs to, if any — null while it's out in
// interstellar space (traveling between stars, or resting at/near one).
// Derived purely from the ship's static order/location fields, not simDays,
// so callers can memoize on `ships` alone (membership only changes at
// order-issue/order-complete, both discrete store writes) — same reasoning
// as InterstellarScene's isShipInInterstellarSpace, just the complementary
// case. Used to figure out which star should show an interstellar-view
// presence badge for a fleet that's nested inside its system (see
// InterstellarScene) and, previously duplicated inline, which ships belong
// in SolarSystemScene.
export function shipSystemId(ship: Pick<ShipInstance, 'order' | 'location'>): string | null {
  if (ship.order) return ship.order.space === 'system' ? ship.order.systemId ?? null : null
  const { location } = ship
  if (location.kind === 'orbiting' || location.kind === 'system-point') return location.systemId
  return null
}

// One visible marker per fleet resting at a shared spot, not one per ship —
// see ShipInstance.fleetId. Grouped by fleet AND location together, not
// fleet alone: a fleet whose members have drifted apart (one pulled off on
// its own order that hasn't resettled yet) must not visually merge into a
// single marker just because they still share a fleetId — shipStore already
// guarantees ships sharing BOTH a fleetId and a rest location are actually
// together, so this key is exactly what makes that guarantee visible. A ship
// still under an order, or resting at a bare point in space rather than a
// named anchor (combatLocationKey returns null there), is never grouped —
// it always renders as its own single-ship cluster, same as every ship did
// before fleets existed.
export interface FleetCluster {
  key: string
  fleetId: string
  ships: ShipInstance[]
}

export function clusterRestingShipsByFleet(ships: ShipInstance[]): FleetCluster[] {
  const groups = new Map<string, ShipInstance[]>()
  for (const ship of ships) {
    const key = ship.order ? null : combatLocationKey(ship.location)
    const groupKey = key ? `${ship.fleetId}::${key}` : `solo::${ship.id}`
    const arr = groups.get(groupKey) ?? []
    arr.push(ship)
    groups.set(groupKey, arr)
  }
  return Array.from(groups.entries()).map(([key, ships]) => ({ key, fleetId: ships[0].fleetId, ships }))
}

// A deterministic angle from a ship's id, in [0, 2π) — the shared basis for
// every "nudge this ship a bit off-center, consistently" placement below.
// Hashing the id (instead of e.g. spawn order) keeps it stable across
// re-renders without needing extra state, and spreads multiple ships around
// the same body instead of stacking them exactly on top of each other.
function hashAngleRad(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return (hash % 360) * (Math.PI / 180)
}

// Same idea, but for a ship's stored resting-at-a-star offset (interstellar
// scale) — used whenever a ship settles at (or hyperdrive-jumps to) a star,
// so it renders visibly beside the star's own marker instead of exactly on
// top of it, indistinguishable from it. Unlike 'orbiting' (see below), a
// ship resting at a star doesn't orbit it — no satellite view exists for a
// star, so there's no second scale this position ever needs to translate
// into, and a static nudge is enough.
const RESTING_OFFSET_RADIUS = 0.6

function restingOffset(shipId: string): [number, number, number] {
  const angle = hashAngleRad(shipId)
  return [Math.cos(angle) * RESTING_OFFSET_RADIUS, 0, Math.sin(angle) * RESTING_OFFSET_RADIUS]
}

// Default orbital motion for a ship resting in orbit around a body — an
// arbitrary but fixed "close orbit" rate, not derived from any real distance
// the way a moon's period is (ships aren't real astronomical bodies with a
// canonical altitude) — same "pick a legible default, not a literal one"
// spirit as orbitMath's MOON_TIME_DILATION. Picked to read as comparably
// paced to a moon's own *apparent* motion, not dramatically faster — Phobos,
// the fastest-apparent moon in this project's roster, works out to
// `0.319 * MOON_TIME_DILATION` ≈ 19.1 apparent days (see moonData.ts/
// orbitMath.ts); 20 sits right at that pace rather than the ~5x-faster
// default this constant used to be. A flat circular orbit by default (no
// inclination) — nonzero inclination only happens via a synced orbit (see
// oppositeMoonSyncOrbit below), not a fresh arrival.
export const DEFAULT_SHIP_ORBIT_PERIOD_DAYS = 20
// How far out a resting ship's marker orbits its body, in *system view's*
// own scale — real planet radii are near sub-pixel at true AU scale (Earth's
// is ~0.00085 scene units), so this is picked to read as a visible "close
// orbit" when zoomed into any specific planet, not derived from any
// particular body's actual size. Satellite view uses its own, unrelated
// constant (see SatelliteViewScene's PRIMARY_VISUAL_RADIUS + 1.2) — the two
// scales share nothing but the underlying angular motion (periodDays/
// phaseDeg), which is why only those are stored on ShipLocation itself.
export const SYSTEM_SHIP_ORBIT_RADIUS = 0.15

// How long a ship resting in a body's gravity well must spend on reaction
// drive alone before a warp drive can fire, scaled by that specific body's
// actual gravity — real mass/radius data (see planetData.ts/starData.ts) in,
// a heuristic *time* out, same "real constants, legible game-time mapping"
// approach as REACTION_DRIVE_SPEED_KM_S/LY_IN_KM above. Escape velocity
// (not surface gravity) is the physically apt quantity for "how hard is
// this body's well to climb out of" — computed at each body's own surface,
// even though a resting ship's orbit radius is itself a fictional visual
// constant (SYSTEM_SHIP_ORBIT_RADIUS): the body's surface escape velocity is
// a fixed, real property of the body alone, independent of where exactly a
// ship happens to be drawn orbiting it.
const GRAVITATIONAL_CONSTANT = 6.674e-11 // m^3 kg^-1 s^-2

function escapeVelocityKmS(massKg: number, radiusKm: number): number {
  return Math.sqrt((2 * GRAVITATIONAL_CONSTANT * massKg) / (radiusKm * 1000)) / 1000
}

const EARTH = PLANETS.find((p) => p.name === 'Earth')!
const EARTH_ESCAPE_VELOCITY_KM_S = escapeVelocityKmS(EARTH.massKg, EARTH.radiusKm)

// Earth-equivalent-gravity baseline (in days) that the ratio above scales —
// picked, not derived, same "legible default" spirit as
// SYSTEM_SHIP_ORBIT_RADIUS/MOON_TIME_DILATION; only the *ratio* between
// bodies is physically grounded, this anchor point is not.
const EARTH_GRAVITY_WELL_ESCAPE_DAYS = 1

function gravityWellEscapeDays(massKg: number, radiusKm: number): number {
  return EARTH_GRAVITY_WELL_ESCAPE_DAYS * (escapeVelocityKmS(massKg, radiusKm) / EARTH_ESCAPE_VELOCITY_KM_S)
}

// The real body (mass/radius) whose gravity well a resting ship is currently
// inside, if any — 'orbiting' (a planet, or Sol itself as a system-view
// body) and 'star' (resting beside any star, interstellar-scale) both count;
// a ship resting at a bare system/interstellar point isn't inside anything's
// well. Returns null for a body/star this project doesn't have real data
// for (shouldn't happen given every entry in PLANETS/STARS has massKg/
// radiusKm, but keeps this total rather than throwing).
function gravityWellBody(location: ShipLocation): { massKg: number; radiusKm: number } | null {
  if (location.kind === 'orbiting') {
    const star = findSystemStar(location.bodyName)
    if (star) return { massKg: star.massKg, radiusKm: star.radiusKm }
    const planet = findPlanetByName(location.bodyName)
    return planet ? { massKg: planet.massKg, radiusKm: planet.radiusKm } : null
  }
  if (location.kind === 'star') {
    const star = STARS.find((s) => s.id === location.starId)
    return star ? { massKg: star.massKg, radiusKm: star.radiusKm } : null
  }
  return null
}

// A circular orbit offset for a ship — reuses the same angle-from-time and
// flat-circle math planets/moons already use (orbitMath.ts), just with the
// radius supplied directly instead of being read from PlanetData/MoonData,
// since a ship's orbit radius is a per-view rendering constant, not stored
// ship state (see ShipLocation's 'orbiting' comment).
function shipOrbitOffset(radius: number, periodDays: number, phaseDeg: number, inclinationDeg: number, simDays: number): Vector3 {
  const angle = angleForYear(simDays / DAYS_PER_YEAR, periodDays / DAYS_PER_YEAR, (phaseDeg * Math.PI) / 180)
  return getOrbitPosition(radius, angle, inclinationDeg, 0)
}

// A ship resting in orbit around the body a satellite view is currently
// showing — same underlying orbital motion (periodDays/phaseDeg/
// inclinationDeg) as system view's own rendering of the same ship, just at
// this view's local hologram-visual-radius scale instead of system view's
// AU-derived one.
export function satelliteOrbitLocalPosition(
  location: { periodDays: number; phaseDeg: number; inclinationDeg: number },
  primaryVisualRadius: number,
  simDays: number,
): [number, number, number] {
  const v = shipOrbitOffset(primaryVisualRadius + 1.2, location.periodDays, location.phaseDeg, location.inclinationDeg, simDays)
  return [v.x, v.y, v.z]
}

function resolveLocation(location: ShipLocation, simDays: number): ShipRenderInfo {
  switch (location.kind) {
    case 'orbiting': {
      const base = bodyLivePosition(location.bodyName, simDays)
      base.add(shipOrbitOffset(SYSTEM_SHIP_ORBIT_RADIUS, location.periodDays, location.phaseDeg, location.inclinationDeg, simDays))
      return { space: 'system', systemId: location.systemId, position: base }
    }
    case 'system-point':
      return { space: 'system', systemId: location.systemId, position: new Vector3(...location.position) }
    case 'star': {
      const base = starPosition(location.starId)
      base.add(new Vector3(...location.offset))
      return { space: 'interstellar', position: base }
    }
    case 'interstellar-point':
      return { space: 'interstellar', position: new Vector3(...location.position) }
  }
}

function resolveDestination(destination: MoveDestination, simDays: number): ShipRenderInfo {
  switch (destination.kind) {
    case 'body':
      return { space: 'system', systemId: destination.systemId, position: bodyLivePosition(destination.bodyName, simDays) }
    case 'point':
      return { space: 'system', systemId: destination.systemId, position: new Vector3(...destination.position) }
    case 'star':
      return { space: 'interstellar', position: starPosition(destination.starId) }
    case 'interstellar-point':
      return { space: 'interstellar', position: new Vector3(...destination.position) }
  }
}

// A position's real anchor point in interstellar space: itself if it's
// already out there, or its own system's star if it's inside a system — the
// AU-scale distance from anywhere within a system out to that system's own
// star is negligible next to light-year interstellar distances (see
// Context.md), so a cross-space order treats that in-system leg as free at
// both ends and spends its actual travel time solely on the interstellar leg
// between the two *real* anchor points. Applying this symmetrically to both
// the departure and arrival sides (see planMove) is what fixes a real bug: a
// ship resting at, say, Alpha Centauri ordered to a body in the Sol system
// used to have its start position collapsed straight to Sol's own origin —
// silently discarding the entire interstellar leg it actually needs to make
// first, instead of just the (correctly negligible) in-system hop at the end.
function interstellarAnchor(info: ShipRenderInfo): Vector3 {
  return info.space === 'interstellar' ? info.position.clone() : starPosition(info.systemId ?? SOL_SYSTEM_ID)
}

// A ship's current on-screen position — always derived from its order (if
// traveling) or its resting location, never accumulated per-frame state.
// Same "pure function of simDays" approach as getPlanetPosition/getMoonPosition.
export function getShipRenderPosition(ship: ShipInstance, simDays: number): ShipRenderInfo {
  if (ship.order) {
    const { departSimDays, arrivalSimDays, startPosition, endPosition, space, systemId, warpEngageSimDays, warpEngageFraction } =
      ship.order
    let fraction: number
    if (warpEngageSimDays !== undefined && warpEngageFraction !== undefined) {
      // Two-phase order (reaction drive, then warp) — each phase moves at a
      // very different rate, so distance covered isn't linear in time
      // across the whole trip the way a single-speed order's is. Interpolate
      // each phase on its own local timeline instead.
      if (simDays < warpEngageSimDays) {
        const phase1Span = warpEngageSimDays - departSimDays
        const t = phase1Span <= 0 ? 1 : Math.min(1, Math.max(0, (simDays - departSimDays) / phase1Span))
        fraction = warpEngageFraction * t
      } else {
        const phase2Span = arrivalSimDays - warpEngageSimDays
        const t = phase2Span <= 0 ? 1 : Math.min(1, Math.max(0, (simDays - warpEngageSimDays) / phase2Span))
        fraction = warpEngageFraction + (1 - warpEngageFraction) * t
      }
    } else {
      const span = arrivalSimDays - departSimDays
      fraction = span <= 0 ? 1 : Math.min(1, Math.max(0, (simDays - departSimDays) / span))
    }
    const position = new Vector3(...startPosition).lerp(new Vector3(...endPosition), fraction)
    return { space, systemId, position }
  }
  return resolveLocation(ship.location, simDays)
}

function destinationLabel(destination: MoveDestination): string {
  switch (destination.kind) {
    case 'body':
      return destination.bodyName
    case 'point':
      return 'a point in space'
    case 'star':
      return STARS.find((s) => s.id === destination.starId)?.name ?? destination.starId
    case 'interstellar-point':
      return 'deep space'
  }
}

// Days remaining before a drive is usable again — 0 once ready (never
// negative), so callers can treat "0" and "ready" interchangeably without a
// separate check.
export function hyperdriveCooldownRemainingDays(ship: ShipInstance, simDays: number): number {
  return Math.max(0, ship.hyperdriveReadySimDays - simDays)
}

export function warpCooldownRemainingDays(ship: ShipInstance, simDays: number): number {
  return Math.max(0, ship.warpReadySimDays - simDays)
}

// The ship's "Current Action" line (ShipPanel) — one short, human-readable
// summary of what it's doing right now: traveling (and how), waiting on a
// queued jump, resting somewhere, or following another ship. `ships`, when
// supplied, is only used to look up a followed ship's *name* for the
// "Following X — " prefix — omit it (e.g. a call site with no ships list
// handy) and the rest of the status still renders correctly, just without
// that prefix.
export function getShipStatusText(ship: ShipInstance, simDays: number, ships?: ShipInstance[]): string {
  const leaderName = ship.followingShipId ? ships?.find((s) => s.id === ship.followingShipId)?.name : undefined
  const prefix = leaderName ? `Following ${leaderName} — ` : ''

  if (ship.order) {
    if (simDays >= ship.order.arrivalSimDays) return `${prefix}Arriving…`
    const destLabel = destinationLabel(ship.order.destination)
    const { gravityWellClearSimDays, warpEngageSimDays } = ship.order
    // Two distinct "not warping yet" reasons get distinct status text — a
    // mandatory gravity-well escape reads differently than just waiting out
    // a cooldown (see planMove) — even though both resolve to the same
    // reaction-drive-then-warp mechanics underneath.
    if (gravityWellClearSimDays !== undefined && simDays < gravityWellClearSimDays) {
      return `${prefix}Leaving gravity well — reaction drive (warp in ${(gravityWellClearSimDays - simDays).toFixed(1)}d)`
    }
    if (warpEngageSimDays !== undefined && simDays < warpEngageSimDays) {
      return `${prefix}En route to ${destLabel} — reaction drive (warp in ${(warpEngageSimDays - simDays).toFixed(1)}d)`
    }
    const eta = formatDate(simDaysToDate(ship.order.arrivalSimDays))
    return `${prefix}En route to ${destLabel} — ETA ${eta}`
  }
  // "Jump when ready" — the player ordered a hyperdrive jump while it
  // couldn't fire yet (still on cooldown, or the game is paused — see
  // planMove/useShipOrderSettler); queued instead of refused, so the ship is
  // meaningfully "doing something," not just idle, until it actually fires.
  // Paused gets its own distinct wording rather than a numeric "0.0d" —
  // remaining cooldown isn't counting down while paused, so showing it would
  // read as "about to fire any second" when actually nothing will happen
  // until the player resumes time.
  if (ship.pendingHyperdriveJump) {
    const star = STARS.find((s) => s.id === ship.pendingHyperdriveJump)
    const starName = star?.name ?? ship.pendingHyperdriveJump
    if (useGameTimeStore.getState().paused) {
      return `${prefix}Jump to ${starName} queued — resume time to jump`
    }
    const remaining = hyperdriveCooldownRemainingDays(ship, simDays)
    return `${prefix}Hyperdrive charging — jump to ${starName} queued (${remaining.toFixed(1)}d)`
  }
  const location = ship.location
  switch (location.kind) {
    case 'orbiting':
      return `${prefix}In ${systemDisplayName(location.systemId)} System, orbiting ${location.bodyName}`
    case 'system-point':
      return `${prefix}In ${systemDisplayName(location.systemId)} System, Deep Space`
    case 'star': {
      const star = STARS.find((s) => s.id === location.starId)
      if (!star) return `${prefix}In Deep Space`
      return star.hasSystemData ? `${prefix}In ${star.name} System` : `${prefix}At ${star.name}`
    }
    case 'interstellar-point':
      return `${prefix}In Deep Space`
  }
}

// Shared by both resolveArrivalLocation's 'body' case and its 'star' case
// (when the star has its own system) — a resting ship orbiting a body,
// whether that body is a planet or the system's own star, is described
// identically: which system, which body's live position to track, and a
// starting orbital phase seeded from the ship's own id so multiple arrivals
// at the same body don't all line up identically (see hashAngleRad). `sync`
// overrides that default fresh-arrival motion entirely — see
// MoveDestination's 'body'.syncOrbit / oppositeMoonSyncOrbit.
function orbitingLocation(
  systemId: string,
  bodyName: string,
  shipId: string,
  sync?: { periodDays: number; phaseDeg: number; inclinationDeg: number },
): ShipLocation {
  return {
    kind: 'orbiting',
    systemId,
    bodyName,
    periodDays: sync?.periodDays ?? DEFAULT_SHIP_ORBIT_PERIOD_DAYS,
    phaseDeg: sync?.phaseDeg ?? (hashAngleRad(shipId) * 180) / Math.PI,
    inclinationDeg: sync?.inclinationDeg ?? 0,
  }
}

// The synced period/phase/inclination for entering orbit on the exact
// opposite side of a moon's parent body from that moon — matching its
// period (so the two stay antipodal forever, not just at the moment the
// order was given) and its inclination (so they stay coplanar, not just
// angularly opposite while drifting apart in 3D over one tilted orbit vs.
// the other's flat one). `periodDays` reuses the moon's real period scaled
// by the same MOON_TIME_DILATION its own on-screen motion already uses
// (orbitMath.ts) — matching the moon's *apparent* rate, not its real one —
// negated for a retrograde moon (e.g. Triton): `angleForYear` computes angle
// as `phase + (t/period)*2π`, so flipping period's sign flips the sign of
// angle's rate of change over time exactly the way getMoonPosition's own
// `simYears * direction` trick does, with no other code needing to know
// about direction at all.
export function oppositeMoonSyncOrbit(moon: MoonData): { periodDays: number; phaseDeg: number; inclinationDeg: number } {
  return {
    periodDays: moon.periodDays * MOON_TIME_DILATION * (moon.retrograde ? -1 : 1),
    phaseDeg: (moon.phaseDeg + 180) % 360,
    inclinationDeg: moon.inclinationDeg,
  }
}

// Converts an order's destination into the resting ShipLocation it settles
// into on arrival — called once travel time has elapsed (see ShipMarker's
// useFrame, which is what actually notices and calls setShipLocation).
// `shipId` seeds the 'body' case's starting orbital phase (see hashAngleRad)
// and the 'star' case's resting offset (see restingOffset), so multiple
// ships arriving at the same body/star don't all line up identically.
export function resolveArrivalLocation(destination: MoveDestination, shipId: string): ShipLocation {
  switch (destination.kind) {
    case 'body':
      return orbitingLocation(destination.systemId, destination.bodyName, shipId, destination.syncOrbit)
    case 'point':
      return { kind: 'system-point', systemId: destination.systemId, position: destination.position }
    case 'star': {
      // A star with its own system is a place ships actually enter and
      // orbit, same as any planet — the whole point of ordering a ship
      // there from interstellar view is to see it settle into that system,
      // not hover beside the star at interstellar scale forever. A star
      // with no system data yet has nothing to orbit *into*, so it keeps
      // the old "rest visibly beside it" behavior.
      const star = STARS.find((s) => s.id === destination.starId)
      // Orbit a REAL star in the system — the system's primary component,
      // which is the system itself in a single-star system and the dominant
      // star (e.g. Rigil Kentaurus) in a multi-star one. Using the system's
      // display name ('Alpha Centauri') would name a body that isn't an
      // orbitable star, so this always lands on an actual component.
      if (star?.hasSystemData) {
        const primary = getSystemStars(star.id)[0]
        return orbitingLocation(star.id, primary?.name ?? star.name, shipId)
      }
      return { kind: 'star', starId: destination.starId, offset: restingOffset(shipId) }
    }
    case 'interstellar-point':
      return { kind: 'interstellar-point', position: destination.position }
  }
}

// The inverse of resolveArrivalLocation — a resting ship's current location
// re-expressed as the MoveDestination that would land a ship there. Used
// only for "follow" (see ShipInstance.followingShipId / useShipOrderSettler):
// a follower re-targets whatever destination its leader is *currently*
// ordered to, or, if the leader itself is at rest, wherever it's currently
// resting — this is how that second case gets expressed as a destination.
export function restingDestinationOf(location: ShipLocation): MoveDestination {
  switch (location.kind) {
    case 'orbiting':
      return { kind: 'body', systemId: location.systemId, bodyName: location.bodyName }
    case 'system-point':
      return { kind: 'point', systemId: location.systemId, position: location.position }
    case 'star':
      return { kind: 'star', starId: location.starId }
    case 'interstellar-point':
      return { kind: 'interstellar-point', position: location.position }
  }
}

function destinationKey(d: MoveDestination): string {
  switch (d.kind) {
    case 'body':
      return `body:${d.systemId}:${d.bodyName}:${d.syncOrbit ? `${d.syncOrbit.periodDays},${d.syncOrbit.phaseDeg},${d.syncOrbit.inclinationDeg}` : ''}`
    case 'point':
      return `point:${d.systemId}:${d.position.join(',')}`
    case 'star':
      return `star:${d.starId}`
    case 'interstellar-point':
      return `ipoint:${d.position.join(',')}`
  }
}

// Whether two destinations describe the same target — used by the follow
// mechanism to decide whether a leader's intended destination has actually
// changed since a follower last re-targeted (see useShipOrderSettler),
// rather than blindly reissuing an identical order every tick.
export function destinationsEqual(a: MoveDestination, b: MoveDestination): boolean {
  return destinationKey(a) === destinationKey(b)
}

// Whether `ship` may be given a follow directive targeting `targetShipId` —
// same ownership reasoning as planMove's own "not-owned" gate (only a
// player-owned ship can be commanded at all, following included), plus the
// obvious "can't follow itself."
export function canFollow(ship: ShipInstance, targetShipId: string): boolean {
  return ship.allegiance === 'player' && ship.id !== targetShipId
}

// The warpReadySimDays cooldown update to apply once a completed order that
// used warp settles into its resting location — undefined if the order
// didn't use warp (nothing to update). Re-derives the drive's cooldownDays
// from the ship's class rather than storing it on the order itself, since
// it's already static per-class data available here.
export function warpCooldownAfterArrival(ship: ShipInstance): number | undefined {
  if (!ship.order?.usedWarp) return undefined
  const shipClass = resolveShipClass(ship.classId)
  const warpDrive = shipClass?.ftlDrives.find((d): d is WarpDrive => d.kind === 'warp')
  return warpDrive ? ship.order.arrivalSimDays + warpDrive.cooldownDays : undefined
}

// True while a ship's *current* order is actually mid-warp right now (as
// opposed to still on reaction drive, waiting out a gravity well and/or
// cooldown) — the single question that decides whether redirecting it counts
// as a warp stop-and-start (see planMove). A two-phase order (see
// warpEngageSimDays) hasn't started warping at all until simDays reaches
// that phase boundary.
function isShipCurrentlyWarping(ship: ShipInstance, simDays: number): boolean {
  const order = ship.order
  if (!order || !order.usedWarp) return false
  if (order.warpEngageSimDays === undefined) return true
  return simDays >= order.warpEngageSimDays
}

// A ship's core component HP as a fraction of that hull's max — the input
// every FTL risk figure below scales against. 1 (full health) whenever a
// hull has no combat profile or zero max core, so a total gap here never
// silently reads as "maximally damaged."
export function coreHealthFraction(ship: ShipInstance, shipClass: Pick<ShipClass, 'combat'>): number {
  const max = shipClass.combat.components.core
  if (max <= 0) return 1
  return Math.max(0, Math.min(1, ship.combat.componentHp.core / max))
}

// Chance (0..1) a given hyperdrive jump strands and destroys the ship — see
// HYPERDRIVE_BASE_LOSS_CHANCE/HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE
// (shipData.ts) for why these are named constants, not inlined. A drive's
// own lossChanceOverride (e.g. a Turing Scout's 0) always wins outright,
// regardless of lane state, damage, or combat — that's the whole point of
// that field: the ship's navigational AI makes every jump safe, full stop.
//
// `coreFraction`/`activelyEngaged` layer two independent modifiers on top of
// the base/lane rate (see combatData.ts's coreDamageRiskBonus/
// ACTIVE_ENGAGEMENT_RISK_BONUS for the reasoning behind each). Both default
// to their "no effect" values so every existing call site that doesn't pass
// them keeps behaving exactly as before. `activelyEngaged` is, in practice,
// only ever true from useCombatResolver's FTL-escape path — planMove's own
// hyperdrive branch below is structurally unreachable while a ship is
// actually in an engagement (see planMove's 'engaged' short-circuit), so an
// ordinary jump can never be "actively engaged" by construction.
export function hyperdriveLossChance(
  hyperDrive: HyperDrive,
  laneEstablished: boolean,
  coreFraction = 1,
  activelyEngaged = false,
): number {
  if (hyperDrive.lossChanceOverride !== undefined) return hyperDrive.lossChanceOverride
  const base = laneEstablished ? HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE : HYPERDRIVE_BASE_LOSS_CHANCE
  const modified = base + coreDamageRiskBonus(coreFraction) + (activelyEngaged ? ACTIVE_ENGAGEMENT_RISK_BONUS : 0)
  return Math.max(0, Math.min(1, modified))
}

// The warp equivalent — but unlike hyperdrive, warp has never carried any
// transit risk for an ordinary trip, and this function changes nothing about
// that: it's consulted ONLY at the one new moment that's actually risky, an
// FTL escape charge completing while the ship is (or very recently was)
// fighting — see planMove's warp branch, gated on `riskContext` being
// present at all, and useCombatResolver, the only caller that ever supplies
// one. An ordinary player-issued warp order never calls this.
export function warpEscapeLossChance(coreFraction: number, activelyEngaged: boolean): number {
  const modified = WARP_BASE_ESCAPE_LOSS_CHANCE + coreDamageRiskBonus(coreFraction) + (activelyEngaged ? ACTIVE_ENGAGEMENT_RISK_BONUS : 0)
  return Math.max(0, Math.min(1, modified))
}

// The star id a hyperlane should anchor to on the *departure* side of a jump
// — the system a ship is currently in (system view's systemId doubles as
// that system's own star id, e.g. SOL_SYSTEM_ID === 'sol', the Sol StarData
// entry's own id) if it's inside one, or the star it's resting beside if
// it's out in interstellar space at one. A ship resting at a bare
// system/interstellar point, or currently mid-order anywhere, has no single
// star to anchor a lane to — the jump still proceeds normally in that case
// (the roll still happens), it just can't record a lane afterward, a
// deliberate, documented gap rather than a bug (see Context.md).
function hyperlaneOriginStarId(ship: ShipInstance, simDays: number): string | null {
  const current = getShipRenderPosition(ship, simDays)
  if (current.space === 'system') return current.systemId ?? null
  if (!ship.order && ship.location.kind === 'star') return ship.location.starId
  return null
}

export type MoveResult =
  | { kind: 'order'; order: MoveOrder; warpReadyOverride?: number }
  | {
      kind: 'instant'
      location: ShipLocation
      hyperdriveReadySimDays: number
      // Present only when the jump succeeded *and* the departure side had a
      // known star anchor (see hyperlaneOriginStarId) — the caller (the
      // scene handler or useShipOrderSettler) records this pair via
      // hyperlaneStore.addHyperlane once it applies the rest of the result.
      // planMove itself never writes to that store — same "physics layer
      // computes, caller applies" split every other result kind already
      // follows.
      hyperlaneEstablished?: [string, string]
    }
  | { kind: 'on-cooldown'; readySimDays: number }
  | { kind: 'unknown-class' }
  | { kind: 'not-owned' }
  // The hyperdrive jump was attempted and lost — see hyperdriveLossChance.
  // The ship is gone; the caller removes it from the store (shipStore's
  // removeShip) rather than applying any location/cooldown update.
  | { kind: 'lost-in-hyperspace' }
  // A hyperdrive jump is "instant" — it resolves the moment it's ordered,
  // not over simDays actually advancing the way every other order does. If
  // the clock is paused, nothing else in the game is happening either, so
  // letting a jump fire anyway would be the one thing that keeps moving
  // while everything else is frozen. Same treatment as 'on-cooldown' at
  // every call site — queued (setPendingHyperdriveJump) rather than dropped,
  // firing the instant time resumes (and any real cooldown is also clear —
  // see useShipOrderSettler's firing condition, which checks both).
  | { kind: 'paused' }
  // The ship is pinned in a combat engagement, so it can't simply fly off at
  // reaction drive — the only way out is to spool an FTL drive and survive
  // the charge (see combatResolution.planFtlCharge and ShipInstance's
  // FtlCharge). The caller starts the charge via shipStore.setFtlCharge; the
  // actual move is issued later, by useCombatResolver, once the drive fires.
  // `charge` is null when the ship has no usable drive (or its utility array
  // is wrecked) and therefore genuinely cannot leave.
  | { kind: 'engaged'; charge: FtlCharge | null }

// The single entry point scenes/DebugConsole call to turn "ship X, go to Y"
// into either a continuous MoveOrder (reaction/warp) or an instant hyperdrive
// jump — including picking which drive actually gets used. Also the single
// point of truth for "can this ship be commanded at all": selecting any ship
// (see shipStore.selectShip) is always allowed — players can inspect a
// fleet's info regardless of who it belongs to — but only a player-owned
// ship can actually be issued a move order. Checked here, first, rather than
// at each call site (every scene's right-click handler, DebugConsole) so no
// future caller can accidentally bypass it. Callers already silently ignore
// result kinds they don't handle (see 'on-cooldown'/'unknown-class'), so
// 'not-owned' fits the same pattern with no extra plumbing — the ship's own
// panel is where "not under your command" is actually communicated.
export function planMove(
  ship: ShipInstance,
  destination: MoveDestination,
  simDays: number,
  // Present only when this call is resolving a combat FTL-escape charge (see
  // useCombatResolver) — its mere presence, not just `activelyEngaged`'s
  // value, is what gates the new warp-escape risk roll below, so an
  // ordinary player-issued warp order (which never passes this) can never
  // trigger it, even for a ship with zero core damage and no active target.
  riskContext?: { activelyEngaged: boolean },
): MoveResult {
  if (ship.allegiance !== 'player') return { kind: 'not-owned' }

  const shipClass = resolveShipClass(ship.classId)
  if (!shipClass) return { kind: 'unknown-class' }

  // Checked before any drive logic: a ship in a firefight can't leave by
  // ordinary means at all, so "go here" becomes "charge out to here" rather
  // than a move order. Deliberately placed at this single chokepoint (same
  // reasoning as the ownership check above) so no call site can bypass it and
  // teleport a ship out of a battle. A ship already charging keeps its
  // existing charge rather than restarting the timer — redirecting mid-spool
  // changes only where it ends up, not how long it stays vulnerable.
  if (findEngagementFor(useCombatStore.getState().engagements, ship.id)) {
    const existing = ship.combat.ftlCharge
    return {
      kind: 'engaged',
      charge: existing ? { ...existing, destination } : planFtlCharge(ship, destination, simDays),
    }
  }

  // Warp/Hyperdrive are gated behind Relativity's Warp Theory and
  // Extradimensional's Hyperspace Theory respectively (see techData.ts) —
  // both are seeded already-researched for a fresh country (techStore.ts),
  // so this changes nothing until/unless that seed is ever removed. Reading
  // the player's own tech here (rather than passing it in) is safe because
  // planMove already refused any non-player ship above, so this is always
  // resolving the SAME player whose tech state this is.
  const playerCountryId = usePlayerStore.getState().selectedCountryId ?? ''
  const playerResearched = useTechStore.getState().stateFor(playerCountryId).researched
  const warpDrive = playerResearched.has('warp-theory') ? shipClass.ftlDrives.find((d): d is WarpDrive => d.kind === 'warp') : undefined
  const hyperDrive = playerResearched.has('hyperspace-theory')
    ? shipClass.ftlDrives.find((d): d is HyperDrive => d.kind === 'hyperdrive')
    : undefined

  // Hyperdrive only makes sense for jumping to a charted star (you jump TO
  // somewhere, not into open space) — and only when there's no warp drive to
  // prefer instead (warp is always at least as fast for any real distance).
  if (destination.kind === 'star' && hyperDrive && !warpDrive) {
    if (useGameTimeStore.getState().paused) return { kind: 'paused' }
    if (simDays < ship.hyperdriveReadySimDays) return { kind: 'on-cooldown', readySimDays: ship.hyperdriveReadySimDays }

    const originStarId = hyperlaneOriginStarId(ship, simDays)
    const laneEstablished = originStarId !== null && useHyperlaneStore.getState().hasHyperlane(originStarId, destination.starId)
    const lossChance = hyperdriveLossChance(
      hyperDrive,
      laneEstablished,
      coreHealthFraction(ship, shipClass),
      riskContext?.activelyEngaged ?? false,
    )
    if (Math.random() < lossChance) return { kind: 'lost-in-hyperspace' }

    return {
      kind: 'instant',
      location: resolveArrivalLocation(destination, ship.id),
      hyperdriveReadySimDays: simDays + hyperDrive.cooldownDays,
      hyperlaneEstablished: originStarId !== null ? [originStarId, destination.starId] : undefined,
    }
  }

  const endInfo = resolveDestination(destination, simDays)
  const current = getShipRenderPosition(ship, simDays)
  // Same space already (including "both interstellar," where systemId is
  // undefined on both sides) — no crossing needed, travel directly.
  // Otherwise the order plays out as a single interstellar leg between the
  // two real anchor points (see interstellarAnchor) — the negligible
  // in-system hop at whichever end(s) are inside a system is free, same
  // "system-to-interstellar crossing is instantaneous at the star"
  // simplification this project already uses, just now correctly measuring
  // the real distance between the *actual* departure and arrival stars
  // instead of assuming the ship starts right where it's going.
  const sameSpace = current.space === endInfo.space && current.systemId === endInfo.systemId
  const startVec = sameSpace ? current.position.clone() : interstellarAnchor(current)
  const endVec = sameSpace ? endInfo.position : interstellarAnchor(endInfo)
  const orderSpace: 'system' | 'interstellar' = sameSpace ? endInfo.space : 'interstellar'
  const orderSystemId = sameSpace ? endInfo.systemId : undefined

  const kmPerUnit = orderSpace === 'system' ? KM_PER_SYSTEM_UNIT : KM_PER_INTERSTELLAR_UNIT
  const distanceKm = startVec.distanceTo(endVec) * kmPerUnit
  const reactionOnlyDays = distanceKm / (REACTION_DRIVE_SPEED_KM_S * SECONDS_PER_DAY)
  const reactionOnlyArrivalSimDays = simDays + reactionOnlyDays

  const baseOrder = {
    destination,
    departSimDays: simDays,
    space: orderSpace,
    systemId: orderSystemId,
    startPosition: [startVec.x, startVec.y, startVec.z] as [number, number, number],
    endPosition: [endVec.x, endVec.y, endVec.z] as [number, number, number],
  }

  // Redirecting a ship away from an in-progress warp jump is a stop-and-
  // start, not a free course correction — the drive has to recharge from
  // *now*, exactly as if it had just completed a jump (see
  // warpCooldownAfterArrival). Only an in-progress warp *leg* counts — a
  // redirect during the reaction-drive/leaving-gravity-well portion of an
  // order never actually engaged the drive, so there's nothing to
  // interrupt. Applying this before the checks below means every one of
  // this function's remaining branches (including "warp disabled" and
  // "in a gravity well") already sees the post-penalty cooldown.
  let warpReadySimDays = ship.warpReadySimDays
  let warpReadyOverride: number | undefined
  if (warpDrive && isShipCurrentlyWarping(ship, simDays)) {
    warpReadySimDays = simDays + warpDrive.cooldownDays
    warpReadyOverride = warpReadySimDays
  }

  // Warp is a player-toggleable convenience (see ShipInstance.warpEnabled) —
  // a working drive doesn't mean the player wants *this* trip to use it.
  if (!warpDrive || !ship.warpEnabled) {
    return {
      kind: 'order',
      order: { ...baseOrder, arrivalSimDays: reactionOnlyArrivalSimDays, usedWarp: false },
      warpReadyOverride,
    }
  }

  // A ship at rest in orbit (or beside a star) is inside that body's gravity
  // well — a warp drive can't fire from inside one, so it must first spend a
  // stretch on reaction drive alone clearing it, scaled by that specific
  // body's own real gravity (see gravityWellEscapeDays). A ship already
  // underway (mid-order, any phase) is already out in open space by
  // definition, so this only ever applies to a fresh order issued from rest.
  // If the destination is closer than escape alone would cover, the trip
  // just never gets that far — no gravity-well phase at all, plain reaction
  // drive the whole (short) way.
  const gravityWell = ship.order ? null : gravityWellBody(ship.location)
  const gravityWellEscapeDaysForBody = gravityWell ? gravityWellEscapeDays(gravityWell.massKg, gravityWell.radiusKm) : 0
  const gravityWellClearSimDays =
    gravityWell && simDays + gravityWellEscapeDaysForBody < reactionOnlyArrivalSimDays
      ? simDays + gravityWellEscapeDaysForBody
      : undefined

  // Once clear of any gravity well, warp still can't fire until its own
  // cooldown clears. Unlike the gravity-well wait (always mandatory), a
  // cooldown wait mid-flight only happens if the player opted into it (see
  // ShipInstance.warpWhenReady) — otherwise the trip just rides reaction
  // drive the whole way, the same fallback this project already had before
  // warp ever had a cooldown.
  const readyPoint = gravityWellClearSimDays ?? simDays
  const cooldownWaitNeeded = warpReadySimDays > readyPoint
  const engageSimDays =
    !cooldownWaitNeeded || ship.warpWhenReady ? Math.max(readyPoint, warpReadySimDays) : undefined

  if (engageSimDays === undefined || engageSimDays >= reactionOnlyArrivalSimDays) {
    // Never actually gets to warp on this trip — either it arrives before
    // clearing gravity/cooldown, or the player didn't opt into waiting for
    // the drive mid-flight. gravityWellClearSimDays is kept (even though
    // warp never engages) purely so the status line can still show "leaving
    // gravity well" for that opening stretch.
    return {
      kind: 'order',
      order: { ...baseOrder, arrivalSimDays: reactionOnlyArrivalSimDays, usedWarp: false, gravityWellClearSimDays },
      warpReadyOverride,
    }
  }

  if (engageSimDays <= simDays) {
    // Clear of any gravity well and off cooldown right now — full trip at
    // warp speed, exactly as before this feature existed.
    const travelDays = distanceKm / (warpSpeedKmS(warpDrive.speedC) * SECONDS_PER_DAY)
    // Only ever true when resolving a combat escape (see riskContext's own
    // comment) — an ordinary warp trip skips this block entirely, unchanged
    // from before this mechanic existed.
    if (riskContext) {
      const lossChance = warpEscapeLossChance(coreHealthFraction(ship, shipClass), riskContext.activelyEngaged)
      if (Math.random() < lossChance) return { kind: 'lost-in-hyperspace' }
    }
    return {
      kind: 'order',
      order: { ...baseOrder, arrivalSimDays: simDays + travelDays, usedWarp: true },
      warpReadyOverride,
    }
  }

  // Two-phase trip: reaction drive until engageSimDays, then warp for the
  // remaining distance. warpEngageFraction is the share of *distance* (not
  // time) already covered when warp kicks in — getShipRenderPosition uses
  // it directly instead of re-deriving it from the two very different
  // speeds.
  const phase1Days = engageSimDays - simDays
  const phase1DistanceKm = REACTION_DRIVE_SPEED_KM_S * SECONDS_PER_DAY * phase1Days
  const warpEngageFraction = phase1DistanceKm / distanceKm
  const remainingDistanceKm = distanceKm - phase1DistanceKm
  const phase2Days = remainingDistanceKm / (warpSpeedKmS(warpDrive.speedC) * SECONDS_PER_DAY)

  // Same escape-only gate as the single-phase branch above — this trip also
  // ends up using warp (usedWarp: true below), just after an initial
  // reaction-drive stretch.
  if (riskContext) {
    const lossChance = warpEscapeLossChance(coreHealthFraction(ship, shipClass), riskContext.activelyEngaged)
    if (Math.random() < lossChance) return { kind: 'lost-in-hyperspace' }
  }

  return {
    kind: 'order',
    order: {
      ...baseOrder,
      arrivalSimDays: engageSimDays + phase2Days,
      usedWarp: true,
      warpEngageSimDays: engageSimDays,
      warpEngageFraction,
      gravityWellClearSimDays,
    },
    warpReadyOverride,
  }
}
