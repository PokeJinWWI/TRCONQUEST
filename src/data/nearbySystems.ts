// The planets of the nearby stars that came in with the 12 light-year chart
// (starData.STARS from index 8 on), plus Barnard's Star's real worlds.
//
// Two layers, kept apart so the UI can say which is which:
//  1. REAL detections (Wikipedia's List of nearest exoplanets, read Oct 2026),
//     tagged `knownStatus` 'confirmed' or 'candidate'. Radial-velocity masses
//     are MINIMUM masses and are used as the true mass; the radius comes from
//     a mass-radius relation (an estimate: none of these transit). The orbit
//     is the real period; the semi-major axis follows from Kepler's third law.
//  2. SEEDED top-up: what a radial-velocity survey would not have seen yet,
//     worlds beyond the outermost detection (or inside it, for a directly
//     imaged giant), and sometimes only a belt. No `knownStatus`. Every star
//     draws from its own stream, so nothing moves when another system changes.
import type { PlanetClass, RawPlanet } from '../scene/planetData'
import type { AsteroidBeltData } from './asteroidBeltData'
import { GALAXY_SEED, between, intBetween, rollPlanet, seededStream, PLANET_COLORS } from './galaxyGen'

type Status = 'confirmed' | 'candidate'

interface RealWorld {
  // The designation letter(s), appended to the system's name prefix.
  letter: string
  massEarth: number
  periodDays: number
  planetClass: PlanetClass
  status: Status
  // The component star it orbits (a multi-star system) and that star's mass.
  parentStar?: string
  hostMass?: number
}

interface SystemSpec {
  // What planet names are built on: "<prefix> <letter>".
  prefix: string
  // The primary's mass, solar masses (a real world may give its own host's).
  hostMass: number
  // The primary component's name in a multi-star system; generated planets orbit it.
  primary?: string
  real: RealWorld[]
  // Real debris belts (approximate extents, AU).
  belts?: { name: string; innerAU: number; outerAU: number; color: string; parentStar?: string }[]
  // How many generated planets, min/max, and where they go.
  extras: [number, number]
  fill?: 'outer' | 'inner'
  // The first letter generated planets may take (keeps clear of disputed names).
  firstLetter?: string
  // Hand-authored worlds added after the seeded ones (they draw nothing from the stream).
  authored?: RawPlanet[]
  // Chance of one generated belt beyond the planets (when there are none: higher).
  beltChance?: number
}

const DUST = '#9a8f7a'
const GREY = '#8a8378'
const COLD = '#6a7a8a'

