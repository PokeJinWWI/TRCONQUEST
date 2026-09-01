import { getSystemStars } from '../data/starData'

// Single unified scale: 1 AU = UNITS_PER_AU scene units, applied identically
// to orbital distances and body radii, so positions and sizes are all
// true-to-scale relative to each other (real solar system proportions).
export const AU_IN_KM = 149_597_870
export const UNITS_PER_AU = 20

const auRadius = (km: number) => (km / AU_IN_KM) * UNITS_PER_AU

export const SUN_RADIUS_KM = 696_000
export const SUN_RADIUS = auRadius(SUN_RADIUS_KM)

// Satellite view's close-up hologram of a body — see SatelliteViewScene —
// used to render EVERY inspected body (star or planet) at one flat radius
// regardless of which one it actually was, so Sol and Earth read as the same
// size purely because nothing ever compared them. Real radius ratios span
// too wide a range to draw literally in the same view either (Sol is ~109x
// Earth's radius — rendered true-to-scale, Earth's own satellite view would
// be an invisible speck), so this compresses with the same fourth-root curve
// combatArena.arenaBodyRadius already uses for the same reason, anchored so
// Earth keeps the visual radius (3) every camera-distance constant in
// SatelliteViewScene was originally tuned against.
const SATELLITE_VISUAL_RADIUS_AT_EARTH = 3
const SATELLITE_MIN_VISUAL_RADIUS = 1.4
const SATELLITE_MAX_VISUAL_RADIUS = 9
const EARTH_RADIUS_KM_FOR_SCALE = 6371

export function satelliteVisualRadius(radiusKm: number): number {
  const scaled = SATELLITE_VISUAL_RADIUS_AT_EARTH * Math.pow(radiusKm / EARTH_RADIUS_KM_FOR_SCALE, 0.25)
  return Math.max(SATELLITE_MIN_VISUAL_RADIUS, Math.min(SATELLITE_MAX_VISUAL_RADIUS, scaled))
}

// See bodyStats.ts's PLANET_CLASS_LABELS for what each of these means —
// defined there (alongside estimateHabitability/estimateSize) since it's the
// same kind of hand-authored flavor classification, just assigned per-planet
// here at data-authoring time rather than computed.
export type PlanetClass =
  | 'continental'
  | 'ocean'
  | 'hycean'
  | 'desert'
  | 'toxic'
  | 'barren'
  | 'ice'
  | 'lava'
  | 'eyeball'
  | 'gas-giant'
  | 'ice-giant'

export interface PlanetData {
  name: string
  radius: number
  radiusKm: number
  massKg: number
  orbitRadius: number
  color: string
  orbitPeriodYears: number
  inclinationDeg: number
  ascendingNodeDeg: number
  phaseDeg: number
  planetClass: PlanetClass
  // True for a dwarf planet (Ceres, Pluto, ...) — same orbit/size fields as
  // any other entry here, just flagged for display/filtering rather than
  // modeled as a separate type.
  isDwarfPlanet?: boolean
  // Which country controls this body, if any — see countryData.ts. Absent
  // means unclaimed.
  ownerId?: string
  // The scene-unit offset of the star this planet orbits, relative to the
  // system barycenter (origin). Baked at build time from the parent star's
  // `offsetAU` (see buildPlanets). [0,0,0] for a single-star system (or a
  // planet orbiting the barycenter itself); nonzero in a multi-star system,
  // so a planet renders/lives around ITS star, not the system center.
  centerOffset: [number, number, number]
  // Which component star this planet orbits (see StarComponent) — display
  // only; the resolved offset above is what physics/rendering use.
  parentStar?: string
}

interface RawPlanet {
  name: string
  radiusKm: number
  massKg: number
  auDistance: number
  color: string
  periodYears: number
  inclinationDeg: number
  ascendingNodeDeg: number
  phaseDeg: number
  planetClass: PlanetClass
  isDwarfPlanet?: boolean
  ownerId?: string
  // Name of the component star this planet orbits (see starData's
  // StarComponent). Omit in a single-star system, where every planet orbits
  // the one star at the barycenter.
  parentStar?: string
}

