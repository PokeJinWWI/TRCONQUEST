import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore, type ShipCombatState } from '../state/shipStore'
import { useFleetStore } from '../state/fleetStore'
import { usePlayerStore } from '../state/playerStore'
import { useTechStore } from '../state/techStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { useCombatStore } from '../state/combatStore'
import {
  COMBAT_STEP_DAYS,
  MAX_STEPS_PER_TICK,
  activeEnemyContacts,
  combatCatchUpCursor,
  stepEngagements,
  syncEngagements,
} from '../scene/combatResolution'
import { bodyLivePosition, bodyOrbitalVelocity, getShipRenderPosition, planMove, shipSystemId, SOL_SYSTEM_ID } from '../scene/shipPhysics'
import { shipCombatProfile } from '../scene/combatResolution'
import { utilityEffectiveness } from '../data/combatData'
import { combatLocationLabel } from '../state/combatStore'

// How far out into system space a disengaging ship is placed, in system
// units. Small — this is a nudge clear of whatever it was orbiting so it
// renders as its own contact rather than sitting on the body's marker, not a
// claim about how far it actually travelled. The arena has no consistent
// km-per-unit scale (see combatArena's arenaBodyRadius), so there is no
// honest conversion from "30 arena units from the enemy" into a system-space
// distance; this is a picked, documented placement instead of a fake one.
const DISENGAGE_SYSTEM_OFFSET_UNITS = 1.5

// A STRANDED hull (utility destroyed) is placed much closer in, and this is
// a physical constraint rather than a taste call. A body's gravitational
// influence ends at its Hill sphere — about 0.2 system units for Earth —
// and past that the Sun dominates completely. Dropping a powerless wreck at
// the 1.5 units a powered ship flees to would put it seven Hill radii out,
// where "falls toward the body or settles into an orbit" is simply not what
// the physics does: measured, it wanders up to 34 units away and eventually
// falls into Sol. 0.08 units (~600,000 km, a bit beyond Luna) is comfortably
// inside Earth's Hill sphere, so local gravity is what governs it.
const STRANDED_SYSTEM_OFFSET_UNITS = 0.08
// Outward nudge for a stranded hull, in system units per sim-day. Must stay
// well UNDER escape velocity at STRANDED_SYSTEM_OFFSET_UNITS (~0.013
// units/day for Earth) or the wreck simply leaves — which is how an earlier
// 0.05 value behaved, at nearly twice escape velocity. Small enough that
// gravity, not this, decides where it ends up.
const STRANDED_DRIFT_SPEED_UNITS_PER_DAY = 0.003

