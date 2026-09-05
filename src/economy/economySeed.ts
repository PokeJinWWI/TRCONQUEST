import { GOODS, GOOD_IDS, type GoodId } from './goods'
import { POP_CLASSES, RECIPES, getMethod, type PopClass } from './recipes'
import { DEPLETABLE_GOODS } from './economyTick'
import { governorAppointmentDef, type CentralBank } from './centralBank'
import type { ReligionMix } from './demographics'
import type {
  Building,
  BuildingOwner,
  Character,
  Corporation,
  Country,
  Family,
  LaborMarket,
  Market,
  Pop,
  World,
} from './economyTypes'

// Seed for the merged economy (design doc v2). Population is in MILLIONS. Pops
// span the four axes (a cohort per class × religion per world). Buildings now
// form real chains with power, and each is owned by the state, a corporation,
// or its own workers. Two seed corporations demonstrate the ownership layer:
// the Martian Restoration Administration (a state agri-corp) and Redmines (a
// private mining company), each with a leader character and a family.

// --- Corporation ids referenced by building ownership below ---
const MRA = 'mra'
const REDMINES = 'redmines'

// Starting education by class — higher classes arrive more schooled, so the
// technical/professional job rungs (which demand qualification) start staffed.
const CLASS_EDUCATION: Record<PopClass, number> = {
  subsistence: 0.05,
  labor: 0.2,
  technical: 0.5,
  professional: 0.85,
  investor: 0.9,
  political: 0.7,
}

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
    wealth: size * 4,
    educationLevel: CLASS_EDUCATION[cls],
    standardOfLiving: 0.5,
    needsSatisfaction: { basic: 1, everyday: 1, healthcare: 1, comfort: 1, luxury: 1 },
  }
}

// Ownership shorthand used in building specs: 'state' | 'worker' | a corp id.
function resolveOwner(tag: string | undefined): BuildingOwner {
  if (!tag || tag === 'state') return { kind: 'state' }
  if (tag === 'worker') return { kind: 'worker' }
  return { kind: 'corporation', corporationId: tag }
}