function buildPlanets(starId: string, raw: RawPlanet[]): PlanetData[] {
  const components = getSystemStars(starId)
  const offsetOf = (parentStar?: string): [number, number, number] => {
    if (!parentStar) return [0, 0, 0]
    const star = components.find((c) => c.name === parentStar)
    if (!star) return [0, 0, 0]
    return [star.offsetAU[0] * UNITS_PER_AU, 0, star.offsetAU[1] * UNITS_PER_AU]
  }
  return raw.map((p) => ({
    name: p.name,
    radius: auRadius(p.radiusKm),
    radiusKm: p.radiusKm,
    massKg: p.massKg,
    orbitRadius: p.auDistance * UNITS_PER_AU,
    color: p.color,
    orbitPeriodYears: p.periodYears,
    inclinationDeg: p.inclinationDeg,
    ascendingNodeDeg: p.ascendingNodeDeg,
    phaseDeg: p.phaseDeg,
    planetClass: p.planetClass,
    isDwarfPlanet: p.isDwarfPlanet,
    ownerId: p.ownerId,
    parentStar: p.parentStar,
    centerOffset: offsetOf(p.parentStar),
  }))
}

// Orbital elements (inclination + longitude of ascending node) are real J2000
// values relative to the ecliptic, so orbit tilts are physically accurate
// (small — a few degrees at most — which is realistic; real planetary orbits
// are nearly, but not exactly, coplanar). `phaseDeg` is an arbitrary but
// fixed starting position along the orbit — fixed (not random) so any code
// (camera fly-to, minimaps, etc) can independently compute a planet's exact
// position from `data` + the current sim time alone. Generated (non-real)
// planets elsewhere in this file use the same real-J2000-derived inclination
// range and the same "picked but fixed" phase/node convention, just without
// a specific real body to draw them from.
const SOL_RAW: RawPlanet[] = [
  { name: 'Mercury', radiusKm: 2439.7, massKg: 3.3011e23, auDistance: 0.387, color: '#9c9c9c', periodYears: 0.241, inclinationDeg: 7.0, ascendingNodeDeg: 48.33, phaseDeg: 45, planetClass: 'barren' },
  // Terraformed in this game's lore — a global ocean replaces the real toxic
  // greenhouse (see the Republic of Venus in countryData.ts).
  { name: 'Venus', radiusKm: 6051.8, massKg: 4.8675e24, auDistance: 0.723, color: '#3d7dc9', periodYears: 0.615, inclinationDeg: 3.39, ascendingNodeDeg: 76.68, phaseDeg: 120, planetClass: 'ocean', ownerId: 'republic-of-venus' },
  { name: 'Earth', radiusKm: 6371, massKg: 5.972e24, auDistance: 1.0, color: '#4da6ff', periodYears: 1.0, inclinationDeg: 0.0, ascendingNodeDeg: 0.0, phaseDeg: 200, planetClass: 'continental' },
  // Also terraformed — engineered seas/lakes in the lowlands (see the
  // Imperial State of Mars in countryData.ts).
  { name: 'Mars', radiusKm: 3389.5, massKg: 6.4171e23, auDistance: 1.524, color: '#c9704a', periodYears: 1.881, inclinationDeg: 1.85, ascendingNodeDeg: 49.56, phaseDeg: 10, planetClass: 'continental', ownerId: 'imperial-state-of-mars' },
  { name: 'Jupiter', radiusKm: 69911, massKg: 1.8982e27, auDistance: 5.203, color: '#e0a96d', periodYears: 11.86, inclinationDeg: 1.31, ascendingNodeDeg: 100.46, phaseDeg: 300, planetClass: 'gas-giant' },
  { name: 'Saturn', radiusKm: 58232, massKg: 5.6834e26, auDistance: 9.537, color: '#e8d7a7', periodYears: 29.45, inclinationDeg: 2.49, ascendingNodeDeg: 113.67, phaseDeg: 80, planetClass: 'gas-giant' },
  { name: 'Uranus', radiusKm: 25362, massKg: 8.681e25, auDistance: 19.191, color: '#7de0e0', periodYears: 84.02, inclinationDeg: 0.77, ascendingNodeDeg: 74.02, phaseDeg: 160, planetClass: 'ice-giant' },
  { name: 'Neptune', radiusKm: 24622, massKg: 1.02413e26, auDistance: 30.069, color: '#5a7de0', periodYears: 164.8, inclinationDeg: 1.77, ascendingNodeDeg: 131.78, phaseDeg: 260, planetClass: 'ice-giant' },
  // Dwarf planets — real bodies, real (approximate) orbital elements.
  { name: 'Ceres', radiusKm: 473, massKg: 9.38e20, auDistance: 2.767, color: '#a8a196', periodYears: 4.6, inclinationDeg: 10.6, ascendingNodeDeg: 80.3, phaseDeg: 30, planetClass: 'barren', isDwarfPlanet: true },
  { name: 'Pluto', radiusKm: 1188, massKg: 1.303e22, auDistance: 39.48, color: '#c9a876', periodYears: 248, inclinationDeg: 17.16, ascendingNodeDeg: 110.3, phaseDeg: 130, planetClass: 'ice', isDwarfPlanet: true },
  { name: 'Haumea', radiusKm: 816, massKg: 4.006e21, auDistance: 43.13, color: '#e8e4d8', periodYears: 283, inclinationDeg: 28.2, ascendingNodeDeg: 121.9, phaseDeg: 220, planetClass: 'ice', isDwarfPlanet: true },
  { name: 'Makemake', radiusKm: 715, massKg: 3.1e21, auDistance: 45.79, color: '#c9906a', periodYears: 305.3, inclinationDeg: 29.0, ascendingNodeDeg: 79.0, phaseDeg: 300, planetClass: 'ice', isDwarfPlanet: true },
  { name: 'Eris', radiusKm: 1163, massKg: 1.66e22, auDistance: 67.78, color: '#e0ddd4', periodYears: 558, inclinationDeg: 44.0, ascendingNodeDeg: 36.0, phaseDeg: 50, planetClass: 'ice', isDwarfPlanet: true },
]

