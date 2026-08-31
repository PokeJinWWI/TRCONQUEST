// Stellar neighborhoods — the galaxy-view equivalent of starData's stars.
// Just as INTERSTELLAR represents a whole star system as a single point (its
// star), GALACTIC represents a whole neighborhood (a cluster of many star
// systems) as a single point. Only one neighborhood has real interior data
// today — our own, the same 8-star cluster starData.ts already models — so
// `hasInterstellarData` mirrors StarData's `hasSystemData`: false just means
// "not charted yet," the same honest incomplete-state the rest of this
// project already uses rather than faking data for hundreds of neighborhoods
// nothing populates yet.
//
// Positions are procedural — no real catalog of "stellar neighborhoods"
// exists to draw from (unlike starData's real nearest-star catalog) — laid
// out on a log-spiral matching the Milky Way's real broad shape (a bulge
// plus ~4 arms), with our own neighborhood placed at Sol's real approximate
// galactic location: ~27,000 ly from the core, in the Orion Spur between the
// Sagittarius and Perseus arms.

export interface NeighborhoodData {
  id: string
  name: string
  color: string
  // Cartesian position in kly (thousand light-years), galactic center at the
  // origin — same "real units in, scene units derived" split starData uses.
  position: [number, number, number]
  hasInterstellarData: boolean
}

export const UNITS_PER_KLY = 30

export function neighborhoodScenePosition(n: NeighborhoodData): [number, number, number] {
  return [n.position[0] * UNITS_PER_KLY, n.position[2] * UNITS_PER_KLY, n.position[1] * UNITS_PER_KLY]
}

// Small deterministic PRNG (not Math.random) so the galaxy's shape is stable
// across reloads instead of reshuffling every time the module loads.
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const CONSTELLATIONS = [
  'Vela', 'Cygnus', 'Draco', 'Lyra', 'Aquila', 'Perseus', 'Orion', 'Carina', 'Centaurus', 'Hydra',
  'Corvus', 'Lupus', 'Ara', 'Pavo', 'Grus', 'Phoenix', 'Fornax', 'Eridanus', 'Cetus', 'Pegasus',
  'Andromeda', 'Cassiopeia', 'Cepheus', 'Auriga', 'Gemini', 'Leo', 'Virgo', 'Libra', 'Scorpius', 'Sagittarius',
  'Capricornus', 'Aquarius', 'Pisces', 'Aries', 'Taurus', 'Cancer', 'Sculptor', 'Pictor', 'Volans', 'Chamaeleon',
  'Apus', 'Octans', 'Indus', 'Tucana', 'Reticulum', 'Horologium', 'Caelum', 'Columba', 'Lepus', 'Monoceros',
]
const SECTOR_WORDS = ['Reach', 'Drift', 'Expanse', 'Cluster', 'Rim', 'Belt', 'Verge', 'Span', 'Deep', 'Marches']

function neighborhoodName(rng: () => number, usedNames: Set<string>): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const constellation = CONSTELLATIONS[Math.floor(rng() * CONSTELLATIONS.length)]
    const word = SECTOR_WORDS[Math.floor(rng() * SECTOR_WORDS.length)]
    const name = `${constellation} ${word}`
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return name
    }
  }
  // Exhausted the easy combinations (very unlikely at this count) — fall
  // back to a numbered variant rather than looping forever.
  const name = `Sector ${Math.floor(rng() * 9000 + 1000)}`
  usedNames.add(name)
  return name
}

const ARM_COUNT = 4
const ARM_COLORS = ['#8fd0ff', '#ffd27a', '#ff9a7a', '#b6a3ff']
const GALAXY_RADIUS_KLY = 55
const DISK_THICKNESS_KLY = 1.2
const BULGE_RADIUS_KLY = 6

function generateNeighborhoods(count: number, seed: number): NeighborhoodData[] {
  const rng = seededRandom(seed)
  const usedNames = new Set<string>()
  const result: NeighborhoodData[] = []

  // Central bulge — a denser, roughly spherical cluster with no arm
  // structure, same as the real Milky Way's core.
  const bulgeCount = Math.round(count * 0.12)
  for (let i = 0; i < bulgeCount; i++) {
    const r = BULGE_RADIUS_KLY * Math.cbrt(rng())
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    const x = r * Math.sin(phi) * Math.cos(theta)
    const y = r * Math.sin(phi) * Math.sin(theta)
    const z = r * Math.cos(phi) * 0.4
    result.push({
      id: `bulge-${i}`,
      name: neighborhoodName(rng, usedNames),
      color: '#ffdca0',
      position: [x, y, z],
      hasInterstellarData: false,
    })
  }

  // Spiral arms — a log spiral per arm, scattered around its centerline.
  const armCount = count - bulgeCount
  for (let i = 0; i < armCount; i++) {
    const arm = i % ARM_COUNT
    const t = rng()
    const armAngleOffset = (arm / ARM_COUNT) * Math.PI * 2
    const radius = BULGE_RADIUS_KLY + t * (GALAXY_RADIUS_KLY - BULGE_RADIUS_KLY)
    const angle = armAngleOffset + t * 3.2 // spiral wind — how tightly the arms curl
    const scatter = (rng() - 0.5) * radius * 0.28
    const scatterAngle = rng() * Math.PI * 2
    const x = Math.cos(angle) * radius + Math.cos(scatterAngle) * Math.abs(scatter)
    const y = Math.sin(angle) * radius + Math.sin(scatterAngle) * Math.abs(scatter)
    const z = (rng() - 0.5) * DISK_THICKNESS_KLY * (1 - radius / GALAXY_RADIUS_KLY + 0.3)
    result.push({
      id: `arm${arm}-${i}`,
      name: neighborhoodName(rng, usedNames),
      color: ARM_COLORS[arm],
      position: [x, y, z],
      hasInterstellarData: false,
    })
  }

  return result
}

// Sol sits ~27,000 ly (27 kly) from the galactic core, in the Orion Spur — a
// minor arm segment between Sagittarius and Perseus. Angle chosen arbitrarily
// (galactic longitude isn't otherwise pinned down anywhere in this project).
const SOLAR_NEIGHBORHOOD: NeighborhoodData = {
  id: 'solar-neighborhood',
  name: 'Solar Neighborhood',
  color: '#ffd27a',
  position: [27, 0, 0.05],
  hasInterstellarData: true,
}

export const NEIGHBORHOODS: NeighborhoodData[] = [SOLAR_NEIGHBORHOOD, ...generateNeighborhoods(320, 20260830)]
