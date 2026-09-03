import { create } from 'zustand'
import type { ComponentKind } from '../data/combatData'
import type { FleetAllegiance } from '../data/shipData'
import type { ArenaPoint, CombatObstacle, GridDensity } from '../scene/combatArena'
import type { ShipLocation } from './shipStore'

// A missile or torpedo already committed to a target but still crossing the
// distance to it (see combatData's "Missile / torpedo travel time" and
// combatResolution's projectile-flight step). Whether it hits, misses, or was
// already shot down by point defense is decided at the instant it launches
// (same rolls as every other weapon) — this record only carries a round that
// SURVIVED that instant and is now just closing the distance, so `willHit`
// is the one thing left undetermined by anything happening during flight:
// only whether the target is still there to receive it when it arrives.
export interface InFlightProjectile {
  id: string
  sourceShipId: string
  targetShipId: string
  damageType: 'missile' | 'torpedo'
  // Pre-multiplier damage, already resolved against the firing ship's
  // weapons-component effectiveness and (for a missile) range falloff at the
  // moment of launch — see combatResolution's firing loop. Reapplied through
  // the shields/armor/component matrix against the target's state AT
  // ARRIVAL, not launch, so shield regen or other hits it takes mid-flight
  // are accounted for.
  rawDamage: number
  preferredComponent: ComponentKind | null
  // False for a round that will simply miss on arrival (torpedo inaccuracy
  // or active chaff, rolled at launch) rather than vanishing outright — it
  // still visibly travels and whiffs, same as a direct-fire miss reads as a
  // shot that went somewhere rather than not being fired at all.
  willHit: boolean
  // Real, continuous arena position — advanced each combat step in flight,
  // homing on the target's current position (see participantArenaPosition).
  position: ArenaPoint
  speedUnitsPerSecond: number
  // Separation between shooter and target at the moment this round launched
  // — the denominator for `progress` below. A homing round's target can
  // itself be moving, so "distance remaining" alone doesn't say how far
  // through its flight a round actually is; this is what turns that into an
  // honest fraction (see CombatProjectileMarker.tsx's progress bar).
  initialDistanceUnits: number
  // 0 (just launched) to 1 (arriving) — recomputed every combat step in the
  // projectile-flight step from current distance-to-target vs.
  // initialDistanceUnits, clamped. Purely a display value; arrival itself is
  // still decided by PROJECTILE_IMPACT_RADIUS_UNITS, not by this hitting 1.
  progress: number
}

// Live combat state — which fights are happening, and everything transient
// about them (arena positions, weapon timers, chosen targets).
//
// Deliberately split from ShipInstance.combat, which holds only *persistent*
// damage that outlives a battle (component HP, shields, armor). Anything that
// exists solely for the duration of a fight lives here instead, so a ship
// that disengages simply stops appearing in any engagement rather than having
// to have a pile of arena fields reset on it.

// Which side of an engagement a ship is on. Neutrals never fight at all (see
// areHostile), so every participant resolves to one of exactly two sides —
// which keeps the model honest for the eventual N-vs-N case without
// pretending to support free-for-alls it doesn't.
export type CombatSide = 0 | 1

// Who shoots at whom. Neutral is deliberately inert: it's a real allegiance a
// fleet can hold without that fleet being dragged into every passing
// firefight. Friendly counts as player-side, so an allied fleet parked at a
// contested body joins the fight rather than watching it.
export function areHostile(a: FleetAllegiance, b: FleetAllegiance): boolean {
  const isPlayerSide = (x: FleetAllegiance) => x === 'player' || x === 'friendly'
  const isEnemySide = (x: FleetAllegiance) => x === 'hostile'
  return (isPlayerSide(a) && isEnemySide(b)) || (isEnemySide(a) && isPlayerSide(b))
}

export function sideFor(allegiance: FleetAllegiance): CombatSide {
  return allegiance === 'hostile' ? 1 : 0
}

// The identity of a place two fleets can meet. Only *resting* locations
// produce a key — a ship mid-order is in transit across real interplanetary
// distance and simply isn't in the same place as anything else, so it can't
// be engaged. Bare system/interstellar points are excluded too: they're
// arbitrary coordinates that two ships would have to match exactly, which
// says "these ships happen to share a float" rather than "these fleets met."
export function combatLocationKey(location: ShipLocation): string | null {
  if (location.kind === 'orbiting') return `body:${location.systemId}:${location.bodyName}`
  if (location.kind === 'star') return `star:${location.starId}`
  return null
}

