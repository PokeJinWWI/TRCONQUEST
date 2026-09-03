import type { GoodId } from './goods'

// The six social classes from the design doc (Section 1). Milestone 1 only
// hires the four working classes into building jobs; Investor pops earn
// dividends instead of wages, and Political pops have no state jobs yet (that
// arrives with the political layer), so both simply hold and spend wealth for
// now.
export type PopClass = 'subsistence' | 'labor' | 'technical' | 'professional' | 'investor' | 'political'

export const POP_CLASSES: PopClass[] = ['subsistence', 'labor', 'technical', 'professional', 'investor', 'political']

// Qualification a class of job demands of the pops that fill it (design doc
// Section 3: "it only fills them with qualified, available pops"). A pop's
// educationLevel is measured against this: below the requirement the pop is
// only partially qualified, so a building drawing on an under-educated labor
// pool ends up understaffed and throttled. Manual classes ask little; the
// technical and professional rungs need real schooling. Investor/Political take
// no building jobs, so their requirement is moot.
export const CLASS_QUALIFICATION: Record<PopClass, number> = {
  subsistence: 0,
  labor: 0.1,
  technical: 0.4,
  professional: 0.7,
  investor: 0,
  political: 0,
}

// How qualified a pop of `cls` with the given education is for a job of its
// class: fully (1) once it meets the requirement, scaling down to a floor below
// it (never zero — an under-schooled worker is inefficient, not useless).
export function qualificationFraction(cls: PopClass, educationLevel: number): number {
  const req = CLASS_QUALIFICATION[cls]
  if (req <= 0) return 1
  const ratio = educationLevel / req
  return Math.max(0.25, Math.min(1, ratio))
}

export interface RecipeIO {
  good: GoodId
  // Per building level, at full operating scale, per tick.
  amount: number
}

export interface RecipeJob {
  class: PopClass
  // Job slots per building level.
  count: number
}

// A Production Method — the selectable way a building runs (design doc Section
// 3). Each method is a full input/output/labor profile: a *manual* method
// leans on many low-qualification workers and few material inputs; a
// *mechanized* one trades some of that labor for higher output, a richer input
// bill, and more skilled staff. Switching method is a real player tradeoff
// (labor vs inputs vs qualification), and because buildings ramp (throughput)
// the gains from a better method arrive over several ticks, not overnight.
export interface ProductionMethod {
  id: string
  label: string
  description: string
  inputs: RecipeIO[]
  outputs: RecipeIO[]
  jobs: RecipeJob[]
}

export type BuildingCategory = 'energy' | 'extraction' | 'agriculture' | 'industry' | 'services' | 'corporate' | 'government'

// Bureaucracy a government building produces per level at full throughput (a
// national resource, not a market good — handled in economyTick).
export const BUREAUCRACY_OUTPUT: Record<string, number> = {
  governmentOffice: 260,
  ministry: 620,
}

// Freight capacity an infrastructure building adds to its COUNTRY per level at
// full throughput — the market-access backbone that inter-world trade runs on.
export const LOGISTICS_OUTPUT: Record<string, number> = {
  roadNetwork: 300,
  railway: 1200,
  spaceport: 2000,
}

// A planet is not unlimited: buildings occupy DISTRICTS by category. The core
// holds government + finance; the urban district holds services; the industrial
// district holds power + heavy industry; the resource district holds mines and
// farms. Each district has a bounded number of slots (a building's level = its
// slots), so construction competes for space.
export type DistrictType = 'core' | 'urban' | 'industrial' | 'resource'
export const DISTRICT_TYPES: DistrictType[] = ['core', 'urban', 'industrial', 'resource']
export const DISTRICT_LABELS: Record<DistrictType, string> = {
  core: 'Core',
  urban: 'Urban',
  industrial: 'Industrial',
  resource: 'Resource',
}
const CATEGORY_DISTRICT: Record<BuildingCategory, DistrictType> = {
  government: 'core',
  corporate: 'core',
  services: 'urban',
  industry: 'industrial',
  energy: 'industrial',
  extraction: 'resource',
  agriculture: 'resource',
}
export function districtOfRecipe(recipeId: string): DistrictType {
  const cat = RECIPES[recipeId]?.category
  return cat ? CATEGORY_DISTRICT[cat] : 'urban'
}

// UI-only sub-categorization, finer-grained than BuildingCategory. `industry`
// alone now spans steel mills through spaceyards to consumer-goods factories —
// too wide a bucket to browse as one flat list once the roster passed ~45
// entries. This is purely presentational (which header a building sits under
// in the build menus): it carries no economic weight and the tick loop never
// reads it. Kept as a lookup table here (data) rather than scattered
// conditionals in the UI components.
export type BuildingGroup =
  | 'power'
  | 'extraction'
  | 'agriculture'
  | 'heavyIndustry'
  | 'chemicals'
  | 'consumerGoods'
  | 'vehicles'
  | 'infrastructure'
  | 'services'
  | 'civic'

export const BUILDING_GROUP_LABELS: Record<BuildingGroup, string> = {
  power: 'Power',
  extraction: 'Extraction',
  agriculture: 'Agriculture',
  heavyIndustry: 'Heavy Industry',
  chemicals: 'Chemicals & Materials',
  consumerGoods: 'Consumer Manufacturing',
  vehicles: 'Vehicles & Craft',
  infrastructure: 'Infrastructure',
  services: 'Public Services',
  civic: 'Corporate & Government',
}

// Display order for groups wherever they're listed together.
export const BUILDING_GROUP_ORDER: BuildingGroup[] = [
  'power',
  'extraction',
  'agriculture',
  'heavyIndustry',
  'chemicals',
  'consumerGoods',
  'vehicles',
  'infrastructure',
  'services',
  'civic',
]

