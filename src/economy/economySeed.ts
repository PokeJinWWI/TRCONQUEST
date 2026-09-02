import { GOODS, GOOD_IDS } from './goods'
import { POP_CLASSES, getMethod, type PopClass } from './recipes'
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
  return {
    id: spec.id,
    name: spec.id,
    ownerId: spec.ownerId,
    cultureId: spec.culture,
    populationCapacity: spec.capacity,
    // District slots scale with population, sized to hold the seed with headroom.
    districtCapacity: {
      core: Math.max(8, Math.round(spec.population / 500)),
      urban: Math.max(10, Math.round(spec.population / 250)),
      industrial: Math.max(12, Math.round(spec.population / 130)),
      resource: Math.max(12, Math.round(spec.population / 130)),
    },
    pops,
    buildings: spec.buildings.map((b) => makeBuilding(spec.id, b.recipe, b.level, b.owner, b.method)),
    constructionQueue: [],
    market: seedMarket(),
    labor: seedLabor(),
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
      // Agriculture — the Martian Restoration Administration (state corp).
      { recipe: 'wheatFarm', level: 4, owner: MRA },
      { recipe: 'riceFarm', level: 2, owner: MRA },
      { recipe: 'livestockRanch', level: 2, owner: MRA },
      // Industry (state unless noted).
      { recipe: 'steelMill', level: 3 },
      { recipe: 'sawmill', level: 1, owner: 'worker' },
      { recipe: 'chemicalPlant', level: 1 },
      { recipe: 'fertilizerPlant', level: 1 },
      { recipe: 'machineryFactory', level: 1 },
      { recipe: 'foodProcessor', level: 3, owner: MRA },
      { recipe: 'consumerGoodsFactory', level: 3, owner: 'worker' },
      { recipe: 'semiconductorFab', level: 1 },
      { recipe: 'electronicsFactory', level: 1 },
      { recipe: 'luxuryFactory', level: 1 },
      // Services.
      { recipe: 'clinic', level: 3 },
      { recipe: 'school', level: 2 },
      { recipe: 'retailShop', level: 2 },
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
      { recipe: 'consumerGoodsFactory', level: 1 },
      { recipe: 'clinic', level: 1 },
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
      { recipe: 'steelMill', level: 2 },
      { recipe: 'chemicalPlant', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 2 },
      { recipe: 'clinic', level: 2 },
      { recipe: 'school', level: 1 },
      { recipe: 'retailShop', level: 2 },
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
      { recipe: 'foodProcessor', level: 1 },
      { recipe: 'sawmill', level: 1, owner: 'worker' },
      { recipe: 'steelMill', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 1 },
      { recipe: 'clinic', level: 1 },
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
      { recipe: 'consumerGoodsFactory', level: 1 },
      { recipe: 'clinic', level: 1 },
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
      { recipe: 'steelMill', level: 2 },
      { recipe: 'fertilizerPlant', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 2 },
      { recipe: 'clinic', level: 2 },
      { recipe: 'school', level: 1 },
      { recipe: 'retailShop', level: 2 },
      { recipe: 'governmentOffice', level: 2 },
    ],
  }),
]

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
    requireForeignApproval: true,
    pendingForeign: [],
    bureaucracy: 3500,
    decrees: [],
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
    requireForeignApproval: false,
    pendingForeign: [],
    bureaucracy: 3500,
    decrees: [],
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
    requireForeignApproval: false,
    pendingForeign: [],
    bureaucracy: 3500,
    decrees: [],
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
    requireForeignApproval: true,
    pendingForeign: [],
    bureaucracy: 3500,
    decrees: [],
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

export function seedWorlds(): World[] {
  return WORLDS.map((w) => ({ ...w, pops: [...w.pops], buildings: [...w.buildings] }))
}
export function seedCountries(): Country[] {
  return COUNTRIES.map((c) => ({ ...c }))
}
export function seedCorporations(): Corporation[] {
  return CORPORATIONS.map((c) => ({ ...c, shares: c.shares.map((s) => ({ ...s })) }))
}
export function seedCharacters(): Character[] {
  return CHARACTERS.map((c) => ({ ...c, traits: [...c.traits], log: [...c.log], skills: { ...c.skills } }))
}
export function seedFamilies(): Family[] {
  return FAMILIES.map((f) => ({ ...f, memberIds: [...f.memberIds] }))
}
