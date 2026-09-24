import { useEffect } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { setUpNewGame } from '../scene/gameSetup'

// Runs setUpNewGame the moment a nation is picked at the main menu — the
// point the game actually starts. See scene/gameSetup.ts. The sandbox has no
// nations, so no starting forces to seed (see scene/sandboxSetup.ts).
export function useGameSetup() {
  useEffect(() => {
    const { selectedCountryId, sandbox } = usePlayerStore.getState()
    if (selectedCountryId && !sandbox) setUpNewGame()
    return usePlayerStore.subscribe((state, prev) => {
      if (state.selectedCountryId && !state.sandbox && state.selectedCountryId !== prev.selectedCountryId) setUpNewGame()
    })
  }, [])
}
