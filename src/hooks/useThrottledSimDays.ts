import { useEffect, useState } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'

// The game clock for a panel that only DISPLAYS it (a build countdown, a status
// line): re-renders at most every `intervalMs` of real time instead of on every
// frame. A panel subscribed straight to `simDays` re-renders 60 times a second
// for as long as it is open, and the ship panel does real combat maths on each
// pass. A trailing update means a paused clock still ends on its exact value.
export function useThrottledSimDays(intervalMs = 250): number {
  const [value, setValue] = useState(() => useGameTimeStore.getState().simDays)
  useEffect(() => {
    let last = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    setValue(useGameTimeStore.getState().simDays)
    const unsubscribe = useGameTimeStore.subscribe((state) => {
      const now = performance.now()
      if (now - last >= intervalMs) {
        last = now
        setValue(state.simDays)
        return
      }
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        last = performance.now()
        setValue(useGameTimeStore.getState().simDays)
      }, intervalMs - (now - last))
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [intervalMs])
  return value
}
