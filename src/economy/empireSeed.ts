// The economies of the generated empires (data/generatedEmpires.ts): worlds,
// country, bank and operator company for each, built by the SAME seeding
// pipeline the four nations' worlds go through (economySeed.seedNationWorlds:
// transport, supply chains, balancing, administration) and then run by the SAME
// tickEconomy. Pure and deterministic: the same empires always give the same
// economies, whatever was seeded before.
//
// What is derived, and from what:
//   - a world per habitable-or-usable planet an empire owns (the best one is its
//     home world, the rest are colonies, at most MAX_WORLDS_PER_EMPIRE), its
//     population from the planet's class and size, its buildings from what the
//     planet class can supply (EXTRACTION_BY_CLASS) on top of one shared base kit;
//   - the country from the empire's INFLUENCE (treasury, bonds, banks) on top of
//     the settled Venus/Mars templates (the laissez-faire / interventionist
//     nations the economy was calibrated on);
//   - nothing from its TECH: the economy has no tech hook, so an empire's
//     researched set does not change its economy (and none is invented here).
import type { PlanetClass, PlanetData } from '../scene/planetData'
import { getPlanetsForStar } from '../scene/planetData'
import { estimateSize } from '../scene/bodyStats'
import { LAND_PER_SIZE_DISTRICT } from '../scene/bodyLand'
import type { GalaxyEmpire } from '../data/generatedEmpires'
import { INFLUENCE_CAP } from '../data/colonyData'
import { JOB_SCALE } from './economyTick'
import { getMethod } from './recipes'
import { makeBank, seedCentralBank, seedCountries, seedNationWorlds, type BuildingSpec, type SeedNation, type WorldSpec } from './economySeed'
import type { SeedCalibration } from './seedCalibration'
import { EMPIRE_TAX_RATES, EMPIRE_WORLD_CALIBRATION } from './empireCalibration'
import type { Bank, Corporation, Country, World } from './economyTypes'
import type { ReligionMix } from './demographics'

// An empire never runs more than this many worlds: home + colonies.
export const MAX_WORLDS_PER_EMPIRE = 4

// Millions of people on a HOME world of each class at Earth's size; colonies hold
// COLONY_SHARE of it. Lava worlds and giants take no people.
const HOME_POPULATION: Partial<Record<PlanetClass, number>> = {
  continental: 3000,
  ocean: 2500,
  hycean: 2000,
  desert: 1500,
  eyeball: 1200,
  ice: 400,
  barren: 300,
  toxic: 300,
}
const COLONY_SHARE = 0.25
const MIN_POPULATION = 60
// A capital staffs a whole supply chain (economySeed.withSupplyChains puts a plant
// for every good the nation needs on it), so it never has fewer people than the
// smallest of the four nations' capitals (Arcadia).
const HOME_MIN_POPULATION = 1200
// How much of a world's people its class suits (the best is the home world).
const SUITABILITY: Partial<Record<PlanetClass, number>> = { continental: 6, ocean: 5, hycean: 5, desert: 4, eyeball: 4, ice: 2, barren: 1, toxic: 1 }

// The extraction and farming a planet class can supply: what its ground holds.
const EXTRACTION_BY_CLASS: Partial<Record<PlanetClass, string[]>> = {
  continental: ['wheatFarm', 'riceFarm', 'livestockRanch', 'loggingCamp', 'ironMine', 'coalMine', 'fishery'],
  ocean: ['fishery', 'wheatFarm', 'ironMine', 'oilWell'],
  hycean: ['fishery', 'hydroponicsFarm', 'oilWell', 'ironMine'],
  desert: ['solarPlant', 'ironMine', 'rareMetalsMine', 'oilWell', 'hydroponicsFarm'],
  eyeball: ['solarPlant', 'hydroponicsFarm', 'ironMine', 'coalMine'],
  ice: ['hydroponicsFarm', 'oilWell', 'sulfurMine', 'ironMine'],
  barren: ['ironMine', 'rareMetalsMine', 'phosphateMine', 'coalMine', 'hydroponicsFarm'],
  toxic: ['sulfurMine', 'phosphateMine', 'ironMine', 'hydroponicsFarm'],
}

