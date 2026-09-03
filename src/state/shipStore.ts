import { create } from 'zustand'
import { CHAFF_CHARGES, type CombatProfile, type CombatStance, type ComponentKind, type FleetStrategy } from '../data/combatData'
import { deployChaff as deployChaffState } from '../scene/combatResolution'
import { combatLocationKey } from './combatStore'
import { useFleetStore, nextFleetName } from './fleetStore'
import type { FleetAllegiance } from '../data/shipData'

// Where a ship rests when it has no active order — always resolved to a
// live/derived position at render time (never a stale snapshot), same
// "pure function of simDays" philosophy as planet/moon orbits.
// A resting, orbiting ship's motion is described by `periodDays`/`phaseDeg`
// alone, not a stored radius — unlike a real distance (an AU, a km), "how
// far out it orbits" is purely a per-view rendering decision: system view
// and satellite view use unrelated visual scales for the *same* ship (see
// shipPhysics.ts's SYSTEM_SHIP_ORBIT_RADIUS vs. SatelliteViewScene's
// PRIMARY_VISUAL_RADIUS-relative radius), so each picks its own constant
// rather than sharing one stored value that could only be right for one of
// them. The time-basis (how fast, starting where in the circle) is the one
// part that's genuinely shared, physical ship state.
// `inclinationDeg` defaults to 0 for a normal arrival (a flat orbit, same as
// before this field existed) — nonzero only when a ship has entered a
// synced orbit matching a real moon's tilt (see MoveDestination's 'body'
// `syncOrbit`, and shipPhysics.oppositeMoonSyncOrbit), so its path actually
// stays coplanar with that moon's, not just angularly opposite it.
export type ShipLocation =
  | { kind: 'orbiting'; systemId: string; bodyName: string; periodDays: number; phaseDeg: number; inclinationDeg: number }
  | { kind: 'system-point'; systemId: string; position: [number, number, number] }
  | { kind: 'star'; starId: string; offset: [number, number, number] }
  | { kind: 'interstellar-point'; position: [number, number, number] }

// What a move order targets — resolved to a live position by shipPhysics.ts
// at order-issue time (and, for a 'body', re-resolved to wherever that body
// actually is once the order completes).
export type MoveDestination =
  | {
      kind: 'body'
      systemId: string
      bodyName: string
      // Present only for "enter a preexisting orbit" (see
      // shipPhysics.oppositeMoonSyncOrbit) — overrides the default
      // fresh-arrival period/phase/inclination with an exact match to
      // another orbiting object's motion (offset however the caller likes;
      // the opposite-a-moon case bakes in a 180° phase offset itself).
      // Absent for every ordinary "go orbit this body" order.
      syncOrbit?: { periodDays: number; phaseDeg: number; inclinationDeg: number }
    }
  | { kind: 'point'; systemId: string; position: [number, number, number] }
  | { kind: 'star'; starId: string }
  | { kind: 'interstellar-point'; position: [number, number, number] }

export interface MoveOrder {
  destination: MoveDestination
  departSimDays: number
  arrivalSimDays: number
  // The whole order plays out in a single space (see shipPhysics.ts's
  // `interstellarAnchor` — crossing between a system and interstellar space
  // is modeled as instantaneous at the relevant system's star, so start/end
  // are always in the same units).
  space: 'system' | 'interstellar'
  systemId?: string
  startPosition: [number, number, number]
  endPosition: [number, number, number]
  // Whether this order is actually using the ship's warp drive (vs. falling
  // back to reaction-drive speed because warp is on cooldown, or the ship
  // simply has none) — recorded here, not re-derived at arrival, since which
  // drive a *specific* order used can no longer be inferred purely from the
  // ship's class once warp has its own cooldown (see shipPhysics.planMove).
  // Read once, at arrival (ShipMarker), to decide whether to start the warp
  // cooldown.
  usedWarp: boolean
  // Set only for a two-phase order that starts on reaction drive and
  // switches to warp partway through (waiting out a gravity well and/or a
  // cooldown — see shipPhysics.planMove) — the simDays at which that switch
  // happens. Undefined for a plain single-speed order (the whole trip on
  // one drive, whichever it is).
  warpEngageSimDays?: number
  // The share of the trip's total *distance* (not time) already covered at
  // warpEngageSimDays. getShipRenderPosition interpolates the two phases
  // using this directly rather than re-deriving it from the two drives'
  // very different speeds.
  warpEngageFraction?: number
  // Set whenever this order started at rest inside a body's gravity well
  // and intends to eventually warp — purely for status-line display
  // ("leaving gravity well") distinct from a plain cooldown wait; the
  // actual gating already lives in warpEngageSimDays.
  gravityWellClearSimDays?: number
}

