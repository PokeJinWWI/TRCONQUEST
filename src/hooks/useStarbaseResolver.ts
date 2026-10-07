import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useShipStore } from '../state/shipStore'
import { useDiplomacyStore, atWar } from '../state/diplomacyStore'
import { starbaseAnchorBody, stepStarbaseSieges } from '../scene/starbaseLogic'
import { ownerDisplay } from '../data/countryRoster'
import { STARBASE_LOSS_VALUE } from '../data/starbaseData'
import { recordLoss } from '../scene/peace'
import { usePlayerStore } from '../state/playerStore'
import { findStar } from '../data/starData'
import { finishedBetween, starbaseFinishedText } from '../scene/starbaseNotices'

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
  const { damaged, destroyedIds, killersOf, shipDamage, shipDestroyedIds } = stepStarbaseSieges(days, starbases, ships, atWar, toSimDays)
  // Defended bases return fire: apply the hull damage to the besiegers.
  if (Object.keys(shipDamage).length > 0) useShipStore.getState().applyCombatDamage(shipDamage, shipDestroyedIds)
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

// The player's Starbases that finished since the last pass are announced (not other nations':
// the player does not see those). A click on the notice goes to the system.
export function announceFinishedStarbases(fromSimDays: number, toSimDays: number): void {
  const player = usePlayerStore.getState().selectedCountryId
  if (!player) return
  const mine = useStarbaseStore.getState().starbases.filter((sb) => sb.ownerId === player)
  for (const sb of finishedBetween(mine, fromSimDays, toSimDays)) {
    useDiplomacyStore.getState().pushEvent('starbase-finished', [player], starbaseFinishedText(ownerDisplay(player).name, findStar(sb.starId)?.name ?? sb.starId), toSimDays, { starId: sb.starId })
  }
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
      announceFinishedStarbases(last, state.simDays)
      resolveStarbaseSieges(last, state.simDays)
      last = state.simDays
    })
  }, [])
}
