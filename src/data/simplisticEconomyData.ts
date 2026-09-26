// Data for Simple mode (the macro economy, `economyModel: 'abstract'`) — its
// handful of goods, its handful of buildings, each nation's starting worlds and
// currency. Complex mode never reads this file.
//
// Goods are deliberately few and broad — "alloys", not steel/titanium/copper
// wire; "electronics", not phones/chips/robots. They're Stellaris-style
// stockpiles with no prices: each has a monthly +/− and a stockpile (the same
// resourceStore stockpile ships and armies are paid from).

import type { ResourceId } from './resourceData'

export type SimpleGood = Extract<ResourceId, 'food' | 'minerals' | 'energy' | 'alloys' | 'electronics' | 'consumerGoods' | 'exoticMatter' | 'hyperium'>
export const SIMPLE_GOODS: SimpleGood[] = ['food', 'minerals', 'energy', 'alloys', 'electronics', 'consumerGoods', 'exoticMatter', 'hyperium']

export const SIMPLE_GOOD_NAMES: Record<SimpleGood, string> = {
  food: 'Food',
  minerals: 'Minerals',
  energy: 'Energy',
  alloys: 'Alloys',
  electronics: 'Electronics',
  consumerGoods: 'Consumer Goods',
  exoticMatter: 'Exotic Matter',
  hyperium: 'Hyperium',
}

// What one unit of each good is worth, in the economy's money ($B at the base
// price level). Not a market price — a fixed yardstick used to value output for
// GDP and to price trade on the interstellar market.
export const GOOD_VALUE: Record<SimpleGood, number> = {
  food: 1.5,
  minerals: 0.45,
  energy: 0.45,
  alloys: 1.6,
  electronics: 5,
  consumerGoods: 3.8,
  exoticMatter: 8,
  hyperium: 25,
}

// --- Buildings ---------------------------------------------------------------
export type SimpleBuildingId = 'factory' | 'farm' | 'mine' | 'powerPlant' | 'researchLab' | 'exoticRefinery'
export const SIMPLE_BUILDINGS: SimpleBuildingId[] = ['factory', 'farm', 'mine', 'powerPlant', 'researchLab', 'exoticRefinery']

export interface SimpleBuildingDef {
  name: string
  description: string
  jobs: number // workers (millions) one level employs
  cost: number // construction points to build one level
}

export const SIMPLE_BUILDING_DEFS: Record<SimpleBuildingId, SimpleBuildingDef> = {
  factory: {
    name: 'Factory',
    description:
      'Industrial capacity — each level adds Production Units, split by your allocation into construction (civilian), alloys (military) and consumer goods + electronics (consumer). Consumes minerals and energy.',
    jobs: 40,
    cost: 300,
  },
  farm: { name: 'Farm', description: 'Grows food for the population.', jobs: 30, cost: 150 },
  mine: { name: 'Mine', description: 'Extracts minerals — the raw input for industry and construction.', jobs: 20, cost: 150 },
  powerPlant: { name: 'Power Plant', description: 'Generates energy for industry, labs, refineries and ships.', jobs: 15, cost: 150 },
  researchLab: {
    name: 'Research Lab',
    description: 'Produces research points in your chosen focus. Consumes energy and electronics.',
    jobs: 20,
    cost: 400,
  },
  exoticRefinery: {
    name: 'Exotic Refinery',
    description: 'Refines exotic matter (warp fuel) and a trickle of hyperium (hyperdrive fuel). Energy hungry.',
    jobs: 20,
    cost: 600,
  },
}

// --- Worlds --------------------------------------------------------------------
export type BuildingLevels = Partial<Record<SimpleBuildingId, number>>

export interface SimpleWorldSeed {
  population: number // millions
  slots: number // building levels the world can hold
  buildings: BuildingLevels
}

// The inhabited worlds; every other body a nation owns starts as an outpost.
export const SIMPLE_WORLD_SEEDS: Record<string, SimpleWorldSeed> = {
  // Imperial State of Mars
  Mars: { population: 3000, slots: 80, buildings: { factory: 18, farm: 6, mine: 6, powerPlant: 6, researchLab: 3, exoticRefinery: 2 } },
  Luna: { population: 600, slots: 30, buildings: { factory: 3, farm: 1, mine: 3, powerPlant: 2 } },
  // Republic of Venus
  Venus: { population: 3000, slots: 80, buildings: { factory: 16, farm: 7, mine: 6, powerPlant: 6, researchLab: 3, exoticRefinery: 2 } },
  // Orion Republic
  Arcadia: { population: 1000, slots: 60, buildings: { factory: 7, farm: 3, mine: 2, powerPlant: 2, researchLab: 2, exoticRefinery: 1 } },
  'Proxima b': { population: 450, slots: 30, buildings: { factory: 2, farm: 2, mine: 1, powerPlant: 1 } },
  // Kingdom of Lalande
  'Lalande 21185 d': { population: 2000, slots: 70, buildings: { factory: 10, farm: 6, mine: 5, powerPlant: 4, researchLab: 1, exoticRefinery: 1 } },
}

export const OUTPOST_SEED: SimpleWorldSeed = { population: 40, slots: 10, buildings: { mine: 1 } }

// Stockpile of the civilian goods each nation starts with in Simple mode (on
// top of the shared strategic starting stockpile).
export const SIMPLE_STARTING_STOCK: Partial<Record<SimpleGood, number>> = {
  food: 200,
  consumerGoods: 150,
  electronics: 60,
}

// --- Currencies ----------------------------------------------------------------
// Each nation's currency and its starting exchange rate against the Terra
// Standard Credit (TSC): the TSC value of one unit (higher = stronger).
export interface SimpleCurrencySeed {
  code: string
  name: string
  rate: number
}
export const SIMPLE_CURRENCIES: Record<string, SimpleCurrencySeed> = {
  'imperial-state-of-mars': { code: 'MSV', name: 'Martian Sovereign', rate: 1.0 },
  'republic-of-venus': { code: 'VNC', name: 'Venusian Crown', rate: 1.15 },
  'orion-republic': { code: 'ORM', name: 'Orion Mark', rate: 0.95 },
  'kingdom-of-lalande': { code: 'LLD', name: 'Lalande Ducat', rate: 0.7 },
}
