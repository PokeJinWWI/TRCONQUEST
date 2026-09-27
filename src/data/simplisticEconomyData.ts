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

// --- District kinds (defined below with their buildings) ------------------------
export type SimpleDistrictId = 'industrial' | 'academic' | 'agricultural' | 'mining' | 'generator' | 'urban'
export const SIMPLE_DISTRICTS: SimpleDistrictId[] = ['industrial', 'academic', 'agricultural', 'mining', 'generator', 'urban']

// --- Buildings ---------------------------------------------------------------
// A Stellaris-style roster: each building has its own output and upkeep per
// level per month (at efficiency 1), its jobs and which stratum works them, its
// district and its construction cost. The model (abstractEconomy.ts) reads this
// table generically — adding a building is adding a row.
export type SimpleBuildingId =
  | 'civilianFactory'
  | 'alloyFoundry'
  | 'consumerFactory'
  | 'electronicsPlant'
  | 'exoticRefinery'
  | 'physicsLab'
  | 'societyLab'
  | 'engineeringLab'
  | 'farm'
  | 'hydroponicsBay'
  | 'mine'
  | 'deepCoreMine'
  | 'powerPlant'
  | 'fusionReactor'
  | 'clinic'
  | 'entertainmentCenter'
  | 'commercialZone'

// What a building makes: goods, construction points, research in a tree,
// amenities (planet services people need) or services GDP ($B a month).
export type SimpleProduct = SimpleGood | 'construction' | 'physics' | 'society' | 'engineering' | 'amenities' | 'services'

export interface SimpleBuildingDef {
  name: string
  description: string
  district: SimpleDistrictId
  jobs: number // people (millions) one level employs
  stratum: 'workers' | 'specialists' // who works it
  cost: number // construction points to build one level
  outputs: Partial<Record<SimpleProduct, number>> // per level per month
  upkeep: Partial<Record<SimpleGood, number>> // inputs per level per month
  // Factory capacity (Production Units) one level counts for — factories only.
  pu?: number
  // Extra annual population growth per level per billion people (clinics).
  popGrowth?: number
}

