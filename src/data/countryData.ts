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
  // The nation's form of government (shown in the Diplomacy profile).
  government?: string
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
  kind: 'city' | 'spaceport' | 'outpost'
}

export const COUNTRIES: Country[] = [
  {
    id: 'imperial-state-of-mars',
    name: 'Imperial State of Mars',
    government: 'Imperial autocracy',
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
    government: 'Federal republic',
    color: '#3d7dc9',
    capitalStarId: 'sol',
    capitalBodyName: 'Venus',
    capitalCityName: 'Paphos',
  },
  {
    id: 'orion-republic',
    name: 'Orion Republic',
    government: 'Democratic republic',
    color: '#8fd0ff',
    capitalStarId: 'alpha-centauri',
    capitalBodyName: 'Arcadia',
    capitalCityName: 'Elysion',
  },
  {
    // An alien empire — the Tidalians of Lalande 21185 d.
    id: 'kingdom-of-lalande',
    name: 'Kingdom of Lalande',
    government: 'Constitutional monarchy',
    color: '#5ad1a0',
    capitalStarId: 'lalande-21185',
    capitalBodyName: 'Lalande 21185 d',
    capitalCityName: 'Bellerive',
  },
  {
    // The surviving core of an old empire — a declining colossus under the
    // Northern Federal Command (a military government). Huge, prestigious and
    // decaying from within. Capital: Chengyu (merged Chengdu–Chongqing).
    id: 'earth',
    name: 'Earth',
    government: 'Military junta (Northern Federal Command)',
    color: '#4a6fa5', // a deep steel blue, distinct from Venus/Orion
    capitalStarId: 'sol',
    capitalBodyName: 'Earth',
    capitalCityName: 'Chengyu Megalopolis',
    capitalCityNative: '成渝',
    capitalCityAt: [105.4, 30.0], // the Chengdu–Chongqing megalopolis, Sichuan Basin
    // Earth's four surviving megacities (vast urban sprawls) and the old empire's
    // spaceports at their real launch sites. Each placed at its true coordinates,
    // snapped to the nearest land node and named uniquely (not pool-named). The
    // megacities get a large urban footprint (planetTerrain floodUrban).
    cities: [
      { name: 'Great Lakes Megalopolis', at: [-87.63, 41.88], kind: 'city' },
      { name: 'São Paulo', at: [-46.63, -23.55], kind: 'city' },
      { name: 'Nairobi', at: [36.82, -1.29], kind: 'city' },
      // Launch sites — real cosmodromes, spread across the world and standalone
      // (not tied to an urban area): the Gobi, Shanxi, the steppe, the Mojave, the
      // Kenyan coast, the equatorial Pacific. These are Earth's ONLY spaceports —
      // the economy's auto-placement is suppressed for curated worlds (spaceportSites).
      { name: 'Jiuquan Cosmodrome', at: [100.29, 40.96], kind: 'spaceport' },
      { name: 'Taiyuan Launch Centre', at: [111.6, 38.85], kind: 'spaceport' },
      { name: 'Baikonur Cosmodrome', at: [63.34, 45.96], kind: 'spaceport' },
      { name: 'Malindi Space Centre', at: [39.5, -3.5], kind: 'spaceport' }, // coastal Kenya, near Nairobi
      { name: 'Edwards Spaceport', at: [-117.9, 34.9], kind: 'spaceport' }, // Edwards AFB, Mojave
      { name: 'Biak Spaceport', at: [136.1, -1.2], kind: 'spaceport' }, // equatorial Indonesia
      // A frontier settlement key node (the colony outpost snaps to it, so it is
      // named for its real place instead of the city-name pool).
      { name: 'Strasbourg', at: [7.75, 48.58], kind: 'outpost' }, // Alsace
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