// Alpha Centauri is a real triple system — three separate stars, each drawn
// at its own position in the system view (see starData.ts's `components`):
// Rigil Kentaurus (A), Toliman (B), and Proxima Centauri (C). Every planet
// here declares which star it orbits via `parentStar`, so it renders and
// lives around THAT star, not the system center. Proxima's b/c/d are real
// confirmed/candidate exoplanets; the rest are physically-plausible generated
// planets, each sized/paced against its own host star.
//
// Arcadia — the Orion Republic's capital — orbits Rigil Kentaurus (A), the
// Sun-like primary, in its habitable zone (~1.25 AU). It was briefly modeled
// as a close circumbinary world, but with A and B drawn as the real WIDE
// binary they are (~23 AU apart, see starData), a close habitable
// circumbinary orbit isn't physically sensible — a stable circumbinary planet
// there would sit far out and cold. Homing it in Rigil Kentaurus's own HZ
// keeps it both habitable (under bodyStats' Sol-anchored heuristic) and
// astronomically honest.
const ORION_REPUBLIC = 'orion-republic'

const ALPHA_CENTAURI_RAW: RawPlanet[] = [
  // Proxima Centauri (C) — real confirmed/candidate exoplanets.
  { name: 'Proxima d', parentStar: 'Proxima Centauri', radiusKm: 5160, massKg: 1.55e24, auDistance: 0.02885, color: '#c9522a', periodYears: 0.01397, inclinationDeg: 4.0, ascendingNodeDeg: 40, phaseDeg: 15, planetClass: 'lava', ownerId: ORION_REPUBLIC },
  { name: 'Proxima b', parentStar: 'Proxima Centauri', radiusKm: 6820, massKg: 6.39e24, auDistance: 0.0485, color: '#7fb8a0', periodYears: 0.0307, inclinationDeg: 3.2, ascendingNodeDeg: 130, phaseDeg: 200, planetClass: 'eyeball', ownerId: ORION_REPUBLIC },
  { name: 'Proxima c', parentStar: 'Proxima Centauri', radiusKm: 14000, massKg: 4.18e25, auDistance: 1.489, color: '#6a8ac9', periodYears: 5.28, inclinationDeg: 2.1, ascendingNodeDeg: 250, phaseDeg: 90, planetClass: 'hycean', ownerId: ORION_REPUBLIC },
  // Rigil Kentaurus (A) — one real 2024 JWST direct-imaging candidate, plus
  // generated planets filling out the rest of the system.
  { name: 'Rigil Kentaurus c', parentStar: 'Rigil Kentaurus', radiusKm: 5734, massKg: 4.78e24, auDistance: 0.4, color: '#a89078', periodYears: 0.2436, inclinationDeg: 1.5, ascendingNodeDeg: 10, phaseDeg: 300, planetClass: 'barren', ownerId: ORION_REPUBLIC },
  { name: 'Rigil Kentaurus b', parentStar: 'Rigil Kentaurus', radiusKm: 20000, massKg: 1.02e26, auDistance: 0.8, color: '#8fc4d8', periodYears: 0.685, inclinationDeg: 2.8, ascendingNodeDeg: 190, phaseDeg: 60, planetClass: 'ice-giant', ownerId: ORION_REPUBLIC },
  { name: 'Rigil Kentaurus d', parentStar: 'Rigil Kentaurus', radiusKm: 7008, massKg: 7.76e24, auDistance: 1.8, color: '#5a9c6a', periodYears: 2.31, inclinationDeg: 1.9, ascendingNodeDeg: 90, phaseDeg: 240, planetClass: 'continental', ownerId: ORION_REPUBLIC },
  { name: 'Rigil Kentaurus e', parentStar: 'Rigil Kentaurus', radiusKm: 25484, massKg: 1.02e26, auDistance: 6.0, color: '#9fd4d4', periodYears: 14.15, inclinationDeg: 3.4, ascendingNodeDeg: 320, phaseDeg: 150, planetClass: 'ice-giant', ownerId: ORION_REPUBLIC },
  // Arcadia — Rigil Kentaurus's habitable-zone capital (see header note).
  { name: 'Arcadia', parentStar: 'Rigil Kentaurus', radiusKm: 6690, massKg: 6.87e24, auDistance: 1.25, color: '#6aa878', periodYears: 1.34, inclinationDeg: 1.0, ascendingNodeDeg: 130, phaseDeg: 0, planetClass: 'continental', ownerId: ORION_REPUBLIC },
  // Toliman (B) — generated (the one real 2012 claim, "Alpha Centauri Bb",
  // was later retracted as a data artifact, leaving this system genuinely
  // open).
  { name: 'Toliman b', parentStar: 'Toliman', radiusKm: 5415, massKg: 4.18e24, auDistance: 0.3, color: '#c9a878', periodYears: 0.1723, inclinationDeg: 2.2, ascendingNodeDeg: 70, phaseDeg: 10, planetClass: 'desert', ownerId: ORION_REPUBLIC },
  { name: 'Toliman c', parentStar: 'Toliman', radiusKm: 6371, massKg: 5.97e24, auDistance: 0.7, color: '#4a7ac9', periodYears: 0.6142, inclinationDeg: 1.6, ascendingNodeDeg: 200, phaseDeg: 280, planetClass: 'ocean', ownerId: ORION_REPUBLIC },
  { name: 'Toliman d', parentStar: 'Toliman', radiusKm: 9557, massKg: 1.79e25, auDistance: 1.4, color: '#c9d8e0', periodYears: 1.737, inclinationDeg: 2.9, ascendingNodeDeg: 340, phaseDeg: 120, planetClass: 'ice', ownerId: ORION_REPUBLIC },
  // Dwarf planets in each main star's outer reaches — left unclaimed
  // (unowned) like every other dwarf planet/belt in this file: the Orion
  // Republic controls the system's planets, not its unclaimed frontier.
  { name: 'Centauri Minor I', parentStar: 'Rigil Kentaurus', radiusKm: 900, massKg: 1e21, auDistance: 14, color: '#c9d8dc', periodYears: 50.3, inclinationDeg: 12, ascendingNodeDeg: 60, phaseDeg: 200, planetClass: 'ice', isDwarfPlanet: true },
  { name: 'Toliman Minor', parentStar: 'Toliman', radiusKm: 700, massKg: 6e20, auDistance: 9, color: '#c9d8dc', periodYears: 28.3, inclinationDeg: 9, ascendingNodeDeg: 300, phaseDeg: 40, planetClass: 'ice', isDwarfPlanet: true },
]

