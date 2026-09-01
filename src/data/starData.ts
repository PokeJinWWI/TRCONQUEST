// One physical star inside a system. A single-star system (Sol, the red
// dwarfs) has no explicit components — getSystemStars synthesizes one at the
// barycenter from the StarData fields below. A multi-star system (Alpha
// Centauri's three stars, Sirius's two, Luyten 726-8's two) lists each real
// star here, positioned by `offsetAU` from the system barycenter.
export interface StarComponent {
  name: string
  color: string
  radiusKm: number
  massKg: number
  // Position of this star within the system, in AU from the barycenter, in
  // the X/Z orbital plane. Real inter-star separations span an enormous range
  // (Alpha Centauri A-B ~23 AU, but Proxima is ~13,000 AU out) — these are
  // compressed for legibility so every component stays on-screen in one
  // system view, the same "real ratios, scene-legible magnitudes" spirit the
  // rest of this project uses. Converted to scene units via UNITS_PER_AU
  // wherever it's consumed (getSystemStars stays unit-agnostic to avoid a
  // starData->planetData import cycle).
  offsetAU: [number, number]
}

export interface StarData {
  id: string
  name: string
  color: string
  distanceLy: number
  // Cartesian position in light-years, derived from real RA/Dec/distance
  // (equatorial coordinates), Sol at the origin.
  position: [number, number, number]
  hasSystemData: boolean
  // Real (approximate, for multi-star systems the dominant component's)
  // mass/radius — used by shipPhysics' gravity-well escape-time math, same
  // real-data-driven approach as planetData's massKg/radiusKm.
  massKg: number
  radiusKm: number
  // Real spectral classification (multiple components separated by "/" for a
  // multi-star system, dominant component first) — flavor/info-panel data,
  // not consumed by any physics.
  starClass: string
  // The individual physical stars in a MULTI-star system, each at its own
  // offset. Omitted for single-star systems (see getSystemStars).
  components?: StarComponent[]
}

// The stars actually rendered/orbited in a system's own view: a multi-star
// system's real components, or a single synthesized star at the barycenter
// for a single-star system. Kept unit-agnostic (offsetAU stays in AU) so
// this module never has to import UNITS_PER_AU from planetData.
export function getSystemStars(starId: string): StarComponent[] {
  const star = STARS.find((s) => s.id === starId)
  if (!star) return []
  if (star.components && star.components.length > 0) return star.components
  return [{ name: star.name, color: star.color, radiusKm: star.radiusKm, massKg: star.massKg, offsetAU: [0, 0] }]
}

// A single physical star looked up by its own name, across every system —
// component star names are unique game-wide by construction, so this needs no
// system id to disambiguate. Used by physics/combat to resolve a body a ship
// is orbiting/resting at when that body is one of a system's component stars
// (e.g. "Rigil Kentaurus") rather than a planet.
export function findSystemStar(name: string): StarComponent | undefined {
  for (const s of STARS) {
    for (const c of getSystemStars(s.id)) {
      if (c.name === name) return c
    }
  }
  return undefined
}

export const UNITS_PER_LY = 8

// A star's real (ly-scale) Cartesian position converted to interstellar-view
// scene units — shared by InterstellarScene's rendering and shipPhysics'
// travel-order math so both agree on where a star actually sits on screen.
export function starScenePosition(star: StarData): [number, number, number] {
  return [star.position[0] * UNITS_PER_LY, star.position[2] * UNITS_PER_LY, star.position[1] * UNITS_PER_LY]
}