// A drive spooling up to fire. This is the *only* way out of an engagement:
// a ship in combat can't simply fly off at reaction drive (it's pinned inside
// the arena), so escaping means committing to a charge and surviving it.
// While charging, the ship cannot fire (see combatResolution) — the whole
// point of the mechanic is that announcing an escape costs you your guns for
// the duration and hands the enemy a window to stop you.
export interface FtlCharge {
  kind: 'warp' | 'hyperdrive'
  // Where the ship intends to go once the charge completes. Kept here rather
  // than as a MoveOrder because no arrival time can be computed until the
  // drive actually fires.
  destination: MoveDestination
  startedSimDays: number
  // Absolute deadline. Recomputed if the ship's utility component takes
  // damage mid-charge — a wrecked utility array charges slower, and can stall
  // the escape entirely at zero.
  readySimDays: number
}

// Persistent battle damage, carried on the ship itself so it outlives any one
// engagement. Everything transient about a fight (arena position, weapon
// timers, chosen target) lives on the engagement instead — see
// combatStore.CombatParticipant.
export interface ShipCombatState {
  componentHp: Record<ComponentKind, number>
  // Regenerates over time, in and out of combat.
  shieldHp: number
  // Does not regenerate in the field — armor damage is permanent until some
  // future repair/shipyard system exists to undo it.
  armorHp: number
  ftlCharge: FtlCharge | null
  // Countermeasure charges left (see combatData's CHAFF_CHARGES). Like armor,
  // these do NOT come back on their own — a ship that spent both is out of
  // them until some future resupply system exists.
  chaffRemaining: number
  // Absolute simDays the current chaff burst stops working, or null when
  // none is up. Stored as a deadline rather than a countdown for the same
  // reason every other timer in this project is (weapon cooldowns, FTL
  // charge): it stays correct no matter how the clock is stepped.
  chaffActiveUntilSimDays: number | null
}

// A fresh, undamaged combat state for a hull. Every ship gets one at spawn
// (there is no "not yet in combat" null state) so damage application never
// has to construct state on the fly.
export function pristineCombatState(profile: CombatProfile): ShipCombatState {
  return {
    componentHp: { ...profile.components },
    shieldHp: profile.defenses.shieldHp,
    armorHp: profile.defenses.armorHp,
    ftlCharge: null,
    chaffRemaining: CHAFF_CHARGES,
    chaffActiveUntilSimDays: null,
  }
}