// Barnard's Star (M4V) — Barnard b is real (confirmed 2024); the rest are
// generated, filling out a compact inner system typical of red dwarfs.
const BARNARDS_STAR_RAW: RawPlanet[] = [
  { name: 'Barnard b', radiusKm: 8920, massKg: 1.97e25, auDistance: 0.0596, color: '#c9603a', periodYears: 0.00863, inclinationDeg: 2.0, ascendingNodeDeg: 50, phaseDeg: 0, planetClass: 'lava' },
  { name: 'Barnard c', radiusKm: 4460, massKg: 2.99e24, auDistance: 0.12, color: '#a89478', periodYears: 0.1095, inclinationDeg: 1.4, ascendingNodeDeg: 150, phaseDeg: 100, planetClass: 'barren' },
  { name: 'Barnard d', radiusKm: 6371, massKg: 5.97e24, auDistance: 0.23, color: '#7fb0a8', periodYears: 0.2907, inclinationDeg: 2.6, ascendingNodeDeg: 260, phaseDeg: 200, planetClass: 'eyeball' },
  { name: 'Barnard e', radiusKm: 8282, massKg: 1.19e25, auDistance: 0.4, color: '#c9d8dc', periodYears: 0.6667, inclinationDeg: 3.1, ascendingNodeDeg: 20, phaseDeg: 320, planetClass: 'ice' },
  { name: 'Barnard’s Reach', radiusKm: 600, massKg: 4e20, auDistance: 5, color: '#c9d8dc', periodYears: 29.5, inclinationDeg: 8, ascendingNodeDeg: 100, phaseDeg: 40, planetClass: 'ice', isDwarfPlanet: true },
]