export const SIMPLE_BUILDING_DEFS: Record<SimpleBuildingId, SimpleBuildingDef> = {
  civilianFactory: {
    name: 'Civilian Factory',
    description: 'Builds things: makes the construction points that raise new buildings and district levels. Burns minerals and energy.',
    district: 'industrial', jobs: 40, stratum: 'workers', cost: 600, pu: 10,
    outputs: { construction: 10 }, upkeep: { minerals: 3, energy: 5 },
  },
  alloyFoundry: {
    name: 'Alloy Foundry',
    description: 'Military industry: smelts the alloys ships and armies are built from. Its capacity is also what your military budget pays upkeep on.',
    district: 'industrial', jobs: 40, stratum: 'workers', cost: 600, pu: 10,
    outputs: { alloys: 15 }, upkeep: { minerals: 10, energy: 5 },
  },
  consumerFactory: {
    name: 'Consumer Goods Factory',
    description: 'Civilian industries: the everyday goods every stratum wants. Short of them, people grow unhappy.',
    district: 'industrial', jobs: 40, stratum: 'workers', cost: 600, pu: 10,
    outputs: { consumerGoods: 5.5 }, upkeep: { minerals: 10, energy: 5 },
  },
  electronicsPlant: {
    name: 'Electronics Plant',
    description: 'Circuits and computers — used by research labs and fusion reactors, and wanted by specialists and workers.',
    district: 'industrial', jobs: 30, stratum: 'specialists', cost: 700, pu: 10,
    outputs: { electronics: 4 }, upkeep: { minerals: 6, energy: 6 },
  },
  exoticRefinery: {
    name: 'Exotic Refinery',
    description: 'Refines exotic matter (warp fuel) and a trickle of hyperium (hyperdrive fuel). Energy hungry.',
    district: 'industrial', jobs: 20, stratum: 'specialists', cost: 1200,
    outputs: { exoticMatter: 3, hyperium: 0.5 }, upkeep: { energy: 10 },
  },
  physicsLab: {
    name: 'Physics Lab',
    description: 'Research into the Physics tree. All research also raises productivity.',
    district: 'academic', jobs: 20, stratum: 'specialists', cost: 800,
    outputs: { physics: 2.5 }, upkeep: { energy: 3, electronics: 0.5 },
  },
  societyLab: {
    name: 'Society Lab',
    description: 'Research into the Society tree. All research also raises productivity.',
    district: 'academic', jobs: 20, stratum: 'specialists', cost: 800,
    outputs: { society: 2.5 }, upkeep: { energy: 3, electronics: 0.5 },
  },
  engineeringLab: {
    name: 'Engineering Lab',
    description: 'Research into the Engineering tree. All research also raises productivity.',
    district: 'academic', jobs: 20, stratum: 'specialists', cost: 800,
    outputs: { engineering: 2.5 }, upkeep: { energy: 3, electronics: 0.5 },
  },
  farm: {
    name: 'Farm', description: 'Grows food for the population.',
    district: 'agricultural', jobs: 30, stratum: 'workers', cost: 300, outputs: { food: 6 }, upkeep: {},
  },
  hydroponicsBay: {
    name: 'Hydroponics Bay', description: 'Indoor farming: twice a farm’s food from the same slot, but it runs on energy. For worlds short of room.',
    district: 'agricultural', jobs: 30, stratum: 'workers', cost: 450, outputs: { food: 12 }, upkeep: { energy: 6 },
  },
  mine: {
    name: 'Mine', description: 'Extracts minerals — the raw input for industry and construction.',
    district: 'mining', jobs: 20, stratum: 'workers', cost: 300, outputs: { minerals: 25 }, upkeep: {},
  },
  deepCoreMine: {
    name: 'Deep Core Mine', description: 'Mines far below the crust: twice the minerals from the same slot, for energy.',
    district: 'mining', jobs: 25, stratum: 'workers', cost: 450, outputs: { minerals: 50 }, upkeep: { energy: 10 },
  },
  powerPlant: {
    name: 'Power Plant', description: 'Generates energy for industry, labs, refineries and ships.',
    district: 'generator', jobs: 15, stratum: 'workers', cost: 300, outputs: { energy: 30 }, upkeep: {},
  },
  fusionReactor: {
    name: 'Fusion Reactor', description: 'Two and a half times a power plant’s energy from the same slot, run by specialists; needs electronics.',
    district: 'generator', jobs: 20, stratum: 'specialists', cost: 700, outputs: { energy: 75 }, upkeep: { electronics: 1 },
  },
  clinic: {
    name: 'Clinic', description: 'Healthcare: provides amenities and makes the population grow faster.',
    district: 'urban', jobs: 15, stratum: 'specialists', cost: 400, outputs: { amenities: 10 }, upkeep: { consumerGoods: 1 }, popGrowth: 0.003,
  },
  entertainmentCenter: {
    name: 'Entertainment Center', description: 'Theatres, arenas and holo-dramas: plenty of amenities to keep people content.',
    district: 'urban', jobs: 15, stratum: 'specialists', cost: 400, outputs: { amenities: 15 }, upkeep: { consumerGoods: 2 },
  },
  commercialZone: {
    name: 'Commercial Zone', description: 'Shops, offices and markets: some amenities and a stream of taxable services output.',
    district: 'urban', jobs: 20, stratum: 'workers', cost: 400, outputs: { amenities: 5, services: 15 }, upkeep: {},
  },
}
export const SIMPLE_BUILDINGS = Object.keys(SIMPLE_BUILDING_DEFS) as SimpleBuildingId[]

// Amenities (Stellaris's planet services): every million people use a little;
// cities provide a base share, urban buildings the rest. See abstractEconomy.
export const AMENITIES_PER_POP = 0.01 // needed per million people per month
export const CITY_AMENITIES_PER_POP = 0.006 // provided per million people on an inhabited world
export const AMENITIES_MIN_POP = 100 // million: below this a world has no city services

