import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { COUNTRIES } from '../data/countryData'
import { advanceShipyard } from '../scene/shipyardLogic'

// One step of every nation's shipyard up to `simDays` — exported so a
// headless run (tests) can drive it without React.
export function resolveShipyards(simDays: number): void {
  for (const country of COUNTRIES) advanceShipyard(country, simDays)
}

// Runs EVERY nation's capital shipyard off the game clock — the player's and
// each AI empire's alike: starts waiting builds as slots open, and puts each
// finished hull into orbit around its own nation's capital, owned by that
// nation. Subscribes to simDays the same way useCommsResolver/
// useShipOrderSettler do, so it keeps building whichever view is mounted.
export function useShipyardResolver() {
  useEffect(() => {
    resolveShipyards(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolveShipyards(state.simDays))
  }, [])
}