const SYSTEMS: Record<string, SystemSpec> = {
  'barnards-star': {
    prefix: 'Barnard',
    hostMass: 0.162,
    real: [
      { letter: 'd', massEarth: 0.26, periodDays: 2.34, planetClass: 'lava', status: 'confirmed' },
      { letter: 'b', massEarth: 0.3, periodDays: 3.154, planetClass: 'lava', status: 'confirmed' },
      { letter: 'c', massEarth: 0.34, periodDays: 4.124, planetClass: 'barren', status: 'confirmed' },
      { letter: 'e', massEarth: 0.19, periodDays: 6.739, planetClass: 'barren', status: 'confirmed' },
    ],
    extras: [0, 0],
    beltChance: 0,
  },
  'epsilon-eridani': {
    prefix: 'ε Eridani',
    hostMass: 0.82,
    real: [{ letter: 'b', massEarth: 318, periodDays: 2680, planetClass: 'gas-giant', status: 'confirmed' }],
    belts: [
      { name: 'ε Eridani Inner Belt', innerAU: 2.2, outerAU: 3, color: DUST },
      { name: 'ε Eridani Middle Belt', innerAU: 18, outerAU: 22, color: GREY },
      { name: 'ε Eridani Outer Disk', innerAU: 35, outerAU: 90, color: COLD },
    ],
    extras: [1, 3],
  },
  'tau-ceti': {
    prefix: 'τ Ceti',
    hostMass: 0.783,
    real: [
      { letter: 'e', massEarth: 3.93, periodDays: 162.9, planetClass: 'desert', status: 'candidate' },
      { letter: 'f', massEarth: 3.93, periodDays: 636.1, planetClass: 'ice', status: 'candidate' },
    ],
    belts: [{ name: 'τ Ceti Debris Disk', innerAU: 6, outerAU: 52, color: COLD }],
    extras: [1, 3],
    firstLetter: 'i',
    authored: [
      // A California world, in the Sun-like star's habitable zone between the two
      // candidate planets: Earth-sized, warm, a touch more flux than Earth gets.
      // The seeded surface is tuned in groundData.SURFACE_OVERRIDES. Home of the Republic
      // of Jinshan (data/countryData.ts).
      { name: 'Jinshan', radiusKm: 6500, massKg: 6.3e24, auDistance: 0.7, color: '#8fa65a', periodYears: 0.662, inclinationDeg: 1.4, ascendingNodeDeg: 215, phaseDeg: 40, planetClass: 'continental', ownerId: 'republic-of-jinshan' },
    ],
  },
  'ross-128': {
    prefix: 'Ross 128',
    hostMass: 0.168,
    real: [{ letter: 'b', massEarth: 1.4, periodDays: 9.866, planetClass: 'eyeball', status: 'confirmed' }],
    extras: [1, 3],
  },
  'lacaille-9352': {
    prefix: 'Lacaille 9352',
    hostMass: 0.489,
    real: [
      { letter: 'e', massEarth: 1.46, periodDays: 4.42, planetClass: 'lava', status: 'candidate' },
      { letter: 'b', massEarth: 3.9, periodDays: 9.262, planetClass: 'lava', status: 'confirmed' },
      { letter: 'c', massEarth: 6.5, periodDays: 21.78, planetClass: 'desert', status: 'confirmed' },
      { letter: 'd', massEarth: 6.1, periodDays: 50.77, planetClass: 'eyeball', status: 'candidate' },
    ],
    extras: [0, 2],
  },
  'epsilon-indi': {
    prefix: 'ε Indi A',
    hostMass: 0.762,
    primary: 'ε Indi A',
    // Directly imaged: far out, so what is missing is the inner system.
    real: [{ letter: 'b', massEarth: 2005, periodDays: 63_400, planetClass: 'gas-giant', status: 'confirmed', parentStar: 'ε Indi A' }],
    extras: [1, 3],
    fill: 'inner',
  },
  'struve-2398': {
    prefix: 'Struve 2398',
    hostMass: 0.33,
    primary: 'Struve 2398 A',
    real: [
      { letter: 'b', massEarth: 2.78, periodDays: 11.2201, planetClass: 'desert', status: 'confirmed', parentStar: 'Struve 2398 A', hostMass: 0.33 },
      { letter: 'c', massEarth: 3.4, periodDays: 37.9, planetClass: 'eyeball', status: 'confirmed', parentStar: 'Struve 2398 B', hostMass: 0.25 },
    ],
    extras: [0, 2],
  },
  'groombridge-34': {
    prefix: 'Groombridge 34',
    hostMass: 0.38,
    primary: 'Groombridge 34 A',
    real: [
      { letter: 'b', massEarth: 3.03, periodDays: 11.44, planetClass: 'desert', status: 'confirmed', parentStar: 'Groombridge 34 A' },
      { letter: 'c', massEarth: 36, periodDays: 7600, planetClass: 'ice-giant', status: 'confirmed', parentStar: 'Groombridge 34 A' },
    ],
    extras: [0, 2],
  },
  'l372-58': {
    prefix: 'L372-58',
    hostMass: 0.113,
    real: [
      { letter: 'b', massEarth: 1.37, periodDays: 3.204, planetClass: 'lava', status: 'confirmed' },
      { letter: 'c', massEarth: 1.74, periodDays: 6.689, planetClass: 'desert', status: 'confirmed' },
      { letter: 'd', massEarth: 1.64, periodDays: 13.03, planetClass: 'eyeball', status: 'confirmed' },
    ],
    extras: [0, 3],
  },
  'l725-32': {
    prefix: 'L725-32',
    hostMass: 0.13,
    real: [
      { letter: 'b', massEarth: 0.7, periodDays: 2.021, planetClass: 'lava', status: 'confirmed' },
      { letter: 'c', massEarth: 1.14, periodDays: 3.06, planetClass: 'lava', status: 'confirmed' },
      { letter: 'd', massEarth: 1.09, periodDays: 4.656, planetClass: 'desert', status: 'confirmed' },
    ],
    extras: [0, 3],
  },
  'luytens-star': {
    prefix: "Luyten's Star",
    hostMass: 0.29,
    real: [
      { letter: 'c', massEarth: 1.18, periodDays: 4.723, planetClass: 'desert', status: 'confirmed' },
      { letter: 'b', massEarth: 2.89, periodDays: 18.65, planetClass: 'eyeball', status: 'confirmed' },
    ],
    extras: [0, 3],
  },
  // No planet detected (yet): generated, and some of them only a belt.
  '61-cygni': { prefix: '61 Cygni', hostMass: 0.7, primary: '61 Cygni A', real: [], extras: [0, 4] },
  procyon: { prefix: 'Procyon', hostMass: 1.5, primary: 'Procyon A', real: [], extras: [0, 4] },
  'dx-cancri': { prefix: 'G51-15', hostMass: 0.09, real: [], extras: [0, 4] },
  'l789-6': { prefix: 'L789-6', hostMass: 0.11, primary: 'EZ Aquarii A', real: [], extras: [0, 4] },
  'ross-248': { prefix: 'Ross 248', hostMass: 0.136, real: [], extras: [0, 4] },
}

// Real worlds only. Gas giants hold about a Jupiter radius whatever their mass.
export function radiusKmFromMass(massEarth: number): number {
  const r = massEarth < 2.04 ? Math.pow(massEarth, 0.279) : massEarth < 131.6 ? 0.79 * Math.pow(massEarth, 0.589) : 11.2 * Math.pow(massEarth / 318, -0.04)
  return Math.round(r * 6371)
}

