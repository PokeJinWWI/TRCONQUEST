// The rest of the galaxy: procedural star systems for every neighbourhood
// except our own. The Solar Neighbourhood's 8 systems are hand-authored
// (starData.STARS, planetData.PLANETS_BY_STAR) and never pass through here;
// everything below is served through the same lookups those use
// (getStarsForNeighborhood, getPlanetsForStar, getAsteroidBeltsForStar), so
// the global constants stay exactly the Sol neighbourhood.
//
// Deterministic: one seed (GALAXY_SEED), and every cluster and every star
// draws from its own stream (the seed hashed with its id), so the result does
// not depend on what was generated first.
import { NEIGHBORHOODS, type NeighborhoodData } from './neighborhoodData'
import type { StarData } from './starData'
import type { AsteroidBeltData } from './asteroidBeltData'
import type { PlanetClass, RawPlanet } from '../scene/planetData'

export const GALAXY_SEED = 20261001
export const SOLAR_NEIGHBORHOOD_ID = 'solar-neighborhood'
export const MIN_STARS_PER_CLUSTER = 6
export const MAX_STARS_PER_CLUSTER = 12
export const MAX_PLANETS_PER_STAR = 5

// A stream of numbers in [0, 1) for one seed and one key (mulberry32 over an
// FNV-1a hash of the two).
export function seededStream(seed: number, key: string): () => number {
  let h = 2166136261 ^ seed
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo)
const intBetween = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))
function weighted<T extends { weight: number }>(rng: () => number, options: T[]): T {
  let roll = rng() * options.reduce((sum, o) => sum + o.weight, 0)
  for (const o of options) {
    roll -= o.weight
    if (roll < 0) return o
  }
  return options[options.length - 1]
}

const SOLAR_MASS_KG = 1.989e30
const SOLAR_RADIUS_KM = 696_000

// Roughly the real mix of stars near the Sun: mostly red dwarfs.
const STAR_KINDS = [
  { weight: 60, letter: 'M', color: '#ff7a4a', mass: [0.1, 0.6], radius: [0.15, 0.6] },
  { weight: 15, letter: 'K', color: '#ffb070', mass: [0.6, 0.85], radius: [0.65, 0.85] },
  { weight: 9, letter: 'G', color: '#ffd27a', mass: [0.85, 1.1], radius: [0.9, 1.1] },
  { weight: 5, letter: 'F', color: '#fff0d0', mass: [1.1, 1.5], radius: [1.1, 1.4] },
  { weight: 3, letter: 'A', color: '#bfe0ff', mass: [1.6, 2.4], radius: [1.5, 2.0] },
  { weight: 8, letter: 'D', color: '#eaf4ff', mass: [0.5, 1.0], radius: [0.008, 0.015] },
] as const

const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu']
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI']
const CLUSTER_RADIUS_LY = 9
const MIN_STAR_SEPARATION_LY = 2

// One cluster's stars: 6-12 single stars scattered through a ball a few
// light-years across. Positions are in light-years from the cluster's own
// centre (the Solar Neighbourhood's are from Sol, the same idea).
export function generateClusterStars(seed: number, cluster: Pick<NeighborhoodData, 'id' | 'name'>): StarData[] {
  const rng = seededStream(seed, `stars:${cluster.id}`)
  const count = intBetween(rng, MIN_STARS_PER_CLUSTER, MAX_STARS_PER_CLUSTER)
  const stars: StarData[] = []
  for (let i = 0; i < count; i++) {
    let position: [number, number, number] = [0, 0, 0]
    for (let attempt = 0; attempt < 40; attempt++) {
      const r = CLUSTER_RADIUS_LY * Math.cbrt(rng())
      const theta = rng() * Math.PI * 2
      const phi = Math.acos(2 * rng() - 1)
      position = [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi) * 0.6]
      const p = position
      if (stars.every((s) => Math.hypot(s.position[0] - p[0], s.position[1] - p[1], s.position[2] - p[2]) >= MIN_STAR_SEPARATION_LY)) break
    }
    const kind = weighted(rng, [...STAR_KINDS])
    const round3 = (n: number) => Math.round(n * 1000) / 1000
    stars.push({
      id: `${cluster.id}-s${i}`,
      name: `${cluster.name} ${GREEK[i]}`,
      color: kind.color,
      distanceLy: round3(Math.hypot(...position)),
      position: [round3(position[0]), round3(position[1]), round3(position[2])],
      hasSystemData: true,
      massKg: between(rng, kind.mass[0], kind.mass[1]) * SOLAR_MASS_KG,
      radiusKm: Math.round(between(rng, kind.radius[0], kind.radius[1]) * SOLAR_RADIUS_KM),
      starClass: kind.letter === 'D' ? 'DA white dwarf' : `${kind.letter}${intBetween(rng, 0, 9)}V`,
    })
  }
  return stars
}

