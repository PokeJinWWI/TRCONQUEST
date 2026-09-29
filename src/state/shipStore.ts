import { create } from 'zustand'
import type { ResourceId } from '../data/resourceData'
import type { SurveyJob } from '../scene/surveyLogic'
import type { Automation } from '../scene/automation'
import type { ResourceCost } from '../data/shipyardData'
import type { BombardStance } from '../data/defenseData'
import { CHAFF_CHARGES, type CombatProfile, type CombatStance, type ComponentKind, type FleetStrategy } from '../data/combatData'
import { deployChaff as deployChaffState } from '../scene/combatResolution'
import { anyCivilian } from '../scene/fleetRules'
import { useFleetStore, nextFleetName } from './fleetStore'
import { useGameTimeStore } from './gameTimeStore'

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
// `syncOrbit`), so its path actually
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
      // Present only for "enter a preexisting orbit" — overrides the default
      // fresh-arrival period/phase/inclination with an exact match to
      // another orbiting object's motion (offset however the caller likes;
      // the opposite-a-moon case bakes in a 180° phase offset itself).
      // Absent for every ordinary "go orbit this body" order.
      syncOrbit?: { periodDays: number; phaseDeg: number; inclinationDeg: number }
    }
  | { kind: 'point'; systemId: string; position: [number, number, number] }
  | { kind: 'star'; starId: string }
  | { kind: 'interstellar-point'; position: [number, number, number] }

// A non-move command to a ship (survey, load, transfer, build…) — issued by
// the player from ShipPanel, and carried out by scene/shipCommands.ts either
// at once or, out of comms contact, when its signal arrives (see
// ShipInstance.pendingCommands).
export type ShipCommand =
  // A science ship surveys every unsurveyed body of `starId` (default: the
  // system it is in), or only `bodyName`, flying to each in turn. Exploring
  // needs no order: any ship entering a system explores it.
  | { kind: 'survey'; starId?: string; bodyName?: string }
  // Take goods from the nation's stockpile aboard (at an owned world).
  | { kind: 'load'; want: ResourceCost }
  // Hand goods to another of the nation's ships in the same place.
  | { kind: 'transfer'; toShipId: string; want: ResourceCost }
  // A Construction Ship builds a Starbase at the star it rests at, paid from
  // its hold.
  | { kind: 'build-starbase' }
  // A Colony Ship founds a colony on `bodyName`, the body it orbits
  // (scene/colonies.ts).
  | { kind: 'colonize'; bodyName: string }

export interface PendingShipCommand {
  command: ShipCommand
  arrivesSimDays: number
  sentSimDays: number
}

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

// One entry in a ship's own trailing history log (see ShipInstance.history)
// — a full snapshot of the three fields the FTL-delayed "visual" layer cares
// about (commsVisual.ts), taken at the moment ANY of them changed, not just
// a delta. That's what lets reconstruction stay a simple "find the latest
// entry at or before the target time and use it whole" instead of having to
// replay deltas forward.
export interface ShipHistoryEntry {
  simDays: number
  location: ShipLocation
  order: MoveOrder | null
  combat: ShipCombatState
}

// Bound on ShipInstance.history's length — see that field's own comment for
// why a fixed cap (not simDays-based pruning) is an acceptable simplification
// here.
export const MAX_SHIP_HISTORY_ENTRIES = 64

// Minimum simDays gap between two history entries coming from combat damage
// specifically (see applyCombatDamage) — ~14 minutes. Combat resolves in
// COMBAT_STEP_SECONDS-sized steps, far finer than any comms delay this
// project's real distances produce, so this loses no precision a delayed
// viewer could actually perceive while keeping the history log from being
// entirely consumed by one fight.
const MIN_COMBAT_HISTORY_INTERVAL_DAYS = 0.01