// Lalande 21185 (M2V) — b is a well-confirmed real detection, c a
// lower-confidence real candidate; the rest generated.
const LALANDE_21185_RAW: RawPlanet[] = [
  { name: 'Lalande 21185 b', radiusKm: 8282, massKg: 1.79e25, auDistance: 0.0786, color: '#b8623a', periodYears: 0.02703, inclinationDeg: 2.3, ascendingNodeDeg: 80, phaseDeg: 10, planetClass: 'lava' },
  { name: 'Lalande 21185 d', radiusKm: 6690, massKg: 6.57e24, auDistance: 0.35, color: '#7fb8a0', periodYears: 0.3053, inclinationDeg: 1.8, ascendingNodeDeg: 190, phaseDeg: 150, planetClass: 'eyeball' },
  { name: 'Lalande 21185 c', radiusKm: 11468, massKg: 7.76e25, auDistance: 2.9, color: '#8fb0c9', periodYears: 7.28, inclinationDeg: 3.5, ascendingNodeDeg: 300, phaseDeg: 250, planetClass: 'ice-giant' },
  { name: 'Lalande’s Hollow', radiusKm: 550, massKg: 3e20, auDistance: 8, color: '#c9d8dc', periodYears: 33.4, inclinationDeg: 11, ascendingNodeDeg: 40, phaseDeg: 300, planetClass: 'ice', isDwarfPlanet: true },
]