export function combatLocationLabel(location: ShipLocation): string {
  if (location.kind === 'orbiting') return location.bodyName
  if (location.kind === 'star') return location.starId
  return 'Deep space'
}

// One ship's transient presence in a fight. Its position is a lattice node
// (see combatArena.ts), and a move in progress is stored as the hop it's
// currently making plus the queued remainder — rather than an interpolated
// position — so the arena, like everything else in this project, renders as a
// pure function of simDays rather than from mutated per-frame state.
export interface CombatParticipant {
  shipId: string
  side: CombatSide
  // Where the ship ACTUALLY is, in real continuous arena units, as of
  // `positionSimDays` — not a lattice index, and never a destination.
  //
  // That last part is load-bearing. An earlier model stored the current
  // *hop's endpoint* here and set it the instant a hop began, so `position`
  // meant "where this leg ends." Re-ordering a ship mid-flight then read
  // `position` as its start point and snapped it straight to the previous
  // order's destination — the reported "it teleports to where I sent it
  // last" bug. Position and destination are now different things, which
  // makes that class of bug unrepresentable.
  position: ArenaPoint
  // Current velocity, in arena units per sim-second. Integrated under an
  // acceleration limit (see combatResolution.integrateMotion), which is what
  // gives ships real inertia — they build up speed, coast, brake to a stop,
  // and sweep an arc when turning instead of pivoting instantly.
  velocity: ArenaPoint
  // When `position`/`velocity` were last integrated. Rendering extrapolates
  // from here so motion stays smooth between the resolver's 0.1s steps.
  positionSimDays: number
  // Remaining waypoints to fly through, in order. Empty means "hold here"
  // (and the ship will decelerate to a stop if it's still moving).
  path: ArenaPoint[]
  // Per *mount index* (not mount id) — a hull carrying three identical
  // autocannons needs three independent timers, and they're distinguished
  // only by position in the class's weapons array.
  weaponReadySimDays: number[]
  // Player-assigned focus. Null means "auto-pick the nearest enemy", which is
  // also what every AI-controlled ship does, so an unmanaged fight still
  // resolves sensibly.
  targetShipId: string | null
  // Which of the target's three healthbars to concentrate on. Null spreads
  // damage across whatever's exposed — see combatResolution's pickComponent.
  targetComponent: ComponentKind | null
  // Latched the moment the player issues this ship a lattice move, and only
  // cleared by explicitly re-enabling auto-engage. Without the latch, the
  // resolver's default approach behavior would resume the instant a
  // player-ordered path finished and march the ship straight back at the
  // enemy — which makes deliberate kiting (the entire point of giving a
  // long-ranged hull a speed advantage) impossible to actually perform.
  holdPosition: boolean
  // Persistently close on this ship's current target (explicit, or the
  // nearest enemy if none) rather than holding whatever range the stance
  // would normally pick — the answer to a target that's actively running
  // (Flee stance, or just backing off under Kite) drifting back out of reach
  // between plans. Overridden by holdPosition (a manual move order still
  // wins outright, same as it already overrides the stance system), and only
  // ever affects movement — targeting/firing are unrelated to this flag.
  chasing?: boolean
  // The player has ordered this ship to charge its current target (explicit,
  // or the nearest enemy if none — same resolution chasing/firing already
  // use) and collide with it, instead of holding whatever range its stance
  // would normally pick. Distinct from chasing: chase closes to a normal
  // firing standoff and holds it, ramming closes all the way to contact.
  // Cleared automatically by the resolver the instant it actually connects
  // (see combatResolution's ramming-impact step) — a single deliberate hit,
  // not a standing order to keep colliding every step. Works for an unarmed
  // ship too, which chase's approach logic (gated on having a weapon range to
  // close to) does not.
  ramming?: boolean
  // Thruster Boost / Shield Boost / Weapons Boost (see combatData's Tactics
  // section and BOOST_TACTIC_IDS) — three toggles until cancelled, all
  // drawing from the same power grid, so at most ONE of the three is ever
  // true at once: every setter that turns one on (setThrusterBoost/
  // setShieldBoost/setWeaponsBoost, and the auto-tactics pass) clears the
  // other two first. Same boolean-flag shape as ramming/chasing above,
  // otherwise. Thruster Boost additionally can never be true alongside
  // spinThrustActive below — setThrusterBoost refuses to turn on while Spin
  // Thrust has the ship, and setSpinThrust clears it the instant Spin Thrust
  // takes over — since a directed speed/evasion push makes no sense once
  // steering has been handed to a random walk.
  thrusterBoostActive?: boolean
  shieldBoostActive?: boolean
  weaponsBoostActive?: boolean
  // Spin Thrust (see combatData's Tactics section) — a toggle until
  // cancelled. UNLIKE every other tactic, this one genuinely overrides
  // movement rather than layering on top of it (see combatResolution's
  // movement step): while active, the ship's velocity is a random walk, full
  // stop, regardless of stance, Chase, Ram, or even a player's manual
  // holdPosition order — "uncontrollable" is the whole point. The resolver
  // itself is what turns this back off if the random walk is about to drift
  // the hull into a body (see SPIN_THRUST_COLLISION_LOOKAHEAD_SECONDS) — a
  // real, persisted state change (not a one-step bypass), so control reverts
  // to normal navigation for good rather than the same close call recurring
  // next step.
  spinThrustActive?: boolean
  // Locks this ship's velocity to match a named obstacle's own (see
  // CombatObstacle.velocity and combatResolution's moonArenaState) instead
  // of flying under its own thrust — the building block for "stay on the
  // far side of a moving body," ahead of anything actually threatening from
  // one (a weaponized moon) existing yet. Mutually exclusive with
  // holdPosition/chasing in the UI (see CombatPanel), though the resolver
  // itself only enforces holdPosition winning outright — see
  // stepEngagements' movement step.
  inheritVelocityFrom?: string | null
  // The player has ordered this hull to detonate. Acted on by the resolver at
  // the top of its next step (see stepEngagements) rather than immediately,
  // so the blast resolves inside the same fixed-step simulation everything
  // else does — a scuttle that applied instantly from a click would land
  // outside the step ordering and could kill a ship that had already fired
  // this step, or miss one that had already moved.
  scuttleOrdered?: boolean
  // The stance/chase destination the resolver last tried to plan a route
  // to — recorded whether or not that attempt actually found one (see
  // stepEngagements' approach step and orderParticipantTo's "no route
  // exists" fallback). Distinct from path's own final point specifically
  // for the failure case: a destination on the far side of a body big
  // enough to exhaust the pathfinding search returns the participant with
  // its path untouched, and without this field the replan-tolerance check
  // couldn't tell "already tried and failed" from "never tried" — so it
  // re-ran the same expensive, doomed search every single 0.1s step for as
  // long as the target kept being on the wrong side of the body. This is
  // what lets a failed attempt count as "handled" until the destination
  // itself actually moves.
  lastPlanAttempt?: ArenaPoint | null
}