const RECIPE_GROUP: Record<string, BuildingGroup> = {
  // Power
  solarPlant: 'power',
  coalPowerPlant: 'power',
  fusionReactor: 'power',
  // Extraction
  ironMine: 'extraction',
  coalMine: 'extraction',
  oilWell: 'extraction',
  rareMetalsMine: 'extraction',
  loggingCamp: 'extraction',
  phosphateMine: 'extraction',
  sulfurMine: 'extraction',
  hardwoodLogging: 'extraction',
  // Agriculture
  wheatFarm: 'agriculture',
  riceFarm: 'agriculture',
  livestockRanch: 'agriculture',
  sugarPlantation: 'agriculture',
  coffeePlantation: 'agriculture',
  teaPlantation: 'agriculture',
  // Heavy industry — primary metals, tools, machinery tiers, electronics
  steelMill: 'heavyIndustry',
  sawmill: 'heavyIndustry',
  toolWorkshop: 'heavyIndustry',
  machineryFactory: 'heavyIndustry',
  heavyMachineryPlant: 'heavyIndustry',
  electricalMachineryPlant: 'heavyIndustry',
  precisionMachineryPlant: 'heavyIndustry',
  electronicsFactory: 'heavyIndustry',
  semiconductorFab: 'heavyIndustry',
  // Chemicals & materials
  oilRefinery: 'chemicals',
  chemicalPlant: 'chemicals',
  fertilizerPlant: 'chemicals',
  explosivesFactory: 'chemicals',
  dyeWorks: 'chemicals',
  glassworks: 'chemicals',
  paperMill: 'chemicals',
  // Consumer manufacturing
  foodProcessor: 'consumerGoods',
  consumerGoodsFactory: 'consumerGoods',
  luxuryFactory: 'consumerGoods',
  meatPacking: 'consumerGoods',
  // Vehicles & craft
  engineFactory: 'vehicles',
  automobilePlant: 'vehicles',
  locomotiveWorks: 'vehicles',
  aircraftFactory: 'vehicles',
  shipyard: 'vehicles',
  spaceyard: 'vehicles',
  rocketFactory: 'vehicles',
  // Infrastructure (freight capacity)
  roadNetwork: 'infrastructure',
  railway: 'infrastructure',
  spaceport: 'infrastructure',
  // Public services
  clinic: 'services',
  school: 'services',
  retailShop: 'services',
  artStudio: 'services',
  dataCenter: 'services',
  // Corporate & government
  corporateHq: 'civic',
  financialCenter: 'civic',
  governmentOffice: 'civic',
  ministry: 'civic',
}

export function buildingGroup(recipeId: string): BuildingGroup {
  return RECIPE_GROUP[recipeId] ?? 'civic'
}

export interface Recipe {
  id: string
  label: string
  category: BuildingCategory
  // Selectable production methods; the first is the default a fresh building
  // starts on.
  methods: ProductionMethod[]
}