export interface ShipInstance {
  id: string
  classId: string
  name: string
  allegiance: FleetAllegiance
  location: ShipLocation
  order: MoveOrder | null
  // simDays at which the hyperdrive is next usable — 0 (or any simDays
  // already passed) means "ready now."
  hyperdriveReadySimDays: number
  // Same idea for the warp drive — unlike hyperdrive, being on cooldown
  // doesn't block a move order outright, it just falls back to reaction
  // drive for that trip (see shipPhysics.planMove).
  warpReadySimDays: number
  // Player-toggleable (see ShipPanel): whether a new order should use warp
  // at all when one's available — a working drive doesn't mean the player
  // wants *this* particular trip to use it (default true, preserving the
  // original "always warp when possible" behavior unless turned off).
  warpEnabled: boolean
  // Player-toggleable (see ShipPanel): whether an order that can't warp
  // immediately (still on cooldown) should keep waiting and auto-engage
  // warp mid-flight once able, rather than riding reaction drive for the
  // whole trip (see shipPhysics.planMove). Never gates the *mandatory*
  // gravity-well-clearing phase — that always auto-engages once clear,
  // provided warp is otherwise ready. Default false — an opt-in.
  warpWhenReady: boolean
  // Whether this hull spends its own chaff charges automatically when
  // actually under threat (see combatResolution's AI countermeasures step,
  // which every ship — not just AI-controlled ones — now goes through).
  // Default TRUE: a player who wants to hold charges for a specific moment
  // can turn this off and use the panel's Deploy button instead, but the
  // common case is "spend it before I forget I have it," same as the AI
  // already did for non-player hulls.
  chaffAutoDeploy: boolean
  // Whether this hull's Tactics (see combatData's Tactics section) run
  // themselves automatically while in a fight, same "auto with a manual
  // override" relationship chaffAutoDeploy already has with chaff. Each is
  // its own independent flag (a player might want auto Thruster Boost but
  // manual Shield Boost) rather than one shared "tactics auto" switch.
  // Optional and defaults to true when read (see combatResolution's
  // auto-tactics pass) — same "absent means the default" reasoning as
  // CombatParticipant's own new optional fields, so no existing ShipInstance
  // literal anywhere (spawn sites, tests) needs updating for these to exist.
  thrusterBoostAuto?: boolean
  shieldBoostAuto?: boolean
  weaponsBoostAuto?: boolean
  spinThrustAuto?: boolean
  // Set when the player orders a hyperdrive jump to this star while the
  // drive is still on cooldown — instead of the order being refused
  // outright, it queues here and fires automatically once
  // hyperdriveReadySimDays passes (see useShipOrderSettler). Cleared
  // whenever a new order/location is set, since that supersedes the queued
  // intent — a ship can only ever have one destination in mind at a time.
  pendingHyperdriveJump: string | null
  // Standing "escort" directive (see useShipOrderSettler) — when set, this
  // ship keeps re-targeting whatever destination the named ship is
  // currently ordered to (or resting at), re-issuing a fresh order whenever
  // that destination changes, until either ship is removed or the player
  // issues this ship its own manual order (which cancels it — see
  // setShipOrder/setShipLocation's `keepFollowing` param). Not a MoveOrder
  // itself since there's no fixed arrival time to compute up front — the
  // target can keep moving.
  followingShipId: string | null
  // Persistent battle damage + any in-progress FTL escape charge. Always
  // present (see pristineCombatState) — a ship that has never fought simply
  // has one at full health.
  combat: ShipCombatState
  // Unpowered ballistic motion in SYSTEM space, for a ship whose utility
  // (and therefore thrust) is destroyed — see useShipDriftIntegrator.
  //
  // Optional and normally absent: a ship under power has no need of it,
  // because a powered ship's position is a pure function of its order or its
  // resting location, exactly as everything else in this project is. Drift is
  // the one case that genuinely cannot be — an unpowered hull's path depends
  // on where it was and how fast it was going when the engines died, which is
  // accumulated state by definition. Velocity is in system units per sim-day;
  // the position it applies to is the ship's own `system-point` location.
  drift?: { velocity: [number, number, number]; updatedSimDays: number } | null
  // simDays this ship first became "safe" (not in an active engagement) —
  // see useEscapeBehavior. Optional and normally absent, the same "no
  // tracked state until there's something to track" reasoning as `drift`:
  // most ships are never weak-and-alone long enough for this to matter.
  // Reset to null the moment the ship re-enters combat, so only a truly
  // continuous stretch of safety counts toward the escape timer.
  safeSinceSimDays?: number | null
  // How this ship fights when the player isn't steering it by hand — set
  // from Fleet Management > Strategizer. Lives on the ship rather than on a
  // CombatParticipant so it can be set *before* a fight (that's the whole
  // point of a standing doctrine) and survives from one engagement to the
  // next. A manual move order still overrides it for the rest of that fight
  // (see CombatParticipant.holdPosition).
  stance: CombatStance
  // Which Fleet (see fleetStore.ts) this hull currently belongs to — always
  // set, never null; a single ship on its own is still a fleet of one, not a
  // special unfleeted state. Assigned automatically by spawnShip/
  // setShipLocation (join whatever same-allegiance fleet is already resting
  // at the same spot, or start a new one) and changeable directly via
  // mergeFleets. Every marker/list that groups ships visually groups by this
  // field, not by ship identity.
  fleetId: string
}