const PLANET_COLORS: Record<PlanetClass, string> = {
  continental: '#6fa8dc',
  ocean: '#3d7dc9',
  hycean: '#5fb0c9',
  desert: '#c9a36a',
  toxic: '#c9b65a',
  barren: '#8a8378',
  ice: '#c9d8dc',
  lava: '#c9562a',
  eyeball: '#7fb8a0',
  'gas-giant': '#d9b38c',
  'ice-giant': '#8fc7d9',
}
const HOT: PlanetClass[] = ['lava', 'barren', 'desert', 'toxic']
const TEMPERATE: PlanetClass[] = ['continental', 'ocean', 'desert', 'hycean', 'barren', 'toxic']
const COLD: PlanetClass[] = ['gas-giant', 'ice-giant', 'ice', 'barren', 'gas-giant']
const EARTH_RADIUS_KM = 6371
const EARTH_MASS_KG = 5.972e24
const JUPITER_MASS_KG = 1.898e27

// A star's planets, kept minimal: 0-5 on widening orbits, hot worlds close in,
// giants and ice far out. Same shape the hand-authored systems are written in.
export function generateRawPlanets(seed: number, star: Pick<StarData, 'id' | 'name' | 'massKg'>): RawPlanet[] {
  const rng = seededStream(seed, `planets:${star.id}`)
  const count = intBetween(rng, 0, MAX_PLANETS_PER_STAR)
  const solarMasses = star.massKg / SOLAR_MASS_KG
  // Where a world gets Earth's sunlight, in AU (luminosity ~ mass^3.5).
  const habitableAU = Math.sqrt(Math.pow(solarMasses, 3.5))
  const planets: RawPlanet[] = []
  let au = habitableAU * between(rng, 0.15, 0.5)
  for (let i = 0; i < count; i++) {
    const warmth = au / habitableAU
    const pool = warmth < 0.6 ? HOT : warmth <= 1.6 ? TEMPERATE : COLD
    const picked = pool[Math.floor(rng() * pool.length)]
    // A temperate world sits so close to a red dwarf that it is tidally locked.
    const planetClass: PlanetClass = picked === 'continental' && solarMasses < 0.5 ? 'eyeball' : picked
    const giant = planetClass === 'gas-giant' || planetClass === 'ice-giant'
    const radiusKm = Math.round(planetClass === 'gas-giant' ? between(rng, 40_000, 75_000) : planetClass === 'ice-giant' ? between(rng, 20_000, 28_000) : between(rng, 2500, 8000))
    const massKg =
      planetClass === 'gas-giant'
        ? between(rng, 0.3, 2) * JUPITER_MASS_KG
        : planetClass === 'ice-giant'
          ? between(rng, 0.5, 1.2) * 1e26
          : EARTH_MASS_KG * Math.pow(radiusKm / EARTH_RADIUS_KM, 3.7)
    planets.push({
      name: `${star.name} ${ROMAN[i]}`,
      radiusKm,
      massKg,
      auDistance: Math.round(au * 1000) / 1000,
      color: PLANET_COLORS[planetClass],
      periodYears: Math.sqrt(Math.pow(au, 3) / solarMasses),
      inclinationDeg: Math.round(between(rng, 0, 6) * 10) / 10,
      ascendingNodeDeg: Math.round(rng() * 360),
      phaseDeg: Math.round(rng() * 360),
      planetClass,
    })
    au *= between(rng, giant ? 1.8 : 1.5, 2.4)
  }
  return planets
}

