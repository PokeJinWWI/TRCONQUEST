// Real moon data (radius/distance/period) for the major moons of each planet
// that has one. Rendering every known moon (Jupiter alone has ~95) would be
// unreadable clutter, so only the major/well-known ones are rendered —
// `totalCount` still reflects the real known total for the info panel.
export interface MoonRawData {
  name: string
  radiusKm: number
  distanceKm: number // from planet center
  periodDays: number
  color: string
  retrograde?: boolean
  // Real mass — optional because it's only actually needed by whichever moon
  // ends up placed in a combat arena as gravity-bearing terrain (currently
  // just Luna, see combatResolution's EARTH_MOON_OFFSET); every other entry
  // here is display-only and has no reason to carry it.
  massKg?: number
}

export interface MoonData extends MoonRawData {
  visualRadius: number
  orbitRadius: number
  inclinationDeg: number
  phaseDeg: number
}

export interface PlanetMoons {
  totalCount: number
  moons: MoonData[]
}

const PRIMARY_VISUAL_RADIUS = 3
const MIN_MOON_RADIUS = 0.08
const MAX_MOON_RADIUS = 0.9
// Real distance ratios put some major moons (Luna included) well outside the
// satellite view's default camera framing — clamped so every rendered moon
// stays visible without having to hunt for it by panning/zooming, at the
// cost of losing exact relative ordering among the farthest few.
const MAX_ORBIT_RADIUS = 12

// Real size/distance ratios vary too wildly to render true-to-scale (Jupiter
// dwarfs its moons far more than Earth dwarfs the Moon) — sizes are clamped
// to a visible range and orbit distances are log-compressed, but the
// *relative* ordering (bigger/farther moons read as bigger/farther) is
// preserved from the real ratios.
function deriveMoons(planetRadiusKm: number, raw: MoonRawData[]): MoonData[] {
  return raw.map((m, i) => {
    const naturalRadius = (m.radiusKm / planetRadiusKm) * PRIMARY_VISUAL_RADIUS
    const visualRadius = Math.min(MAX_MOON_RADIUS, Math.max(MIN_MOON_RADIUS, naturalRadius))
    const ratio = m.distanceKm / planetRadiusKm
    const orbitRadius = Math.min(MAX_ORBIT_RADIUS, PRIMARY_VISUAL_RADIUS + 1.5 + Math.log2(1 + ratio) * 1.8)
    return {
      ...m,
      visualRadius,
      orbitRadius,
      inclinationDeg: ((i * 37) % 17) - 8,
      phaseDeg: (i * 67) % 360,
    }
  })
}

const MOON_TABLE: Record<string, { planetRadiusKm: number; totalCount: number; raw: MoonRawData[] }> = {
  Earth: {
    planetRadiusKm: 6371,
    totalCount: 1,
    raw: [{ name: 'Luna', radiusKm: 1737.4, distanceKm: 384400, periodDays: 27.32, color: '#c9c9c9', massKg: 7.342e22 }],
  },
  Mars: {
    planetRadiusKm: 3389.5,
    totalCount: 2,
    raw: [
      { name: 'Phobos', radiusKm: 11.1, distanceKm: 9376, periodDays: 0.319, color: '#9c8770' },
      { name: 'Deimos', radiusKm: 6.2, distanceKm: 23463, periodDays: 1.263, color: '#a89880' },
    ],
  },
  Jupiter: {
    planetRadiusKm: 69911,
    totalCount: 95,
    raw: [
      { name: 'Io', radiusKm: 1821.6, distanceKm: 421700, periodDays: 1.769, color: '#e0c95a' },
      { name: 'Europa', radiusKm: 1560.8, distanceKm: 671100, periodDays: 3.551, color: '#d8cbb0' },
      { name: 'Ganymede', radiusKm: 2634.1, distanceKm: 1070400, periodDays: 7.155, color: '#a89c8c' },
      { name: 'Callisto', radiusKm: 2410.3, distanceKm: 1882700, periodDays: 16.69, color: '#8a7f6e' },
    ],
  },
  Saturn: {
    planetRadiusKm: 58232,
    totalCount: 146,
    raw: [
      { name: 'Titan', radiusKm: 2574.7, distanceKm: 1221870, periodDays: 15.945, color: '#e0b473' },
      { name: 'Rhea', radiusKm: 763.8, distanceKm: 527108, periodDays: 4.518, color: '#c9c4b8' },
      { name: 'Iapetus', radiusKm: 734.5, distanceKm: 3560820, periodDays: 79.32, color: '#a89e8e' },
      { name: 'Dione', radiusKm: 561.4, distanceKm: 377396, periodDays: 2.737, color: '#d0ccc4' },
    ],
  },
  Uranus: {
    planetRadiusKm: 25362,
    totalCount: 28,
    raw: [
      { name: 'Miranda', radiusKm: 235.8, distanceKm: 129390, periodDays: 1.413, color: '#9fd8d8' },
      { name: 'Ariel', radiusKm: 578.9, distanceKm: 190900, periodDays: 2.52, color: '#a8dede' },
      { name: 'Umbriel', radiusKm: 584.7, distanceKm: 266000, periodDays: 4.144, color: '#7fbcbc' },
      { name: 'Titania', radiusKm: 788.4, distanceKm: 436300, periodDays: 8.706, color: '#8fcccc' },
      { name: 'Oberon', radiusKm: 761.4, distanceKm: 583500, periodDays: 13.46, color: '#84c0c0' },
    ],
  },
  Neptune: {
    planetRadiusKm: 24622,
    totalCount: 16,
    raw: [{ name: 'Triton', radiusKm: 1353.4, distanceKm: 354759, periodDays: 5.877, color: '#a8c4e8', retrograde: true }],
  },
}

export function getMoonsForPlanet(planetName: string): PlanetMoons {
  const entry = MOON_TABLE[planetName]
  if (!entry) return { totalCount: 0, moons: [] }
  return { totalCount: entry.totalCount, moons: deriveMoons(entry.planetRadiusKm, entry.raw) }
}