// Every tactic (see combatData's Tactics section) currently active on this
// participant — the single source of truth for "what should show a badge"
// (see CombatShipMarker.tsx's arena marker and CombatPanel.tsx's roster
// rows, the only two places this is read). Returns plain `string`s, not the
// narrower `TacticId`, deliberately: a badge renderer should be able to
// handle an id it doesn't recognize (see TACTIC_BADGE_LABELS's own comment
// on the "???" fallback) without this function's return type forcing every
// caller to already agree on the closed set of known ids.
export function activeTacticIds(p: CombatParticipant): string[] {
  const ids: string[] = []
  if (p.thrusterBoostActive) ids.push('thruster-boost')
  if (p.shieldBoostActive) ids.push('shield-boost')
  if (p.weaponsBoostActive) ids.push('weapons-boost')
  if (p.spinThrustActive) ids.push('spin-thrust')
  if (p.ramming) ids.push('ramming')
  return ids
}

export interface Engagement {
  id: string
  // The shared location key every participant is resting at.
  locationKey: string
  locationLabel: string
  startedSimDays: number
  density: GridDensity
  // The real point the visible window is centred on. Purely a camera
  // parameter — recentring never moves a ship or a body, only what's in
  // frame (see combatArena.ts's header).
  center: ArenaPoint
  // Celestial bodies sharing the arena — blocking line of fire and barring
  // movement. Derived from where the fight is happening (see
  // combatResolution.obstaclesForLocation), not authored per engagement.
  obstacles: CombatObstacle[]
  participants: CombatParticipant[]
  // Missiles/torpedoes launched but not yet arrived — see InFlightProjectile
  // and combatResolution's projectile-flight step. Optional/absent reads as
  // "none in flight" so no existing Engagement literal (tests included) needs
  // updating for this to exist.
  projectiles?: InFlightProjectile[]
  // How far combat has actually been simulated. The resolver steps in fixed
  // sim-second increments from here up to the clock, rather than resolving a
  // variable-sized chunk per frame, so outcomes don't depend on framerate.
  resolvedThroughSimDays: number
}