interface ShipState {
  ships: ShipInstance[]
  selectedShipId: string | null
  // fleetId is deliberately omitted here rather than accepted — spawnShip
  // always resolves it itself (join a same-allegiance fleet already resting
  // at this exact spot, or start a new one), so no caller has to know
  // fleetStore exists just to bring a ship into being.
  spawnShip: (ship: Omit<ShipInstance, 'fleetId'>) => void
  removeShip: (id: string) => void
  selectShip: (id: string | null) => void
  // Store stays dependency-free of the scene/physics layer — callers
  // (DebugConsole, the scenes' right-click handlers) compute the order via
  // shipPhysics.planMove and hand over the already-resolved result.
  // `warpReadySimDays`, when present, is planMove's "stop-and-start" penalty
  // — redirecting a ship away from an in-progress warp jump forces its
  // cooldown to restart right now, applied atomically with the new order so
  // there's no frame where the old order is gone but the penalty isn't in
  // effect yet. `keepFollowing` defaults to false — any *manual* order
  // (issued from a scene's right-click handler) cancels a standing follow
  // directive, same as it already cancels a pending hyperdrive jump; only
  // useShipOrderSettler's own follow-recompute calls pass true, since that's
  // the mechanism keeping the directive alive, not overriding it.
  setShipOrder: (id: string, order: MoveOrder, warpReadySimDays?: number, keepFollowing?: boolean) => void
  setWarpEnabled: (id: string, enabled: boolean) => void
  setWarpWhenReady: (id: string, whenReady: boolean) => void
  setChaffAutoDeploy: (id: string, auto: boolean) => void
  setThrusterBoostAuto: (id: string, auto: boolean) => void
  setShieldBoostAuto: (id: string, auto: boolean) => void
  setWeaponsBoostAuto: (id: string, auto: boolean) => void
  setSpinThrustAuto: (id: string, auto: boolean) => void
  setShipLocation: (
    id: string,
    location: ShipLocation,
    cooldowns?: { hyperdriveReadySimDays?: number; warpReadySimDays?: number },
    keepFollowing?: boolean,
  ) => void
  // "Jump when ready" — queues a hyperdrive jump to fire automatically once
  // the drive is off cooldown (see useShipOrderSettler). Pass null to cancel
  // a queued jump without issuing a new order/location.
  setPendingHyperdriveJump: (id: string, starId: string | null) => void
  // See ShipInstance.safeSinceSimDays.
  setSafeSince: (id: string, simDays: number | null) => void
  // Sets or clears (pass null) this ship's standing follow directive — see
  // ShipInstance.followingShipId. Always a deliberate, direct call (from a
  // scene's right-click-a-ship handler), so no keepFollowing-style guard is
  // needed here the way setShipOrder/setShipLocation have.
  setFollowing: (id: string, targetShipId: string | null) => void
  // Bulk-applies one combat step's damage results, keyed by ship id, and
  // removes any ship whose core component hit zero. Combat resolves as a
  // pure function over every participant at once (see combatResolution.ts),
  // so it writes back through a single action — applying per-ship damage
  // one call at a time would let a ship die mid-step and change what its
  // own already-fired shots hit.
  applyCombatDamage: (next: Record<string, ShipCombatState>, destroyedIds: string[]) => void
  // Begins or cancels (pass null) an FTL escape charge — see FtlCharge.
  setFtlCharge: (id: string, charge: FtlCharge | null) => void
  setStance: (id: string, stance: CombatStance) => void
  // Spends one chaff charge on the player's behalf. A no-op when the ship has
  // none left or a burst is already up — the guard lives in
  // combatResolution.deployChaff so the player's button and the AI's own
  // deployment obey exactly one rule.
  deployChaff: (id: string, simDays: number) => void
  // Sets (or clears, with null) an unpowered hull's stored ballistic
  // velocity — see ShipInstance.drift and useShipDriftIntegrator.
  setDrift: (id: string, drift: ShipInstance['drift']) => void
  // Absorbs every ship in `fromFleetId` into `intoFleetId` and removes the
  // now-empty former fleet. Doesn't check that the two are actually at the
  // same place — the caller (see ShipPanel's Merge Fleets button) only ever
  // offers this when they already are, and this action just does what it's
  // told rather than re-deriving a gate that already happened in the UI.
  mergeFleets: (intoFleetId: string, fromFleetId: string) => void
  // Pulls the given ships out of whatever fleet(s) they're currently in and
  // groups them together into one brand-new fleet, pruning any source fleet
  // left empty. All the named ships end up on the SAME new fleet, not one
  // solo fleet each — "split the fleet in two" is the point, not "disband
  // it entirely" (a ship that really should be alone can still be split off
  // one at a time). A no-op if fewer than one id is given, or if every given
  // ship is already alone together in one fleet already.
  splitFleet: (shipIds: string[]) => void
  // Sets (or clears, with null) a fleet's standing coordinated strategy —
  // see Fleet.strategy. Pairs the fleet-level write with the matching bulk
  // update every current member needs: setting a real strategy puts every
  // member's own stance to 'fleet' (so they all defer to it — see
  // CombatStance's own comment), and clearing one resets any member still
  // on 'fleet' back to Balanced rather than leaving it deferring to
  // nothing. A ship the player has already switched to some OTHER
  // individual stance is left alone either way — that's what makes an
  // individual choice an override rather than something this would stomp.
  setFleetStrategy: (fleetId: string, strategy: FleetStrategy | null) => void
}

