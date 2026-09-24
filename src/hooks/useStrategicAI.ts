import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerStore } from '../state/playerStore'
import { runStrategicAI } from '../ai/runStrategicAI'

// Drives every AI empire off the game clock (see src/ai/coordinator.ts).
// Nothing runs until a nation is picked — the game hasn't started before then
// — and never in the sandbox, which has no empires to drive.
export function useStrategicAI() {
  useEffect(() => {
    const tick = (simDays: number) => {
      const { selectedCountryId, sandbox } = usePlayerStore.getState()
      if (!selectedCountryId || sandbox) return
      runStrategicAI(simDays)
    }
    tick(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => tick(state.simDays))
  }, [])
}