export interface ShipInstance {
  id: string
  classId: string
  name: string
  // The nation that owns and commands this ship (a countryId). Every ship has
  // one — hostility is purely between nations (see state/shipRelations.ts
  // and state/diplomacyStore.ts), and how the PLAYER sees a ship (own /
  // neutral / hostile) is derived from this plus diplomacy, never stored.
  ownerId: string
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
  // provided warp is otherwise ready. On by default for new ships.
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
  // Companion to pendingHyperdriveJump, above — only meaningful when that's
  // set AND FTL comms delay applied to the jump order (see commsVisual.ts's
  // queueCommand). Absent means "no comms gate," so the existing
  // cooldown-only firing condition in useShipOrderSettler is unchanged for
  // every ship/order that predates this field. When present, the jump can't
  // actually fire until BOTH this AND the drive's own cooldown have passed.
  pendingHyperdriveJumpArrivesSimDays?: number
  // A move order queued behind FTL comms delay (see commsVisual.ts's
  // queueCommand) — the destination is kept raw rather than pre-computed
  // into a MoveOrder, the same reasoning pendingHyperdriveJump already
  // follows: real travel timing can only be computed once the command
  // actually arrives and planMove sees the ship's true state then, not
  // whatever was true back when the player clicked. Cleared (set to null)
  // once applied, or superseded by a fresh manual order.
  // Non-move commands still travelling behind FTL comms delay (see
  // scene/shipCommands.queueShipCommand and useCommsResolver). Each is its own
  // signal.
  pendingCommands?: PendingShipCommand[]
  pendingMoveOrder?: { destination: MoveDestination; arrivesSimDays: number; sentSimDays?: number } | null
  // Destinations to fly to, in order, after the current order finishes — what
  // Shift + right-click adds (see commsVisual.orderSelectedFleets and
  // useShipOrderSettler, which sends the ship on to the next when it arrives).
  // A fresh, un-shifted order replaces the whole queue.
  orderQueue?: MoveDestination[]
  // Shift-orders still travelling behind FTL comms delay: each is its own
  // signal, joining `orderQueue` when it arrives (useCommsResolver).
  pendingQueueAdds?: { destination: MoveDestination; arrivesSimDays: number; sentSimDays: number }[]
  // Same idea as pendingMoveOrder, for a stance change ordered under comms
  // delay — trivial enough (a single enum value) to just carry directly
  // rather than needing planMove-style re-resolution at arrival.
  pendingStance?: { stance: CombatStance; arrivesSimDays: number; sentSimDays?: number } | null
  // Orbital bombardment stance (scene/bombardment.ts): off / limited / full,
  // and the same comms-delayed pending order as a stance change. Optional:
  // absent = off.
  bombardStance?: BombardStance
  pendingBombard?: { stance: BombardStance; arrivesSimDays: number; sentSimDays?: number } | null
  // Patrol duty (armed ships): orbiting a colony, it holds the orbit toward
  // making a micro-colony a planetary colony (scene/colonyLogic.ts). Absent =
  // off; changed through comms delay like the bombard stance.
  patrol?: boolean
  pendingPatrol?: { on: boolean; arrivesSimDays: number; sentSimDays?: number } | null
  // Settlers (millions) a Colony Ship carries. Absent = none.
  settlers?: number
  // A Colony Ship at work founding a colony on `bodyName` (the body it
  // orbits) since `sinceSimDays`; the colony exists after COLONY_FOUNDING_DAYS
  // (scene/colonies.resolveFoundings). Cleared by any manual order.
  founding?: { bodyName: string; sinceSimDays: number } | null
  // Stellaris-style automation (scene/automation.ts): the ship finds its own
  // work. Absent = off; any manual order turns it off.
  automation?: Automation | null
  // A short trailing log of this ship's own order/location/combat state,
  // appended once each time any of those actually changes (see
  // setShipOrder/setShipLocation/applyCombatDamage below) — never read by
  // any gameplay/simulation logic, only by commsVisual.ts's
  // visualShipSnapshot to reconstruct "what did this ship's status look
  // like N days ago" for a player whose FTL comms haven't caught up yet.
  // Capped at MAX_SHIP_HISTORY_ENTRIES rather than pruned by simDays age —
  // a fixed-size ring is simpler and cheap enough that getting a slightly
  // shorter lookback window than the true comms delay (only possible for a
  // ship that changes state very often AND is very far from the capital)
  // is an acceptable degrade, not a correctness bug: visualShipSnapshot
  // falls back to the OLDEST entry still held rather than jumping to live
  // truth. Optional and normally starts empty — a freshly spawned ship
  // simply has no pre-history to look back into yet.
  history?: ShipHistoryEntry[]
  // Standing "escort" directive (see useShipOrderSettler) — when set, this
  // ship keeps re-targeting whatever destination the named ship is
  // currently ordered to (or resting at), re-issuing a fresh order whenever
  // that destination changes, until either ship is removed or the player
  // issues this ship its own manual order (which cancels it — see
  // setShipOrder/setShipLocation's `keepFollowing` param). Not a MoveOrder
  // itself since there's no fixed arrival time to compute up front — the
  // target can keep moving.
  followingShipId: string | null
  // A merge in progress: this ship is following the lead of the fleet with this
  // id (followingShipId) and joins it once both are resting in the same place
  // (scene/fleetMerge.resolveFleetMerges). Cleared when it joins, or as soon as
  // the follow is cancelled by a new order. Absent = not merging.
  mergeIntoFleetId?: string | null
  // Goods carried in this hull's hold (see ShipClass.cargoCapacity and
  // scene/cargoLogic.ts). Optional: absent = empty, so no existing ShipInstance
  // literal needs updating.
  cargo?: Partial<Record<ResourceId, number>>
  // A science ship's standing survey job (scene/surveyLogic.ts): while set it
  // flies to each listed body and surveys it (hooks/useSurveyResolver).
  // Cleared when every body is done, or by any manual order to the ship.
  surveyJob?: SurveyJob | null
  // "Go there and do this": set by a star's right-click menu (explore, survey,
  // build a Starbase). Fires once when the ship arrives at that star
  // (useShipOrderSettler); cleared by any order to somewhere else.
  // `bodyName` set: it fires at that world instead (a refill at a station).
  arrivalCommand?: { starId: string; bodyName?: string; command: ShipCommand } | null
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
  // (join whatever same-nation fleet is already resting at the spawn point,
  // or start a new one) and changed only deliberately after that — via
  // mergeFleets/splitFleet. A fleet travels as one (see scene/fleetMove.ts)
  // and keeps its identity wherever it arrives; it never absorbs, or gets
  // absorbed by, another fleet just by stopping next to it. Every marker/list that groups ships visually groups by this
  // field, not by ship identity.
  fleetId: string
}