// Picks the fleet a ship now resting at `location` should belong to: an
// existing same-allegiance fleet already resting at that exact spot (see
// combatLocationKey — a ship still traveling, or resting at a bare point in
// space rather than a named anchor, never matches), or a freshly created
// solo fleet otherwise. `excludeShipId` keeps a ship already in `ships` from
// matching itself (setShipLocation's case); spawnShip has no such ship yet
// to exclude.
function resolveFleetId(
  ships: ShipInstance[],
  allegiance: FleetAllegiance,
  location: ShipLocation,
  excludeShipId?: string,
): string {
  const locKey = combatLocationKey(location)
  if (locKey) {
    const mate = ships.find(
      (s) => s.id !== excludeShipId && s.allegiance === allegiance && !s.order && combatLocationKey(s.location) === locKey,
    )
    if (mate) return mate.fleetId
  }
  const fleetState = useFleetStore.getState()
  const id = `fleet-${Date.now()}-${Math.round(Math.random() * 1e6)}`
  fleetState.createFleet({ id, name: nextFleetName(fleetState.fleets, allegiance), allegiance, strategy: null })
  return id
}

// A fleet with nobody left in it has nothing to show in any list — pruned
// the moment its last ship leaves (a merge, a death, a removal) rather than
// left to accumulate as a dead entry. `remainingShips` is the POST-change
// roster, not the store's stale snapshot, so this only fires on an actual
// departure.
function pruneFleetIfEmpty(fleetId: string, remainingShips: ShipInstance[]): void {
  if (remainingShips.some((s) => s.fleetId === fleetId)) return
  useFleetStore.getState().removeFleet(fleetId)
}