let buildingCounter = 0
function makeBuilding(worldId: string, recipeId: string, level: number, owner: string | undefined, methodId?: string): Building {
  buildingCounter += 1
  const method = getMethod(recipeId, methodId)
  const inventory: Building['inventory'] = {}
  // Seeded buildings are established: full throughput and a tick of output on
  // hand, so the starting economy is productive from tick one.
  if (method) for (const out of method.outputs) inventory[out.good] = out.amount * level
  return {
    id: `bld-${worldId}-${recipeId}-${buildingCounter}`,
    recipeId,
    methodId: method?.id ?? '',
    methodLocked: false,
    level,
    owner: resolveOwner(owner),
    inventory,
    throughput: 1,
    lastProfit: 0,
    employed: 0,
    jobsPosted: 0,
  }
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

const CLASS_SPLIT: Record<PopClass, number> = {
  subsistence: 0.15,
  labor: 0.38,
  technical: 0.18,
  professional: 0.12,
  investor: 0.07,
  political: 0.1,
}

interface BuildingSpec {
  recipe: string
  level: number
  owner?: string
  method?: string
}
interface WorldSpec {
  id: string
  ownerId: string
  culture: string
  species: string
  population: number
  capacity: number
  religions: ReligionMix
  buildings: BuildingSpec[]
}

// Seeded deposits are a large-but-finite multiple of current per-tick output —
// slow long-game depletion pressure, not a near-term crisis. At ~800 ticks
// (~66 years of monthly ticks) worth of output, a normal play session (dozens
// to low hundreds of ticks) won't come close to exhausting one.
const DEPOSIT_TICK_MULTIPLE = 800

// Sum each depletable good's current per-tick output across a world's
// extraction buildings (at their SEEDED method/level) and seed a deposit that
// many ticks deep.
function seedDeposits(buildings: Building[]): Partial<Record<GoodId, number>> {
  const perTick: Partial<Record<GoodId, number>> = {}
  for (const b of buildings) {
    if (RECIPES[b.recipeId]?.category !== 'extraction') continue
    const method = getMethod(b.recipeId, b.methodId)
    if (!method) continue
    for (const out of method.outputs) {
      if (!DEPLETABLE_GOODS.includes(out.good)) continue
      perTick[out.good] = (perTick[out.good] ?? 0) + out.amount * b.level
    }
  }
  const deposits: Partial<Record<GoodId, number>> = {}
  for (const [good, amount] of Object.entries(perTick)) deposits[good as GoodId] = amount * DEPOSIT_TICK_MULTIPLE
  return deposits
}

function buildWorld(spec: WorldSpec): World {
  const pops: Pop[] = []
  for (const cls of POP_CLASSES) {
    const classPop = spec.population * CLASS_SPLIT[cls]
    if (classPop <= 0) continue
    for (const r of spec.religions) {
      const size = classPop * r.share
      if (size <= 0) continue
      pops.push(makePop(spec.id, cls, spec.species, spec.culture, r.religion, size))
    }
  }
  const buildings = spec.buildings.map((b) => makeBuilding(spec.id, b.recipe, b.level, b.owner, b.method))
  return {
    id: spec.id,
    name: spec.id,
    ownerId: spec.ownerId,
    cultureId: spec.culture,
    populationCapacity: spec.capacity,
    // District slots scale with population, sized to hold the seed with headroom.
    districtCapacity: {
      core: Math.max(12, Math.round(spec.population / 400)),
      urban: Math.max(10, Math.round(spec.population / 250)),
      industrial: Math.max(16, Math.round(spec.population / 72)),
      resource: Math.max(12, Math.round(spec.population / 130)),
    },
    pops,
    buildings,
    constructionQueue: [],
    market: seedMarket(),
    labor: seedLabor(),
    importStock: {},
    resourceDeposits: seedDeposits(buildings),
  }
}

const WORLDS: World[] = [
  // Imperial State of Mars — the showcase world with the full chain.
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
      // Power (state) — the grid the whole chain runs on.
      { recipe: 'solarPlant', level: 5 },
      { recipe: 'coalPowerPlant', level: 3 },
      // Extraction — Redmines (private) runs the mines; timber is worker-owned.
      { recipe: 'coalMine', level: 4, owner: REDMINES },
      { recipe: 'ironMine', level: 3, owner: REDMINES },
      { recipe: 'oilWell', level: 2, owner: REDMINES },
      { recipe: 'phosphateMine', level: 2, owner: REDMINES },
      { recipe: 'rareMetalsMine', level: 1, owner: REDMINES },
      { recipe: 'loggingCamp', level: 2, owner: 'worker' },
      { recipe: 'sulfurMine', level: 1, owner: REDMINES },
      { recipe: 'hardwoodLogging', level: 1, owner: 'worker' },
      // Agriculture — the Martian Restoration Administration (state corp).
      { recipe: 'wheatFarm', level: 4, owner: MRA },
      { recipe: 'riceFarm', level: 2, owner: MRA },
      { recipe: 'livestockRanch', level: 2, owner: MRA },
      // Industry (state unless noted).
      { recipe: 'steelMill', level: 4 },
      { recipe: 'sawmill', level: 1, owner: 'worker' },
      { recipe: 'chemicalPlant', level: 1 },
      { recipe: 'fertilizerPlant', level: 1 },
      { recipe: 'toolWorkshop', level: 4 },
      { recipe: 'machineryFactory', level: 3 },
      { recipe: 'heavyMachineryPlant', level: 1 },
      { recipe: 'electricalMachineryPlant', level: 1 },
      { recipe: 'precisionMachineryPlant', level: 1 },
      { recipe: 'foodProcessor', level: 3, owner: MRA },
      { recipe: 'meatPacking', level: 1, owner: MRA },
      { recipe: 'consumerGoodsFactory', level: 3, owner: 'worker' },
      { recipe: 'semiconductorFab', level: 1 },
      { recipe: 'electronicsFactory', level: 1 },
      { recipe: 'luxuryFactory', level: 1 },
      { recipe: 'oilRefinery', level: 1 },
      { recipe: 'dyeWorks', level: 1 },
      { recipe: 'glassworks', level: 1 },
      { recipe: 'cementWorks', level: 1 },
      { recipe: 'constructionSector', level: 2 },
      { recipe: 'paperMill', level: 1 },
      { recipe: 'shipyard', level: 1 },
      { recipe: 'spaceyard', level: 1 },
      { recipe: 'rocketFactory', level: 1 },
      // Engines & vehicles.
      { recipe: 'engineFactory', level: 1 },
      { recipe: 'automobilePlant', level: 1 },
      { recipe: 'locomotiveWorks', level: 1 },
      { recipe: 'aircraftFactory', level: 1 },
      // Services + infrastructure.
      { recipe: 'clinic', level: 3 },
      { recipe: 'school', level: 2 },
      { recipe: 'retailShop', level: 2 },
      { recipe: 'roadNetwork', level: 2 },
      { recipe: 'railway', level: 1 },
      { recipe: 'spaceport', level: 1 },
      // Government — produces the bureaucracy the state runs on.
      { recipe: 'ministry', level: 2 },
      { recipe: 'governmentOffice', level: 2 },
      // Corporate head offices (overhead that scales with the company).
      { recipe: 'corporateHq', level: 1, owner: MRA },
      { recipe: 'corporateHq', level: 2, owner: REDMINES },
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
      { recipe: 'solarPlant', level: 1 },
      { recipe: 'coalMine', level: 1, owner: 'worker' },
      { recipe: 'ironMine', level: 1, owner: 'worker' },
      { recipe: 'wheatFarm', level: 1 },
      { recipe: 'foodProcessor', level: 1 },
      { recipe: 'steelMill', level: 1 },
      { recipe: 'toolWorkshop', level: 1 },
      { recipe: 'machineryFactory', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 1 },
      { recipe: 'clinic', level: 1 },
      { recipe: 'roadNetwork', level: 1 },
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
      { recipe: 'solarPlant', level: 3 },
      { recipe: 'coalPowerPlant', level: 2 },
      { recipe: 'coalMine', level: 3, owner: 'worker' },
      { recipe: 'ironMine', level: 2, owner: 'worker' },
      { recipe: 'oilWell', level: 1 },
      { recipe: 'wheatFarm', level: 3 },
      { recipe: 'foodProcessor', level: 2 },
      { recipe: 'steelMill', level: 3 },
      { recipe: 'toolWorkshop', level: 2 },
      { recipe: 'machineryFactory', level: 2 },
      { recipe: 'chemicalPlant', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 2 },
      { recipe: 'clinic', level: 2 },
      { recipe: 'roadNetwork', level: 1 },
      { recipe: 'school', level: 1 },
      { recipe: 'retailShop', level: 2 },
      { recipe: 'artStudio', level: 1 },
      { recipe: 'dataCenter', level: 1 },
      { recipe: 'cementWorks', level: 1 },
      { recipe: 'constructionSector', level: 1 },
      { recipe: 'governmentOffice', level: 2 },
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
      { recipe: 'solarPlant', level: 2 },
      { recipe: 'coalPowerPlant', level: 1 },
      { recipe: 'coalMine', level: 2, owner: 'worker' },
      { recipe: 'ironMine', level: 1, owner: 'worker' },
      { recipe: 'loggingCamp', level: 1, owner: 'worker' },
      { recipe: 'wheatFarm', level: 2 },
      { recipe: 'sugarPlantation', level: 1 },
      { recipe: 'coffeePlantation', level: 1 },
      { recipe: 'teaPlantation', level: 1 },
      { recipe: 'foodProcessor', level: 1 },
      { recipe: 'cementWorks', level: 1 },
      { recipe: 'constructionSector', level: 1 },
      { recipe: 'sawmill', level: 1, owner: 'worker' },
      { recipe: 'steelMill', level: 2 },
      { recipe: 'toolWorkshop', level: 1 },
      { recipe: 'machineryFactory', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 1 },
      { recipe: 'clinic', level: 1 },
      { recipe: 'roadNetwork', level: 1 },
      { recipe: 'retailShop', level: 1 },
      { recipe: 'governmentOffice', level: 1 },
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
      { recipe: 'solarPlant', level: 1 },
      { recipe: 'coalMine', level: 1 },
      { recipe: 'ironMine', level: 1, owner: 'worker' },
      { recipe: 'wheatFarm', level: 1 },
      { recipe: 'foodProcessor', level: 1 },
      { recipe: 'steelMill', level: 1 },
      { recipe: 'toolWorkshop', level: 1 },
      { recipe: 'machineryFactory', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 1 },
      { recipe: 'clinic', level: 1 },
      { recipe: 'roadNetwork', level: 1 },
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
      { recipe: 'solarPlant', level: 3 },
      { recipe: 'coalPowerPlant', level: 2 },
      { recipe: 'coalMine', level: 3 },
      { recipe: 'ironMine', level: 2 },
      { recipe: 'phosphateMine', level: 1 },
      { recipe: 'wheatFarm', level: 3 },
      { recipe: 'riceFarm', level: 1 },
      { recipe: 'foodProcessor', level: 2 },
      { recipe: 'steelMill', level: 3 },
      { recipe: 'toolWorkshop', level: 2 },
      { recipe: 'machineryFactory', level: 2 },
      { recipe: 'fertilizerPlant', level: 1 },
      { recipe: 'cementWorks', level: 1 },
      { recipe: 'constructionSector', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 2 },
      { recipe: 'clinic', level: 2 },
      { recipe: 'roadNetwork', level: 1 },
      { recipe: 'school', level: 1 },
      { recipe: 'retailShop', level: 2 },
      { recipe: 'governmentOffice', level: 2 },
    ],
  }),
]