// What every world runs besides what its ground holds, most important first:
// power, food, services, construction, and the light industry the supply-chain
// step then completes. Levels are for a 1,000M-people world; the balancer
// resizes them to the nation's needs.
const BASE_KIT: { recipe: string; perThousand: number }[] = [
  { recipe: 'solarPlant', perThousand: 1.5 },
  { recipe: 'foodProcessor', perThousand: 1 },
  { recipe: 'retailShop', perThousand: 0.6 },
  { recipe: 'roadNetwork', perThousand: 0.6 },
  { recipe: 'clinic', perThousand: 0.8 },
  { recipe: 'steelMill', perThousand: 1 },
  { recipe: 'toolWorkshop', perThousand: 1 },
  { recipe: 'school', perThousand: 0.5 },
  { recipe: 'consumerGoodsFactory', perThousand: 1 },
  { recipe: 'machineryFactory', perThousand: 0.8 },
  { recipe: 'constructionSector', perThousand: 0.6 },
]
// Only the home world carries these.
const HOME_KIT: { recipe: string; perThousand: number }[] = [
  { recipe: 'governmentOffice', perThousand: 0.6 },
  { recipe: 'ministry', perThousand: 0.4 },
]
// A world's buildings offer at most this share of its people jobs (the rest are
// children, investors and the informal sector; Mars opens at 0.59, Luna 1.1): a
// 60M-people colony runs two plants, not the sixteen a 3,000M home world does.
const JOB_BUDGET = { home: 0.75, colony: 0.85 }

// Cultures and faiths that exist in the economy (display data; a new one would
// have to be invented), handed round by the empire's neighbourhood.
const CULTURES = ['martian', 'venusian', 'arcadian']
const FAITHS = ['non-affiliated', 'axiomatic', 'arcadian-idyll', 'old-earth-theravada']

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const sizeFactor = (radiusKm: number) => Math.max(0.4, Math.min(1.5, Math.pow(radiusKm / 6371, 2)))
const landOfRadius = (radiusKm: number) => estimateSize(radiusKm).districts * LAND_PER_SIZE_DISTRICT

// The bodies an empire can run a world on, best first (home world first): the
// planets of every system it owns that people can live on at all.
export function worldPlanetsOf(empire: Pick<GalaxyEmpire, 'ownedStarIds'>): PlanetData[] {
  const planets = empire.ownedStarIds.flatMap((starId, i) => getPlanetsForStar(starId).map((planet) => ({ planet, i })))
  return planets
    .filter(({ planet }) => (HOME_POPULATION[planet.planetClass] ?? 0) > 0)
    .sort((a, b) => (SUITABILITY[b.planet.planetClass] ?? 0) * sizeFactor(b.planet.radiusKm) - (SUITABILITY[a.planet.planetClass] ?? 0) * sizeFactor(a.planet.radiusKm) || a.i - b.i || a.planet.name.localeCompare(b.planet.name))
    .slice(0, MAX_WORLDS_PER_EMPIRE)
    .map(({ planet }) => planet)
}

function worldSpecFor(empire: GalaxyEmpire, planet: PlanetData, home: boolean, operatorId: string): WorldSpec {
  const scaled = Math.round((HOME_POPULATION[planet.planetClass] ?? 0) * sizeFactor(planet.radiusKm) * (home ? 1 : COLONY_SHARE))
  const population = home ? Math.max(HOME_MIN_POPULATION, scaled) : Math.max(MIN_POPULATION, scaled)
  const desired = (perThousand: number) => Math.max(1, Math.round((perThousand * population) / 1000))
  let budget = population * (home ? JOB_BUDGET.home : JOB_BUDGET.colony)
  const buildings: BuildingSpec[] = []
  const have = new Set<string>()
  // Adds as many levels (up to `want`) as the job budget still pays for.
  const add = (recipe: string, want: number, owner?: string) => {
    if (have.has(recipe)) return
    const perLevel = (getMethod(recipe, undefined)?.jobs ?? []).reduce((n, j) => n + j.count * JOB_SCALE, 0)
    const level = Math.min(want, Math.floor(budget / Math.max(1e-9, perLevel)))
    if (level < 1) return
    have.add(recipe)
    budget -= level * perLevel
    buildings.push({ recipe, level, ...(owner ? { owner } : {}) })
  }
  // What the ground holds comes first (so it, not the base kit, sets the mix),
  // then power and food, then the rest of the kit as far as the people go.
  const ground = EXTRACTION_BY_CLASS[planet.planetClass] ?? []
  ground.slice(0, 2).forEach((recipe, i) => add(recipe, desired(i === 0 ? 1.5 : 0.8), 'worker'))
  for (const k of BASE_KIT.slice(0, 2)) add(k.recipe, desired(k.perThousand))
  ground.slice(2).forEach((recipe) => add(recipe, desired(0.8), 'worker'))
  if (home) for (const k of HOME_KIT) add(k.recipe, desired(k.perThousand))
  for (const k of BASE_KIT.slice(2)) add(k.recipe, desired(k.perThousand))
  if (home) buildings.push({ recipe: 'corporateHq', level: 1, owner: operatorId })
  const faith = FAITHS[hash(empire.id) % FAITHS.length]
  const religions: ReligionMix = faith === 'non-affiliated' ? [{ religion: 'non-affiliated', share: 1 }] : [{ religion: faith, share: 0.6 }, { religion: 'non-affiliated', share: 0.4 }]
  return {
    id: planet.name,
    ownerId: empire.id,
    culture: CULTURES[hash(empire.clusterId) % CULTURES.length],
    species: 'baseline-organic',
    population,
    capacity: population * 5,
    religions,
    buildings,
  }
}

