import { getCountry } from '../data/countryData'
import { planetEconomy, useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import type { PlanetEconomy } from '../economy/economyTypes'

// The economy of the player's own capital planet — the one the nation-level
// Economy/Buildings panels report on. Undefined only if the capital has no
// economy yet (every country's capital is one of the three seed worlds in
// Milestone 1, so in practice this is always present in-game).
export function usePlayerEconomy(): PlanetEconomy | undefined {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const planets = useEconomyStore((s) => s.planets)
  const capital = countryId ? getCountry(countryId)?.capitalBodyName : undefined
  return planetEconomy(planets, capital)
}