// Seed a central bank for a country. Each of the four powers runs a distinct
// monetary institution so the models read differently from the start — a
// government-directed development bank, an independent price-stability bank, a
// federal reserve system, etc. `governorTermLength` follows the appointment law.
function seedCentralBank(countryId: string, name: string, cb: Omit<CentralBank, 'countryId' | 'name' | 'governorTermStart' | 'governorTermLength'>): CentralBank {
  return {
    countryId,
    name,
    governorTermStart: 0,
    governorTermLength: governorAppointmentDef(cb.appointment).termTicks,
    ...cb,
  }
}

// Every state starts with existing national debt (bonds outstanding) — no one
// runs a balanced budget from a standing start.
const COUNTRIES: Country[] = [
  {
    id: 'imperial-state-of-mars',
    taxRate: 0.1,
    welfarePerCapita: 2.0,
    treasury: 100000,
    economicSystem: 'interventionism',
    healthcareSystem: 'public',
    bonds: { pops: 60000, corporations: 30000, foreign: 20000 },
    bondRate: 0.004,
    foreignBondPolicy: 'approval',
    foreignInvestmentPolicy: 'approval',
    foreignInvestmentAutoApprove: false,
    pendingForeignInvestment: [],
    requireForeignApproval: true,
    pendingForeign: [],
    bureaucracy: 3500,
    decrees: [],
    logisticsCapacity: 6000,
    subsidies: { corporations: {}, buildings: {} },
    investmentPool: 40000,
    centralBank: seedCentralBank('imperial-state-of-mars', 'Imperial Reserve of Mars', {
      status: 'state-bank',
      structure: 'regional-branches',
      policyAuthority: 'governor',
      appointment: 'head-of-state',
      mandate: 'multiple',
      debtFinancing: 'supported',
      exchangeRegime: 'managed',
      credibility: 0.6,
      governmentPressure: 0.1,
      governorName: 'Gov. Adaeze Okonkwo',
      policyRate: 0.03,
      reserveRequirement: 0.1,
    }),
  },
  {
    id: 'republic-of-venus',
    taxRate: 0.12,
    welfarePerCapita: 2.0,
    treasury: 50000,
    economicSystem: 'laissez-faire',
    healthcareSystem: 'mixed',
    bonds: { pops: 30000, corporations: 25000, foreign: 15000 },
    bondRate: 0.0045,
    foreignBondPolicy: 'open',
    foreignInvestmentPolicy: 'open',
    foreignInvestmentAutoApprove: false,
    pendingForeignInvestment: [],
    requireForeignApproval: false,
    pendingForeign: [],
    bureaucracy: 3500,
    decrees: [],
    logisticsCapacity: 6000,
    subsidies: { corporations: {}, buildings: {} },
    investmentPool: 40000,
    centralBank: seedCentralBank('republic-of-venus', 'Venusian Federal Reserve', {
      status: 'highly-independent',
      structure: 'federal-reserve',
      policyAuthority: 'mpc',
      appointment: 'staggered',
      mandate: 'price',
      debtFinancing: 'secondary-only',
      exchangeRegime: 'float',
      credibility: 0.85,
      governmentPressure: 0,
      governorName: 'Chair Lena Vasquez',
      policyRate: 0.025,
      reserveRequirement: 0.08,
    }),
  },
  {
    id: 'orion-republic',
    taxRate: 0.09,
    welfarePerCapita: 1.7,
    treasury: 30000,
    economicSystem: 'laissez-faire',
    healthcareSystem: 'private',
    bonds: { pops: 18000, corporations: 12000, foreign: 8000 },
    bondRate: 0.0042,
    foreignBondPolicy: 'open',
    foreignInvestmentPolicy: 'open',
    foreignInvestmentAutoApprove: false,
    pendingForeignInvestment: [],
    requireForeignApproval: false,
    pendingForeign: [],
    bureaucracy: 3500,
    decrees: [],
    logisticsCapacity: 6000,
    subsidies: { corporations: {}, buildings: {} },
    investmentPool: 40000,
    centralBank: seedCentralBank('orion-republic', 'Bank of Orion', {
      status: 'independent',
      structure: 'single',
      policyAuthority: 'board',
      appointment: 'fixed-term',
      mandate: 'currency',
      debtFinancing: 'prohibited',
      exchangeRegime: 'float',
      credibility: 0.75,
      governmentPressure: 0,
      governorName: 'Gov. Toma Ilyich',
      policyRate: 0.035,
      reserveRequirement: 0.12,
    }),
  },
  {
    id: 'kingdom-of-lalande',
    taxRate: 0.1,
    welfarePerCapita: 1.7,
    treasury: 45000,
    economicSystem: 'command',
    healthcareSystem: 'public',
    bonds: { pops: 40000, corporations: 20000, foreign: 0 },
    bondRate: 0.004,
    foreignBondPolicy: 'closed',
    foreignInvestmentPolicy: 'closed',
    foreignInvestmentAutoApprove: false,
    pendingForeignInvestment: [],
    requireForeignApproval: true,
    pendingForeign: [],
    bureaucracy: 3500,
    decrees: [],
    logisticsCapacity: 6000,
    subsidies: { corporations: {}, buildings: {} },
    investmentPool: 40000,
    centralBank: seedCentralBank('kingdom-of-lalande', 'Lalande State Monetary Directorate', {
      status: 'treasury-office',
      structure: 'single',
      policyAuthority: 'finance-ministry',
      appointment: 'government',
      mandate: 'development',
      debtFinancing: 'direct',
      exchangeRegime: 'fixed',
      credibility: 0.35,
      governmentPressure: 0.5,
      governorName: 'Minister Hal Renner',
      policyRate: 0.02,
      reserveRequirement: 0.06,
    }),
  },
]

