import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerStore } from '../state/playerStore'
import { runStrategicAI } from '../ai/runStrategicAI'

// Drives every AI empire off the game clock (see src/ai/coordinator.ts).
// Nothing runs until a nation is picked — the game hasn't started before then.
export function useStrategicAI() {
  useEffect(() => {
    const tick = (simDays: number) => {
      if (!usePlayerStore.getState().selectedCountryId) return
      runStrategicAI(simDays)
    }
    tick(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => tick(state.simDays))
  }, [])
}
