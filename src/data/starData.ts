// One physical star inside a system. A single-star system (Sol, the red
// dwarfs) has no explicit components — getSystemStars synthesizes one at the
// barycenter from the StarData fields below. A multi-star system (Alpha
// Centauri's three stars, Sirius's two, Luyten 726-8's two) lists each real
// star here, positioned by `offsetAU` from the system barycenter.
import { SOLAR_NEIGHBORHOOD_ID, findGeneratedStar, findGeneratedStarByName, generatedStarsFor } from './galaxyGen'

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
  const star = findStar(starId)
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
  // A generated star (another cluster's) is a single star named as its system.
  const generated = findGeneratedStarByName(name)
  return generated ? getSystemStars(generated.id)[0] : undefined
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
  // More neighbours from the ~12 ly chart (real RA/Dec/distance). Their planets are in
  // data/nearbySystems.ts (real detections + seeded top-up). Multi-star ones list
  // each real star, the wide separations compressed to stay legible (see
  // StarComponent); the star's own mass/radius is the primary's.
  { id: 'epsilon-eridani', name: "ε Eridani", color: '#ffb36b', distanceLy: 10.47, position: [6.183, 8.272, -1.721], hasSystemData: true, massKg: 1.631e30, radiusKm: 515_040, starClass: 'K2V' },
  { id: 'ross-248', name: "Ross 248", color: '#ff6b4a', distanceLy: 10.32, position: [7.378, -0.584, 7.192], hasSystemData: true, massKg: 2.705e29, radiusKm: 111_360, starClass: 'M5.5V' },
  { id: 'lacaille-9352', name: "Lacaille 9352", color: '#ffa15a', distanceLy: 10.72, position: [8.448, -2.032, -6.278], hasSystemData: true, massKg: 9.746e29, radiusKm: 327_120, starClass: 'M0.5V' },
  { id: 'ross-128', name: "Ross 128", color: '#ff7a5a', distanceLy: 11.01, position: [-10.993, 0.591, 0.154], hasSystemData: true, massKg: 3.342e29, radiusKm: 137_112, starClass: 'M4V' },
  { id: '61-cygni', name: "61 Cygni", color: '#ffb27a', distanceLy: 11.4, position: [6.473, -6.095, 7.136], hasSystemData: true, massKg: 1.392e30, radiusKm: 466_320, starClass: 'K5V / K7V', components: [
      { name: '61 Cygni A', color: '#ffb27a', radiusKm: 466_320, massKg: 1.392e30, offsetAU: [-14, 0] },
      { name: '61 Cygni B', color: '#ff9a5a', radiusKm: 417_600, massKg: 1.253e30, offsetAU: [14, 0] },
    ] },
  { id: 'procyon', name: "Procyon", color: '#fff4e0', distanceLy: 11.46, position: [-4.792, 10.358, 1.043], hasSystemData: true, massKg: 2.983e30, radiusKm: 1_426_800, starClass: 'F5IV-V + DQZ white dwarf', components: [
      { name: 'Procyon A', color: '#fff4e0', radiusKm: 1_426_800, massKg: 2.983e30, offsetAU: [-8, 0] },
      { name: 'Procyon B', color: '#eaf4ff', radiusKm: 6_682, massKg: 1.193e30, offsetAU: [8, 0] },
    ] },
  { id: 'struve-2398', name: "Struve 2398", color: '#ff9a5a', distanceLy: 11.52, position: [1.081, -5.723, 9.939], hasSystemData: true, massKg: 6.961e29, radiusKm: 250_560, starClass: 'M3V / M3.5V', components: [
      { name: 'Struve 2398 A', color: '#ff9a5a', radiusKm: 250_560, massKg: 6.961e29, offsetAU: [-14, 0] },
      { name: 'Struve 2398 B', color: '#ff8a5a', radiusKm: 194_880, massKg: 5.171e29, offsetAU: [14, 0] },
    ] },
  { id: 'groombridge-34', name: "Groombridge 34", color: '#ff9a5a', distanceLy: 11.62, position: [8.329, 0.670, 8.075], hasSystemData: true, massKg: 7.558e29, radiusKm: 264_480, starClass: 'M1.5V / M3.5V', components: [
      { name: 'Groombridge 34 A', color: '#ff9a5a', radiusKm: 264_480, massKg: 7.558e29, offsetAU: [-18, 0] },
      { name: 'Groombridge 34 B', color: '#ff7a4a', radiusKm: 132_240, massKg: 3.182e29, offsetAU: [18, 0] },
    ] },
  { id: 'dx-cancri', name: "G51-15", color: '#ff5a3a', distanceLy: 11.68, position: [-6.340, 8.278, 5.263], hasSystemData: true, massKg: 1.790e29, radiusKm: 76_560, starClass: 'M6.5V' },
  { id: 'tau-ceti', name: "τ Ceti", color: '#ffe29a', distanceLy: 11.91, position: [10.291, 5.025, -3.271], hasSystemData: true, massKg: 1.551e30, radiusKm: 549_840, starClass: 'G8V' },
  { id: 'epsilon-indi', name: "ε Indi", color: '#ffb27a', distanceLy: 11.87, position: [5.678, -3.167, -9.931], hasSystemData: true, massKg: 1.512e30, radiusKm: 508_080, starClass: 'K5V', components: [
      { name: 'ε Indi A', color: '#ffb27a', radiusKm: 508_080, massKg: 1.512e30, offsetAU: [-12, 0] },
      { name: 'ε Indi Ba', color: '#a0563a', radiusKm: 62_640, massKg: 1.253e29, offsetAU: [34, 18] },
      { name: 'ε Indi Bb', color: '#8a4a3a', radiusKm: 62_640, massKg: 8.950e28, offsetAU: [35.5, 18] },
    ] },
  { id: 'l789-6', name: "L789-6", color: '#ff7a5a', distanceLy: 11.27, position: [10.192, -3.780, -2.974], hasSystemData: true, massKg: 2.188e29, radiusKm: 90_480, starClass: 'M5V', components: [
      { name: 'EZ Aquarii A', color: '#ff7a5a', radiusKm: 90_480, massKg: 2.188e29, offsetAU: [-0.6, 0] },
      { name: 'EZ Aquarii B', color: '#ff7a5a', radiusKm: 83_520, massKg: 1.989e29, offsetAU: [0.6, 0] },
      { name: 'EZ Aquarii C', color: '#ff6b4a', radiusKm: 76_560, massKg: 1.790e29, offsetAU: [6, 8] },
    ] },
  { id: 'l372-58', name: "L372-58", color: '#ff6b4a', distanceLy: 12.04, position: [5.047, 6.946, -8.440], hasSystemData: true, massKg: 2.486e29, radiusKm: 104_400, starClass: 'M5.5V' },
  { id: 'l725-32', name: "L725-32", color: '#ff7a5a', distanceLy: 12.11, position: [11.007, 3.603, -3.539], hasSystemData: true, massKg: 2.586e29, radiusKm: 118_320, starClass: 'M4.5V' },
  { id: 'luytens-star', name: "Luyten's Star", color: '#ff9a5a', distanceLy: 12.35, position: [-4.577, 11.415, 1.126], hasSystemData: true, massKg: 5.768e29, radiusKm: 201_840, starClass: 'M3.5V' },
]

// Interstellar view is generic over "which neighborhood" (see
// neighborhoodData.ts): ours is the hand-authored list above, every other one
// is generated (data/galaxyGen.ts).
export function getStarsForNeighborhood(neighborhoodId: string): StarData[] {
  return neighborhoodId === SOLAR_NEIGHBORHOOD_ID ? STARS : generatedStarsFor(neighborhoodId)
}

// Any star by id: one of ours, or a generated one in another neighbourhood.
// STARS itself stays the Solar Neighbourhood only, which is what the running
// game (ships, AI, territory) works over.
export function findStar(starId: string): StarData | undefined {
  return STARS.find((s) => s.id === starId) ?? findGeneratedStar(starId)
}

// Whether a star (by its own name, a component's included) is a real one: every
// hand-authored star is; the other neighbourhoods' generated ones are not.
export function isRealStar(name: string): boolean {
  return STARS.some((s) => s.name === name || (s.components ?? []).some((c) => c.name === name))
}
