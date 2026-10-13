import { useEffect, useState } from 'react'
import { ensureSeededFor } from '../scene/placementOrders'
import { syncCivicHalls } from '../scene/seedPlacementOrders'
import { useLocationStore } from '../state/locationStore'
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
    // Halls follow the areas (scene/civic.withSettlementHalls): towns that grow into one city share one, so resync while it is shown.
    syncCivicHalls(bodyName)
    const resync = () => syncCivicHalls(bodyName)
    const offPlacement = usePlacementStore.subscribe((st, prev) => { if (st.levels !== prev.levels || st.placed !== prev.placed) resync() })
    const offLocations = useLocationStore.subscribe((st, prev) => { if (st.established !== prev.established || st.names !== prev.names) resync() })
    return () => { offPlacement(); offLocations() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyName])
  return done === bodyName || !needs()
}
