import { GOODS, GOOD_IDS } from './goods'
import { POP_CLASSES, RECIPES, type PopClass } from './recipes'
import type { Building, LaborMarket, Market, PlanetEconomy, Pop } from './economyTypes'

// The three seed economies map onto the three playable countries' capital
// planets (see countryData.ts): Mars = Imperial State of Mars, Venus =
// Republic of Venus, Arcadia = Orion Republic. Capacities are the design
// brief's figures (validated against these exact worlds), kept as plain
// scalars per the "planet is one economic unit, no surface regions" steer.
// Starting populations sit well below capacity so there's room to grow.

let popCounter = 0
function makePop(planetId: string, cls: PopClass, populationSize: number, wealth: number): Pop {
  popCounter += 1
  return {
    id: `pop-${planetId}-${cls}-${popCounter}`,
    class: cls,
    speciesTemplateId: 'baseline-organic',
    cultureId: 'baseline',
    religionId: 'none',
    populationSize,
    wealth,
    educationLevel: 0,
    needsSatisfaction: { basic: 1, everyday: 1, healthcare: 1, comfort: 1, luxury: 1 },
  }
}

let buildingCounter = 0
function makeBuilding(planetId: string, recipeId: string, level: number, stateFraction: number): Building {
  buildingCounter += 1
  const recipe = RECIPES[recipeId]
  // Prime one tick's worth of output inventory so the very first tick has
  // something to sell — otherwise tick 1 opens with an empty market and a
  // full tick of universal shortage before production catches up.
  const inventory: Building['inventory'] = {}
  if (recipe) for (const out of recipe.outputs) inventory[out.good] = out.amount * level
  return {
    id: `bld-${planetId}-${recipeId}-${buildingCounter}`,
    recipeId,
    level,
    stateFraction,
    inventory,
    lastProfit: 0,
  }
}

// Every good starts at its base price; the market discovers real prices from
// there over the first dozens of ticks.
function seedMarket(): Market {
  const prices = {} as Market['prices']
  for (const g of GOOD_IDS) prices[g] = GOODS[g].basePrice
  return { prices }
}

// Wages start uniform and low; the labor market moves them apart by class
// scarcity within the first ticks.
function seedLabor(): LaborMarket {
  const wages = {} as LaborMarket['wages']
  for (const cls of POP_CLASSES) wages[cls] = 2
  return { wages }
}

interface PopSpec {
  cls: PopClass
  size: number
}

function buildPlanet(
  id: string,
  ownerId: string,
  populationCapacity: number,
  taxRate: number,
  pops: PopSpec[],
  buildings: { recipe: string; level: number; state?: number }[],
): PlanetEconomy {
  const startingWealth = 20
  return {
    id,
    name: id,
    ownerId,
    populationCapacity,
    pops: pops.map((p) => makePop(id, p.cls, p.size, startingWealth)),
    buildings: buildings.map((b) => makeBuilding(id, b.recipe, b.level, b.state ?? 0)),
    market: seedMarket(),
    labor: seedLabor(),
    treasury: 0,
    taxRate,
  }
}

// Mars — the Imperial State of Mars capital. A large, high-tech world:
// balanced industrial economy, comfortably below its ~290-unit capacity.
const MARS = buildPlanet(
  'Mars',
  'imperial-state-of-mars',
  290,
  0.1,
  [
    { cls: 'subsistence', size: 12 },
    { cls: 'labor', size: 20 },
    { cls: 'technical', size: 8 },
    { cls: 'professional', size: 4 },
    { cls: 'investor', size: 3 },
    { cls: 'political', size: 3 },
  ],
  [
    { recipe: 'farm', level: 4 },
    { recipe: 'mine', level: 3 },
    { recipe: 'factory', level: 3 },
    { recipe: 'clinic', level: 2 },
  ],
)

// Venus — the Republic of Venus capital. A terraformed ocean world, developed
// and closer to its ~28-unit capacity, so less growth headroom.
const VENUS = buildPlanet(
  'Venus',
  'republic-of-venus',
  28,
  0.12,
  [
    { cls: 'subsistence', size: 5 },
    { cls: 'labor', size: 9 },
    { cls: 'technical', size: 4 },
    { cls: 'professional', size: 2 },
    { cls: 'investor', size: 1.5 },
    { cls: 'political', size: 1.5 },
  ],
  [
    { recipe: 'farm', level: 2 },
    { recipe: 'mine', level: 1 },
    { recipe: 'factory', level: 2 },
    { recipe: 'clinic', level: 1 },
  ],
)

// Arcadia — the Orion Republic capital. A small agrarian world near its
// ~2.7-unit capacity: farming-heavy, minimal industry.
const ARCADIA = buildPlanet(
  'Arcadia',
  'orion-republic',
  2.7,
  0.08,
  [
    { cls: 'subsistence', size: 1.0 },
    { cls: 'labor', size: 0.7 },
    { cls: 'technical', size: 0.3 },
    { cls: 'professional', size: 0.1 },
    { cls: 'investor', size: 0.1 },
    { cls: 'political', size: 0.1 },
  ],
  [
    { recipe: 'farm', level: 1 },
    { recipe: 'mine', level: 1 },
    { recipe: 'factory', level: 1 },
  ],
)

export function seedEconomy(): PlanetEconomy[] {
  return [MARS, VENUS, ARCADIA]
}