// Wolf 359 (M6V) — a very low-mass star with a correspondingly modest,
// tightly-packed system; nothing here is real (no confirmed exoplanets
// exist for Wolf 359).
const WOLF_359_RAW: RawPlanet[] = [
  { name: 'Wolf 359 b', radiusKm: 3823, massKg: 2.39e24, auDistance: 0.02, color: '#c9522a', periodYears: 0.00943, inclinationDeg: 1.2, ascendingNodeDeg: 60, phaseDeg: 0, planetClass: 'lava' },
  { name: 'Wolf 359 c', radiusKm: 5734, massKg: 4.78e24, auDistance: 0.035, color: '#7fb0a8', periodYears: 0.02182, inclinationDeg: 2.0, ascendingNodeDeg: 170, phaseDeg: 140, planetClass: 'eyeball' },
  { name: 'Wolf 359 d', radiusKm: 4460, massKg: 2.99e24, auDistance: 0.08, color: '#a89478', periodYears: 0.0754, inclinationDeg: 2.7, ascendingNodeDeg: 280, phaseDeg: 260, planetClass: 'barren' },
  { name: 'Wolf’s Ring Minor', radiusKm: 400, massKg: 2e20, auDistance: 2, color: '#c9d8dc', periodYears: 9.43, inclinationDeg: 7, ascendingNodeDeg: 90, phaseDeg: 180, planetClass: 'ice', isDwarfPlanet: true },
]

// Sirius — a real binary: the brilliant A-type primary Sirius A and its
// white-dwarf companion Sirius B (see starData's components). No inner
// planets survive Sirius B's real red-giant phase (~120 million years ago);
// the two surviving giants orbit Sirius A far enough out to have lived
// through it. All Sirius planets belong to the Orion Republic.
const SIRIUS_RAW: RawPlanet[] = [
  { name: 'Sirius Aeon', parentStar: 'Sirius A', radiusKm: 50000, massKg: 4e26, auDistance: 15, color: '#d8c090', periodYears: 40.87, inclinationDeg: 3.0, ascendingNodeDeg: 40, phaseDeg: 0, planetClass: 'gas-giant', ownerId: ORION_REPUBLIC },
  { name: 'Sirius Cinder', parentStar: 'Sirius A', radiusKm: 26000, massKg: 1.1e26, auDistance: 35, color: '#c9dce8', periodYears: 145.7, inclinationDeg: 4.5, ascendingNodeDeg: 200, phaseDeg: 180, planetClass: 'ice-giant', ownerId: ORION_REPUBLIC },
  // Dwarf planets left unclaimed, same "unowned frontier" rule as every
  // other belt/dwarf planet in this file.
  { name: 'Sirius Remnant I', parentStar: 'Sirius A', radiusKm: 500, massKg: 3e20, auDistance: 22, color: '#c9d8dc', periodYears: 62.9, inclinationDeg: 10, ascendingNodeDeg: 100, phaseDeg: 60, planetClass: 'ice', isDwarfPlanet: true },
  { name: 'Sirius Remnant II', parentStar: 'Sirius A', radiusKm: 650, massKg: 5e20, auDistance: 45, color: '#c9d8dc', periodYears: 212.4, inclinationDeg: 14, ascendingNodeDeg: 320, phaseDeg: 260, planetClass: 'ice', isDwarfPlanet: true },
]