// --- Districts -------------------------------------------------------------------
// Stellaris-style: a world has a limited amount of LAND (from its size), spent on
// district levels; each district level houses SLOTS_PER_DISTRICT buildings of its
// family. Buildings in the same district feed each other (an industrial cluster,
// a research park…), so a built-up district is more than the sum of its parts.
export interface SimpleDistrictDef {
  name: string
  description: string
  buildings: SimpleBuildingId[] // the buildings it houses (urban also holds foreign buildings)
}

const inDistrict = (d: SimpleDistrictId) => SIMPLE_BUILDINGS.filter((b) => SIMPLE_BUILDING_DEFS[b].district === d)

export const SIMPLE_DISTRICT_DEFS: Record<SimpleDistrictId, SimpleDistrictDef> = {
  industrial: {
    name: 'Industrial District',
    description: 'Factories, foundries and refineries. Every building here makes the others more productive (suppliers, skilled labour, shared logistics), and research parks nearby boost it further.',
    buildings: inDistrict('industrial'),
  },
  academic: {
    name: 'Academic District',
    description: 'Universities and research labs. Clustered labs work better together, and each level of research park lifts the industry on the same world.',
    buildings: inDistrict('academic'),
  },
  agricultural: { name: 'Agricultural District', description: 'Farmland, hydroponics and food processing. Farms here share irrigation, storage and markets.', buildings: inDistrict('agricultural') },
  mining: { name: 'Mining District', description: 'Quarries and shafts. Mines here share rail, crushers and smelters.', buildings: inDistrict('mining') },
  generator: { name: 'Generator District', description: 'Power stations and grid. Plants here share transmission and maintenance.', buildings: inDistrict('generator') },
  urban: {
    name: 'Urban District',
    description: 'Clinics, entertainment and commerce — the amenities city life needs. Other nations’ embassies and branch offices are housed here too.',
    buildings: inDistrict('urban'),
  },
}

export const DISTRICT_OF_BUILDING = Object.fromEntries(SIMPLE_BUILDINGS.map((b) => [b, SIMPLE_BUILDING_DEFS[b].district])) as Record<SimpleBuildingId, SimpleDistrictId>

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
  Mars: { population: 3000, buildings: { civilianFactory: 8, alloyFoundry: 3, consumerFactory: 5, electronicsPlant: 2, exoticRefinery: 2, farm: 6, mine: 6, powerPlant: 6, physicsLab: 2, engineeringLab: 1, entertainmentCenter: 1 } },
  Luna: { population: 600, buildings: { civilianFactory: 2, consumerFactory: 1, farm: 1, mine: 3, powerPlant: 2, commercialZone: 1 } },
  // Republic of Venus
  Venus: { population: 3000, buildings: { civilianFactory: 8, alloyFoundry: 2, consumerFactory: 5, electronicsPlant: 2, exoticRefinery: 2, farm: 7, mine: 6, powerPlant: 6, physicsLab: 2, engineeringLab: 1, entertainmentCenter: 1 } },
  // Orion Republic
  Arcadia: { population: 1200, buildings: { civilianFactory: 3, alloyFoundry: 1, consumerFactory: 2, electronicsPlant: 1, exoticRefinery: 1, farm: 3, mine: 2, powerPlant: 2, physicsLab: 1, engineeringLab: 1, clinic: 1 } },
  'Proxima b': { population: 450, buildings: { civilianFactory: 1, consumerFactory: 1, farm: 2, mine: 1, powerPlant: 1 } },
  // Kingdom of Lalande
  'Lalande 21185 d': { population: 2000, buildings: { civilianFactory: 4, alloyFoundry: 3, consumerFactory: 3, electronicsPlant: 1, exoticRefinery: 1, farm: 6, mine: 5, powerPlant: 4, physicsLab: 1, entertainmentCenter: 1 } },
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
