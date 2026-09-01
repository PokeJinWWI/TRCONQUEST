import { getCountry } from '../data/countryData'
import { worldByName, useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import type { Country, World } from '../economy/economyTypes'

// The player's own country (national fiscal) and its capital world (local
// economy). The nation-level Economy category reports on these.
export function usePlayerEconomy(): { country?: Country; world?: World } {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const countries = useEconomyStore((s) => s.countries)
  const worlds = useEconomyStore((s) => s.worlds)
  const country = countryId ? countries.find((c) => c.id === countryId) : undefined
  const capital = countryId ? getCountry(countryId)?.capitalBodyName : undefined
  return { country, world: worldByName(worlds, capital) }
}
