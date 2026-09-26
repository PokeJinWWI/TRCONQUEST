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
    cost: 600,
  },
  farm: { name: 'Farm', description: 'Grows food for the population.', jobs: 30, cost: 300 },
  mine: { name: 'Mine', description: 'Extracts minerals — the raw input for industry and construction.', jobs: 20, cost: 300 },
  powerPlant: { name: 'Power Plant', description: 'Generates energy for industry, labs, refineries and ships.', jobs: 15, cost: 300 },
  researchLab: {
    name: 'Research Lab',
    description: 'Produces research points in your chosen focus. Consumes energy and electronics.',
    jobs: 20,
    cost: 800,
  },
  exoticRefinery: {
    name: 'Exotic Refinery',
    description: 'Refines exotic matter (warp fuel) and a trickle of hyperium (hyperdrive fuel). Energy hungry.',
    jobs: 20,
    cost: 1200,
  },
}

// --- Districts -------------------------------------------------------------------
// Stellaris-style: a world has a limited amount of LAND (from its size), spent on
// district levels; each district level houses SLOTS_PER_DISTRICT buildings of its
// family. Buildings in the same district feed each other (an industrial cluster,
// a research park…), so a built-up district is more than the sum of its parts.
export type SimpleDistrictId = 'industrial' | 'academic' | 'agricultural' | 'mining' | 'generator' | 'urban'
export const SIMPLE_DISTRICTS: SimpleDistrictId[] = ['industrial', 'academic', 'agricultural', 'mining', 'generator', 'urban']

export interface SimpleDistrictDef {
  name: string
  description: string
  buildings: SimpleBuildingId[] // the building families it houses (urban: foreign buildings)
}

export const SIMPLE_DISTRICT_DEFS: Record<SimpleDistrictId, SimpleDistrictDef> = {
  industrial: {
    name: 'Industrial District',
    description: 'Factory belts and refineries. Every building here makes the others more productive (suppliers, skilled labour, shared logistics), and research parks nearby boost it further.',
    buildings: ['factory', 'exoticRefinery'],
  },
  academic: {
    name: 'Academic District',
    description: 'Universities and research labs. Clustered labs work better together, and each level of research park lifts the industry on the same world.',
    buildings: ['researchLab'],
  },
  agricultural: { name: 'Agricultural District', description: 'Farmland and food processing. Farms here share irrigation, storage and markets.', buildings: ['farm'] },
  mining: { name: 'Mining District', description: 'Quarries and shafts. Mines here share rail, crushers and smelters.', buildings: ['mine'] },
  generator: { name: 'Generator District', description: 'Power stations and grid. Plants here share transmission and maintenance.', buildings: ['powerPlant'] },
  urban: {
    name: 'Urban District',
    description: 'Offices, embassies and foreign firms. Other nations can open branch offices and embassies here.',
    buildings: [],
  },
}

export const DISTRICT_OF_BUILDING: Record<SimpleBuildingId, SimpleDistrictId> = {
  factory: 'industrial',
  exoticRefinery: 'industrial',
  researchLab: 'academic',
  farm: 'agricultural',
  mine: 'mining',
  powerPlant: 'generator',
}

export const SLOTS_PER_DISTRICT = 4 // buildings one district level houses
export const DISTRICT_COST = 400 // construction points to develop one district level
// The ecosystem bonus (see abstractEconomy.districtBonus).
export const CLUSTER_PER_BUILDING = 0.005 // output per building in the same district beyond the first…
export const CLUSTER_MAX = 0.15 // …capped
export const ACADEMIC_TO_INDUSTRIAL = 0.01 // industrial output per academic district level on the world…
export const LINK_MAX = 0.08 // …capped

// --- Worlds --------------------------------------------------------------------
export type BuildingLevels = Partial<Record<SimpleBuildingId, number>>

export interface SimpleWorldSeed {
  population: number // millions
  buildings: BuildingLevels
}

// The inhabited worlds; every other body a nation owns starts as an outpost.
export const SIMPLE_WORLD_SEEDS: Record<string, SimpleWorldSeed> = {
  // Imperial State of Mars
  Mars: { population: 3000, buildings: { factory: 18, farm: 6, mine: 6, powerPlant: 6, researchLab: 3, exoticRefinery: 2 } },
  Luna: { population: 600, buildings: { factory: 3, farm: 1, mine: 3, powerPlant: 2 } },
  // Republic of Venus
  Venus: { population: 3000, buildings: { factory: 17, farm: 7, mine: 6, powerPlant: 6, researchLab: 3, exoticRefinery: 2 } },
  // Orion Republic
  Arcadia: { population: 1200, buildings: { factory: 7, farm: 3, mine: 2, powerPlant: 2, researchLab: 2, exoticRefinery: 1 } },
  'Proxima b': { population: 450, buildings: { factory: 2, farm: 2, mine: 1, powerPlant: 1 } },
  // Kingdom of Lalande
  'Lalande 21185 d': { population: 2000, buildings: { factory: 11, farm: 6, mine: 5, powerPlant: 4, researchLab: 1, exoticRefinery: 1 } },
}

export const OUTPOST_SEED: SimpleWorldSeed = { population: 48, buildings: { mine: 1 } }

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
