import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'

// Drives the global simulation clock via requestAnimationFrame, independent of
// any r3f <Canvas>, so time keeps flowing across view-level transitions
// (planet <-> system <-> interstellar), which each mount their own Canvas.
export function useGameClock() {
  useEffect(() => {
    let frameId: number
    let lastTime = performance.now()

    const loop = (now: number) => {
      const deltaSeconds = (now - lastTime) / 1000
      lastTime = now
      useGameTimeStore.getState().tick(Math.min(deltaSeconds, 0.25))
      frameId = requestAnimationFrame(loop)
    }

    frameId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frameId)
  }, [])
}