// Real nearest-neighbor stars/systems to the Sun (within ~10 ly), positioned
// from their actual right ascension, declination, and distance.
export const STARS: StarData[] = [
  { id: 'sol', name: 'Sol', color: '#ffd27a', distanceLy: 0, position: [0, 0, 0], hasSystemData: true, massKg: 1.989e30, radiusKm: 696_000, starClass: 'G2V' },
  {
    id: 'alpha-centauri',
    name: 'Alpha Centauri',
    color: '#ffe1b0',
    distanceLy: 4.37,
    position: [-1.637, -1.362, -3.816],
    hasSystemData: true,
    massKg: 2.188e30,
    radiusKm: 848_000,
    starClass: 'G2V / K1V / M5.5V',
    // Three real stars. A-B are a real wide binary (~23 AU, ~1.22x Sol
    // radius for A, ~0.86x for B); Proxima is a red dwarf ~13,000 AU out,
    // compressed here to a legible ~26 AU so it still shares one view.
    components: [
      { name: 'Rigil Kentaurus', color: '#fff0d0', radiusKm: 852_000, massKg: 2.187e30, offsetAU: [-12, 0] },
      { name: 'Toliman', color: '#ffd9a0', radiusKm: 600_000, massKg: 1.804e30, offsetAU: [12, 0] },
      { name: 'Proxima Centauri', color: '#ff7a4a', radiusKm: 107_000, massKg: 2.428e29, offsetAU: [-16, 22] },
    ],
  },
  { id: 'barnards-star', name: "Barnard's Star", color: '#ff8c5a', distanceLy: 5.96, position: [-0.078, -5.94, 0.487], hasSystemData: true, massKg: 2.864e29, radiusKm: 136_000, starClass: 'M4V' },
  { id: 'wolf-359', name: 'Wolf 359', color: '#ff6b4a', distanceLy: 7.86, position: [-7.499, 2.15, 0.958], hasSystemData: true, massKg: 1.789e29, radiusKm: 111_000, starClass: 'M6V' },
  { id: 'lalande-21185', name: 'Lalande 21185', color: '#ffa15a', distanceLy: 8.31, position: [-6.519, 1.656, 4.881], hasSystemData: true, massKg: 9.146e29, radiusKm: 273_000, starClass: 'M2V' },
  {
    id: 'sirius',
    name: 'Sirius',
    color: '#bfe0ff',
    distanceLy: 8.66,
    position: [-1.618, 8.135, -2.491],
    hasSystemData: true,
    massKg: 4.017e30,
    radiusKm: 1_190_000,
    starClass: 'A1V + DA2 white dwarf',
    // A brilliant A-type primary and its Earth-sized white-dwarf remnant
    // companion (Sirius B) — a real ~20 AU eccentric binary, drawn as a
    // tight central pair here so the surviving outer planets read as
    // orbiting the pair.
    components: [
      { name: 'Sirius A', color: '#d6ecff', radiusKm: 1_190_000, massKg: 4.018e30, offsetAU: [-3, 0] },
      { name: 'Sirius B', color: '#eaf4ff', radiusKm: 5_840, massKg: 1.998e30, offsetAU: [3, 0] },
    ],
  },
  {
    id: 'luyten-726-8',
    name: 'Luyten 726-8',
    color: '#ff7a5a',
    distanceLy: 8.73,
    position: [7.542, 3.477, -2.69],
    hasSystemData: true,
    massKg: 1.989e29,
    radiusKm: 97_000,
    starClass: 'M5.5V / M6V binary',
    // The UV Ceti system — two near-twin red-dwarf flare stars in a real
    // ~5 AU eccentric binary (BL Ceti / UV Ceti).
    components: [
      { name: 'BL Ceti', color: '#ff8a5a', radiusKm: 100_000, massKg: 2.03e29, offsetAU: [-2.5, 0] },
      { name: 'UV Ceti', color: '#ff7a4a', radiusKm: 97_000, massKg: 1.99e29, offsetAU: [2.5, 0] },
    ],
  },
  { id: 'ross-154', name: 'Ross 154', color: '#ff6b4a', distanceLy: 9.68, position: [1.879, -8.653, -3.911], hasSystemData: true, massKg: 5.967e29, radiusKm: 167_000, starClass: 'M3.5V' },
]

// Interstellar view is generic over "which neighborhood" (see
// neighborhoodData.ts) even though only one has real interior data today —
// this is the seam a second populated neighborhood plugs into later without
// InterstellarScene itself needing another refactor. `hasInterstellarData:
// false` on every other neighborhood means this never actually gets called
// for them yet (mirrors how a `hasSystemData: false` star is never entered),
// but returning [] rather than throwing keeps the function total.
export function getStarsForNeighborhood(neighborhoodId: string): StarData[] {
  return neighborhoodId === 'solar-neighborhood' ? STARS : []
}
