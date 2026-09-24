import { create } from 'zustand'
import type { PlayerBattle } from '../scene/battleList'

// The battles the player is in right now, kept current by
// hooks/useBattleTracker.ts. One shared list so every view — the Outliner and
// the combat indicators on every map level — reads the same thing without each
// recomputing it from the ship/army/combat stores. Not game state: it's
// derived, and rebuilt from the real stores.
interface BattleState {
  battles: PlayerBattle[]
  setBattles: (battles: PlayerBattle[]) => void
}

export const useBattleStore = create<BattleState>((set) => ({
  battles: [],
  setBattles: (battles) => set({ battles }),
}))
