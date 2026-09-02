import { usePlayerStore } from '../state/playerStore'
import { useTechStore, type TechState } from '../state/techStore'

// The player's own tech progress — mirrors usePlayerEconomy.ts's join
// exactly (selectedCountryId -> that country's own state), just against
// techStore instead of economyStore. Returns the default-seeded state
// (Warp Theory/Hyperspace Theory already researched, everything else not)
// before a country is chosen, same as techStore.stateFor does for any
// country that hasn't been touched yet.
export function usePlayerTech(): TechState {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  return useTechStore((s) => (countryId ? s.stateFor(countryId) : s.stateFor('')))
}