// The building roster (design doc Section 4). Real production chains with
// ELECTRICITY as a near-universal input: power plants feed extraction,
// processing and manufacturing; farms take fertilizer + machinery; ore + coal
// become steel; steel becomes machinery; and so on down to the consumer goods
// and medicine pops actually need. Extraction and power keep a *manual* method
// that needs no electricity, so an economy can bootstrap before the grid is up;
// their mechanized methods trade labor for power + machinery and far higher
// output. Every building is data — the tick loop is generic over these.
export const RECIPES: Record<string, Recipe> = {
  // ---------------- Energy ----------------
  solarPlant: {
    id: 'solarPlant',
    label: 'Solar Array',
    category: 'energy',
    methods: [
      {
        id: 'standard',
        label: 'Photovoltaic Array',
        description: 'Clean baseline power from sunlight — no fuel, modest output. Bootstraps the grid.',
        inputs: [],
        outputs: [{ good: 'electricity', amount: 850 }],
        jobs: [
          { class: 'labor', count: 80 },
          { class: 'technical', count: 40 },
        ],
      },
    ],
  },
  coalPowerPlant: {
    id: 'coalPowerPlant',
    label: 'Coal Power Plant',
    category: 'energy',
    methods: [
      {
        id: 'standard',
        label: 'Thermal Generation',
        description: 'Burns coal for reliable bulk electricity.',
        inputs: [{ good: 'coal', amount: 300 }],
        outputs: [{ good: 'electricity', amount: 2500 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },
  fusionReactor: {
    id: 'fusionReactor',
    label: 'Fusion Reactor',
    category: 'energy',
    methods: [
      {
        id: 'standard',
        label: 'Magnetic Confinement',
        description: 'Enormous clean output from rare metals and electrical machinery — but a specialist workforce.',
        inputs: [
          { good: 'rareMetals', amount: 40 },
          { good: 'electricalMachinery', amount: 40 },
        ],
        outputs: [{ good: 'electricity', amount: 3600 }],
        jobs: [
          { class: 'technical', count: 200 },
          { class: 'professional', count: 40 },
        ],
      },
    ],
  },

  // ---------------- Extraction ----------------
  ironMine: {
    id: 'ironMine',
    label: 'Iron Mine',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Pick & Shovel',
        description: 'Labor-intensive extraction. No power needed.',
        inputs: [],
        outputs: [{ good: 'ironOre', amount: 500 }],
        jobs: [{ class: 'labor', count: 300 }],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Extraction',
        description: 'Drills and haulers double output, running on power and tools.',
        inputs: [
          { good: 'electricity', amount: 120 },
          { good: 'tools', amount: 30 },
        ],
        outputs: [{ good: 'ironOre', amount: 1000 }],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 100 },
        ],
      },
    ],
  },
  coalMine: {
    id: 'coalMine',
    label: 'Coal Mine',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Hand Hewing',
        description: 'Pick-and-cart coal digging. No power needed.',
        inputs: [],
        outputs: [{ good: 'coal', amount: 600 }],
        jobs: [{ class: 'labor', count: 300 }],
      },
      {
        id: 'mechanized',
        label: 'Longwall Mining',
        description: 'Cutting machines lift output sharply on grid power and mining machinery.',
        inputs: [
          { good: 'machinery', amount: 15 },
          { good: 'electricity', amount: 100 },
        ],
        outputs: [{ good: 'coal', amount: 1150 }],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 80 },
        ],
      },
    ],
  },
  oilWell: {
    id: 'oilWell',
    label: 'Oil Well',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Shallow Derrick',
        description: 'Simple pumping of accessible crude.',
        inputs: [],
        outputs: [{ good: 'oil', amount: 500 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 60 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Deep Drilling',
        description: 'Powered rigs and heavy machinery reach far more crude.',
        inputs: [
          { good: 'electricity', amount: 150 },
          { good: 'heavyMachinery', amount: 30 },
        ],
        outputs: [{ good: 'oil', amount: 1000 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 120 },
        ],
      },
    ],
  },
  rareMetalsMine: {
    id: 'rareMetalsMine',
    label: 'Rare Metals Mine',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Hand Sorting',
        description: 'Painstaking manual extraction of scarce metals.',
        inputs: [],
        outputs: [{ good: 'rareMetals', amount: 220 }],
        jobs: [
          { class: 'labor', count: 300 },
          { class: 'technical', count: 60 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Ore Refining Line',
        description: 'Powered refining more than doubles yield of rare metals.',
        inputs: [
          { good: 'electricity', amount: 200 },
          { good: 'heavyMachinery', amount: 30 },
        ],
        outputs: [{ good: 'rareMetals', amount: 460 }],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 150 },
        ],
      },
    ],
  },
  loggingCamp: {
    id: 'loggingCamp',
    label: 'Logging Camp',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Hand Felling',
        description: 'Axes and saws. No power needed.',
        inputs: [],
        outputs: [{ good: 'timber', amount: 700 }],
        jobs: [{ class: 'labor', count: 250 }],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Harvesting',
        description: 'Powered harvesters and tools nearly double the cut.',
        inputs: [
          { good: 'electricity', amount: 80 },
          { good: 'tools', amount: 25 },
        ],
        outputs: [{ good: 'timber', amount: 1300 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },
  phosphateMine: {
    id: 'phosphateMine',
    label: 'Phosphate Mine',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Open Digging',
        description: 'Manual phosphate rock extraction.',
        inputs: [],
        outputs: [{ good: 'phosphate', amount: 520 }],
        jobs: [{ class: 'labor', count: 280 }],
      },
      {
        id: 'mechanized',
        label: 'Strip Mining',
        description: 'Powered strip mining doubles output, on excavating tools and grid power.',
        inputs: [
          { good: 'tools', amount: 25 },
          { good: 'electricity', amount: 110 },
        ],
        outputs: [{ good: 'phosphate', amount: 1050 }],
        jobs: [
          { class: 'labor', count: 140 },
          { class: 'technical', count: 80 },
        ],
      },
    ],
  },
  sulfurMine: {
    id: 'sulfurMine',
    label: 'Sulfur Mine',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Open-Pit Digging',
        description: 'Manual sulfur extraction from surface deposits. No power needed.',
        inputs: [],
        outputs: [{ good: 'sulfur', amount: 400 }],
        jobs: [{ class: 'labor', count: 280 }],
      },
      {
        id: 'mechanized',
        label: 'Frasch Process',
        description: 'Superheated water and powered pumps double sulfur yield.',
        inputs: [
          { good: 'electricity', amount: 100 },
          { good: 'tools', amount: 25 },
        ],
        outputs: [{ good: 'sulfur', amount: 800 }],
        jobs: [
          { class: 'labor', count: 140 },
          { class: 'technical', count: 70 },
        ],
      },
    ],
  },
  hardwoodLogging: {
    id: 'hardwoodLogging',
    label: 'Hardwood Logging',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Selective Felling',
        description: 'Hand-felled hardwood from a separate, slower-growing stand than the timber camps. No power needed.',
        inputs: [],
        outputs: [{ good: 'hardwood', amount: 400 }],
        jobs: [{ class: 'labor', count: 260 }],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Hardwood Harvest',
        description: 'Powered harvesters lift the cut of high-grade hardwood.',
        inputs: [
          { good: 'electricity', amount: 90 },
          { good: 'tools', amount: 25 },
        ],
        outputs: [{ good: 'hardwood', amount: 800 }],
        jobs: [
          { class: 'labor', count: 130 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },

  // ---------------- Agriculture ----------------
  wheatFarm: {
    id: 'wheatFarm',
    label: 'Wheat Farm',
    category: 'agriculture',
    methods: [
      {
        id: 'manual',
        label: 'Subsistence Farming',
        description: 'Hands and simple tools. Employs many, needs no inputs.',
        inputs: [],
        outputs: [{ good: 'wheat', amount: 1200 }],
        jobs: [
          { class: 'subsistence', count: 300 },
          { class: 'labor', count: 100 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Farming',
        description: 'Fertilizer, tools and power raise yields with fewer, more skilled hands.',
        inputs: [
          { good: 'fertilizer', amount: 120 },
          { good: 'tools', amount: 30 },
          { good: 'electricity', amount: 60 },
        ],
        outputs: [{ good: 'wheat', amount: 2000 }],
        jobs: [
          { class: 'subsistence', count: 100 },
          { class: 'labor', count: 90 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },
  riceFarm: {
    id: 'riceFarm',
    label: 'Rice Farm',
    category: 'agriculture',
    methods: [
      {
        id: 'manual',
        label: 'Paddy Farming',
        description: 'Traditional flooded-paddy cultivation. Labor-heavy, no inputs.',
        inputs: [],
        outputs: [{ good: 'rice', amount: 1150 }],
        jobs: [
          { class: 'subsistence', count: 320 },
          { class: 'labor', count: 100 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Paddy',
        description: 'Fertilizer, tools and pumps lift yields.',
        inputs: [
          { good: 'fertilizer', amount: 110 },
          { good: 'tools', amount: 25 },
          { good: 'electricity', amount: 50 },
        ],
        outputs: [{ good: 'rice', amount: 1900 }],
        jobs: [
          { class: 'subsistence', count: 110 },
          { class: 'labor', count: 90 },
          { class: 'technical', count: 50 },
        ],
      },
    ],
  },
  livestockRanch: {
    id: 'livestockRanch',
    label: 'Livestock Ranch',
    category: 'agriculture',
    methods: [
      {
        id: 'manual',
        label: 'Open Grazing',
        description: 'Herds fed on feed grain, tended by hand.',
        inputs: [{ good: 'wheat', amount: 200 }],
        outputs: [{ good: 'livestock', amount: 500 }],
        jobs: [
          { class: 'subsistence', count: 200 },
          { class: 'labor', count: 120 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Intensive Ranching',
        description: 'Feedlots and powered handling raise more stock on more feed.',
        inputs: [
          { good: 'wheat', amount: 300 },
          { good: 'electricity', amount: 60 },
          { good: 'tools', amount: 20 },
        ],
        outputs: [{ good: 'livestock', amount: 900 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },
  sugarPlantation: {
    id: 'sugarPlantation',
    label: 'Sugar Plantation',
    category: 'agriculture',
    methods: [
      {
        id: 'manual',
        label: 'Cane Cutting',
        description: 'Hand-cut sugarcane. Labor-heavy, no inputs.',
        inputs: [],
        outputs: [{ good: 'sugar', amount: 900 }],
        jobs: [
          { class: 'subsistence', count: 280 },
          { class: 'labor', count: 90 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Cane Harvest',
        description: 'Fertilizer, tools and power lift the cane yield.',
        inputs: [
          { good: 'fertilizer', amount: 100 },
          { good: 'tools', amount: 25 },
          { good: 'electricity', amount: 50 },
        ],
        outputs: [{ good: 'sugar', amount: 1600 }],
        jobs: [
          { class: 'subsistence', count: 90 },
          { class: 'labor', count: 80 },
          { class: 'technical', count: 50 },
        ],
      },
    ],
  },
  coffeePlantation: {
    id: 'coffeePlantation',
    label: 'Coffee Plantation',
    category: 'agriculture',
    methods: [
      {
        id: 'manual',
        label: 'Shade-Grown Picking',
        description: 'Hand-picked coffee cherries. Labor-heavy, no inputs.',
        inputs: [],
        outputs: [{ good: 'coffee', amount: 500 }],
        jobs: [
          { class: 'subsistence', count: 260 },
          { class: 'labor', count: 80 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Estate Cultivation',
        description: 'Fertilizer, tools and power raise coffee yields.',
        inputs: [
          { good: 'fertilizer', amount: 80 },
          { good: 'tools', amount: 20 },
          { good: 'electricity', amount: 40 },
        ],
        outputs: [{ good: 'coffee', amount: 850 }],
        jobs: [
          { class: 'subsistence', count: 80 },
          { class: 'labor', count: 70 },
          { class: 'technical', count: 40 },
        ],
      },
    ],
  },
  teaPlantation: {
    id: 'teaPlantation',
    label: 'Tea Plantation',
    category: 'agriculture',
    methods: [
      {
        id: 'manual',
        label: 'Hand-Picked Leaf',
        description: 'Hand-picked tea leaf. Labor-heavy, no inputs.',
        inputs: [],
        outputs: [{ good: 'tea', amount: 550 }],
        jobs: [
          { class: 'subsistence', count: 260 },
          { class: 'labor', count: 80 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Estate Cultivation',
        description: 'Fertilizer, tools and power raise tea yields.',
        inputs: [
          { good: 'fertilizer', amount: 80 },
          { good: 'tools', amount: 20 },
          { good: 'electricity', amount: 40 },
        ],
        outputs: [{ good: 'tea', amount: 900 }],
        jobs: [
          { class: 'subsistence', count: 80 },
          { class: 'labor', count: 70 },
          { class: 'technical', count: 40 },
        ],
      },
    ],
  },

  // ---------------- Industry ----------------
  steelMill: {
    id: 'steelMill',
    label: 'Steel Mill',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Blast Furnace',
        description: 'Smelts iron ore with coal into steel, driven by heavy plant machinery.',
        inputs: [
          { good: 'ironOre', amount: 300 },
          { good: 'coal', amount: 200 },
          { good: 'machinery', amount: 25 },
          { good: 'electricity', amount: 250 },
        ],
        outputs: [{ good: 'steel', amount: 950 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 150 },
        ],
      },
      {
        id: 'electricArc',
        label: 'Electric Arc',
        description: 'Coal-free arc smelting — trades the blast furnace\'s mechanical plant for heavy electrical equipment (transformers, electrodes), on much more power.',
        inputs: [
          { good: 'ironOre', amount: 320 },
          { good: 'electricalMachinery', amount: 20 },
          { good: 'electricity', amount: 500 },
        ],
        outputs: [{ good: 'steel', amount: 1250 }],
        jobs: [
          { class: 'labor', count: 100 },
          { class: 'technical', count: 220 },
        ],
      },
    ],
  },
  sawmill: {
    id: 'sawmill',
    label: 'Sawmill',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Powered Sawmill',
        description: 'Cuts timber into lumber on powered saws.',
        inputs: [
          { good: 'timber', amount: 400 },
          { good: 'machinery', amount: 30 },
          { good: 'electricity', amount: 120 },
        ],
        outputs: [{ good: 'lumber', amount: 900 }],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },
  oilRefinery: {
    id: 'oilRefinery',
    label: 'Oil Refinery',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Fractional Distillation',
        description: 'Refines crude oil into fuel.',
        inputs: [
          { good: 'oil', amount: 400 },
          { good: 'heavyMachinery', amount: 40 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'fuel', amount: 850 }],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 120 },
        ],
      },
    ],
  },
  chemicalPlant: {
    id: 'chemicalPlant',
    label: 'Chemical Plant',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Petrochemistry',
        description: 'Cracks oil into industrial chemicals in machinery-driven plant.',
        inputs: [
          { good: 'oil', amount: 300 },
          { good: 'machinery', amount: 40 },
          { good: 'electricity', amount: 220 },
        ],
        outputs: [{ good: 'chemicals', amount: 720 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 180 },
        ],
      },
    ],
  },
  fertilizerPlant: {
    id: 'fertilizerPlant',
    label: 'Fertilizer Plant',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Nitrate Synthesis',
        description: 'Combines phosphate and chemicals into fertilizer for farms.',
        inputs: [
          { good: 'phosphate', amount: 300 },
          { good: 'chemicals', amount: 150 },
          { good: 'machinery', amount: 30 },
          { good: 'electricity', amount: 180 },
        ],
        outputs: [{ good: 'fertilizer', amount: 800 }],
        jobs: [
          { class: 'labor', count: 140 },
          { class: 'technical', count: 120 },
        ],
      },
    ],
  },
  explosivesFactory: {
    id: 'explosivesFactory',
    label: 'Explosives Factory',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Ordnance Synthesis',
        description: 'Turns chemicals into industrial and military explosives.',
        inputs: [
          { good: 'chemicals', amount: 250 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'explosives', amount: 560 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 160 },
        ],
      },
    ],
  },
  semiconductorFab: {
    id: 'semiconductorFab',
    label: 'Semiconductor Fab',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Photolithography',
        description: 'Etches rare metals and chemicals into semiconductors — power-hungry, specialist, machinery-intensive.',
        inputs: [
          { good: 'rareMetals', amount: 180 },
          { good: 'chemicals', amount: 120 },
          { good: 'precisionMachinery', amount: 40 },
          { good: 'electricity', amount: 400 },
        ],
        outputs: [{ good: 'semiconductors', amount: 520 }],
        jobs: [
          { class: 'technical', count: 200 },
          { class: 'professional', count: 120 },
        ],
      },
    ],
  },
  toolWorkshop: {
    id: 'toolWorkshop',
    label: 'Tool Workshop',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Toolmaking',
        description: 'Forms steel into the tools nearly every industry and mechanized worker runs on.',
        inputs: [
          { good: 'steel', amount: 200 },
          { good: 'electricity', amount: 120 },
        ],
        outputs: [{ good: 'tools', amount: 1200 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 120 },
        ],
      },
    ],
  },
  machineryFactory: {
    id: 'machineryFactory',
    label: 'Machinery Factory',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'General Machining',
        description: 'Steel and tools into the general industrial machinery that runs mills, plants and factories.',
        inputs: [
          { good: 'steel', amount: 250 },
          { good: 'tools', amount: 80 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'machinery', amount: 950 }],
        jobs: [
          { class: 'labor', count: 180 },
          { class: 'technical', count: 200 },
        ],
      },
    ],
  },
  heavyMachineryPlant: {
    id: 'heavyMachineryPlant',
    label: 'Heavy Machinery Plant',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Heavy Machining',
        description: 'Steel, machinery and engines into the heavy machinery that drives deep extraction, the heaviest industry and major construction.',
        inputs: [
          { good: 'steel', amount: 300 },
          { good: 'machinery', amount: 90 },
          { good: 'engines', amount: 40 },
          { good: 'electricity', amount: 240 },
        ],
        outputs: [{ good: 'heavyMachinery', amount: 560 }],
        jobs: [
          { class: 'labor', count: 160 },
          { class: 'technical', count: 220 },
        ],
      },
    ],
  },
  electricalMachineryPlant: {
    id: 'electricalMachineryPlant',
    label: 'Electrical Machinery Plant',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Electrical Assembly',
        description: 'Motors, generators and drives from steel and electronics — the electrical machinery power plants and advanced factories need.',
        inputs: [
          { good: 'steel', amount: 200 },
          { good: 'electronics', amount: 120 },
          { good: 'electricity', amount: 260 },
        ],
        outputs: [{ good: 'electricalMachinery', amount: 520 }],
        jobs: [
          { class: 'technical', count: 220 },
          { class: 'professional', count: 80 },
        ],
      },
    ],
  },
  precisionMachineryPlant: {
    id: 'precisionMachineryPlant',
    label: 'Precision Machinery Plant',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Precision Instruments',
        description: 'High-tolerance instruments and machine tools from electrical machinery, electronics and rare metals — for the most advanced industry.',
        inputs: [
          { good: 'electricalMachinery', amount: 80 },
          { good: 'electronics', amount: 100 },
          { good: 'rareMetals', amount: 60 },
          { good: 'electricity', amount: 260 },
        ],
        outputs: [{ good: 'precisionMachinery', amount: 420 }],
        jobs: [
          { class: 'technical', count: 200 },
          { class: 'professional', count: 140 },
        ],
      },
    ],
  },
  electronicsFactory: {
    id: 'electronicsFactory',
    label: 'Electronics Factory',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Assembly',
        description: 'Builds electronics from semiconductors, steel and electrical machinery.',
        inputs: [
          { good: 'semiconductors', amount: 200 },
          { good: 'steel', amount: 100 },
          { good: 'electricalMachinery', amount: 50 },
          { good: 'electricity', amount: 300 },
        ],
        outputs: [{ good: 'electronics', amount: 700 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 240 },
          { class: 'professional', count: 50 },
        ],
      },
    ],
  },
  foodProcessor: {
    id: 'foodProcessor',
    label: 'Food Processing Plant',
    category: 'industry',
    methods: [
      {
        id: 'grain',
        label: 'Grain Milling',
        description: 'Mills wheat into staple food — a simple, robust food supply.',
        inputs: [
          { good: 'wheat', amount: 500 },
          { good: 'tools', amount: 20 },
          { good: 'electricity', amount: 100 },
        ],
        outputs: [{ good: 'food', amount: 2000 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 80 },
        ],
      },
      {
        id: 'mixed',
        label: 'Full Processing',
        description: 'A varied diet from wheat, rice and livestock — more food per plant, on a bigger processing line.',
        inputs: [
          { good: 'wheat', amount: 400 },
          { good: 'rice', amount: 300 },
          { good: 'livestock', amount: 150 },
          { good: 'tools', amount: 35 },
          { good: 'electricity', amount: 120 },
        ],
        outputs: [{ good: 'food', amount: 2700 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 100 },
        ],
      },
    ],
  },
  consumerGoodsFactory: {
    id: 'consumerGoodsFactory',
    label: 'Consumer Goods Factory',
    category: 'industry',
    methods: [
      {
        id: 'basic',
        label: 'Basic Workshop',
        description: 'Turns steel and tools into everyday consumer goods — a simple, robust supply.',
        inputs: [
          { good: 'steel', amount: 250 },
          { good: 'tools', amount: 30 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'consumerGoods', amount: 1000 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 150 },
        ],
      },
      {
        id: 'refined',
        label: 'Refined Line',
        description: 'Steel and lumber for finer goods, on heavier tooling than the basic line.',
        inputs: [
          { good: 'steel', amount: 200 },
          { good: 'lumber', amount: 200 },
          { good: 'tools', amount: 45 },
          { good: 'electricity', amount: 250 },
        ],
        outputs: [{ good: 'consumerGoods', amount: 1300 }],
        jobs: [
          { class: 'labor', count: 180 },
          { class: 'technical', count: 200 },
        ],
      },
      {
        id: 'automated',
        label: 'Automated Line',
        description: 'Robotic assembly lines raise throughput and skill demand, on heavy machinery and much more power.',
        inputs: [
          { good: 'steel', amount: 260 },
          { good: 'lumber', amount: 180 },
          { good: 'machinery', amount: 70 },
          { good: 'electricity', amount: 400 },
        ],
        outputs: [{ good: 'consumerGoods', amount: 1650 }],
        jobs: [
          { class: 'labor', count: 90 },
          { class: 'technical', count: 260 },
          { class: 'professional', count: 60 },
        ],
      },
    ],
  },
  luxuryFactory: {
    id: 'luxuryFactory',
    label: 'Luxury Manufactory',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Fine Manufacture',
        description: 'Electronics and consumer goods into luxuries for the wealthy.',
        inputs: [
          { good: 'electronics', amount: 200 },
          { good: 'consumerGoods', amount: 200 },
          { good: 'electricalMachinery', amount: 40 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'luxuryGoods', amount: 520 }],
        jobs: [
          { class: 'labor', count: 100 },
          { class: 'technical', count: 180 },
          { class: 'professional', count: 120 },
        ],
      },
    ],
  },

  meatPacking: {
    id: 'meatPacking',
    label: 'Meat Packing Plant',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Packing Line',
        description: 'Processes livestock into meat for the food chain.',
        inputs: [
          { good: 'livestock', amount: 300 },
          { good: 'electricity', amount: 80 },
        ],
        outputs: [{ good: 'meat', amount: 700 }],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 40 },
        ],
      },
    ],
  },
  dyeWorks: {
    id: 'dyeWorks',
    label: 'Dye Works',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Chemical Dyeing',
        description: 'Synthesizes chemicals into dyes for textiles and luxury goods.',
        inputs: [
          { good: 'chemicals', amount: 200 },
          { good: 'electricity', amount: 150 },
        ],
        outputs: [{ good: 'dyes', amount: 500 }],
        jobs: [
          { class: 'labor', count: 100 },
          { class: 'technical', count: 120 },
        ],
      },
    ],
  },
  glassworks: {
    id: 'glassworks',
    label: 'Glassworks',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Furnace Glassmaking',
        description: 'Melts phosphate-bearing mineral feedstock into glass.',
        inputs: [
          { good: 'phosphate', amount: 250 },
          { good: 'electricity', amount: 180 },
        ],
        outputs: [{ good: 'glass', amount: 650 }],
        jobs: [
          { class: 'labor', count: 140 },
          { class: 'technical', count: 80 },
        ],
      },
    ],
  },
  paperMill: {
    id: 'paperMill',
    label: 'Paper Mill',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Pulp & Press',
        description: 'Pulps timber and hardwood with chemicals into paper.',
        inputs: [
          { good: 'timber', amount: 200 },
          { good: 'hardwood', amount: 100 },
          { good: 'chemicals', amount: 80 },
          { good: 'electricity', amount: 120 },
        ],
        outputs: [{ good: 'paper', amount: 700 }],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 70 },
        ],
      },
    ],
  },
  shipyard: {
    id: 'shipyard',
    label: 'Shipyard',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Hull Assembly',
        description: 'Steel, engines and electronics into ocean-going ships for planetary logistics.',
        inputs: [
          { good: 'steel', amount: 300 },
          { good: 'engines', amount: 150 },
          { good: 'electronics', amount: 80 },
          { good: 'electricity', amount: 220 },
        ],
        outputs: [{ good: 'oceanGoingShips', amount: 120 }],
        jobs: [
          { class: 'labor', count: 160 },
          { class: 'technical', count: 180 },
        ],
      },
    ],
  },
  spaceyard: {
    id: 'spaceyard',
    label: 'Spaceyard',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Orbital Assembly',
        description: 'Precision machinery, electronics, heavy machinery and engines into spaceships — expensive, low-throughput, late-game capital construction.',
        inputs: [
          { good: 'precisionMachinery', amount: 120 },
          { good: 'electronics', amount: 150 },
          { good: 'heavyMachinery', amount: 100 },
          { good: 'engines', amount: 100 },
          { good: 'electricity', amount: 500 },
        ],
        outputs: [{ good: 'spaceships', amount: 15 }],
        jobs: [
          { class: 'technical', count: 200 },
          { class: 'professional', count: 180 },
        ],
      },
    ],
  },
  rocketFactory: {
    id: 'rocketFactory',
    label: 'Rocket Factory',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Booster Assembly',
        description: 'Precision machinery, explosives and electronics into rockets for spaceport-tier logistics.',
        inputs: [
          { good: 'precisionMachinery', amount: 80 },
          { good: 'explosives', amount: 100 },
          { good: 'electronics', amount: 90 },
          { good: 'electricity', amount: 300 },
        ],
        outputs: [{ good: 'rockets', amount: 60 }],
        jobs: [
          { class: 'technical', count: 180 },
          { class: 'professional', count: 100 },
        ],
      },
    ],
  },

  // ---------------- Engines & vehicles ----------------
  engineFactory: {
    id: 'engineFactory',
    label: 'Engine Factory',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Engine Assembly',
        description: 'Builds engines from steel and machinery — the powerplant of vehicles and heavy machinery.',
        inputs: [
          { good: 'steel', amount: 200 },
          { good: 'machinery', amount: 60 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'engines', amount: 600 }],
        jobs: [
          { class: 'labor', count: 160 },
          { class: 'technical', count: 180 },
        ],
      },
    ],
  },
  automobilePlant: {
    id: 'automobilePlant',
    label: 'Automobile Plant',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Vehicle Assembly',
        description: 'Steel, engines and electronics into automobiles for the population.',
        inputs: [
          { good: 'steel', amount: 200 },
          { good: 'engines', amount: 150 },
          { good: 'electronics', amount: 70 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'automobiles', amount: 500 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 160 },
        ],
      },
    ],
  },
  locomotiveWorks: {
    id: 'locomotiveWorks',
    label: 'Locomotive Works',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Locomotive Assembly',
        description: 'Heavy rolling stock from steel, engines and heavy machinery — the backbone of railways.',
        inputs: [
          { good: 'steel', amount: 300 },
          { good: 'engines', amount: 120 },
          { good: 'heavyMachinery', amount: 40 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'locomotives', amount: 260 }],
        jobs: [
          { class: 'labor', count: 180 },
          { class: 'technical', count: 180 },
        ],
      },
    ],
  },
  aircraftFactory: {
    id: 'aircraftFactory',
    label: 'Aircraft Factory',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Airframe Assembly',
        description: 'Aircraft from steel, engines, electronics and electrical machinery — for spaceports and the wealthy.',
        inputs: [
          { good: 'steel', amount: 200 },
          { good: 'engines', amount: 180 },
          { good: 'electronics', amount: 120 },
          { good: 'precisionMachinery', amount: 40 },
          { good: 'electricity', amount: 250 },
        ],
        outputs: [{ good: 'aircraft', amount: 180 }],
        jobs: [
          { class: 'technical', count: 240 },
          { class: 'professional', count: 120 },
        ],
      },
    ],
  },

  // ---------------- Infrastructure (raises market access / freight capacity) ----------------
  roadNetwork: {
    id: 'roadNetwork',
    label: 'Road Network',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Roads & Utilities',
        description: 'Basic roads and utilities connecting the planet — modest infrastructure and freight capacity.',
        inputs: [
          { good: 'steel', amount: 120 },
          { good: 'tools', amount: 50 },
          { good: 'electricity', amount: 80 },
        ],
        outputs: [{ good: 'infrastructure', amount: 700 }],
        jobs: [
          { class: 'subsistence', count: 80 },
          { class: 'labor', count: 220 },
        ],
      },
    ],
  },
  railway: {
    id: 'railway',
    label: 'Railway',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Rail Network',
        description: 'Locomotives and rail move people and freight across the planet — strong infrastructure and freight capacity.',
        inputs: [
          { good: 'locomotives', amount: 30 },
          { good: 'steel', amount: 120 },
          { good: 'fuel', amount: 100 },
          { good: 'electricity', amount: 80 },
        ],
        outputs: [{ good: 'infrastructure', amount: 1100 }],
        jobs: [
          { class: 'labor', count: 180 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },
  spaceport: {
    id: 'spaceport',
    label: 'Spaceport',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Orbital Freight Hub',
        description: 'Aircraft and orbital lift connect the world off-planet — the greatest market access and freight capacity.',
        inputs: [
          { good: 'aircraft', amount: 20 },
          { good: 'fuel', amount: 200 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'infrastructure', amount: 900 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 120 },
          { class: 'professional', count: 60 },
        ],
      },
    ],
  },

  // ---------------- Services ----------------
  clinic: {
    id: 'clinic',
    label: 'Clinic',
    category: 'services',
    methods: [
      {
        id: 'basic',
        label: 'General Practice',
        description: 'Technicians and physicians providing basic healthcare from medical supplies.',
        inputs: [
          { good: 'consumerGoods', amount: 150 },
          { good: 'electricity', amount: 100 },
        ],
        outputs: [{ good: 'healthcare', amount: 560 }],
        jobs: [
          { class: 'technical', count: 100 },
          { class: 'professional', count: 100 },
        ],
      },
      {
        id: 'advanced',
        label: 'Hospital',
        description: 'A specialist hospital delivering far more healthcare from chemicals and power.',
        inputs: [
          { good: 'chemicals', amount: 150 },
          { good: 'consumerGoods', amount: 100 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'healthcare', amount: 950 }],
        jobs: [
          { class: 'technical', count: 120 },
          { class: 'professional', count: 190 },
        ],
      },
    ],
  },
  school: {
    id: 'school',
    label: 'School',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Public Schooling',
        description: 'Educators providing schooling — raises the population it serves.',
        inputs: [
          { good: 'consumerGoods', amount: 120 },
          { good: 'electricity', amount: 100 },
        ],
        outputs: [{ good: 'education', amount: 500 }],
        jobs: [
          { class: 'technical', count: 80 },
          { class: 'professional', count: 160 },
        ],
      },
    ],
  },
  retailShop: {
    id: 'retailShop',
    label: 'Retail Center',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Shops & Services',
        description: 'Shops, repairs and everyday services staffed by the working class.',
        inputs: [
          { good: 'consumerGoods', amount: 200 },
          { good: 'electricity', amount: 80 },
        ],
        outputs: [{ good: 'retail', amount: 900 }],
        jobs: [
          { class: 'labor', count: 220 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },

  artStudio: {
    id: 'artStudio',
    label: 'Art Studio',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Studio & Gallery',
        description: 'Artists and craftspeople producing culture and art for a comfortable population.',
        inputs: [
          { good: 'consumerGoods', amount: 60 },
          { good: 'electricity', amount: 60 },
        ],
        outputs: [{ good: 'art', amount: 300 }],
        jobs: [
          { class: 'technical', count: 80 },
          { class: 'professional', count: 120 },
        ],
      },
    ],
  },
  dataCenter: {
    id: 'dataCenter',
    label: 'Data Center',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Server Farm',
        description: 'Electronics and power running the online services pops and businesses rely on.',
        inputs: [
          { good: 'electronics', amount: 80 },
          { good: 'electricity', amount: 250 },
        ],
        outputs: [{ good: 'onlineServices', amount: 600 }],
        jobs: [
          { class: 'technical', count: 180 },
          { class: 'professional', count: 100 },
        ],
      },
    ],
  },

  // ---------------- Corporate ----------------
  // A company's headquarters — pure overhead: it produces nothing but employs
  // administrators and consumes supplies, a cost that scales with the company's
  // size (its level tracks the number of buildings the company owns).
  corporateHq: {
    id: 'corporateHq',
    label: 'Corporate HQ',
    category: 'corporate',
    methods: [
      {
        id: 'standard',
        label: 'Head Office',
        description: 'Management, administration and overhead. Grows as the company grows.',
        inputs: [
          { good: 'consumerGoods', amount: 60 },
          { good: 'electricity', amount: 80 },
          { good: 'retail', amount: 40 },
        ],
        outputs: [],
        jobs: [
          { class: 'professional', count: 120 },
          { class: 'technical', count: 80 },
          { class: 'political', count: 20 },
        ],
      },
    ],
  },

  // ---------------- Finance (the financial district) ----------------
  financialCenter: {
    id: 'financialCenter',
    label: 'Financial Center',
    category: 'corporate',
    methods: [
      {
        id: 'standard',
        label: 'Banks & Exchanges',
        description: 'Banks, exchanges and brokerages — the financial district providing financial services.',
        inputs: [
          { good: 'consumerGoods', amount: 90 },
          { good: 'electricity', amount: 90 },
        ],
        outputs: [{ good: 'retail', amount: 700 }],
        jobs: [
          { class: 'professional', count: 160 },
          { class: 'investor', count: 60 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },

  // ---------------- Government (produce bureaucracy) ----------------
  governmentOffice: {
    id: 'governmentOffice',
    label: 'Government Office',
    category: 'government',
    methods: [
      {
        id: 'standard',
        label: 'Civil Service',
        description: 'Clerks and administrators producing the bureaucratic capacity the state runs on.',
        inputs: [
          { good: 'consumerGoods', amount: 80 },
          { good: 'electricity', amount: 60 },
          { good: 'retail', amount: 30 },
        ],
        outputs: [],
        jobs: [
          { class: 'professional', count: 140 },
          { class: 'political', count: 60 },
          { class: 'technical', count: 40 },
        ],
      },
    ],
  },
  ministry: {
    id: 'ministry',
    label: 'Ministry',
    category: 'government',
    methods: [
      {
        id: 'standard',
        label: 'Great Department of State',
        description: 'A vast department generating far more bureaucratic capacity — at a far greater cost.',
        inputs: [
          { good: 'consumerGoods', amount: 160 },
          { good: 'electricity', amount: 140 },
          { good: 'retail', amount: 80 },
          { good: 'education', amount: 40 },
        ],
        outputs: [],
        jobs: [
          { class: 'professional', count: 300 },
          { class: 'political', count: 140 },
          { class: 'technical', count: 90 },
        ],
      },
    ],
  },
}

// The production method a building is currently running (falling back to the
// recipe's default), plus a plain lookup for a specific method id. Centralised
// so the tick loop and the UI resolve methods the same way.
export function defaultMethodId(recipeId: string): string {
  return RECIPES[recipeId]?.methods[0]?.id ?? ''
}

export function getMethod(recipeId: string, methodId: string | undefined): ProductionMethod | undefined {
  const recipe = RECIPES[recipeId]
  if (!recipe) return undefined
  return recipe.methods.find((m) => m.id === methodId) ?? recipe.methods[0]
}