interface ShipState {
  ships: ShipInstance[]
  // The primary selection — the ship whose panel is open, the last one
  // clicked. Always a member of selectedShipIds when set.
  selectedShipId: string | null
  // Everything selected, for group orders (Shift/Ctrl/Cmd-click adds or
  // removes; a plain click resets to one ship). Map orders move every fleet
  // among these; arena orders move every ship.
  selectedShipIds: string[]
  // fleetId is deliberately omitted here rather than accepted — spawnShip
  // always resolves it itself (join a same-nation fleet already resting
  // at this exact spot, or start a new one), so no caller has to know
  // fleetStore exists just to bring a ship into being.
  spawnShip: (ship: Omit<ShipInstance, 'fleetId'>) => void
  removeShip: (id: string) => void
  // Resets the selection to just this ship (or clears it).
  selectShip: (id: string | null) => void
  // Adds the ship to the selection (making it primary), or removes it if it
  // was already selected.
  toggleShipSelection: (id: string) => void
  // Replaces the whole selection; the last id becomes primary.
  selectShips: (ids: string[]) => void
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
  // Replaces a ship's whole hold (scene/cargoLogic computes the new contents).
  setPendingCommands: (id: string, commands: PendingShipCommand[]) => void
  setSurveyJob: (id: string, job: SurveyJob | null) => void
  setArrivalCommand: (id: string, arrival: { starId: string; bodyName?: string; command: ShipCommand } | null) => void
  setShipCargo: (id: string, cargo: Partial<Record<ResourceId, number>>) => void
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
  // a queued jump without issuing a new order/location. `arrivesSimDays`
  // (see ShipInstance.pendingHyperdriveJumpArrivesSimDays) additionally
  // gates firing on FTL comms delay having elapsed too — omitted (or
  // explicitly cleared alongside a null starId) for a plain cooldown-only
  // queue, exactly as before this parameter existed.
  setPendingHyperdriveJump: (id: string, starId: string | null, arrivesSimDays?: number) => void
  // See ShipInstance.pendingMoveOrder / pendingStance.
  setPendingMoveOrder: (id: string, pending: { destination: MoveDestination; arrivesSimDays: number; sentSimDays?: number } | null) => void
  setBombardStance: (id: string, stance: BombardStance) => void
  setPendingBombard: (id: string, pending: ShipInstance['pendingBombard']) => void
  setPatrol: (id: string, on: boolean) => void
  setPendingPatrol: (id: string, pending: ShipInstance['pendingPatrol']) => void
  setSettlers: (id: string, settlers: number) => void
  setFounding: (id: string, founding: ShipInstance['founding']) => void
  setAutomation: (id: string, automation: Automation | null) => void
  setPendingStance: (id: string, pending: { stance: CombatStance; arrivesSimDays: number; sentSimDays?: number } | null) => void
  // See ShipInstance.orderQueue / pendingQueueAdds.
  setOrderQueue: (id: string, queue: MoveDestination[]) => void
  setPendingQueueAdds: (id: string, adds: NonNullable<ShipInstance['pendingQueueAdds']>) => void
  // See ShipInstance.safeSinceSimDays.
  setSafeSince: (id: string, simDays: number | null) => void
  // Sets or clears (pass null) this ship's standing follow directive — see
  // ShipInstance.followingShipId. Always a deliberate, direct call (from a
  // scene's right-click-a-ship handler), so no keepFollowing-style guard is
  // needed here the way setShipOrder/setShipLocation have.
  setFollowing: (id: string, targetShipId: string | null) => void
  // Marks (or clears, with null) ships as merging into a fleet — see ShipInstance.mergeIntoFleetId.
  setMergeInto: (ids: string[], fleetId: string | null) => void
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

// Appends one history entry (see ShipHistoryEntry) capturing `ship`'s
// CURRENT location/order/combat — call with the already-updated ship object,
// after every other field change has been applied, so the entry reflects
// what actually became true at `simDays`. Capped at MAX_SHIP_HISTORY_ENTRIES
// by dropping the oldest entries first (a simple ring, not simDays-based
// pruning — see ShipInstance.history's own comment on why that's fine here).
function appendHistory(ship: ShipInstance, simDays: number): ShipInstance {
  const entry: ShipHistoryEntry = { simDays, location: ship.location, order: ship.order, combat: ship.combat }
  const history = [...(ship.history ?? []), entry]
  return {
    ...ship,
    history: history.length > MAX_SHIP_HISTORY_ENTRIES ? history.slice(history.length - MAX_SHIP_HISTORY_ENTRIES) : history,
  }
}

// A brand-new one-ship fleet. Fleets are defined by the player (mergeFleets /
// splitFleet), never formed automatically — a ship spawned or built beside
// another of the same nation is still its own fleet.
function createSoloFleet(ownerId: string): string {
  const fleetState = useFleetStore.getState()
  const id = `fleet-${Date.now()}-${Math.round(Math.random() * 1e6)}`
  fleetState.createFleet({ id, name: nextFleetName(fleetState.fleets, ownerId), ownerId, strategy: null })
  return id
}

// Drops removed/destroyed ships from the selection, keeping a still-selected
// primary or falling back to the last remaining selected ship.
function pruneSelection(
  s: Pick<ShipState, 'selectedShipId' | 'selectedShipIds'>,
  gone: Set<string>,
): Pick<ShipState, 'selectedShipId' | 'selectedShipIds'> {
  const ids = s.selectedShipIds.filter((id) => !gone.has(id))
  const primary = s.selectedShipId && !gone.has(s.selectedShipId) ? s.selectedShipId : ids[ids.length - 1] ?? null
  return { selectedShipIds: ids, selectedShipId: primary }
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
  selectedShipIds: [],
  spawnShip: (ship) =>
    set((s) => ({
      ships: [...s.ships, { ...ship, fleetId: createSoloFleet(ship.ownerId) }],
    })),
  removeShip: (id) =>
    set((s) => {
      const ship = s.ships.find((sh) => sh.id === id)
      const ships = s.ships.filter((sh) => sh.id !== id)
      if (ship) pruneFleetIfEmpty(ship.fleetId, ships)
      return { ships, ...pruneSelection(s, new Set([id])) }
    }),
  // Selecting a ship (any ship, regardless of owner) is just "look at
  // its info" — always allowed, so players can inspect enemy/neutral/
  // friendly fleets too. *Commanding* one is the privileged action, gated
  // separately at the single place every order actually gets computed
  // (shipPhysics.planMove refuses to plan a move for a non-player ship) —
  // see planMove's own doc comment.
  selectShip: (id) => set({ selectedShipId: id, selectedShipIds: id ? [id] : [] }),
  toggleShipSelection: (id) =>
    set((s) => {
      if (s.selectedShipIds.includes(id)) {
        const ids = s.selectedShipIds.filter((x) => x !== id)
        return { selectedShipIds: ids, selectedShipId: s.selectedShipId === id ? ids[ids.length - 1] ?? null : s.selectedShipId }
      }
      return { selectedShipIds: [...s.selectedShipIds, id], selectedShipId: id }
    }),
  selectShips: (ids) => set({ selectedShipIds: [...new Set(ids)], selectedShipId: ids[ids.length - 1] ?? null }),
  setShipOrder: (id, order, warpReadySimDays, keepFollowing) =>
    set((s) => {
      const simDays = useGameTimeStore.getState().simDays
      return {
        ships: s.ships.map((ship) =>
          ship.id === id
            ? appendHistory(
                {
                  ...ship,
                  order,
                  // An order to somewhere else cancels a "go and do this"; the
                  // order that carries it (same star) leaves it be.
                  arrivalCommand:
                    ship.arrivalCommand &&
                    (ship.arrivalCommand.bodyName
                      ? order.destination.kind === 'body' && order.destination.bodyName === ship.arrivalCommand.bodyName
                      : order.destination.kind === 'star' && order.destination.starId === ship.arrivalCommand.starId)
                      ? ship.arrivalCommand
                      : null,
                  pendingHyperdriveJump: null,
                  // A real order actually taking effect supersedes any
                  // still-queued comms-delayed command — same "the newest
                  // thing wins" reasoning pendingHyperdriveJump already
                  // gets, and just as necessary here: without this, a
                  // player who queues an order under delay and then issues
                  // a fresh one before the first arrives (contact restored,
                  // or simply changing their mind) would find the stale one
                  // silently re-fires later and stomps the new order.
                  pendingMoveOrder: null,
                  // A fresh player order replaces whatever was queued behind
                  // the old one; the settler/follow handlers (keepFollowing)
                  // are the ship carrying on with its own plan and don't.
                  orderQueue: keepFollowing ? ship.orderQueue : [],
                  warpReadySimDays: warpReadySimDays ?? ship.warpReadySimDays,
                  followingShipId: keepFollowing ? ship.followingShipId : null,
                  // A manual order ends a survey job; the job's own flights
                  // (keepFollowing) leave it be.
                  surveyJob: keepFollowing ? ship.surveyJob : null,
                  founding: keepFollowing ? ship.founding : null,
                  automation: keepFollowing ? ship.automation : null,
                },
                simDays,
              )
            : ship,
        ),
      }
    }),
  setPendingCommands: (id, commands) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, pendingCommands: commands } : ship)),
    })),
  setArrivalCommand: (id, arrival) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, arrivalCommand: arrival } : ship)),
    })),
  setSurveyJob: (id, job) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, surveyJob: job } : ship)),
    })),
  setShipCargo: (id, cargo) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, cargo } : ship)),
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
      // A ship coming to rest keeps its own fleet — fleets merge only when
      // asked (mergeFleets), never just by stopping next to each other, so
      // a fleet that travelled together stays one fleet wherever it lands.
      const fleetId = ship.fleetId
      const simDays = useGameTimeStore.getState().simDays
      const ships = s.ships.map((sh) =>
        sh.id === id
          ? appendHistory(
              {
                ...sh,
                location,
                fleetId,
                order: null,
                hyperdriveReadySimDays: cooldowns?.hyperdriveReadySimDays ?? sh.hyperdriveReadySimDays,
                warpReadySimDays: cooldowns?.warpReadySimDays ?? sh.warpReadySimDays,
                pendingHyperdriveJump: null,
                // Same reasoning as setShipOrder's own pendingMoveOrder
                // clear — a ship actually coming to rest supersedes
                // whatever comms-delayed command might still be queued.
                pendingMoveOrder: null,
                followingShipId: keepFollowing ? sh.followingShipId : null,
                surveyJob: keepFollowing ? sh.surveyJob : null,
                founding: keepFollowing ? sh.founding : null,
                automation: keepFollowing ? sh.automation : null,
              },
              simDays,
            )
          : sh,
      )
      return { ships }
    }),
  setPendingHyperdriveJump: (id, starId, arrivesSimDays) =>
    set((s) => ({
      ships: s.ships.map((ship) =>
        ship.id === id ? { ...ship, pendingHyperdriveJump: starId, pendingHyperdriveJumpArrivesSimDays: arrivesSimDays } : ship,
      ),
    })),
  setPendingMoveOrder: (id, pending) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, pendingMoveOrder: pending } : ship)),
    })),
  setPatrol: (id, on) => set((s) => ({ ships: s.ships.map((ship) => (ship.id === id ? { ...ship, patrol: on, pendingPatrol: null } : ship)) })),
  setPendingPatrol: (id, pending) => set((s) => ({ ships: s.ships.map((ship) => (ship.id === id ? { ...ship, pendingPatrol: pending } : ship)) })),
  setSettlers: (id, settlers) => set((s) => ({ ships: s.ships.map((ship) => (ship.id === id ? { ...ship, settlers } : ship)) })),
  setFounding: (id, founding) => set((s) => ({ ships: s.ships.map((ship) => (ship.id === id ? { ...ship, founding } : ship)) })),
  setAutomation: (id, automation) => set((s) => ({ ships: s.ships.map((ship) => (ship.id === id ? { ...ship, automation } : ship)) })),
  setBombardStance: (id, stance) =>
    set((s) => ({ ships: s.ships.map((ship) => (ship.id === id ? { ...ship, bombardStance: stance, pendingBombard: null } : ship)) })),
  setPendingBombard: (id, pending) =>
    set((s) => ({ ships: s.ships.map((ship) => (ship.id === id ? { ...ship, pendingBombard: pending } : ship)) })),
  setPendingStance: (id, pending) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, pendingStance: pending } : ship)),
    })),
  setOrderQueue: (id, queue) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, orderQueue: queue } : ship)),
    })),
  setPendingQueueAdds: (id, adds) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, pendingQueueAdds: adds } : ship)),
    })),
  setSafeSince: (id, simDays) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, safeSinceSimDays: simDays } : ship)),
    })),
  setFollowing: (id, targetShipId) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, followingShipId: targetShipId } : ship)),
    })),
  setMergeInto: (ids, fleetId) =>
    set((s) => {
      const set_ = new Set(ids)
      return { ships: s.ships.map((ship) => (set_.has(ship.id) ? { ...ship, mergeIntoFleetId: fleetId } : ship)) }
    }),
  applyCombatDamage: (next, destroyedIds) =>
    set((s) => {
      const destroyed = new Set(destroyedIds)
      const lostFleetIds = new Set(s.ships.filter((sh) => destroyed.has(sh.id)).map((sh) => sh.fleetId))
      const simDays = useGameTimeStore.getState().simDays
      const ships = s.ships
        .filter((ship) => !destroyed.has(ship.id))
        .map((ship) => {
          if (!next[ship.id]) return ship
          const updated = { ...ship, combat: next[ship.id] }
          // Combat resolves in COMBAT_STEP_SECONDS-sized steps — appending a
          // history entry on every single one (as setShipOrder/setShipLocation
          // do unconditionally) would burn through MAX_SHIP_HISTORY_ENTRIES in
          // seconds of real fight time, leaving nothing to look back years
          // into for a distant fleet. Throttled instead: a delayed viewer's
          // health readout for a ship mid-fight is coarse (updates roughly
          // every MIN_COMBAT_HISTORY_INTERVAL_DAYS) rather than a live combat
          // log — which is the right flavor anyway (see commsVisual.ts's own
          // note on the combat arena itself staying untouched/live).
          const lastEntry = ship.history?.[ship.history.length - 1]
          if (lastEntry && simDays - lastEntry.simDays < MIN_COMBAT_HISTORY_INTERVAL_DAYS) return updated
          return appendHistory(updated, simDays)
        })
      for (const fleetId of lostFleetIds) pruneFleetIfEmpty(fleetId, ships)
      // A destroyed ship can't stay selected — same cleanup removeShip
      // already does for the lost-in-hyperspace case.
      return { ships, ...pruneSelection(s, destroyed) }
    }),
  setFtlCharge: (id, charge) =>
    set((s) => ({
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, combat: { ...ship.combat, ftlCharge: charge } } : ship)),
    })),
  setStance: (id, stance) =>
    set((s) => ({
      // A stance actually taking effect (whether applied directly or fired
      // by useCommsResolver once a queued one arrives) supersedes any
      // still-pending one, same "the newest thing wins" reasoning
      // setShipOrder already applies to pendingHyperdriveJump.
      ships: s.ships.map((ship) => (ship.id === id ? { ...ship, stance, pendingStance: null } : ship)),
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
      // Civilian hulls (science, construction, cargo…) never join a fleet.
      if (anyCivilian(s.ships.filter((sh) => sh.fleetId === intoFleetId || sh.fleetId === fromFleetId))) return s
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
        name: nextFleetName(fleetState.fleets, moving[0].ownerId),
        ownerId: moving[0].ownerId,
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