// --- Characters, families, corporations ---
const FAMILIES: Family[] = [
  { id: 'fam-vance', name: 'Vance', memberIds: ['char-aurelia-vance', 'char-marcus-vance', 'char-lucia-vance'], prestige: 62 },
  { id: 'fam-kessler', name: 'Kessler', memberIds: ['char-doran-kessler', 'char-serit-kessler'], prestige: 48 },
]

const CHARACTERS: Character[] = [
  {
    id: 'char-aurelia-vance',
    name: 'Aurelia Vance',
    familyId: 'fam-vance',
    age: 54,
    role: 'corp-leader',
    corporationId: MRA,
    cultureId: 'martian',
    religionId: 'imperial-church-of-mars',
    speciesTemplateId: 'baseline-organic',
    traits: ['Diligent', 'Reformer', 'Incorruptible'],
    wealth: 320,
    skills: { administration: 8, finance: 6, diplomacy: 5 },
    log: ['Appointed Director of the Martian Restoration Administration.'],
  },
  {
    id: 'char-marcus-vance',
    name: 'Marcus Vance',
    familyId: 'fam-vance',
    age: 57,
    role: 'unaffiliated',
    cultureId: 'martian',
    religionId: 'imperial-church-of-mars',
    speciesTemplateId: 'baseline-organic',
    traits: ['Content'],
    wealth: 140,
    skills: { administration: 3, finance: 4, diplomacy: 6 },
    log: [],
  },
  {
    id: 'char-lucia-vance',
    name: 'Lucia Vance',
    familyId: 'fam-vance',
    age: 24,
    role: 'unaffiliated',
    cultureId: 'martian',
    religionId: 'martian-buddhist',
    speciesTemplateId: 'baseline-organic',
    traits: ['Ambitious', 'Brilliant'],
    wealth: 60,
    skills: { administration: 6, finance: 7, diplomacy: 4 },
    log: ['Heir to the Vance name.'],
  },
  {
    id: 'char-doran-kessler',
    name: 'Doran Kessler',
    familyId: 'fam-kessler',
    age: 49,
    role: 'corp-leader',
    corporationId: REDMINES,
    cultureId: 'martian',
    religionId: 'non-affiliated',
    speciesTemplateId: 'baseline-organic',
    traits: ['Greedy', 'Shrewd', 'Ruthless'],
    wealth: 900,
    skills: { administration: 6, finance: 9, diplomacy: 3 },
    log: ['Founder and majority owner of Redmines.'],
  },
  {
    id: 'char-serit-kessler',
    name: 'Serit Kessler',
    familyId: 'fam-kessler',
    age: 46,
    role: 'unaffiliated',
    cultureId: 'martian',
    religionId: 'non-affiliated',
    speciesTemplateId: 'baseline-organic',
    traits: ['Gregarious'],
    wealth: 210,
    skills: { administration: 4, finance: 5, diplomacy: 7 },
    log: [],
  },
]

