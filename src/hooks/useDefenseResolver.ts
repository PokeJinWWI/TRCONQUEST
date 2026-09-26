import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useDefenseStore } from '../state/defenseStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { atWar } from '../state/diplomacyStore'
import { batteryFire } from '../scene/defenseLogic'
import { isArmed, orbitedBody } from '../scene/armyLogic'

// Defense batteries fire on hostile warships in orbit, once per sim-day of
// clock time (scene/defenseLogic.batteryFire; the ship damage goes through the
// ship store's single combat-damage action). Pure rules, store I/O here.
export function resolveDefenses(fromSimDays: number, toSimDays: number): void {
  const days = Math.floor(toSimDays) - Math.floor(fromSimDays)
  if (days <= 0) return
  const installations = useDefenseStore.getState().installations
  if (!installations.some((i) => i.kind === 'defenseBattery')) return
  const { ships, applyCombatDamage } = useShipStore.getState()
  const { bodyOwner, nodeHolders } = useTerritoryStore.getState()
  const orbiting = ships
    .map((s) => ({ id: s.id, ownerId: s.ownerId, bodyName: orbitedBody(s), armed: isArmed(s), combat: s.combat }))
    .filter((s) => s.bodyName !== null)
  const { damaged, destroyedIds } = batteryFire(days, installations, orbiting, bodyOwner, nodeHolders, atWar, toSimDays)
  if (Object.keys(damaged).length > 0) applyCombatDamage(damaged, destroyedIds)
}

export function useDefenseResolver() {
  useEffect(() => {
    let last = useGameTimeStore.getState().simDays
    return useGameTimeStore.subscribe((state) => {
      if (state.simDays < last) {
        last = state.simDays
        return
      }
      if (Math.floor(state.simDays) === Math.floor(last)) return
      resolveDefenses(last, state.simDays)
      last = state.simDays
    })
  }, [])
}