// Laissez-faire or interventionist: which of the two calibrated nations the
// empire's institutions are copied from.
export function systemOf(empire: Pick<GalaxyEmpire, 'id'>): 'laissez-faire' | 'interventionism' {
  return hash(empire.id) % 2 === 0 ? 'laissez-faire' : 'interventionism'
}

function codeOf(name: string): string {
  const letters = name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').toUpperCase()
  return `${letters.slice(0, 2).padEnd(2, 'X')}C`
}

export interface EmpireEconomy {
  countries: Country[]
  worlds: World[]
  corporations: Corporation[]
  banks: Bank[]
  // Empires deal only with the other empires of their own neighbourhood
  // (EconomyStepInput.tradeGroups): empire id -> its cluster id.
  tradeGroups: Record<string, string>
  // The empires that got an economy, home world first.
  worldIdsByEmpire: Record<string, string[]>
}

// `calibration` says where the empires' markets settle and what their starting tax
// rates are (scripts/economy/calibrate.ts --empires writes the shipped one).
export function seedEmpireEconomies(
  empires: GalaxyEmpire[],
  calibration: { worlds?: SeedCalibration; taxRates?: Record<string, number> } = { worlds: EMPIRE_WORLD_CALIBRATION, taxRates: EMPIRE_TAX_RATES },
): EmpireEconomy {
  const templates = new Map(seedCountries().map((c) => [c.economicSystem, c]))
  const countries: Country[] = []
  const corporations: Corporation[] = []
  const banks: Bank[] = []
  const worlds: World[] = []
  const tradeGroups: Record<string, string> = {}
  const worldIdsByEmpire: Record<string, string[]> = {}

  for (const empire of empires) {
    const planets = worldPlanetsOf(empire)
    if (planets.length === 0) continue
    const system = systemOf(empire)
    const template = templates.get(system) ?? [...templates.values()][0]
    const operatorId = `${empire.id}-transit`
    const specs = planets.map((planet, i) => worldSpecFor(empire, planet, i === 0, operatorId))
    const nation: SeedNation = { id: empire.id, capitalBodyName: planets[0].name, operatorId, privateLed: system === 'laissez-faire' }
    const radiusOf = new Map(planets.map((p) => [p.name, p.radiusKm]))
    const empireWorlds = seedNationWorlds([nation], specs, { landOf: (name) => landOfRadius(radiusOf.get(name) ?? 3000), calibration: calibration?.worlds })
    worlds.push(...empireWorlds)
    worldIdsByEmpire[empire.id] = empireWorlds.map((w) => w.id)
    tradeGroups[empire.id] = empire.clusterId

    const totalPopulation = specs.reduce((n, s) => n + s.population, 0)
    const influence = Math.max(0, Math.min(INFLUENCE_CAP, empire.influence))
    const treasury = Math.round(20000 + influence * 60)
    const code = codeOf(empire.name)
    const country: Country = structuredClone(template)
    countries.push({
      ...country,
      id: empire.id,
      taxRate: calibration?.taxRates?.[empire.id] ?? country.taxRate,
      treasury,
      bonds: { pops: Math.round(treasury * 0.6), corporations: Math.round(treasury * 0.3), foreign: Math.round(treasury * 0.2) },
      investmentPool: Math.round(30000 * Math.max(0.2, Math.min(1.5, totalPopulation / 3000))),
      pendingForeignInvestment: [],
      pendingForeign: [],
      decrees: [],
      subsidies: { corporations: {}, buildings: {} },
      currency: { name: `${empire.name} Credit`, code, rate: 1, target: 1 },
      // The template's bank, as this empire's own (its id and name come after the
      // template's, which seedCentralBank would otherwise copy over them).
      centralBank: { ...seedCentralBank(empire.id, `${empire.name} Reserve`, country.centralBank!), countryId: empire.id, name: `${empire.name} Reserve`, governorName: `Gov. ${empire.name.split(' ')[0]}` },
    })
    banks.push(makeBank(`bank-${empire.id}-1`, `${empire.name} National Bank`, empire.id, Math.round(10000 + totalPopulation * 15), 0.5))
    corporations.push({
      id: operatorId,
      name: `${empire.name.split(' ')[0]} Transit`,
      countryId: empire.id,
      kind: 'private',
      cash: 8000,
      totalShares: 1000,
      shares: [{ holder: { kind: 'public' }, shares: 1000 }],
      lastProfit: 0,
      sector: 'Transport',
    })
  }
  return { countries, worlds, corporations, banks, tradeGroups, worldIdsByEmpire }
}