export const useShipStore = create<ShipState>((set) => ({
  ships: [],
  selectedShipId: null,
  spawnShip: (ship) =>
    set((s) => ({
      ships: [...s.ships, { ...ship, fleetId: resolveFleetId(s.ships, ship.allegiance, ship.location) }],
    })),
  removeShip: (id) =>
    set((s) => {
      const ship = s.ships.find((sh) => sh.id === id)
      const ships = s.ships.filter((sh) => sh.id !== id)
      if (ship) pruneFleetIfEmpty(ship.fleetId, ships)
      return {
        ships,
        selectedShipId: s.selectedShipId === id ? null : s.selectedShipId,
      }
    }),
  // Selecting a ship (any ship, regardless of allegiance) is just "look at
  // its info" — always allowed, so players can inspect enemy/neutral/
  // friendly fleets too. *Commanding* one is the privileged action, gated
  // separately at the single place every order actually gets computed
  // (shipPhysics.planMove refuses to plan a move for a non-player ship) —
  // see planMove's own doc comment.
  selectShip: (id) => set({ selectedShipId: id }),
  setShipOrder: (id, order, warpReadySimDays, keepFollowing) =>
    set((s) => ({
      ships: s.ships.map((ship) =>
        ship.id === id
          ? {
              ...ship,
              order,
              pendingHyperdriveJump: null,
              warpReadySimDays: warpReadySimDays ?? ship.warpReadySimDays,
              followingShipId: keepFollowing ? ship.followingShipId : null,
            }
          : ship,
      ),
    })),
  setWarpEnabled: (id, enabled) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, warpEnabled: enabled } : ship)),
    })),
  setWarpWhenReady: (id, whenReady) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, warpWhenReady: whenReady } : ship)),
    })),
  setChaffAutoDeploy: (id, auto) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, chaffAutoDeploy: auto } : ship)),
    })),
  setThrusterBoostAuto: (id, auto) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, thrusterBoostAuto: auto } : ship)),
    })),
  setShieldBoostAuto: (id, auto) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, shieldBoostAuto: auto } : ship)),
    })),
  setWeaponsBoostAuto: (id, auto) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, weaponsBoostAuto: auto } : ship)),
    })),
  setSpinThrustAuto: (id, auto) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, spinThrustAuto: auto } : ship)),
    })),
  setShipLocation: (id, location, cooldowns, keepFollowing) =>
    set((s) => {
      const ship = s.ships.find((sh) => sh.id === id)
      if (!ship) return s
      // Every call here is a ship coming to rest somewhere — the moment it's
      // worth checking whether a same-allegiance fleet is already sitting
      // right there and folding in rather than staying its own separate
      // one-ship entry. Covers every path a ship can settle through (a
      // normal order arriving, an instant hyperdrive jump, drift settling,
      // combat relocating a disengaged hull) since they all funnel through
      // this one action.
      const fleetId = resolveFleetId(s.ships, ship.allegiance, location, id)
      const ships = s.ships.map((sh) =>
        sh.id === id
          ? {
              ...sh,
              location,
              fleetId,
              order: null,
              hyperdriveReadySimDays: cooldowns?.hyperdriveReadySimDays ?? sh.hyperdriveReadySimDays,
              warpReadySimDays: cooldowns?.warpReadySimDays ?? sh.warpReadySimDays,
              pendingHyperdriveJump: null,
              followingShipId: keepFollowing ? sh.followingShipId : null,
            }
          : sh,
      )
      if (fleetId !== ship.fleetId) pruneFleetIfEmpty(ship.fleetId, ships)
      return { ships }
    }),
  setPendingHyperdriveJump: (id, starId) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, pendingHyperdriveJump: starId } : ship)),
    })),
  setSafeSince: (id, simDays) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, safeSinceSimDays: simDays } : ship)),
    })),
  setFollowing: (id, targetShipId) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, followingShipId: targetShipId } : ship)),
    })),
  applyCombatDamage: (next, destroyedIds) =>
    set((s) => {
      const destroyed = new Set(destroyedIds)
      const lostFleetIds = new Set(s.ships.filter((sh) => destroyed.has(sh.id)).map((sh) => sh.fleetId))
      const ships = s.ships
        .filter((ship) => !destroyed.has(ship.id))
        .map((ship) => (next[ship.id] ? { ...ship, combat: next[ship.id] } : ship))
      for (const fleetId of lostFleetIds) pruneFleetIfEmpty(fleetId, ships)
      return {
        ships,
        // A destroyed ship can't stay selected — same cleanup removeShip
        // already does for the lost-in-hyperspace case.
        selectedShipId: s.selectedShipId && destroyed.has(s.selectedShipId) ? null : s.selectedShipId,
      }
    }),
  setFtlCharge: (id, charge) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, combat: { ...ship.combat, ftlCharge: charge } } : ship)),
    })),
  setStance: (id, stance) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, stance } : ship)),
    })),
  deployChaff: (id, simDays) =>
    set((s) => ({
      ships: s.ships.map((ship) => {
        if (ship.id !== id) return ship
        const next = deployChaffState(ship.combat, simDays)
        return next === ship.combat ? ship : { ...ship, combat: next }
      }),
    })),
  setDrift: (id, drift) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, drift } : ship)),
    })),
  mergeFleets: (intoFleetId, fromFleetId) =>
    set((s) => {
      if (intoFleetId === fromFleetId) return s
      const ships = s.ships.map((sh) => (sh.fleetId === fromFleetId ? { ...sh, fleetId: intoFleetId } : sh))
      useFleetStore.getState().removeFleet(fromFleetId)
      return { ships }
    }),
  splitFleet: (shipIds) =>
    set((s) => {
      const idSet = new Set(shipIds)
      const moving = s.ships.filter((sh) => idSet.has(sh.id))
      if (moving.length === 0) return s
      const sourceFleetIds = new Set(moving.map((sh) => sh.fleetId))
      // Already alone together on one fleet, with nothing else in it —
      // there's nothing to actually split.
      if (sourceFleetIds.size === 1) {
        const [onlyFleetId] = sourceFleetIds
        if (s.ships.every((sh) => sh.fleetId !== onlyFleetId || idSet.has(sh.id))) return s
      }
      const fleetState = useFleetStore.getState()
      const newFleetId = `fleet-${Date.now()}-${Math.round(Math.random() * 1e6)}`
      fleetState.createFleet({
        id: newFleetId,
        name: nextFleetName(fleetState.fleets, moving[0].allegiance),
        allegiance: moving[0].allegiance,
        strategy: null,
      })
      const ships = s.ships.map((sh) => (idSet.has(sh.id) ? { ...sh, fleetId: newFleetId, stance: sh.stance === 'fleet' ? 'balanced' as CombatStance : sh.stance } : sh))
      for (const fleetId of sourceFleetIds) pruneFleetIfEmpty(fleetId, ships)
      return { ships }
    }),
  setFleetStrategy: (fleetId, strategy) =>
    set((s) => {
      useFleetStore.getState().setStrategy(fleetId, strategy)
      const ships = s.ships.map((sh) => {
        if (sh.fleetId !== fleetId) return sh
        if (strategy !== null) return sh.stance === 'fleet' ? sh : { ...sh, stance: 'fleet' as CombatStance }
        return sh.stance === 'fleet' ? { ...sh, stance: 'balanced' as CombatStance } : sh
      })
      return { ships }
    }),
}))
