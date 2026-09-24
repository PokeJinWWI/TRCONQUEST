import { usePlayerStore } from '../state/playerStore'
import { useResourceStore, type CountryResources } from '../state/resourceStore'

// The player's own nation's stockpile and monthly figures — the resource
// counterpart to usePlayerTech. Resolves to the shared empty state at the
// main menu (no nation picked yet).
export function usePlayerResources(): CountryResources {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  return useResourceStore((s) => s.stateFor(countryId ?? ''))
}