// At most one belt, outside the planets.
export function generateBelts(seed: number, star: Pick<StarData, 'id' | 'name' | 'massKg'>): AsteroidBeltData[] {
  const rng = seededStream(seed, `belts:${star.id}`)
  if (rng() >= 0.35) return []
  const planets = generateRawPlanets(seed, star)
  const outermost = planets.length > 0 ? planets[planets.length - 1].auDistance : between(rng, 0.3, 1.5)
  // To the thousandth of an AU: a red dwarf's whole system fits inside 0.1 AU.
  const innerAU = Math.round(outermost * between(rng, 1.3, 1.8) * 1000) / 1000
  const outerAU = Math.max(innerAU + 0.002, Math.round(innerAU * between(rng, 1.2, 1.5) * 1000) / 1000)
  return [{ name: `${star.name} Belt`, innerAU, outerAU, color: '#8a8378' }]
}

// --- The galaxy as generated from GALAXY_SEED, built once on first use -------

interface Galaxy {
  starsByCluster: Map<string, StarData[]>
  starById: Map<string, { star: StarData; clusterId: string }>
  starByName: Map<string, StarData>
}
let galaxy: Galaxy | null = null

function theGalaxy(): Galaxy {
  if (galaxy) return galaxy
  const starsByCluster = new Map<string, StarData[]>()
  const starById = new Map<string, { star: StarData; clusterId: string }>()
  const starByName = new Map<string, StarData>()
  for (const cluster of NEIGHBORHOODS) {
    if (cluster.id === SOLAR_NEIGHBORHOOD_ID) continue
    const stars = generateClusterStars(GALAXY_SEED, cluster)
    starsByCluster.set(cluster.id, stars)
    for (const star of stars) {
      starById.set(star.id, { star, clusterId: cluster.id })
      starByName.set(star.name, star)
    }
  }
  galaxy = { starsByCluster, starById, starByName }
  return galaxy
}

const NO_STARS: StarData[] = []

// The generated clusters' ids (every neighbourhood but our own).
export function generatedClusterIds(): string[] {
  return [...theGalaxy().starsByCluster.keys()]
}

export function generatedStarsFor(clusterId: string): StarData[] {
  return theGalaxy().starsByCluster.get(clusterId) ?? NO_STARS
}

export function findGeneratedStar(starId: string): StarData | undefined {
  return theGalaxy().starById.get(starId)?.star
}

// A generated star by its NAME (a star is the one body of its own name in its system).
export function findGeneratedStarByName(name: string): StarData | undefined {
  return theGalaxy().starByName.get(name)
}

// The generated star a body name belongs to, in O(1) and without generating
// anything: a generated planet is named "<star name> <numeral>" (generateRawPlanets),
// so its star is the name less its last word. Undefined for a hand-authored body
// or a name that is no generated planet's.
export function generatedStarOfBody(bodyName: string): StarData | undefined {
  const cut = bodyName.lastIndexOf(' ')
  if (cut <= 0) return undefined
  const star = theGalaxy().starByName.get(bodyName.slice(0, cut))
  if (!star) return undefined
  return generatedRawPlanetsFor(star.id).some((p) => p.name === bodyName) ? star : undefined
}

// The cluster a generated star belongs to (undefined for a hand-authored one).
export function clusterOfGeneratedStar(starId: string): string | undefined {
  return theGalaxy().starById.get(starId)?.clusterId
}

const rawPlanetCache = new Map<string, RawPlanet[]>()
export function generatedRawPlanetsFor(starId: string): RawPlanet[] {
  const cached = rawPlanetCache.get(starId)
  if (cached) return cached
  const star = findGeneratedStar(starId)
  const planets = star ? generateRawPlanets(GALAXY_SEED, star) : []
  rawPlanetCache.set(starId, planets)
  return planets
}

export function generatedBeltsFor(starId: string): AsteroidBeltData[] {
  const star = findGeneratedStar(starId)
  return star ? generateBelts(GALAXY_SEED, star) : []
}