// Luyten 726-8 (UV Ceti) — a real binary of two near-twin red-dwarf flare
// stars, BL Ceti (A) and UV Ceti (B), see starData's components. Generated
// planets in stable close (S-type) orbits around each star, none real.
const LUYTEN_726_8_RAW: RawPlanet[] = [
  { name: 'Luyten 726-8 Ab', parentStar: 'BL Ceti', radiusKm: 4460, massKg: 2.99e24, auDistance: 0.03, color: '#c9522a', periodYears: 0.01643, inclinationDeg: 1.5, ascendingNodeDeg: 30, phaseDeg: 0, planetClass: 'lava' },
  { name: 'Luyten 726-8 Ac', parentStar: 'BL Ceti', radiusKm: 6052, massKg: 5.37e24, auDistance: 0.06, color: '#7fb0a8', periodYears: 0.0465, inclinationDeg: 2.3, ascendingNodeDeg: 150, phaseDeg: 120, planetClass: 'eyeball' },
  { name: 'Luyten 726-8 Bb', parentStar: 'UV Ceti', radiusKm: 5097, massKg: 3.58e24, auDistance: 0.045, color: '#a89478', periodYears: 0.03017, inclinationDeg: 1.9, ascendingNodeDeg: 260, phaseDeg: 240, planetClass: 'barren' },
  { name: 'Luyten’s Speck', parentStar: 'BL Ceti', radiusKm: 380, massKg: 1.5e20, auDistance: 0.5, color: '#c9d8dc', periodYears: 1.12, inclinationDeg: 6, ascendingNodeDeg: 80, phaseDeg: 320, planetClass: 'ice', isDwarfPlanet: true },
]

// Ross 154 (M3.5V flare star) — generated, no real confirmed exoplanets.
const ROSS_154_RAW: RawPlanet[] = [
  { name: 'Ross 154 b', radiusKm: 4778, massKg: 3.28e24, auDistance: 0.06, color: '#c9522a', periodYears: 0.02683, inclinationDeg: 1.7, ascendingNodeDeg: 20, phaseDeg: 0, planetClass: 'lava' },
  { name: 'Ross 154 c', radiusKm: 6690, massKg: 6.57e24, auDistance: 0.15, color: '#7fb8a0', periodYears: 0.1061, inclinationDeg: 2.5, ascendingNodeDeg: 140, phaseDeg: 130, planetClass: 'eyeball' },
  { name: 'Ross 154 d', radiusKm: 7645, massKg: 9.55e24, auDistance: 0.35, color: '#c9d8dc', periodYears: 0.378, inclinationDeg: 3.2, ascendingNodeDeg: 270, phaseDeg: 250, planetClass: 'ice' },
  { name: 'Ross’s Cairn', radiusKm: 450, massKg: 2.5e20, auDistance: 3, color: '#c9d8dc', periodYears: 9.49, inclinationDeg: 9, ascendingNodeDeg: 200, phaseDeg: 90, planetClass: 'ice', isDwarfPlanet: true },
]

export const PLANETS_BY_STAR: Record<string, PlanetData[]> = {
  sol: buildPlanets('sol', SOL_RAW),
  'alpha-centauri': buildPlanets('alpha-centauri', ALPHA_CENTAURI_RAW),
  'barnards-star': buildPlanets('barnards-star', BARNARDS_STAR_RAW),
  'wolf-359': buildPlanets('wolf-359', WOLF_359_RAW),
  'lalande-21185': buildPlanets('lalande-21185', LALANDE_21185_RAW),
  sirius: buildPlanets('sirius', SIRIUS_RAW),
  'luyten-726-8': buildPlanets('luyten-726-8', LUYTEN_726_8_RAW),
  'ross-154': buildPlanets('ross-154', ROSS_154_RAW),
}

export function getPlanetsForStar(starId: string): PlanetData[] {
  return PLANETS_BY_STAR[starId] ?? []
}

// Backward-compatible alias — the overwhelming majority of scene/physics
// code was written against "the" planet roster before other systems had any
// data at all. Same array reference as PLANETS_BY_STAR['sol'], so every
// existing Sol-only consumer keeps behaving exactly as before.
export const PLANETS: PlanetData[] = PLANETS_BY_STAR.sol
