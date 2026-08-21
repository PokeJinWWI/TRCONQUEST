import { Vector3 } from 'three'
import type { ShipInstance, ShipLocation, MoveDestination, MoveOrder } from '../state/shipStore'
import { SHIP_CLASSES, type WarpDrive, type HyperDrive } from '../data/shipData'
import { PLANETS, UNITS_PER_AU, AU_IN_KM } from './planetData'
import { getPlanetPosition, getOrbitPosition, angleForYear } from './orbitMath'
import { STARS, UNITS_PER_LY, starScenePosition } from '../data/starData'
import { DAYS_PER_YEAR, formatDate, simDaysToDate } from '../state/gameTimeStore'

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

export function warpSpeedKmS(speedC: number): number {
  return speedC * SPEED_OF_LIGHT_KM_S
}

export interface ShipRenderInfo {
  space: 'system' | 'interstellar'
  systemId?: string
  position: Vector3
}

function bodyLivePosition(bodyName: string, simDays: number): Vector3 {
  if (bodyName === SOL_BODY_NAME) return new Vector3(0, 0, 0)
  const planet = PLANETS.find((p) => p.name === bodyName)
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
// interstellar space (travelling between stars, or resting at/near one).
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
// spirit as orbitMath's MOON_TIME_DILATION. A flat circular orbit (no
// inclination/ascending node — ships don't have a meaningful orbital plane
// to model yet).
export const DEFAULT_SHIP_ORBIT_PERIOD_DAYS = 4
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
// drive alone before a warp drive can fire — a flat, deliberately-not-
// derived-from-real-physics heuristic (same "pick a legible default, not a
// literal one" spirit as SYSTEM_SHIP_ORBIT_RADIUS/MOON_TIME_DILATION), just
// long enough to be a visible "Leaving gravity well" status rather than an
// instantaneous escape.
export const GRAVITY_WELL_ESCAPE_DAYS = 1

// A circular orbit offset for a ship — reuses the same angle-from-time and
// flat-circle math planets/moons already use (orbitMath.ts), just with the
// radius supplied directly instead of being read from PlanetData/MoonData,
// since a ship's orbit radius is a per-view rendering constant, not stored
// ship state (see ShipLocation's 'orbiting' comment).
function shipOrbitOffset(radius: number, periodDays: number, phaseDeg: number, simDays: number): Vector3 {
  const angle = angleForYear(simDays / DAYS_PER_YEAR, periodDays / DAYS_PER_YEAR, (phaseDeg * Math.PI) / 180)
  return getOrbitPosition(radius, angle, 0, 0)
}

// A ship resting in orbit around the body a satellite view is currently
// showing — same underlying orbital motion (periodDays/phaseDeg) as system
// view's own rendering of the same ship, just at this view's local
// hologram-visual-radius scale instead of system view's AU-derived one.
export function satelliteOrbitLocalPosition(
  location: { periodDays: number; phaseDeg: number },
  primaryVisualRadius: number,
  simDays: number,
): [number, number, number] {
  const v = shipOrbitOffset(primaryVisualRadius + 1.2, location.periodDays, location.phaseDeg, simDays)
  return [v.x, v.y, v.z]
}

function resolveLocation(location: ShipLocation, simDays: number): ShipRenderInfo {
  switch (location.kind) {
    case 'orbiting': {
      const base = bodyLivePosition(location.bodyName, simDays)
      base.add(shipOrbitOffset(SYSTEM_SHIP_ORBIT_RADIUS, location.periodDays, location.phaseDeg, simDays))
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
// travelling) or its resting location, never accumulated per-frame state.
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

export function getShipStatusText(ship: ShipInstance, simDays: number): string {
  if (ship.order) {
    if (simDays >= ship.order.arrivalSimDays) return 'Arriving…'
    const destLabel = destinationLabel(ship.order.destination)
    const { gravityWellClearSimDays, warpEngageSimDays } = ship.order
    // Two distinct "not warping yet" reasons get distinct status text — a
    // mandatory gravity-well escape reads differently than just waiting out
    // a cooldown (see planMove) — even though both resolve to the same
    // reaction-drive-then-warp mechanics underneath.
    if (gravityWellClearSimDays !== undefined && simDays < gravityWellClearSimDays) {
      return `Leaving gravity well — reaction drive (warp in ${(gravityWellClearSimDays - simDays).toFixed(1)}d)`
    }
    if (warpEngageSimDays !== undefined && simDays < warpEngageSimDays) {
      return `En route to ${destLabel} — reaction drive (warp in ${(warpEngageSimDays - simDays).toFixed(1)}d)`
    }
    const eta = formatDate(simDaysToDate(ship.order.arrivalSimDays))
    return `En route to ${destLabel} — ETA ${eta}`
  }
  // "Jump when ready" — the player ordered a hyperdrive jump while it was
  // still on cooldown; queued instead of refused (see planMove/
  // useShipOrderSettler), so the ship is meaningfully "doing something,"
  // not just idle, until the drive comes off cooldown and it actually fires.
  if (ship.pendingHyperdriveJump) {
    const star = STARS.find((s) => s.id === ship.pendingHyperdriveJump)
    const remaining = hyperdriveCooldownRemainingDays(ship, simDays)
    return `Hyperdrive charging — jump to ${star?.name ?? ship.pendingHyperdriveJump} queued (${remaining.toFixed(1)}d)`
  }
  const location = ship.location
  switch (location.kind) {
    case 'orbiting':
      return `In ${systemDisplayName(location.systemId)} System, orbiting ${location.bodyName}`
    case 'system-point':
      return `In ${systemDisplayName(location.systemId)} System, Deep Space`
    case 'star': {
      const star = STARS.find((s) => s.id === location.starId)
      if (!star) return 'In Deep Space'
      return star.hasSystemData ? `In ${star.name} System` : `At ${star.name}`
    }
    case 'interstellar-point':
      return 'In Deep Space'
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
      return {
        kind: 'orbiting',
        systemId: destination.systemId,
        bodyName: destination.bodyName,
        periodDays: DEFAULT_SHIP_ORBIT_PERIOD_DAYS,
        phaseDeg: (hashAngleRad(shipId) * 180) / Math.PI,
      }
    case 'point':
      return { kind: 'system-point', systemId: destination.systemId, position: destination.position }
    case 'star':
      return { kind: 'star', starId: destination.starId, offset: restingOffset(shipId) }
    case 'interstellar-point':
      return { kind: 'interstellar-point', position: destination.position }
  }
}

// The warpReadySimDays cooldown update to apply once a completed order that
// used warp settles into its resting location — undefined if the order
// didn't use warp (nothing to update). Re-derives the drive's cooldownDays
// from the ship's class rather than storing it on the order itself, since
// it's already static per-class data available here.
export function warpCooldownAfterArrival(ship: ShipInstance): number | undefined {
  if (!ship.order?.usedWarp) return undefined
  const shipClass = SHIP_CLASSES.find((c) => c.id === ship.classId)
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

export type MoveResult =
  | { kind: 'order'; order: MoveOrder; warpReadyOverride?: number }
  | { kind: 'instant'; location: ShipLocation; hyperdriveReadySimDays: number }
  | { kind: 'on-cooldown'; readySimDays: number }
  | { kind: 'unknown-class' }
  | { kind: 'not-owned' }

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
export function planMove(ship: ShipInstance, destination: MoveDestination, simDays: number): MoveResult {
  if (ship.allegiance !== 'player') return { kind: 'not-owned' }

  const shipClass = SHIP_CLASSES.find((c) => c.id === ship.classId)
  if (!shipClass) return { kind: 'unknown-class' }

  const warpDrive = shipClass.ftlDrives.find((d): d is WarpDrive => d.kind === 'warp')
  const hyperDrive = shipClass.ftlDrives.find((d): d is HyperDrive => d.kind === 'hyperdrive')

  // Hyperdrive only makes sense for jumping to a charted star (you jump TO
  // somewhere, not into open space) — and only when there's no warp drive to
  // prefer instead (warp is always at least as fast for any real distance).
  if (destination.kind === 'star' && hyperDrive && !warpDrive) {
    if (simDays < ship.hyperdriveReadySimDays) return { kind: 'on-cooldown', readySimDays: ship.hyperdriveReadySimDays }
    return {
      kind: 'instant',
      location: { kind: 'star', starId: destination.starId, offset: restingOffset(ship.id) },
      hyperdriveReadySimDays: simDays + hyperDrive.cooldownDays,
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

  // A ship at rest in orbit is inside that body's gravity well — a warp
  // drive can't fire from inside one (see GRAVITY_WELL_ESCAPE_DAYS), so it
  // must first spend a short, fixed stretch on reaction drive alone
  // clearing it. A ship already underway (mid-order, any phase) is already
  // out in open space by definition, so this only ever applies to a fresh
  // order issued from rest. If the destination is closer than escape alone
  // would cover, the trip just never gets that far — no gravity-well phase
  // at all, plain reaction drive the whole (short) way.
  const inGravityWell = !ship.order && ship.location.kind === 'orbiting'
  const gravityWellClearSimDays =
    inGravityWell && simDays + GRAVITY_WELL_ESCAPE_DAYS < reactionOnlyArrivalSimDays
      ? simDays + GRAVITY_WELL_ESCAPE_DAYS
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
