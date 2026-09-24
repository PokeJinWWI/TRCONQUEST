import { useEffect } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { setUpNewGame } from '../scene/gameSetup'

// Runs setUpNewGame the moment a nation is picked at the main menu — the
// point the game actually starts. See scene/gameSetup.ts.
export function useGameSetup() {
  useEffect(() => {
    if (usePlayerStore.getState().selectedCountryId) setUpNewGame()
    return usePlayerStore.subscribe((state, prev) => {
      if (state.selectedCountryId && state.selectedCountryId !== prev.selectedCountryId) setUpNewGame()
    })
  }, [])
}
