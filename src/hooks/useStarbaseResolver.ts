import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useShipStore } from '../state/shipStore'
import { useDiplomacyStore, atWar } from '../state/diplomacyStore'
import { starbaseAnchorBody, stepStarbaseSieges } from '../scene/starbaseLogic'
import { ownerDisplay } from '../data/countryRoster'
import { STARBASE_LOSS_VALUE } from '../data/starbaseData'
import { recordLoss } from '../scene/peace'

// Hostile warships parked at a Starbase's own star grind its integrity down,
// once per sim-day of clock time (scene/starbaseLogic.stepStarbaseSieges) — a
// Starbase never fires back, it only gets sieged. Pure rules, store I/O here;
// mirrors hooks/useDefenseResolver.ts.
export function resolveStarbaseSieges(fromSimDays: number, toSimDays: number): void {
  const days = Math.floor(toSimDays) - Math.floor(fromSimDays)
  if (days <= 0) return
  const starbases = useStarbaseStore.getState().starbases
  if (starbases.length === 0) return
  const ships = useShipStore.getState().ships
  const { damaged, destroyedIds, killersOf } = stepStarbaseSieges(days, starbases, ships, atWar, toSimDays)
  if (Object.keys(damaged).length === 0 && destroyedIds.length === 0) return
  for (const id of destroyedIds) {
    const sb = starbases.find((s) => s.id === id)
    if (!sb) continue
    const star = starbaseAnchorBody(sb.starId) ?? sb.starId
    useDiplomacyStore.getState().pushEvent('installation-destroyed', [sb.ownerId], `${ownerDisplay(sb.ownerId).name}'s Starbase at ${star} was destroyed`, toSimDays, { starId: sb.starId })
    recordLoss(sb.ownerId, killersOf[id] ?? [], STARBASE_LOSS_VALUE)
  }
  useStarbaseStore.getState().applyDamage(damaged, destroyedIds)
}

export function useStarbaseResolver() {
  useEffect(() => {
    let last = useGameTimeStore.getState().simDays
    return useGameTimeStore.subscribe((state) => {
      if (state.simDays < last) {
        last = state.simDays
        return
      }
      if (Math.floor(state.simDays) === Math.floor(last)) return
      resolveStarbaseSieges(last, state.simDays)
      last = state.simDays
    })
  }, [])
}
