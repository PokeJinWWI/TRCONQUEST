// Playable factions — see playerStore.ts for the selected-country session
// state and MainMenu.tsx for where a player picks one of these.
export interface Country {
  id: string
  name: string
  color: string
  // Where a freshly-selected player starts — the system to enter and the
  // body to arrive pre-selected at (see MainMenu.selectCountry).
  capitalStarId: string
  capitalBodyName: string
  // The capital city's name, where the setting has one (shown on its key node).
  capitalCityName?: string
  // The capital's name in its own script (Mars's kanji), when it has one.
  capitalCityNative?: string
  // Where on the capital world it stands (degrees east, north); the nearest
  // mainland to it. Omitted: the map picks a spot.
  capitalCityAt?: [number, number]
}

export const COUNTRIES: Country[] = [
  {
    id: 'imperial-state-of-mars',
    name: 'Imperial State of Mars',
    color: '#c9704a',
    capitalStarId: 'sol',
    capitalBodyName: 'Mars',
    capitalCityName: 'Akakyō',
    capitalCityNative: '赤京',
    capitalCityAt: [-48.1, 1.6], // Xanthe Terra (IAU centre)
  },
  {
    id: 'republic-of-venus',
    name: 'Republic of Venus',
    color: '#3d7dc9',
    capitalStarId: 'sol',
    capitalBodyName: 'Venus',
    capitalCityName: 'Paphos',
  },
  {
    id: 'orion-republic',
    name: 'Orion Republic',
    color: '#8fd0ff',
    capitalStarId: 'alpha-centauri',
    capitalBodyName: 'Arcadia',
    capitalCityName: 'Elysion',
  },
  {
    // An alien empire — the Tidalians of Lalande 21185 d.
    id: 'kingdom-of-lalande',
    name: 'Kingdom of Lalande',
    color: '#5ad1a0',
    capitalStarId: 'lalande-21185',
    capitalBodyName: 'Lalande 21185 d',
    capitalCityName: 'Bellerive',
  },
]

export function getCountry(id: string): Country | undefined {
  return COUNTRIES.find((c) => c.id === id)
}

// Nations carved at runtime (a released subject/vassal) join COUNTRIES itself
// — the single roster every panel, army homecoming, and AI already reads —
// rather than a parallel list only some call sites would remember to check.
// See scene/subjects.ts's releaseAsSubject. Tracked separately so a game
// reset can strip them back out (gameReset.resetGame calls
// resetDynamicCountries) without touching the four founding nations.
const dynamicCountryIds = new Set<string>()

export function registerCountry(country: Country): void {
  if (COUNTRIES.some((c) => c.id === country.id)) return
  COUNTRIES.push(country)
  dynamicCountryIds.add(country.id)
}

export function resetDynamicCountries(): void {
  for (const id of dynamicCountryIds) {
    const idx = COUNTRIES.findIndex((c) => c.id === id)
    if (idx >= 0) COUNTRIES.splice(idx, 1)
  }
  dynamicCountryIds.clear()
}
