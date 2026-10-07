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
  seaport: 1500,
  urbanCenter: 450,
}

// Construction points a Construction Sector adds to its WORLD's build capacity
// per level at full throughput. This is what makes building faster a strategic
// investment (build more sectors) rather than a fixed rate — Stage 2 of the
// construction rework. Tech can raise this later.
export const CONSTRUCTION_OUTPUT: Record<string, number> = {
  constructionSector: 55,
}

// A planet is not unlimited: buildings occupy DISTRICTS by category. The core
// holds government + finance; the urban district holds services; the industrial
// district holds power + heavy industry; the resource district holds mines and
// farms. Each district has a bounded number of slots (a building's level = its
// slots), so construction competes for space.
// The military district holds no economy buildings: it houses the nation's
// planetary defenses (fortress, shield, battery — data/defenseData.ts), counted
// through World.militarySlots.
export type DistrictType = 'core' | 'urban' | 'industrial' | 'resource' | 'military'
export const DISTRICT_TYPES: DistrictType[] = ['core', 'urban', 'industrial', 'resource', 'military']
export const DISTRICT_LABELS: Record<DistrictType, string> = {
  core: 'Core',
  urban: 'Urban',
  industrial: 'Industrial',
  resource: 'Resource',
  military: 'Military',
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
  baseMetalsMine: 'extraction',
  lightMetalsMine: 'extraction',
  metallicHydrogenPlant: 'extraction',
  exoticMatterPlant: 'extraction',
  hyperiumPlant: 'extraction',
  waterTreatmentPlant: 'extraction',
  groundwaterPump: 'extraction',
  desalinationPlant: 'extraction',
  iceMine: 'extraction',
  loggingCamp: 'extraction',
  phosphateMine: 'extraction',
  sulfurMine: 'extraction',
  hardwoodLogging: 'extraction',
  // Agriculture
  wheatFarm: 'agriculture',
  riceFarm: 'agriculture',
  hydroponicsFarm: 'agriculture',
  fishery: 'agriculture',
  fishingWharf: 'agriculture',
  livestockRanch: 'agriculture',
  sugarPlantation: 'agriculture',
  coffeePlantation: 'agriculture',
  teaPlantation: 'agriculture',
  // Heavy industry — primary metals, tools, machinery tiers, electronics
  steelMill: 'heavyIndustry',
  alloySmelter: 'heavyIndustry',
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
  rocketFuelRefinery: 'chemicals',
  chemicalPlant: 'chemicals',
  fertilizerPlant: 'chemicals',
  explosivesFactory: 'chemicals',
  dyeWorks: 'chemicals',
  glassworks: 'chemicals',
  cementWorks: 'chemicals',
  paperMill: 'chemicals',
  constructionSector: 'infrastructure',
  // Consumer manufacturing
  foodProcessor: 'consumerGoods',
  consumerGoodsFactory: 'consumerGoods',
  furnitureFactory: 'consumerGoods',
  textileMill: 'consumerGoods',
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
  seaport: 'infrastructure',
  urbanCenter: 'infrastructure',
  spaceElevatorAnchor: 'infrastructure',
  // Public services
  clinic: 'services',
  school: 'services',
  university: 'services',
  physicsLab: 'services',
  engineeringLab: 'services',
  socialInstitute: 'services',
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

// --- Construction work (design: Vic3-style) ---
// A building level costs a fixed amount of CONSTRUCTION WORK (points), not a sum
// of money. The money cost is emergent: producing that work consumes goods
// (steel/concrete/tools/glass/lumber) bought at market prices, so a building
// "costs" whatever those materials cost that tick — no arbitrary dollar figure.
// Work scales by tier: cheap primary buildings are quick to throw up; advanced
// and megastructure-tier ones take far more work.
const CONSTRUCTION_WORK_BY_TIER: Record<number, number> = { 1: 100, 2: 250, 3: 450, 4: 650, 5: 900 }

// Explicit tier per building. Anything unlisted falls back to a category default.
const CONSTRUCTION_TIER: Record<string, number> = {
  // T1 — primary sector, quick to build
  ironMine: 1, coalMine: 1, oilWell: 1, rareMetalsMine: 1, baseMetalsMine: 1, loggingCamp: 1, phosphateMine: 1, sulfurMine: 1, hardwoodLogging: 1,
  wheatFarm: 1, riceFarm: 1, fishery: 1, fishingWharf: 1, livestockRanch: 1, sugarPlantation: 1, coffeePlantation: 1, teaPlantation: 1,
  waterTreatmentPlant: 1, groundwaterPump: 1,
  lightMetalsMine: 2, hydroponicsFarm: 3, desalinationPlant: 2, iceMine: 2,
  // T2 — light industry, services, basic power/infra
  solarPlant: 2, coalPowerPlant: 2, foodProcessor: 2, meatPacking: 2, consumerGoodsFactory: 2, furnitureFactory: 2, sawmill: 2, toolWorkshop: 2,
  dyeWorks: 2, glassworks: 2, cementWorks: 2, paperMill: 2, clinic: 2, school: 2, retailShop: 2, artStudio: 2, roadNetwork: 2, governmentOffice: 2, constructionSector: 3,
  // T3 — mid/heavy industry, advanced services, civic
  steelMill: 3, alloySmelter: 3, machineryFactory: 3, oilRefinery: 3, rocketFuelRefinery: 3, chemicalPlant: 3, fertilizerPlant: 3, explosivesFactory: 3, electronicsFactory: 3,
  physicsLab: 3, engineeringLab: 3, socialInstitute: 3,
  engineFactory: 3, automobilePlant: 3, luxuryFactory: 3, dataCenter: 3, railway: 3, urbanCenter: 3, corporateHq: 3, financialCenter: 3,
  // T4 — advanced industry & major infrastructure
  heavyMachineryPlant: 4, electricalMachineryPlant: 4, precisionMachineryPlant: 4, semiconductorFab: 4, locomotiveWorks: 4,
  aircraftFactory: 4, shipyard: 4, fusionReactor: 4, ministry: 4, spaceport: 4, university: 4,
  // T5 — the biggest, most complex yards
  spaceyard: 5, rocketFactory: 5, metallicHydrogenPlant: 5, exoticMatterPlant: 5, hyperiumPlant: 5,
}

const CATEGORY_TIER_DEFAULT: Record<BuildingCategory, number> = {
  extraction: 1, agriculture: 1, energy: 2, services: 2, industry: 3, corporate: 3, government: 3,
}

// Construction points to complete one level of a building.
export function constructionWork(recipeId: string): number {
  const tier = CONSTRUCTION_TIER[recipeId] ?? CATEGORY_TIER_DEFAULT[RECIPES[recipeId]?.category ?? 'industry'] ?? 3
  return CONSTRUCTION_WORK_BY_TIER[tier] ?? 450
}

export interface Recipe {
  id: string
  label: string
  category: BuildingCategory
  // Selectable production methods; the first is the default a fresh building
  // starts on.
  methods: ProductionMethod[]
  // A tech this building needs before it can be built (data/techData.ts).
  // Absent = buildable from the start. Enforced in state/economyStore.queueBuild
  // and hidden in the build picker until researched.
  requiresTech?: string
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
        description: 'Burns coal for reliable bulk electricity, with water for cooling.',
        inputs: [
          { good: 'coal', amount: 300 },
          { good: 'water', amount: 140 },
        ],
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
        description: 'Enormous clean output from rare metals and electrical machinery, with coolant water — but a specialist workforce.',
        inputs: [
          { good: 'rareMetals', amount: 40 },
          { good: 'electricalMachinery', amount: 40 },
          { good: 'water', amount: 180 },
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
  baseMetalsMine: {
    id: 'baseMetalsMine',
    label: 'Base Metals Mine',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Open-Pit Mining',
        description: 'Copper and nickel from open-pit ore — the base metals, as co-products of one mine.',
        inputs: [],
        outputs: [
          { good: 'copper', amount: 320 },
          { good: 'nickel', amount: 140 },
        ],
        jobs: [
          { class: 'labor', count: 300 },
          { class: 'technical', count: 50 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Flotation Line',
        description: 'Powered crushing and flotation lift the yield of copper and nickel.',
        inputs: [
          { good: 'electricity', amount: 220 },
          { good: 'heavyMachinery', amount: 30 },
        ],
        outputs: [
          { good: 'copper', amount: 660 },
          { good: 'nickel', amount: 300 },
        ],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 150 },
        ],
      },
    ],
  },
  lightMetalsMine: {
    id: 'lightMetalsMine',
    label: 'Light Metals Mine',
    category: 'extraction',
    methods: [
      {
        id: 'manual',
        label: 'Ore & Brine Works',
        description: 'Aluminium ore, titanium sands and lithium brine — the light metals, from one works.',
        inputs: [],
        outputs: [
          { good: 'aluminium', amount: 300 },
          { good: 'titanium', amount: 90 },
          { good: 'lithium', amount: 110 },
        ],
        jobs: [
          { class: 'labor', count: 300 },
          { class: 'technical', count: 60 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Electrolytic Line',
        description: 'Electrolysis and powered processing raise the yield of all three light metals, on heavy power.',
        inputs: [
          { good: 'electricity', amount: 420 },
          { good: 'heavyMachinery', amount: 35 },
        ],
        outputs: [
          { good: 'aluminium', amount: 640 },
          { good: 'titanium', amount: 200 },
          { good: 'lithium', amount: 240 },
        ],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 170 },
        ],
      },
    ],
  },
  metallicHydrogenPlant: {
    id: 'metallicHydrogenPlant',
    label: 'Metallic Hydrogen Plant',
    category: 'extraction',
    requiresTech: 'metallic-hydrogen',
    methods: [
      {
        id: 'standard',
        label: 'Gas-Giant Skimming',
        description: 'Skims and compresses gas-giant hydrogen into metastable metallic hydrogen — an enormous, clean source of rocket fuel. A late-game megastructure-tier work.',
        inputs: [
          { good: 'electricity', amount: 1200 },
          { good: 'heavyMachinery', amount: 120 },
          { good: 'precisionMachinery', amount: 80 },
        ],
        outputs: [{ good: 'rocketFuel', amount: 2600 }],
        jobs: [
          { class: 'technical', count: 220 },
          { class: 'professional', count: 200 },
        ],
      },
    ],
  },
  // --- Strategic war materials (FTL) ---------------------------------------
  // Exotic matter and hyperium: synthesised only once the late tech lands, never
  // demanded by any economy recipe, so they are never auto-seeded — a nation
  // builds these when it wants to feed an FTL navy (the military shipyard draws
  // them from the economy in Complex mode). Expensive, power-hungry, low yield.
  exoticMatterPlant: {
    id: 'exoticMatterPlant',
    label: 'Exotic Matter Containment Plant',
    category: 'extraction',
    requiresTech: 'exotic-matter-containment',
    methods: [
      {
        id: 'standard',
        label: 'Negative-Energy Containment',
        description: 'Condenses and holds exotic matter in magnetic-confinement lattices — the stuff that threads a warp field. Enormous power for a trickle of output; the feedstock of every warp drive.',
        inputs: [
          { good: 'electricity', amount: 1400 },
          { good: 'rareMetals', amount: 90 },
          { good: 'precisionMachinery', amount: 70 },
        ],
        outputs: [{ good: 'exoticMatter', amount: 240 }],
        jobs: [
          { class: 'technical', count: 180 },
          { class: 'professional', count: 220 },
        ],
      },
    ],
  },
  hyperiumPlant: {
    id: 'hyperiumPlant',
    label: 'Hyperium Synthesis Plant',
    category: 'extraction',
    // Gated on hyperium-extraction, which the near-Sol human nations all hold by
    // default (DEFAULT_RESEARCHED) — only they work with hyperium by lore — while
    // distant low-tier empires do not. So the human powers can make their own
    // hyperium from turn one and keep building an FTL navy.
    requiresTech: 'hyperium-extraction',
    methods: [
      {
        id: 'standard',
        label: 'Transuranic Synthesis',
        description: 'Breeds and stabilises hyperium from rare feedstock and vast power — the fuel a hyperdrive folds space with. Rarer and dearer than exotic matter; a handful a month from a whole plant.',
        inputs: [
          { good: 'electricity', amount: 1800 },
          { good: 'rareMetals', amount: 120 },
          { good: 'rocketFuel', amount: 60 },
          { good: 'precisionMachinery', amount: 90 },
        ],
        outputs: [{ good: 'hyperium', amount: 150 }],
        jobs: [
          { class: 'technical', count: 200 },
          { class: 'professional', count: 260 },
        ],
      },
    ],
  },
  // --- Water ---------------------------------------------------------------
  // Three ways to supply the universal water utility. The seed prefers the
  // treatment plant (cheapest power), pumping and desalination are built where a
  // world has no surface water or runs on the sea.
  waterTreatmentPlant: {
    id: 'waterTreatmentPlant',
    label: 'Water Treatment Plant',
    category: 'extraction',
    methods: [
      {
        id: 'standard',
        label: 'Surface Water Treatment',
        description: 'Collects and treats surface water — rivers, lakes and reservoirs — into clean supply. Cheap to run, the backbone of a world\'s water.',
        inputs: [{ good: 'electricity', amount: 16 }],
        outputs: [{ good: 'water', amount: 1000 }],
        jobs: [
          { class: 'labor', count: 50 },
          { class: 'technical', count: 13 },
        ],
      },
    ],
  },
  groundwaterPump: {
    id: 'groundwaterPump',
    label: 'Groundwater Pumps',
    category: 'extraction',
    methods: [
      {
        id: 'standard',
        label: 'Aquifer Pumping',
        description: 'Pumps groundwater from aquifers — more power than surface treatment, but it works where there is no river to draw on.',
        inputs: [{ good: 'electricity', amount: 58 }],
        outputs: [{ good: 'water', amount: 900 }],
        jobs: [
          { class: 'labor', count: 40 },
          { class: 'technical', count: 18 },
        ],
      },
    ],
  },
  desalinationPlant: {
    id: 'desalinationPlant',
    label: 'Desalination Plant',
    category: 'extraction',
    methods: [
      {
        id: 'standard',
        label: 'Reverse-Osmosis Desalination',
        description: 'Turns seawater into fresh water on heavy power. Expensive, but a world covered in sea can water itself without a drop of rain.',
        inputs: [{ good: 'electricity', amount: 225 }],
        outputs: [{ good: 'water', amount: 1200 }],
        jobs: [
          { class: 'labor', count: 26 },
          { class: 'technical', count: 56 },
        ],
      },
    ],
  },
  iceMine: {
    id: 'iceMine',
    label: 'Ice Mine',
    category: 'extraction',
    methods: [
      {
        id: 'standard',
        label: 'Volatile Ice Extraction',
        description: 'Mines frozen volatiles — surface and subsurface water ice — and melts them into supply. The way an airless, frozen world or an outer moon waters itself; energy-hungry, but it needs neither rivers nor a sea.',
        inputs: [
          { good: 'electricity', amount: 120 },
          { good: 'heavyMachinery', amount: 7 },
        ],
        outputs: [{ good: 'water', amount: 1000 }],
        jobs: [
          { class: 'labor', count: 50 },
          { class: 'technical', count: 27 },
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
        outputs: [{ good: 'grains', amount: 1200 }],
        jobs: [
          { class: 'subsistence', count: 300 },
          { class: 'labor', count: 100 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Farming',
        description: 'Fertilizer, tools, water and power raise yields with fewer, more skilled hands.',
        inputs: [
          { good: 'fertilizer', amount: 120 },
          { good: 'tools', amount: 30 },
          { good: 'water', amount: 120 },
          { good: 'electricity', amount: 45 },
        ],
        outputs: [{ good: 'grains', amount: 2000 }],
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
        outputs: [{ good: 'grains', amount: 1150 }],
        jobs: [
          { class: 'subsistence', count: 320 },
          { class: 'labor', count: 100 },
        ],
      },
      {
        id: 'mechanized',
        label: 'Mechanized Paddy',
        description: 'Fertilizer, tools, flood water and pumps lift yields.',
        inputs: [
          { good: 'fertilizer', amount: 110 },
          { good: 'tools', amount: 25 },
          { good: 'water', amount: 160 },
          { good: 'electricity', amount: 40 },
        ],
        outputs: [{ good: 'grains', amount: 1900 }],
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
        inputs: [{ good: 'grains', amount: 200 }],
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
          { good: 'grains', amount: 300 },
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
  hydroponicsFarm: {
    id: 'hydroponicsFarm',
    label: 'Hydroponic Farm',
    category: 'agriculture',
    methods: [
      {
        id: 'standard',
        label: 'Vertical Hydroponics',
        description: 'Stacked, climate-controlled grain growing — high yield in little space, on power, water and fertilizer. The backbone of food security on marginal worlds.',
        inputs: [
          { good: 'fertilizer', amount: 100 },
          { good: 'water', amount: 90 },
          { good: 'electricity', amount: 185 },
          { good: 'machinery', amount: 20 },
        ],
        outputs: [{ good: 'grains', amount: 2600 }],
        jobs: [
          { class: 'labor', count: 90 },
          { class: 'technical', count: 150 },
        ],
      },
    ],
  },
  fishery: {
    id: 'fishery',
    label: 'Fishery',
    category: 'agriculture',
    methods: [
      {
        id: 'coastal',
        label: 'Coastal Fishing',
        description: 'Small boats and nets. Employs many, needs no inputs.',
        inputs: [],
        outputs: [{ good: 'fish', amount: 900 }],
        jobs: [
          { class: 'subsistence', count: 220 },
          { class: 'labor', count: 120 },
        ],
      },
      {
        id: 'trawler',
        label: 'Trawler Fleet',
        description: 'Powered trawlers and processing raise the catch, on fuel and heavier gear.',
        inputs: [
          { good: 'fuel', amount: 80 },
          { good: 'electricity', amount: 60 },
          { good: 'tools', amount: 25 },
        ],
        outputs: [{ good: 'fish', amount: 1700 }],
        jobs: [
          { class: 'labor', count: 130 },
          { class: 'technical', count: 70 },
        ],
      },
    ],
  },
  fishingWharf: {
    id: 'fishingWharf',
    label: 'Fishing Wharves',
    category: 'agriculture',
    methods: [
      {
        id: 'standard',
        label: 'Fishing Fleet',
        description: 'A fleet of ocean-going boats works the coast and the open sea, landing fish at the wharves. The boats are consumed as they wear out and are replaced — a world with sea turns ships into food.',
        inputs: [
          { good: 'oceanGoingShips', amount: 6 },
          { good: 'fuel', amount: 60 },
          { good: 'electricity', amount: 50 },
        ],
        outputs: [{ good: 'fish', amount: 1500 }],
        jobs: [
          { class: 'labor', count: 180 },
          { class: 'technical', count: 50 },
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
  alloySmelter: {
    id: 'alloySmelter',
    label: 'Alloy Smelter',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Alloying Furnace',
        description: 'Blends copper, aluminium, nickel, titanium and lithium into high-performance alloys — the metal that ships, aircraft and vehicles are built from.',
        inputs: [
          { good: 'copper', amount: 180 },
          { good: 'aluminium', amount: 220 },
          { good: 'nickel', amount: 90 },
          { good: 'titanium', amount: 70 },
          { good: 'lithium', amount: 60 },
          { good: 'electricity', amount: 300 },
        ],
        outputs: [{ good: 'alloys', amount: 620 }],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'technical', count: 190 },
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
  rocketFuelRefinery: {
    id: 'rocketFuelRefinery',
    label: 'Rocket Fuel Refinery',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Propellant Synthesis',
        description: 'Refines crude oil and chemicals into cryogenic rocket propellant — the fuel that spaceport launches and rockets burn. Drawn from oil directly, so it does not compete with the fuel market.',
        inputs: [
          { good: 'oil', amount: 300 },
          { good: 'chemicals', amount: 140 },
          { good: 'electricity', amount: 280 },
        ],
        outputs: [{ good: 'rocketFuel', amount: 560 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 160 },
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
        description: 'Cracks oil into industrial chemicals in machinery-driven plant, with process water.',
        inputs: [
          { good: 'sulfur', amount: 60 },
          { good: 'oil', amount: 300 },
          { good: 'water', amount: 110 },
          { good: 'machinery', amount: 40 },
          { good: 'electricity', amount: 200 },
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
          { good: 'sulfur', amount: 40 },
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
          { good: 'sulfur', amount: 80 },
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
        description: 'Mills grains into packaged groceries — a simple, robust processed-food supply.',
        inputs: [
          { good: 'grains', amount: 500 },
          { good: 'tools', amount: 20 },
          { good: 'electricity', amount: 100 },
        ],
        outputs: [{ good: 'groceries', amount: 2000 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 80 },
        ],
      },
      {
        id: 'mixed',
        label: 'Full Processing',
        description: 'A varied grocery line from grains and livestock — more processed food per plant, on a bigger line.',
        inputs: [
          { good: 'grains', amount: 700 },
          { good: 'livestock', amount: 150 },
          { good: 'tools', amount: 35 },
          { good: 'electricity', amount: 120 },
        ],
        outputs: [{ good: 'groceries', amount: 2700 }],
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
          { good: 'textiles', amount: 60 },
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

  furnitureFactory: {
    id: 'furnitureFactory',
    label: 'Furniture Factory',
    category: 'industry',
    methods: [
      {
        id: 'basic',
        label: 'Joinery',
        description: 'Lumber and hardwood worked into household furniture.',
        inputs: [
          { good: 'textiles', amount: 40 },
          { good: 'lumber', amount: 220 },
          { good: 'hardwood', amount: 120 },
          { good: 'electricity', amount: 150 },
        ],
        outputs: [{ good: 'furniture', amount: 620 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 120 },
        ],
      },
      {
        id: 'finished',
        label: 'Finished Goods Line',
        description: 'Adds glass and consumer fittings for finer furniture, on heavier tooling.',
        inputs: [
          { good: 'textiles', amount: 40 },
          { good: 'lumber', amount: 200 },
          { good: 'hardwood', amount: 110 },
          { good: 'glass', amount: 60 },
          { good: 'tools', amount: 40 },
          { good: 'electricity', amount: 220 },
        ],
        outputs: [{ good: 'furniture', amount: 900 }],
        jobs: [
          { class: 'labor', count: 160 },
          { class: 'technical', count: 200 },
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
  textileMill: {
    id: 'textileMill',
    label: 'Textile Mill',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Spinning & Dyeing',
        description: 'Wool and synthetic fibre spun, woven and dyed into cloth and clothing.',
        inputs: [
          { good: 'livestock', amount: 60 },
          { good: 'chemicals', amount: 80 },
          { good: 'dyes', amount: 60 },
          { good: 'electricity', amount: 120 },
        ],
        outputs: [{ good: 'textiles', amount: 1400 }],
        jobs: [
          { class: 'labor', count: 180 },
          { class: 'technical', count: 60 },
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
  constructionSector: {
    id: 'constructionSector',
    label: 'Construction Sector',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Construction Firms',
        description: 'Contractors, cranes and crews. Produces the construction capacity that builds everything on this world — build more to build faster. Consumes some upkeep; the bulk materials are consumed by the projects themselves.',
        inputs: [
          { good: 'machinery', amount: 40 },
          { good: 'tools', amount: 60 },
          { good: 'electricity', amount: 90 },
        ],
        outputs: [],
        jobs: [
          { class: 'labor', count: 220 },
          { class: 'technical', count: 90 },
        ],
      },
    ],
  },
  cementWorks: {
    id: 'cementWorks',
    label: 'Cement Works',
    category: 'industry',
    methods: [
      {
        id: 'standard',
        label: 'Kiln Cement',
        description: 'Fires coal-heated kilns to produce cement and concrete — the bulk material almost every construction consumes.',
        inputs: [
          { good: 'coal', amount: 200 },
          { good: 'electricity', amount: 160 },
        ],
        outputs: [{ good: 'concrete', amount: 1400 }],
        jobs: [
          { class: 'labor', count: 170 },
          { class: 'technical', count: 60 },
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
        description: 'Steel, alloys, engines and electronics into ocean-going ships for planetary logistics.',
        inputs: [
          { good: 'steel', amount: 240 },
          { good: 'alloys', amount: 60 },
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
        description: 'Steel, alloys, precision machinery, electronics, heavy machinery and engines into spaceships — expensive, low-throughput, late-game capital construction.',
        inputs: [
          { good: 'steel', amount: 100 },
          { good: 'alloys', amount: 90 },
          { good: 'precisionMachinery', amount: 120 },
          { good: 'electronics', amount: 150 },
          { good: 'heavyMachinery', amount: 70 },
          { good: 'engines', amount: 80 },
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
        description: 'Alloys, rocket fuel, precision machinery, explosives and electronics into rockets for spaceport-tier logistics — the boosters come fuelled.',
        inputs: [
          { good: 'alloys', amount: 60 },
          { good: 'rocketFuel', amount: 90 },
          { good: 'precisionMachinery', amount: 60 },
          { good: 'explosives', amount: 70 },
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
        description: 'Steel, alloys, engines and electronics into automobiles for the population.',
        inputs: [
          { good: 'steel', amount: 160 },
          { good: 'alloys', amount: 50 },
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
        description: 'Heavy rolling stock from steel, alloys, engines and heavy machinery — the backbone of railways.',
        inputs: [
          { good: 'steel', amount: 270 },
          { good: 'alloys', amount: 40 },
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
        description: 'Aircraft from alloys, steel, engines, electronics and electrical machinery — lightweight airframes for spaceports and the wealthy.',
        inputs: [
          { good: 'alloys', amount: 130 },
          { good: 'steel', amount: 90 },
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
        outputs: [{ good: 'transportation', amount: 700 }],
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
        outputs: [{ good: 'transportation', amount: 1100 }],
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
    // Three production methods (economy/transport.ts reads the chosen method for
    // the LAUNCH and INTERSTELLAR capacity each gives): a balanced freight hub,
    // a lift-focused launch complex, and an interstellar merchant port.
    methods: [
      {
        id: 'standard',
        label: 'Orbital Freight Hub',
        description: 'Aircraft and orbital lift connect the world off-planet — balanced launch and interstellar freight capacity.',
        inputs: [
          { good: 'rockets', amount: 6 },
          { good: 'spaceships', amount: 1 },
          { good: 'aircraft', amount: 20 },
          { good: 'fuel', amount: 200 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [{ good: 'transportation', amount: 900 }],
        jobs: [
          { class: 'labor', count: 120 },
          { class: 'technical', count: 120 },
          { class: 'professional', count: 60 },
        ],
      },
      {
        id: 'launch-complex',
        label: 'Launch Complex',
        description: 'Heavy rocketry maximises surface↔orbit LAUNCH capacity at the cost of interstellar freight.',
        inputs: [
          { good: 'rockets', amount: 16 },
          { good: 'fuel', amount: 320 },
          { good: 'electricity', amount: 240 },
        ],
        outputs: [{ good: 'transportation', amount: 700 }],
        jobs: [
          { class: 'labor', count: 160 },
          { class: 'technical', count: 100 },
          { class: 'professional', count: 40 },
        ],
      },
      {
        id: 'interstellar-port',
        label: 'Interstellar Port',
        description: 'A merchant-marine berth: maximises INTERSTELLAR freight (trade between stars) at the cost of raw lift.',
        inputs: [
          { good: 'spaceships', amount: 6 },
          { good: 'fuel', amount: 180 },
          { good: 'electricity', amount: 220 },
        ],
        outputs: [{ good: 'transportation', amount: 800 }],
        jobs: [
          { class: 'labor', count: 90 },
          { class: 'technical', count: 140 },
          { class: 'professional', count: 90 },
        ],
      },
    ],
  },

  // A space elevator's ground anchor: a tethered ribbon to orbit. Paired with an
  // orbital tether module on a starbase/ring over the same world it gives huge,
  // fuel-free LAUNCH capacity (economy/transport.ts); alone it still helps.
  // Gated by Orbital Tethers (data/techData.ts).
  spaceElevatorAnchor: {
    id: 'spaceElevatorAnchor',
    label: 'Space Elevator Anchor',
    category: 'services',
    requiresTech: 'orbital-tethers',
    methods: [
      {
        id: 'standard',
        label: 'Tether Ribbon',
        description: 'A ground anchor and climber station for a tether to orbit — fuel-free lift when paired with an orbital tether above.',
        inputs: [
          { good: 'semiconductors', amount: 10 },
          { good: 'electricalMachinery', amount: 8 },
          { good: 'electricity', amount: 300 },
        ],
        outputs: [{ good: 'transportation', amount: 400 }],
        jobs: [
          { class: 'technical', count: 100 },
          { class: 'professional', count: 80 },
        ],
      },
    ],
  },

  // ---------------- Services ----------------
  seaport: {
    id: 'seaport',
    label: 'Seaport',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Harbour & Shipping',
        description: 'Docks and ocean-going ships carry freight along a world’s coasts and across its seas — strong infrastructure and freight capacity, on a world with sea.',
        inputs: [
          { good: 'oceanGoingShips', amount: 8 },
          { good: 'fuel', amount: 120 },
          { good: 'electricity', amount: 100 },
        ],
        outputs: [{ good: 'transportation', amount: 800 }],
        jobs: [
          { class: 'labor', count: 200 },
          { class: 'technical', count: 60 },
        ],
      },
    ],
  },
  urbanCenter: {
    id: 'urbanCenter',
    label: 'Urban Center',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'City District',
        description: 'A dense urban core of roads, transit and commerce. Automobiles and power keep a city moving and trading — it runs on the cars its people drive.',
        inputs: [
          { good: 'automobiles', amount: 28 },
          { good: 'fuel', amount: 80 },
          { good: 'electricity', amount: 200 },
        ],
        outputs: [
          { good: 'transportation', amount: 350 },
          { good: 'retail', amount: 650 },
        ],
        jobs: [
          { class: 'labor', count: 150 },
          { class: 'professional', count: 220 },
          { class: 'technical', count: 70 },
        ],
      },
    ],
  },
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
        outputs: [
          { good: 'healthcare', amount: 560 },
          { good: 'dental', amount: 180 },
        ],
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
        outputs: [
          { good: 'healthcare', amount: 950 },
          { good: 'dental', amount: 300 },
        ],
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
  // The grand research institution — a tier above the Schools (which teach the
  // population; see `school`) and distinct from them: the University drives the
  // SCIENCES across all three trees (the biggest broad source in
  // economy/research.ts) and sells its higher-education and research work as
  // online services, rather than schooling. Buildable, never auto-seeded.
  university: {
    id: 'university',
    label: 'University',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Research University',
        description: 'Lecture halls, graduate schools and research institutes together. The grandest seat of learning — above all it drives the sciences, the largest broad source of research a world can build, and publishes its work as online services.',
        inputs: [
          { good: 'consumerGoods', amount: 200 },
          { good: 'electricity', amount: 320 },
          { good: 'electronics', amount: 50 },
          { good: 'precisionMachinery', amount: 20 },
        ],
        outputs: [{ good: 'onlineServices', amount: 760 }],
        jobs: [
          { class: 'technical', count: 140 },
          { class: 'professional', count: 320 },
          { class: 'investor', count: 20 },
        ],
      },
    ],
  },
  // Dedicated research laboratories — one per tree. Each is the best single-tree
  // research producer (economy/research.ts), above the broad University per tree,
  // and sells its findings as online services (data, publications). Buildable, not
  // auto-seeded (online services is emergent, so the seed never reaches for them).
  physicsLab: {
    id: 'physicsLab',
    label: 'Physics Laboratory',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Physics Research',
        description: 'Particle accelerators, cryostats and theory groups pushing the physical sciences — the strongest single source of Physics research.',
        inputs: [
          { good: 'electricity', amount: 240 },
          { good: 'electronics', amount: 40 },
          { good: 'precisionMachinery', amount: 25 },
        ],
        outputs: [{ good: 'onlineServices', amount: 340 }],
        jobs: [
          { class: 'professional', count: 200 },
          { class: 'technical', count: 90 },
          { class: 'investor', count: 10 },
        ],
      },
    ],
  },
  engineeringLab: {
    id: 'engineeringLab',
    label: 'Engineering Laboratory',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Applied Engineering',
        description: 'Test rigs, prototyping shops and materials labs turning theory into hardware — the strongest single source of Engineering research.',
        inputs: [
          { good: 'electricity', amount: 240 },
          { good: 'electronics', amount: 40 },
          { good: 'machinery', amount: 30 },
        ],
        outputs: [{ good: 'onlineServices', amount: 340 }],
        jobs: [
          { class: 'professional', count: 180 },
          { class: 'technical', count: 110 },
          { class: 'investor', count: 10 },
        ],
      },
    ],
  },
  socialInstitute: {
    id: 'socialInstitute',
    label: 'Institute of Social Research',
    category: 'services',
    methods: [
      {
        id: 'standard',
        label: 'Social Research',
        description: 'Economists, sociologists and policy scholars studying how societies work — the strongest single source of Society research.',
        inputs: [
          { good: 'electricity', amount: 200 },
          { good: 'consumerGoods', amount: 60 },
          { good: 'electronics', amount: 30 },
        ],
        outputs: [{ good: 'onlineServices', amount: 340 }],
        jobs: [
          { class: 'professional', count: 210 },
          { class: 'technical', count: 70 },
          { class: 'investor', count: 10 },
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
        description: 'Banks, exchanges and brokerages. A lean overhead — the financial district earns its keep MANAGING the country\'s investment pool (a fee on the capital it stewards), not from this building.',
        inputs: [
          { good: 'consumerGoods', amount: 35 },
          { good: 'electricity', amount: 45 },
        ],
        outputs: [{ good: 'retail', amount: 400 }],
        // A small professional staff. (No investor "jobs": investor pops draw
        // dividends, not wages, and never fill building slots.)
        jobs: [
          { class: 'professional', count: 60 },
          { class: 'technical', count: 25 },
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
