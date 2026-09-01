import { useEffect } from 'react'
import { Vector3 } from 'three'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { shipCombatProfile } from '../scene/combatResolution'
import { systemBodyContaining, systemGravityAcceleration } from '../scene/shipPhysics'
import { utilityEffectiveness } from '../data/combatData'

// Largest slice of time integrated in one go, in sim-days. Gravity is an
// inverse-square field, so a single huge Euler step near a body would jump
// straight past it and produce nonsense (or miss the collision entirely).
// Strategic pace advances 6 sim-days per real second, so without this a
// drifting hull would be integrated in 6-day leaps.
const MAX_SUBSTEP_DAYS = 0.02
// Ceiling on substeps per tick, so a long pause or a big time jump can't
// stall a frame. Beyond this the remaining time is simply skipped — same
// bounded-catch-up reasoning as useCombatResolver's own step cap.
const MAX_SUBSTEPS = 60

// Keeps unpowered hulls moving under real gravity while they're OUT of
// combat.
//
// In combat the resolver already does this (see combatResolution's
// integrateMotion, which applies arena-scale gravity in its zero-thrust
// branch), but a ship whose utility was destroyed doesn't stop being
// unpowered the moment the fight ends — it drifts out of the battle (see
// useCombatResolver's disengage handling) and then has to keep behaving like
// a real object rather than reverting to a tidy orbit it has no engines to
// hold. This is the out-of-combat half of that same rule.
//
// Deliberately scoped to ships that are BOTH at a `system-point` and have
// zero utility: a powered ship's position stays a pure function of its order
// or its resting location (this project's core "no accumulated per-frame
// state" property), and only a genuinely unpowered hull needs the stored
// velocity that breaks it.
export function useShipDriftIntegrator() {
  useEffect(() => {
    const step = (simDays: number) => {
      const { ships, setShipLocation, setDrift, removeShip } = useShipStore.getState()

      for (const ship of ships) {
        if (!ship.drift) continue
        if (ship.location.kind !== 'system-point') continue
        // Utility back above zero would mean the ship can hold station again.
        // No repair system exists yet, so this never fires today — it's here
        // so that adding one doesn't leave hulls drifting forever.
        const profile = shipCombatProfile(ship)
        if (profile && utilityEffectiveness(ship.combat.componentHp.utility, profile.components.utility) > 0) {
          setDrift(ship.id, null)
          continue
        }

        const elapsed = simDays - ship.drift.updatedSimDays
        if (elapsed <= 0) continue

        const position = new Vector3(...ship.location.position)
        const velocity = new Vector3(...ship.drift.velocity)

        const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(elapsed / MAX_SUBSTEP_DAYS)))
        const dt = elapsed / substeps
        let struck: string | null = null
        for (let i = 0; i < substeps; i++) {
          velocity.add(systemGravityAcceleration(position, simDays, ship.location.systemId).multiplyScalar(dt))
          position.add(velocity.clone().multiplyScalar(dt))
          struck = systemBodyContaining(position, simDays, ship.location.systemId)
          if (struck) break
        }

        if (struck) {
          // Fell into a star or a planet. Same consequence the arena gives a
          // ship that drifts into a body (see combatResolution's collision
          // step) — the hull is simply gone.
          removeShip(ship.id)
          continue
        }

        setShipLocation(
          ship.id,
          { kind: 'system-point', systemId: ship.location.systemId, position: [position.x, position.y, position.z] },
          undefined,
          true,
        )
        setDrift(ship.id, { velocity: [velocity.x, velocity.y, velocity.z], updatedSimDays: simDays })
      }
    }

    return useGameTimeStore.subscribe((state) => step(state.simDays))
  }, [])
}
