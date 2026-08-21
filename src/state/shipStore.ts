import { create } from 'zustand'
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
export type ShipLocation =
  | { kind: 'orbiting'; systemId: string; bodyName: string; periodDays: number; phaseDeg: number }
  | { kind: 'system-point'; systemId: string; position: [number, number, number] }
  | { kind: 'star'; starId: string; offset: [number, number, number] }
  | { kind: 'interstellar-point'; position: [number, number, number] }

// What a move order targets — resolved to a live position by shipPhysics.ts
// at order-issue time (and, for a 'body', re-resolved to wherever that body
// actually is once the order completes).
export type MoveDestination =
  | { kind: 'body'; systemId: string; bodyName: string }
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
  // Set when the player orders a hyperdrive jump to this star while the
  // drive is still on cooldown — instead of the order being refused
  // outright, it queues here and fires automatically once
  // hyperdriveReadySimDays passes (see useShipOrderSettler). Cleared
  // whenever a new order/location is set, since that supersedes the queued
  // intent — a ship can only ever have one destination in mind at a time.
  pendingHyperdriveJump: string | null
}

interface ShipState {
  ships: ShipInstance[]
  selectedShipId: string | null
  spawnShip: (ship: ShipInstance) => void
  removeShip: (id: string) => void
  selectShip: (id: string | null) => void
  // Store stays dependency-free of the scene/physics layer — callers
  // (DebugConsole, the scenes' right-click handlers) compute the order via
  // shipPhysics.planMove and hand over the already-resolved result.
  // `warpReadySimDays`, when present, is planMove's "stop-and-start" penalty
  // — redirecting a ship away from an in-progress warp jump forces its
  // cooldown to restart right now, applied atomically with the new order so
  // there's no frame where the old order is gone but the penalty isn't in
  // effect yet.
  setShipOrder: (id: string, order: MoveOrder, warpReadySimDays?: number) => void
  setWarpEnabled: (id: string, enabled: boolean) => void
  setWarpWhenReady: (id: string, whenReady: boolean) => void
  setShipLocation: (
    id: string,
    location: ShipLocation,
    cooldowns?: { hyperdriveReadySimDays?: number; warpReadySimDays?: number },
  ) => void
  // "Jump when ready" — queues a hyperdrive jump to fire automatically once
  // the drive is off cooldown (see useShipOrderSettler). Pass null to cancel
  // a queued jump without issuing a new order/location.
  setPendingHyperdriveJump: (id: string, starId: string | null) => void
}

export const useShipStore = create<ShipState>((set) => ({
  ships: [],
  selectedShipId: null,
  spawnShip: (ship) => set((s) => ({ ships: [...s.ships, ship] })),
  removeShip: (id) =>
    set((s) => ({
      ships: s.ships.filter((ship) => ship.id !== id),
      selectedShipId: s.selectedShipId === id ? null : s.selectedShipId,
    })),
  // Selecting a ship (any ship, regardless of allegiance) is just "look at
  // its info" — always allowed, so players can inspect enemy/neutral/
  // friendly fleets too. *Commanding* one is the privileged action, gated
  // separately at the single place every order actually gets computed
  // (shipPhysics.planMove refuses to plan a move for a non-player ship) —
  // see planMove's own doc comment.
  selectShip: (id) => set({ selectedShipId: id }),
  setShipOrder: (id, order, warpReadySimDays) =>
    set((s) => ({
      ships: s.ships.map((ship) =>
        ship.id === id
          ? {
              ...ship,
              order,
              pendingHyperdriveJump: null,
              warpReadySimDays: warpReadySimDays ?? ship.warpReadySimDays,
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
  setShipLocation: (id, location, cooldowns) =>
    set((s) => ({
      ships: s.ships.map((ship) =>
        ship.id === id
          ? {
              ...ship,
              location,
              order: null,
              hyperdriveReadySimDays: cooldowns?.hyperdriveReadySimDays ?? ship.hyperdriveReadySimDays,
              warpReadySimDays: cooldowns?.warpReadySimDays ?? ship.warpReadySimDays,
              pendingHyperdriveJump: null,
            }
          : ship,
      ),
    })),
  setPendingHyperdriveJump: (id, starId) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, pendingHyperdriveJump: starId } : ship)),
    })),
}))