// Drives combat. Subscribes to the clock exactly the way useShipOrderSettler
// does — reacting to simDays advancing rather than running its own
// requestAnimationFrame loop — so it keeps resolving regardless of which
// view's <Canvas> happens to be mounted, or whether the combat view is open
// at all. A battle in another system resolves whether or not anyone is
// watching it.
//
// Each pass does three things in order:
//   1. Reconcile the engagement roster against where ships actually are, so
//      fleets that just arrived join the fight and fleets that left drop out.
//   2. Step the simulation forward in fixed COMBAT_STEP_SECONDS increments up
//      to the current clock, so outcomes don't depend on framerate.
//   3. Apply the results — damage, destructions, and completed FTL escapes.
export function useCombatResolver() {
  useEffect(() => {
    const resolve = (simDays: number) => {
      const combat = useCombatStore.getState()
      const { ships } = useShipStore.getState()
      const { fleets } = useFleetStore.getState()
      // Whether the PLAYER's own country has researched Free-Flight
      // Maneuvering (see techData.ts) — the one tech check stepEngagements
      // needs from outside, resolved here so it stays a pure function (see
      // its own playerCanFreeFloat param comment).
      const playerCountryId = usePlayerStore.getState().selectedCountryId ?? ''
      const playerCanFreeFloat = useTechStore.getState().stateFor(playerCountryId).researched.has('free-flight-maneuvering')

      const synced = syncEngagements(ships, combat.engagements, simDays)
      const hadEngagements = combat.engagements.length > 0

      // Combat is unobservable at strategic pace (a real second is ~518,400
      // sim-seconds), so the clock follows whether any fight is live: pulled
      // down to tactical when one starts, handed back when the last one ends.
      // Gated on the player's preference, so it only ever undoes something
      // this hook itself did, and it deliberately never touches `paused` —
      // see gameTimeStore.setMode.
      //
      // Called on BOTH exits below rather than only the early one: an
      // engagement can end either by the roster emptying (sync) or by one
      // side being wiped out mid-step (the resolver). An earlier cut only
      // handled the sync path, so a fight that ended in a kill — the normal
      // case — left the player stranded in tactical time afterwards.
      const followCombatWithClock = (hasEngagements: boolean) => {
        if (!combat.autoTacticalOnEngage) return
        const time = useGameTimeStore.getState()
        if (hasEngagements && time.mode !== 'tactical') time.setMode('tactical')
        else if (!hasEngagements && time.mode === 'tactical') time.setMode('normal')
      }

      if (synced.length === 0) {
        if (hadEngagements) {
          combat.replaceEngagements([])
          followCombatWithClock(false)
        }
        return
      }

      if (!hadEngagements) followCombatWithClock(true)

      // Snapshot, right now, which ships have a live enemy within range and
      // line of fire — the only situation an FTL escape's risk should be
      // elevated by (see combatData's ACTIVE_ENGAGEMENT_RISK_BONUS). Taken
      // BEFORE stepping because by the time a charge completes below and we
      // call planMove, stepEngagements has already dropped that ship from
      // `engagements` (it's leaving), so planMove itself can no longer see
      // what it was fighting. A tick-start snapshot is a deliberate
      // approximation — steps are 0.1s and a tick catches up at most 4s
      // (MAX_STEPS_PER_TICK), so "engaged at tick start" and "engaged at the
      // instant of escape" differ by at most a few steps, which is fine for
      // a coarse risk modifier rather than a precise combat mechanic.
      const activelyEngagedIds = new Set<string>()
      for (const e of synced) {
        for (const p of e.participants) {
          if (activeEnemyContacts(p, e, ships, simDays).length > 0) activelyEngagedIds.add(p.shipId)
        }
      }

      // Catch up from wherever resolution last got to. Bounded so that time
      // running far ahead of combat (normal mode, or a long pause) can't
      // stall a frame trying to simulate millions of steps — combat then
      // simply resolves at its own maximum pace.
      let cursor = Math.min(...synced.map((e) => e.resolvedThroughSimDays))

      // ...bounded so a strategic-time excursion can't leave a permanent
      // catch-up debt that keeps the battle running at ~240x after the clock
      // returns to tactical. See combatCatchUpCursor for the full reasoning.
      cursor = combatCatchUpCursor(cursor, simDays)
      let engagements = synced
      let steps = 0
      const pendingDamage: Record<string, ShipCombatState> = {}
      const destroyed = new Set<string>()
      const escaped = new Set<string>()
      const disengaged = new Set<string>()

      // Strictly whole steps only. An earlier cut advanced `cursor` to
      // `simDays` whenever less than a full step remained, which billed a
      // partial frame as a complete COMBAT_STEP_SECONDS — at 60fps in
      // tactical mode only ~0.017 sim-seconds elapse per frame, so every
      // per-step effect (shield regen most visibly) ran several times too
      // fast, and the rate varied with framerate. Leftover time below one
      // step is simply carried: `resolvedThroughSimDays` stays put and the
      // remainder accumulates into the next frame.
      while (cursor + COMBAT_STEP_DAYS <= simDays && steps < MAX_STEPS_PER_TICK && engagements.length > 0) {
        cursor += COMBAT_STEP_DAYS
        steps++
        // Each step reads live ship state for anything already written back,
        // and the accumulated `pendingDamage` for anything not yet flushed —
        // merged here so multi-step catch-up compounds correctly rather than
        // each step re-reading stale HP.
        const shipsForStep = useShipStore.getState().ships.map((s) =>
          pendingDamage[s.id] ? { ...s, combat: pendingDamage[s.id] } : s,
        )
        const result = stepEngagements(engagements, shipsForStep, cursor, undefined, fleets, playerCanFreeFloat)
        engagements = result.engagements
        Object.assign(pendingDamage, result.shipCombat)
        for (const id of result.destroyedShipIds) destroyed.add(id)
        for (const id of result.escapedShipIds) escaped.add(id)
        for (const id of result.disengagedShipIds) disengaged.add(id)
      }

      const damageToApply = { ...pendingDamage }
      for (const id of destroyed) delete damageToApply[id]

      if (Object.keys(damageToApply).length > 0 || destroyed.size > 0) {
        useShipStore.getState().applyCombatDamage(damageToApply, [...destroyed])
      }

      combat.replaceEngagements(engagements)
      // The other way a fight ends: one side was wiped out (or escaped)
      // during the steps above, so `engagements` came back empty even though
      // sync had produced a live one.
      if (engagements.length === 0) followCombatWithClock(false)

      // Broke contact by outrunning everyone (no FTL involved) — put the ship
      // into open system space so it shows on the system map as a real,
      // separate contact instead of silently snapping back to whatever body
      // it was nominally orbiting. A `system-point` location is specifically
      // what makes the disengagement stick: combatLocationKey returns null
      // for one, so syncEngagements can never pull the ship back into the
      // fight it just left (every other location kind would re-form it on the
      // very next tick).
      if (disengaged.size > 0) {
        const shipStore = useShipStore.getState()
        for (const id of disengaged) {
          if (destroyed.has(id)) continue
          const ship = shipStore.ships.find((s) => s.id === id)
          if (!ship) continue
          const profile = shipCombatProfile(ship)
          const stranded =
            !!profile && utilityEffectiveness(ship.combat.componentHp.utility, profile.components.utility) <= 0

          const bodyName = combatLocationLabel(ship.location)
          const bodyPosition = bodyLivePosition(bodyName, simDays)
          const { position } = getShipRenderPosition(ship, simDays)
          const away = position.clone().sub(bodyPosition)
          if (away.length() < 1e-6) away.set(1, 0, 0)
          away.normalize()

          // A ship that ran under its own power genuinely travelled; one whose
          // engines are dead did not, and is left near the body it was
          // fighting at so local gravity can act on it (see the constants).
          const offset = stranded ? STRANDED_SYSTEM_OFFSET_UNITS : DISENGAGE_SYSTEM_OFFSET_UNITS
          const escapePoint = bodyPosition.clone().add(away.clone().multiplyScalar(offset))
          shipStore.setShipLocation(
            id,
            { kind: 'system-point', systemId: shipSystemId(ship) ?? SOL_SYSTEM_ID, position: [escapePoint.x, escapePoint.y, escapePoint.z] },
            undefined,
            true,
          )

          // A hull that left the fight with its utility destroyed has no
          // engines to hold that position with, so it keeps coasting under
          // gravity from here (see useShipDriftIntegrator).
          //
          // Seeded as the BODY'S OWN orbital velocity plus a small outward
          // nudge along the direction it left on. Inheriting the body's
          // velocity is the important half: a ship in Earth orbit is also
          // moving with Earth around the Sun, and a wreck seeded at
          // heliocentric rest instead loses that and spirals into Sol over
          // weeks (measured: 64 sim-days from a stranding near Earth) rather
          // than staying anywhere near the planet it was fighting at. The
          // nudge carries only the DIRECTION it left on, since the arena has
          // no consistent km-per-unit scale (see combatArena's
          // arenaBodyRadius) and its arena speed therefore cannot be
          // converted into a system-space one honestly.
          if (stranded) {
            const drift = bodyOrbitalVelocity(bodyName, simDays).add(
              away.clone().multiplyScalar(STRANDED_DRIFT_SPEED_UNITS_PER_DAY),
            )
            shipStore.setDrift(id, { velocity: [drift.x, drift.y, drift.z], updatedSimDays: simDays })
          }
        }
      }

      // A completed FTL charge is the ship actually leaving — turn the stored
      // intent into a real move now that the drive has fired. Done here
      // rather than inside the resolver because it's order planning
      // (planMove), which is squarely the strategic layer's job.
      if (escaped.size > 0) {
        const shipStore = useShipStore.getState()
        const { addHyperlane } = useHyperlaneStore.getState()
        for (const id of escaped) {
          const ship = shipStore.ships.find((s) => s.id === id)
          if (!ship?.combat.ftlCharge) continue
          const destination = ship.combat.ftlCharge.destination
          shipStore.setFtlCharge(id, null)
          const result = planMove(ship, destination, simDays, { activelyEngaged: activelyEngagedIds.has(id) })
          if (result.kind === 'order') {
            shipStore.setShipOrder(id, result.order, result.warpReadyOverride, true)
          } else if (result.kind === 'instant') {
            shipStore.setShipLocation(id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays }, true)
            if (result.hyperlaneEstablished) addHyperlane(...result.hyperlaneEstablished)
          } else if (result.kind === 'lost-in-hyperspace') {
            // Escaped the battle and lost the jump — a real outcome of
            // fleeing through an uncharted lane under fire, not a bug.
            shipStore.removeShip(id)
          }
          // Anything else ('on-cooldown', 'paused'): the charge completed but
          // the drive won't fire. The ship stays put and rejoins the fight on
          // the next sync, which is the honest result of trying to run with a
          // drive that isn't actually ready.
        }
      }
    }

    resolve(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolve(state.simDays))
  }, [])
}