const CORPORATIONS: Corporation[] = [
  {
    id: MRA,
    name: 'Martian Restoration Administration',
    countryId: 'imperial-state-of-mars',
    kind: 'state',
    cash: 8000,
    totalShares: 1000,
    // A state corporation: the government holds every share.
    shares: [{ holder: { kind: 'state' }, shares: 1000 }],
    leaderId: 'char-aurelia-vance',
    lastProfit: 0,
    sector: 'Agriculture',
  },
  {
    id: REDMINES,
    name: 'Redmines',
    countryId: 'imperial-state-of-mars',
    kind: 'private',
    cash: 12000,
    totalShares: 1000,
    // Private: the founder holds a controlling block, the rest floats publicly.
    shares: [
      { holder: { kind: 'character', id: 'char-doran-kessler' }, shares: 520 },
      { holder: { kind: 'public' }, shares: 480 },
    ],
    leaderId: 'char-doran-kessler',
    lastProfit: 0,
    sector: 'Mining',
  },
]

// --- Financial districts (auto-form on any world with ≥100M pop) ---
// Each is a co-op-like institutional entity (kind 'financial') that owns a
// Financial Center building on its world and holds a stake in its country's
// private corporations. Generated from the world roster so it stays in sync.
const FD_MIN_POP = 100 // 100M people
const FD_LEADERS = ['Halvard Renn', 'Ives Marlowe', 'Sora Quist', 'Dane Voss', 'Priya Ander', 'Lorne Sable']
const FD_STAKE = 0.15 // share of a private corp the financial district holds

