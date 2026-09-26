import { create } from 'zustand'
import { useGameTimeStore } from './gameTimeStore'
import { isPlayerOwned } from './shipRelations'
import { simDaysToGroundStep } from '../scene/groundResolution'
import { haltUnits, orderUnitsTo, targetUnits, type LocalPoint, type TerrainBattle } from '../scene/terrainBattle'

// The terrain battles going on (scene/terrainBattle.ts): fights the ground war
// has lifted onto a finer map. Kept current by hooks/useGroundCombatResolver.ts
// (via scene/terrainWar.ts); the terrain map view reads them and the player's
// orders land here. Like the space arena's engagements this is derived, not
// saved state: a battle exists only while the units are in contact.
export type TerrainActionResult = { ok: true } | { ok: false; reason: string }

interface TerrainState {
  battles: TerrainBattle[]
  setBattles: (battles: TerrainBattle[]) => void
  // Player orders to units in a battle (units the player doesn't own are ignored).
  orderUnits: (battleId: string, unitIds: string[], to: LocalPoint, queue?: boolean) => TerrainActionResult
  targetUnits: (battleId: string, unitIds: string[], targetUnitId: string | null) => void
  haltUnits: (battleId: string, unitIds: string[]) => void
}

const mine = (battle: TerrainBattle, unitIds: string[]) => unitIds.filter((id) => battle.units.some((u) => u.id === id && isPlayerOwned({ ownerId: u.ownerId })))

export const useTerrainStore = create<TerrainState>((set, get) => {
  const edit = (battleId: string, fn: (b: TerrainBattle) => TerrainBattle) =>
    set((s) => ({ battles: s.battles.map((b) => (b.id === battleId ? fn(b) : b)) }))
  const step = () => simDaysToGroundStep(useGameTimeStore.getState().simDays)
  return {
    battles: [],
    setBattles: (battles) => set({ battles }),
    orderUnits: (battleId, unitIds, to, queue = false) => {
      const battle = get().battles.find((b) => b.id === battleId)
      if (!battle) return { ok: false, reason: 'That battle is over' }
      const ids = mine(battle, unitIds)
      if (ids.length === 0) return { ok: false, reason: 'Select some of your units first' }
      const result = orderUnitsTo(battle, ids, to, queue, step())
      if (!result.ok) return { ok: false, reason: result.reason ?? 'They cannot go there' }
      edit(battleId, () => result.battle)
      return { ok: true }
    },
    targetUnits: (battleId, unitIds, targetUnitId) => {
      const battle = get().battles.find((b) => b.id === battleId)
      if (battle) edit(battleId, (b) => targetUnits(b, mine(battle, unitIds), targetUnitId))
    },
    haltUnits: (battleId, unitIds) => {
      const battle = get().battles.find((b) => b.id === battleId)
      if (battle) edit(battleId, (b) => haltUnits(b, mine(battle, unitIds), step()))
    },
  }
})
