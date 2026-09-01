import { GOODS, GOOD_IDS } from './goods'
import { POP_CLASSES, RECIPES, type PopClass } from './recipes'
import type { ReligionMix } from './demographics'
import type { Building, Country, LaborMarket, Market, Pop, World } from './economyTypes'

// Seed for the merged economy (design doc v2): 4 countries and 6 inhabited
// worlds. Population is in MILLIONS of people. Pops are generated across the
// four axes — a cohort per (class × religion) on each world, all one culture
// and species per world for now. Percentages/counts chosen by judgment.

let popCounter = 0
function makePop(worldId: string, cls: PopClass, species: string, culture: string, religion: string, size: number): Pop {
  popCounter += 1
  return {
    id: `pop-${worldId}-${cls}-${religion}-${popCounter}`,
    class: cls,
    speciesTemplateId: species,
    cultureId: culture,
    religionId: religion,
    populationSize: size,
    // Starting wealth scales with population (money is in the same ×100 scale
    // as the recipes and prices).
    wealth: size * 4,
    educationLevel: 0,
    needsSatisfaction: { basic: 1, everyday: 1, healthcare: 1, comfort: 1, luxury: 1 },
  }
}

let buildingCounter = 0
function makeBuilding(worldId: string, recipeId: string, level: number, stateFraction: number): Building {
  buildingCounter += 1
  const recipe = RECIPES[recipeId]
  const inventory: Building['inventory'] = {}
  if (recipe) for (const out of recipe.outputs) inventory[out.good] = out.amount * level
  return { id: `bld-${worldId}-${recipeId}-${buildingCounter}`, recipeId, level, stateFraction, inventory, lastProfit: 0 }
}

function seedMarket(): Market {
  const prices = {} as Market['prices']
  for (const g of GOOD_IDS) prices[g] = GOODS[g].basePrice
  return { prices }
}
function seedLabor(): LaborMarket {
  const wages = {} as LaborMarket['wages']
  for (const cls of POP_CLASSES) wages[cls] = 2
  return { wages }
}

// Default class split of a population (sums to 1).
const CLASS_SPLIT: Record<PopClass, number> = {
  subsistence: 0.15,
  labor: 0.38,
  technical: 0.18,
  professional: 0.12,
  investor: 0.07,
  political: 0.1,
}

interface WorldSpec {
  id: string
  ownerId: string
  culture: string
  species: string
  population: number // millions
  capacity: number
  religions: ReligionMix
  classSplit?: Record<PopClass, number>
  buildings: { recipe: string; level: number; state?: number }[]
}

function buildWorld(spec: WorldSpec): World {
  const split = spec.classSplit ?? CLASS_SPLIT
  const pops: Pop[] = []
  for (const cls of POP_CLASSES) {
    const classPop = spec.population * split[cls]
    if (classPop <= 0) continue
    for (const r of spec.religions) {
      const size = classPop * r.share
      if (size <= 0) continue
      pops.push(makePop(spec.id, cls, spec.species, spec.culture, r.religion, size))
    }
  }
  return {
    id: spec.id,
    name: spec.id,
    ownerId: spec.ownerId,
    cultureId: spec.culture,
    populationCapacity: spec.capacity,
    pops,
    buildings: spec.buildings.map((b) => makeBuilding(spec.id, b.recipe, b.level, b.state ?? 0)),
    constructionQueue: [],
    market: seedMarket(),
    labor: seedLabor(),
  }
}