// Whether an Engagement is an actual FIGHT right now — some pair on its
// roster is genuinely hostile to each other — as opposed to merely EXISTING:
// per syncEngagements' own design, an engagement deliberately persists once
// opened even after one side is wiped out or leaves (a solo "arena" to look
// around in, or linger in after winning — see createSoloEngagement's own
// comment), and it can even get its entire roster silently swapped for a
// brand-new one while keeping the SAME id (same locationKey, see
// syncEngagements' `prior` handling) — e.g. loading a fresh scenario at the
// same body a previous one just finished at. "An engagement object exists"
// is therefore NOT the same question as "is a fight actually happening",
// and conflating the two is what caused two real bugs: the Ship Panel
// showing "Enter Combat"/"In combat" for a hostile-free arena (see
// ShipPanel.tsx), and the clock failing to snap back to tactical when a
// brand-new scenario loads into an engagement id that technically already
// existed (see useCombatResolver.ts). Both now go through this one check
// instead of `!!engagement`/`engagements.length > 0`.
export function engagementIsContested(e: Pick<Engagement, 'participants'>, allegianceOf: (shipId: string) => FleetAllegiance | undefined): boolean {
  return e.participants.some((a) => {
    const allegianceA = allegianceOf(a.shipId)
    if (!allegianceA) return false
    return e.participants.some((b) => {
      if (b.shipId === a.shipId) return false
      const allegianceB = allegianceOf(b.shipId)
      return !!allegianceB && areHostile(allegianceA, allegianceB)
    })
  })
}

interface CombatState {
  engagements: Engagement[]
  // Which engagement the combat view is currently showing, if any.
  viewedEngagementId: string | null
  // Whether entering combat should yank the clock into tactical mode. On by
  // default because combat is otherwise literally unobservable: at normal 1x
  // a real second is ~518,400 sim-seconds, so an entire battle would resolve
  // between two frames. Exposed as a toggle rather than hardcoded so a player
  // who doesn't want to be interrupted can let fights auto-resolve.
  autoTacticalOnEngage: boolean
  setAutoTacticalOnEngage: (enabled: boolean) => void
  addEngagement: (engagement: Engagement) => void
  removeEngagement: (id: string) => void
  replaceEngagements: (engagements: Engagement[]) => void
  viewEngagement: (id: string | null) => void
  setParticipantTarget: (engagementId: string, shipId: string, targetShipId: string | null) => void
  // Points EVERY listed ship at one enemy at once. The answer to being
  // outnumbered is to kill hulls one at a time — every kill permanently
  // removes that ship's damage from the fight, so concentrating fire is how
  // a smaller force closes the gap. Doing that ship-by-ship put the most
  // clicking on the player who could least afford the time, which is exactly
  // backwards. Takes an explicit id list rather than "all player ships" so
  // the caller owns the ownership rule (see CombatPanel).
  setFleetTarget: (engagementId: string, shipIds: string[], targetShipId: string | null) => void
  setParticipantTargetComponent: (engagementId: string, shipId: string, component: ComponentKind | null) => void
  setDensity: (engagementId: string, density: GridDensity) => void
  setCenter: (engagementId: string, center: ArenaPoint) => void
  // Writes back a participant the caller has already recomputed — the move
  // itself is planned by combatResolution.orderParticipantTo, keeping the
  // "physics computes, store applies" split every other order path in this
  // project follows (see shipStore.setShipOrder's comment).
  setParticipant: (engagementId: string, participant: CombatParticipant) => void
  setHoldPosition: (engagementId: string, shipId: string, hold: boolean) => void
  setChasing: (engagementId: string, shipId: string, chasing: boolean) => void
  // See CombatParticipant.ramming.
  setRamming: (engagementId: string, shipId: string, ramming: boolean) => void
  // See CombatParticipant.thrusterBoostActive/shieldBoostActive/
  // weaponsBoostActive — turning any ONE of these three on clears the other
  // two (see combatData.BOOST_TACTIC_IDS).
  setThrusterBoost: (engagementId: string, shipId: string, active: boolean) => void
  setShieldBoost: (engagementId: string, shipId: string, active: boolean) => void
  setWeaponsBoost: (engagementId: string, shipId: string, active: boolean) => void
  // See CombatParticipant.spinThrustActive.
  setSpinThrust: (engagementId: string, shipId: string, active: boolean) => void
  // See CombatParticipant.inheritVelocityFrom. Pass an obstacle name to lock
  // onto it, or null to release back to normal flight.
  setInheritVelocityFrom: (engagementId: string, shipId: string, obstacleName: string | null) => void
  // Flags a hull to detonate on the resolver's next step — see
  // CombatParticipant.scuttleOrdered.
  orderScuttle: (engagementId: string, shipId: string) => void
}

