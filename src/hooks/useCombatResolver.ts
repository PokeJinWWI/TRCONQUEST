import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore, type ShipCombatState } from '../state/shipStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { useCombatStore } from '../state/combatStore'
import {
  COMBAT_STEP_DAYS,
  MAX_STEPS_PER_TICK,
  stepEngagements,
  syncEngagements,
} from '../scene/combatResolution'
import { planMove } from '../scene/shipPhysics'

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

      // Catch up from wherever resolution last got to. Bounded so that time
      // running far ahead of combat (normal mode, or a long pause) can't
      // stall a frame trying to simulate millions of steps — combat then
      // simply resolves at its own maximum pace.
      let cursor = Math.min(...synced.map((e) => e.resolvedThroughSimDays))
      let engagements = synced
      let steps = 0
      const pendingDamage: Record<string, ShipCombatState> = {}
      const destroyed = new Set<string>()
      const escaped = new Set<string>()

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
        const result = stepEngagements(engagements, shipsForStep, cursor)
        engagements = result.engagements
        Object.assign(pendingDamage, result.shipCombat)
        for (const id of result.destroyedShipIds) destroyed.add(id)
        for (const id of result.escapedShipIds) escaped.add(id)
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
          const result = planMove(ship, destination, simDays)
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