const WORLDS: World[] = [
  // Imperial State of Mars.
  buildWorld({
    id: 'Mars',
    ownerId: 'imperial-state-of-mars',
    culture: 'martian',
    species: 'baseline-organic',
    population: 4000,
    capacity: 20000,
    religions: [
      { religion: 'imperial-church-of-mars', share: 0.6 },
      { religion: 'non-affiliated', share: 0.25 },
      { religion: 'martian-buddhist', share: 0.15 },
    ],
    buildings: [
      { recipe: 'farm', level: 2 },
      { recipe: 'mine', level: 2 },
      { recipe: 'factory', level: 3 },
      { recipe: 'clinic', level: 2 },
    ],
  }),
  buildWorld({
    id: 'Luna',
    ownerId: 'imperial-state-of-mars',
    culture: 'martian',
    species: 'baseline-organic',
    population: 400,
    capacity: 2000,
    religions: [
      { religion: 'imperial-church-of-mars', share: 0.5 },
      { religion: 'non-affiliated', share: 0.35 },
      { religion: 'martian-buddhist', share: 0.15 },
    ],
    buildings: [
      { recipe: 'mine', level: 2 },
      { recipe: 'farm', level: 1 },
      { recipe: 'factory', level: 1 },
    ],
  }),
  // Republic of Venus.
  buildWorld({
    id: 'Venus',
    ownerId: 'republic-of-venus',
    culture: 'venusian',
    species: 'baseline-organic',
    population: 2500,
    capacity: 8000,
    religions: [
      { religion: 'venusian-storm-cult', share: 0.35 },
      { religion: 'axiomatic', share: 0.25 },
      { religion: 'silicon-dream', share: 0.2 },
      { religion: 'non-affiliated', share: 0.2 },
    ],
    buildings: [
      { recipe: 'farm', level: 2 },
      { recipe: 'mine', level: 1 },
      { recipe: 'factory', level: 2 },
      { recipe: 'clinic', level: 1 },
    ],
  }),
  // Orion Republic.
  buildWorld({
    id: 'Arcadia',
    ownerId: 'orion-republic',
    culture: 'arcadian',
    species: 'baseline-organic',
    population: 1200,
    capacity: 3000,
    religions: [
      { religion: 'arcadian-idyll', share: 0.55 },
      { religion: 'old-earth-theravada', share: 0.25 },
      { religion: 'non-affiliated', share: 0.2 },
    ],
    buildings: [
      { recipe: 'farm', level: 2 },
      { recipe: 'mine', level: 1 },
      { recipe: 'factory', level: 1 },
    ],
  }),
  buildWorld({
    id: 'Proxima b',
    ownerId: 'orion-republic',
    culture: 'arcadian',
    species: 'baseline-organic',
    population: 150,
    capacity: 1000,
    religions: [
      { religion: 'arcadian-idyll', share: 0.5 },
      { religion: 'non-affiliated', share: 0.3 },
      { religion: 'old-earth-theravada', share: 0.2 },
    ],
    buildings: [
      { recipe: 'farm', level: 1 },
      { recipe: 'mine', level: 1 },
    ],
  }),
  // Kingdom of Lalande — the Tidalians.
  buildWorld({
    id: 'Lalande 21185 d',
    ownerId: 'kingdom-of-lalande',
    culture: 'tidalian',
    species: 'tidalian',
    population: 2500,
    capacity: 8000,
    religions: [
      { religion: 'tidal-communion', share: 0.7 },
      { religion: 'non-affiliated', share: 0.3 },
    ],
    buildings: [
      { recipe: 'farm', level: 3 },
      { recipe: 'mine', level: 2 },
      { recipe: 'factory', level: 2 },
      { recipe: 'clinic', level: 1 },
    ],
  }),
]

const COUNTRIES: Country[] = [
  { id: 'imperial-state-of-mars', taxRate: 0.1, welfarePerCapita: 0.08, treasury: 100000 },
  { id: 'republic-of-venus', taxRate: 0.12, welfarePerCapita: 0.08, treasury: 50000 },
  { id: 'orion-republic', taxRate: 0.09, welfarePerCapita: 0.07, treasury: 30000 },
  { id: 'kingdom-of-lalande', taxRate: 0.1, welfarePerCapita: 0.07, treasury: 45000 },
]

export function seedWorlds(): World[] {
  return WORLDS.map((w) => ({ ...w, pops: [...w.pops], buildings: [...w.buildings] }))
}
export function seedCountries(): Country[] {
  return COUNTRIES.map((c) => ({ ...c }))
}
