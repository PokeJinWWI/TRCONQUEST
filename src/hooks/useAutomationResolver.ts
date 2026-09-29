import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { resolveAutomation } from '../scene/automation'

// Automated ships look for work once a sim-day (scene/automation.ts).
export function useAutomationResolver() {
  useEffect(() => {
    let lastDay = Math.floor(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => {
      const day = Math.floor(state.simDays)
      if (day === lastDay) return
      lastDay = day
      resolveAutomation(state.simDays)
    })
  }, [])
}