interface FinancialDistrictSeed {
  districts: Corporation[]
  characters: Character[]
  buildingByWorld: Map<string, Building>
  capitalFdByCountry: Map<string, string>
}
function makeFinancialDistricts(): FinancialDistrictSeed {
  const districts: Corporation[] = []
  const characters: Character[] = []
  const buildingByWorld = new Map<string, Building>()
  const capitalFdByCountry = new Map<string, string>()
  let n = 0
  for (const w of WORLDS) {
    const pop = w.pops.reduce((s, p) => s + p.populationSize, 0)
    if (pop < FD_MIN_POP) continue
    n += 1
    const fdId = `fd-${w.id.replace(/\s+/g, '-').toLowerCase()}`
    const leaderId = `char-fd-${n}`
    characters.push({
      id: leaderId,
      name: FD_LEADERS[(n - 1) % FD_LEADERS.length],
      age: 44 + n,
      role: 'corp-leader',
      corporationId: fdId,
      cultureId: w.cultureId,
      religionId: 'non-affiliated',
      speciesTemplateId: w.pops[0]?.speciesTemplateId ?? 'baseline-organic',
      traits: ['Shrewd', 'Cautious'],
      wealth: 500,
      skills: { administration: 5, finance: 8, diplomacy: 5 },
      log: [`Chairs the ${w.id} Financial District.`],
    })
    districts.push({
      id: fdId,
      name: `${w.id} Financial District`,
      countryId: w.ownerId,
      kind: 'financial',
      cash: Math.round(pop * 6),
      totalShares: 1000,
      // Publicly/collectively held — the district is a co-op, not a company.
      shares: [{ holder: { kind: 'public' }, shares: 1000 }],
      leaderId,
      lastProfit: 0,
      sector: 'Finance',
    })
    buildingByWorld.set(w.id, makeBuilding(w.id, 'financialCenter', Math.max(1, Math.round(pop / 2500)), fdId))
    if (!capitalFdByCountry.has(w.ownerId)) capitalFdByCountry.set(w.ownerId, fdId)
  }
  return { districts, characters, buildingByWorld, capitalFdByCountry }
}
const FD = makeFinancialDistricts()