export const useCombatStore = create<CombatState>((set) => ({
  engagements: [],
  viewedEngagementId: null,
  autoTacticalOnEngage: true,
  setAutoTacticalOnEngage: (enabled) => set({ autoTacticalOnEngage: enabled }),
  addEngagement: (engagement) => set((s) => ({ engagements: [...s.engagements, engagement] })),
  removeEngagement: (id) =>
    set((s) => ({
      engagements: s.engagements.filter((e) => e.id !== id),
      viewedEngagementId: s.viewedEngagementId === id ? null : s.viewedEngagementId,
    })),
  // The resolver computes a whole new engagement list per step (it's a pure
  // function of the previous list plus the ships), so it writes back through
  // one action rather than a pile of granular mutations.
  replaceEngagements: (engagements) =>
    set((s) => ({
      engagements,
      viewedEngagementId: engagements.some((e) => e.id === s.viewedEngagementId) ? s.viewedEngagementId : null,
    })),
  viewEngagement: (id) => set({ viewedEngagementId: id }),
  setParticipantTarget: (engagementId, shipId, targetShipId) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) => (p.shipId === shipId ? { ...p, targetShipId } : p)),
            }
          : e,
      ),
    })),
  setFleetTarget: (engagementId, shipIds, targetShipId) =>
    set((s) => {
      const ids = new Set(shipIds)
      return {
        engagements: s.engagements.map((e) =>
          e.id === engagementId
            ? { ...e, participants: e.participants.map((p) => (ids.has(p.shipId) ? { ...p, targetShipId } : p)) }
            : e,
        ),
      }
    }),
  setParticipantTargetComponent: (engagementId, shipId, targetComponent) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) => (p.shipId === shipId ? { ...p, targetComponent } : p)),
            }
          : e,
      ),
    })),
  // Every position here is already real, density-independent game state (see
  // combatArena.ts's header) — density only changes the pathfinding/
  // visualization lattice, so switching it is nothing more than flipping
  // this one field. Ships, bodies, the window centre, and any queued route
  // all stay exactly where they were; nothing needs remapping. (An earlier
  // cut stored positions AS lattice indices and round-tripped them through a
  // remap on every density change, which snapped each one to the nearest
  // node of the new spacing — a real, visible jump whenever the original
  // position wasn't already an exact multiple of the new spacing, which was
  // routine. Storing real coordinates as the ground truth removes the bug at
  // the root instead of patching the remap.)
  setDensity: (engagementId, density) =>
    set((s) => ({
      engagements: s.engagements.map((e) => (e.id === engagementId ? { ...e, density } : e)),
    })),
  // Slides the visible window. This is the answer to "movement shouldn't be
  // confined to one cube" — ships stay where they are in absolute lattice
  // terms, and the frame the player can issue orders within moves to include
  // new space.
  setCenter: (engagementId, center) =>
    set((s) => ({
      engagements: s.engagements.map((e) => (e.id === engagementId ? { ...e, center } : e)),
    })),
  setParticipant: (engagementId, participant) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? { ...e, participants: e.participants.map((p) => (p.shipId === participant.shipId ? participant : p)) }
          : e,
      ),
    })),
  orderScuttle: (engagementId, shipId) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) => (p.shipId === shipId ? { ...p, scuttleOrdered: true } : p)),
            }
          : e,
      ),
    })),
  setHoldPosition: (engagementId, shipId, hold) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? // Releasing the latch also drops any queued path, so
                    // "resume auto-engage" takes effect immediately rather
                    // than after the ship finishes walking to wherever it was
                    // last sent.
                    hold ? { ...p, holdPosition: true } : { ...p, holdPosition: false, path: [] }
                  : p,
              ),
            }
          : e,
      ),
    })),
  setChasing: (engagementId, shipId, chasing) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? // Turning chase ON also drops manual control (same
                    // "takes effect immediately" reasoning as
                    // setHoldPosition's own release path) — chase is a form
                    // of automatic movement, so it doesn't make sense to
                    // enable it while still latched to a stale manual order.
                    chasing
                    ? { ...p, chasing: true, ramming: false, holdPosition: false, path: [], inheritVelocityFrom: null }
                    : { ...p, chasing: false }
                  : p,
              ),
            }
          : e,
      ),
    })),
  setRamming: (engagementId, shipId, ramming) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? // Same "takes effect immediately" reasoning as chasing:
                    // enabling ramming drops any manual hold and any other
                    // movement lock, since it's itself a form of automatic
                    // (if very deliberate) movement.
                    ramming
                    ? { ...p, ramming: true, chasing: false, holdPosition: false, path: [], inheritVelocityFrom: null }
                    : { ...p, ramming: false }
                  : p,
              ),
            }
          : e,
      ),
    })),
  setInheritVelocityFrom: (engagementId, shipId, obstacleName) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? obstacleName
                    ? { ...p, inheritVelocityFrom: obstacleName, holdPosition: false, chasing: false, ramming: false, path: [] }
                    : { ...p, inheritVelocityFrom: null }
                  : p,
              ),
            }
          : e,
      ),
    })),
  // Thruster Boost / Shield Boost / Weapons Boost are a separate axis from
  // movement orders — deliberately NOT clearing ramming/chasing/holdPosition
  // the way those clear each other, since a boosted ship is still trying to
  // get wherever its movement order says. They DO clear EACH OTHER, though
  // (see combatData.BOOST_TACTIC_IDS's own comment): there's one power grid,
  // so switching one boost on switches the other two off, the same instant.
  setThrusterBoost: (engagementId, shipId, active) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? active
                    ? // Blocked while Spin Thrust has the ship (see
                      // CombatParticipant.spinThrustActive) — a directed
                      // speed/evasion push makes no sense on a ship that has
                      // already given up steering to a random walk. Turn Spin
                      // Thrust off first.
                      p.spinThrustActive
                      ? p
                      : { ...p, thrusterBoostActive: true, shieldBoostActive: false, weaponsBoostActive: false }
                    : { ...p, thrusterBoostActive: false }
                  : p,
              ),
            }
          : e,
      ),
    })),
  setShieldBoost: (engagementId, shipId, active) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? active
                    ? { ...p, shieldBoostActive: true, thrusterBoostActive: false, weaponsBoostActive: false }
                    : { ...p, shieldBoostActive: false }
                  : p,
              ),
            }
          : e,
      ),
    })),
  setWeaponsBoost: (engagementId, shipId, active) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? active
                    ? { ...p, weaponsBoostActive: true, thrusterBoostActive: false, shieldBoostActive: false }
                    : { ...p, weaponsBoostActive: false }
                  : p,
              ),
            }
          : e,
      ),
    })),
  // Spin Thrust DOES clear every other movement lock when switched on — see
  // CombatParticipant.spinThrustActive's own comment on why it's genuinely
  // uncontrollable rather than layered on top like the other three tactics.
  // Switching it off hands control back with an empty path, same as
  // releasing holdPosition — the ship's stance/order picks a fresh
  // destination from wherever the random walk left it, rather than resuming
  // a route planned from a position it's no longer at.
  setSpinThrust: (engagementId, shipId, active) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? active
                    ? {
                        ...p,
                        spinThrustActive: true,
                        thrusterBoostActive: false,
                        holdPosition: false,
                        chasing: false,
                        ramming: false,
                        inheritVelocityFrom: null,
                        path: [],
                      }
                    : { ...p, spinThrustActive: false, path: [] }
                  : p,
              ),
            }
          : e,
      ),
    })),
}))
