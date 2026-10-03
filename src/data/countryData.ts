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
  // Fixed, real-place key cities on the capital world, each at its true
  // coordinates on whatever landmass it falls on (not sampled, not pool-named).
  // Used for Earth's surviving cities and its spaceports at real launch sites.
  // Omitted: the terrain samples and names cities itself (the default).
  cities?: FixedCity[]
}

export interface FixedCity {
  name: string
  at: [number, number] // degrees east, north
  kind: 'city' | 'spaceport'
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
  {
    // The surviving core of an old empire — a declining colossus under the
    // Northern Federal Command (a military government). Huge, prestigious and
    // decaying from within. Capital: Chicago.
    id: 'earth',
    name: 'Earth',
    color: '#b89b5e',
    capitalStarId: 'sol',
    capitalBodyName: 'Earth',
    capitalCityName: 'Chicago',
    capitalCityAt: [-87.63, 41.88], // Chicago (lon east, lat north) — ~179 m, well above the +70 m sea
    // The surviving urban centres (high-ground interior cities) and the old
    // empire's spaceports at their real launch sites. Each placed at its true
    // coordinates, snapped to the nearest land node.
    cities: [
      { name: 'Chengdu', at: [104.07, 30.57], kind: 'city' }, // Sichuan Basin
      { name: 'Chongqing', at: [106.55, 29.56], kind: 'city' },
      { name: 'Xi’an', at: [108.94, 34.34], kind: 'city' },
      { name: 'Kunming', at: [102.83, 24.88], kind: 'city' },
      { name: 'Lanzhou', at: [103.83, 36.06], kind: 'city' },
      { name: 'Delhi', at: [77.1, 28.7], kind: 'city' },
      { name: 'São Paulo', at: [-46.63, -23.55], kind: 'city' },
      { name: 'Nairobi', at: [36.82, -1.29], kind: 'city' },
      { name: 'Kano', at: [8.52, 12.0], kind: 'city' },
      { name: 'Moscow', at: [37.62, 55.75], kind: 'city' },
      // Launch sites, spread across the world (not forced to the equator).
      { name: 'Baikonur', at: [63.34, 45.96], kind: 'spaceport' }, // Kazakhstan (Roscosmos)
      { name: 'Jiuquan', at: [100.29, 40.96], kind: 'spaceport' }, // Gobi
      { name: 'Taiyuan', at: [111.6, 38.85], kind: 'spaceport' },
      { name: 'Cape Canaveral', at: [-80.6, 28.5], kind: 'spaceport' }, // Florida
      { name: 'Kourou', at: [-52.77, 5.17], kind: 'spaceport' }, // near the equator
    ],
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