const EARTH_MASS_KG = 5.972e24
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

function realWorld(rng: () => number, spec: SystemSpec, w: RealWorld): RawPlanet {
  const yearsOfPeriod = w.periodDays / 365.25
  const au = Math.cbrt((w.hostMass ?? spec.hostMass) * yearsOfPeriod * yearsOfPeriod)
  return {
    name: `${spec.prefix} ${w.letter}`,
    radiusKm: radiusKmFromMass(w.massEarth),
    massKg: w.massEarth * EARTH_MASS_KG,
    auDistance: round(au, 4),
    color: PLANET_COLORS[w.planetClass],
    periodYears: round(yearsOfPeriod, 5),
    inclinationDeg: round(between(rng, 0.4, 3.5), 1),
    ascendingNodeDeg: Math.round(rng() * 360),
    phaseDeg: Math.round(rng() * 360),
    planetClass: w.planetClass,
    knownStatus: w.status,
    ...(w.parentStar ? { parentStar: w.parentStar } : {}),
  }
}

const LETTERS = 'bcdefghijklmnop'
const MULTI_STAR_MAX_AU = 10

interface Built {
  planets: RawPlanet[]
  belts: AsteroidBeltData[]
}
const cache = new Map<string, Built>()

function build(starId: string): Built | undefined {
  const spec = SYSTEMS[starId]
  if (!spec) return undefined
  const cached = cache.get(starId)
  if (cached) return cached
  const rng = seededStream(GALAXY_SEED, `nearby:${starId}`)
  rng()
  rng()
  const real = spec.real.map((w) => realWorld(rng, spec, w))
  const planets = [...real]
  const belts: AsteroidBeltData[] = (spec.belts ?? []).map((b) => ({ ...b }))

  const habitableAU = Math.sqrt(Math.pow(spec.hostMass, 3.5))
  const count = intBetween(rng, spec.extras[0], spec.extras[1])
  const usedLetters = new Set(spec.real.map((w) => w.letter))
  let letterAt = LETTERS.indexOf(spec.firstLetter ?? 'b')
  const nextName = () => {
    while (usedLetters.has(LETTERS[letterAt])) letterAt++
    return `${spec.prefix} ${LETTERS[letterAt++]}`
  }
  const outermost = real.reduce((m, p) => Math.max(m, p.auDistance), 0)
  const innermost = real.reduce((m, p) => Math.min(m, p.auDistance), Infinity)
  const orbitOf = (p: RawPlanet): RawPlanet => (spec.primary ? { ...p, parentStar: spec.primary } : p)
  const extras: RawPlanet[] = []
  if (spec.fill === 'inner') {
    let au = habitableAU * between(rng, 0.2, 0.5)
    for (let i = 0; i < count && au < innermost / 1.4; i++) {
      const p = rollPlanet(rng, nextName(), au, spec.hostMass, habitableAU)
      extras.push(orbitOf(p))
      au *= between(rng, p.planetClass === 'gas-giant' || p.planetClass === 'ice-giant' ? 1.8 : 1.5, 2.4)
    }
  } else {
    let au = real.length > 0 ? outermost * between(rng, 1.6, 2.4) : habitableAU * between(rng, 0.15, 0.5)
    for (let i = 0; i < count; i++) {
      if (spec.primary && au > MULTI_STAR_MAX_AU) break
      const p = rollPlanet(rng, nextName(), au, spec.hostMass, habitableAU)
      extras.push(orbitOf(p))
      au *= between(rng, p.planetClass === 'gas-giant' || p.planetClass === 'ice-giant' ? 1.8 : 1.5, 2.4)
    }
  }
  planets.push(...extras)

  // A belt beyond everything, more likely round a star with no planets: some
  // systems are only a belt.
  const farthest = planets.reduce((m, p) => Math.max(m, p.auDistance), 0)
  const chance = spec.beltChance ?? (planets.length === 0 ? 0.7 : 0.35)
  if (spec.fill !== 'inner' && !spec.belts && rng() < chance) {
    const innerAU = round((farthest > 0 ? farthest * between(rng, 1.3, 1.8) : between(rng, 0.05, 0.6)), 3)
    const outerAU = Math.max(innerAU + 0.002, round(innerAU * between(rng, 1.2, 1.5), 3))
    belts.push({ name: `${spec.prefix} Belt`, innerAU, outerAU, color: DUST, ...(spec.primary ? { parentStar: spec.primary } : {}) })
  }
  planets.push(...(spec.authored ?? []))
  planets.sort((a, b) => a.auDistance - b.auDistance)
  const built = { planets, belts }
  cache.set(starId, built)
  return built
}

export function nearbyRawPlanets(starId: string): RawPlanet[] | undefined {
  return build(starId)?.planets
}

export function nearbyBelts(starId: string): AsteroidBeltData[] | undefined {
  return build(starId)?.belts
}

// Every star id this file supplies a system for.
export const NEARBY_SYSTEM_IDS: string[] = Object.keys(SYSTEMS)
