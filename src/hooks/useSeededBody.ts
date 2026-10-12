import { useEffect, useState } from 'react'
import { ensureSeededFor } from '../scene/placementOrders'
import { usePlacementStore } from '../state/placementStore'

// Whether a world's starting districts and buildings have been assigned to their sites, seeding it (in an effect, never during render,
// since seeding writes stores other components subscribe to) the first time it is asked about. A view that reads where things stand
// shows nothing until this is true, which is one frame.
export function useSeededBody(bodyName: string): boolean {
  const needs = (): boolean => {
    const s = usePlacementStore.getState()
    return s.autoSeed && !s.seeded[bodyName]
  }
  const [done, setDone] = useState<string | null>(() => (needs() ? null : bodyName))
  useEffect(() => {
    if (needs()) ensureSeededFor(bodyName)
    setDone(bodyName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyName])
  return done === bodyName || !needs()
}