export function seedWorlds(): World[] {
  return WORLDS.map((w) => {
    const fdBuilding = FD.buildingByWorld.get(w.id)
    const buildings = fdBuilding ? [...w.buildings, fdBuilding] : [...w.buildings]
    return { ...w, pops: [...w.pops], buildings, importStock: {}, resourceDeposits: { ...w.resourceDeposits } }
  })
}
export function seedCountries(): Country[] {
  return COUNTRIES.map((c) => ({ ...c }))
}
export function seedCorporations(): Corporation[] {
  // Base corporations, with private ones giving their country's capital
  // financial district a minority stake taken from the public float.
  const base = CORPORATIONS.map((c) => {
    if (c.kind !== 'private') return { ...c, shares: c.shares.map((s) => ({ ...s })) }
    const fdId = FD.capitalFdByCountry.get(c.countryId)
    if (!fdId) return { ...c, shares: c.shares.map((s) => ({ ...s })) }
    const stake = Math.round(c.totalShares * FD_STAKE)
    const shares = c.shares
      .map((s) => (s.holder.kind === 'public' ? { ...s, shares: Math.max(0, s.shares - stake) } : { ...s }))
      .concat([{ holder: { kind: 'financial', id: fdId }, shares: stake }])
    return { ...c, shares }
  })
  const fds = FD.districts.map((d) => ({ ...d, shares: d.shares.map((s) => ({ ...s })) }))
  return [...base, ...fds]
}
export function seedCharacters(): Character[] {
  return [...CHARACTERS, ...FD.characters].map((c) => ({ ...c, traits: [...c.traits], log: [...c.log], skills: { ...c.skills } }))
}
export function seedFamilies(): Family[] {
  return FAMILIES.map((f) => ({ ...f, memberIds: [...f.memberIds] }))
}
