import { useEffect } from 'react'
import { resolveInfrastructure } from '../scene/infrastructureOrders'
import { useGameTimeStore } from '../state/gameTimeStore'

// Each month, the owners of the route network pay its upkeep (scene/infrastructureOrders.resolveInfrastructure).
export function useInfrastructureResolver() {
  useEffect(() => {
    resolveInfrastructure(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolveInfrastructure(state.simDays))
  }, [])
}
