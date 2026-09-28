import { GOODS, GOOD_IDS, type GoodId } from './goods'
import { BUREAUCRACY_OUTPUT, DISTRICT_TYPES, POP_CLASSES, RECIPES, districtOfRecipe, getMethod, qualificationFraction, type DistrictType, type PopClass } from './recipes'
import { SLOTS_PER_DISTRICT_LEVEL } from './districts'
import { landForBody } from '../scene/bodyLand'
import { COUNTRIES as NATIONS } from '../data/countryData'
import { COUNTRY_CALIBRATION, SEED_CALIBRATION, type CountryCalibration, type SeedCalibration, type WorldCalibration } from './seedCalibration'
import { CLASS_PAY, LABOR_SHARE, WAGE_FLOOR, ADMIN_PER_BUILDING_LEVEL, BUREAUCRACY_PER_DECREE, BUREAUCRACY_PER_STATE_BUILDING_LEVEL, BUREAUCRACY_PER_STATECORP_BUILDING_LEVEL, CAPITAL_UPKEEP, DEPLETABLE_GOODS, GOVERNMENT_BASKET, isEmergentGood, JOB_SCALE, NEED_SCALE, PUBLIC_SPENDING_PER_CAPITA } from './economyTick'
import { NEED_TIERS, SPECIES_TEMPLATES, tierWealthFactor } from './species'
import { bodyGroundInfo, surfaceOf, TERRAIN_IDS } from '../scene/planetTerrain'
import { governorAppointmentDef, type CentralBank } from './centralBank'
import type { ReligionMix } from './demographics'
import type {
  Bank,
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
// Each nation's private spaceport & shipping operator: it runs half the
// nation's spaceports (and its seaports) — see withTransport.
const OPERATOR_OF: Record<string, string> = {
  'imperial-state-of-mars': 'tenku-koro',
  'republic-of-venus': 'kypris-astroporia',
  'orion-republic': 'arcadian-starlines',
  'kingdom-of-lalande': 'compagnie-stellaire',
}
// The laissez-faire nations (their seeded economicSystem, below): plants the
// seed adds to complete their supply chains are private (their operator's),
// not the state's — a free-market republic doesn't run its own mills, and each
// state building level costs bureaucracy.
const PRIVATE_LED = new Set(['republic-of-venus', 'orion-republic'])

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
  // Seeded buildings are established, with a month's output on hand: the
  // market clears BEFORE a month's production, so this is what's for sale in
  // month 1, as last month's output is every month after. (A quarter-month
  // left month 1 at a fifth of demand: prices jumped, firms sold little, the
  // budget lurched. buildWorld scales it to the run the building opens at.)
  if (method) for (const out of method.outputs) inventory[out.good] = out.amount * level * SEED_STOCK_TICKS
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

// Starting prices: base, or where a calibration found the world's markets settle.
function seedMarket(calibrated?: Partial<Record<GoodId, number>>): Market {
  const prices = {} as Market['prices']
  for (const g of GOOD_IDS) prices[g] = calibrated?.[g] ?? GOODS[g].basePrice
  return { prices }
}
// Starting wages by the same rule the tick bargains them by (economyTick's
// LABOR_SHARE and CLASS_PAY): the labour share of the value the world's
// buildings add, of which SEED_VALUE_REALIZED is expected to sell once markets
// settle. Wages only fall slowly (WAGE_CUT_MAX), so a seed far above this
// left every firm losing money for years.
const SEED_VALUE_REALIZED = 0.2
const SEED_STOCK_TICKS = 1
function seedLabor(spec: WorldSpec, split: Record<PopClass, number>): LaborMarket {
  let valueAdded = 0
  const jobs = {} as Record<PopClass, number>
  for (const cls of POP_CLASSES) jobs[cls] = 0
  for (const b of spec.buildings) {
    const m = getMethod(b.recipe, b.method ?? RECIPES[b.recipe]?.methods[0]?.id ?? '')
    if (!m) continue
    const run = b.level * (1 - (b.idle ?? 0))
    for (const o of m.outputs) valueAdded += o.amount * run * GOODS[o.good].basePrice
    for (const i of m.inputs) valueAdded -= i.amount * run * GOODS[i.good].basePrice
    for (const u of CAPITAL_UPKEEP) valueAdded -= u.amount * run * GOODS[u.good].basePrice
    for (const j of m.jobs) jobs[j.class] += j.count * run * JOB_SCALE
  }
  let payUnits = 0
  for (const cls of POP_CLASSES) payUnits += CLASS_PAY[cls] * Math.min(jobs[cls], spec.population * split[cls])
  const perUnit = payUnits > 0 ? (LABOR_SHARE * SEED_VALUE_REALIZED * Math.max(0, valueAdded)) / payUnits : 0
  const wages = {} as LaborMarket['wages']
  for (const cls of POP_CLASSES) wages[cls] = Math.max(WAGE_FLOOR, perUnit * CLASS_PAY[cls])
  return { wages }
}

// Starting ADOPTION for emergent goods (see economyTick's EMERGENT_GOODS): the
// established consumer durables are broadly adopted; luxuries have room to spread
// as worlds get richer. A good's demand is gated by this — stop supplying one and
// its adoption (and demand) decays; introduce a new one and it climbs from ~0.
function seedAdoption(): Partial<Record<GoodId, number>> {
  return { furniture: 0.8, electronics: 0.8, automobiles: 0.75, onlineServices: 0.7, luxuryGoods: 0.4, art: 0.35, aircraft: 0.3 }
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
  // Share of its capacity mothballed at the start (Building.idle): set by the
  // balancer where a nation needs less than one level of it.
  idle?: number
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

// A world's people by class, sized to its own jobs: each working class gets
// its jobs plus a little frictional slack, investors a small fixed share, and
// the rest are subsistence (the informal economy). Where the jobs outnumber the
// people, the working classes share what there is in proportion. A world with
// no jobs falls back to CLASS_SPLIT. (One global split left Mars with 727
// technicians for 1,601 technical jobs while half its other classes idled.)
const WORKING_CLASSES: PopClass[] = ['labor', 'technical', 'professional', 'political']
const FRICTIONAL_SLACK = 1.06
const INVESTOR_SHARE = 0.04
const MIN_SUBSISTENCE_SHARE = 0.08
function classSplitFor(spec: WorldSpec): Record<PopClass, number> {
  const jobs = {} as Record<PopClass, number>
  for (const cls of POP_CLASSES) jobs[cls] = 0
  for (const b of spec.buildings) {
    const m = getMethod(b.recipe, b.method ?? RECIPES[b.recipe]?.methods[0]?.id ?? '')
    for (const j of m?.jobs ?? []) jobs[j.class] += j.count * b.level * (1 - (b.idle ?? 0)) * JOB_SCALE
  }
  const want = WORKING_CLASSES.reduce((n, c) => n + jobs[c] * FRICTIONAL_SLACK, 0) + jobs.subsistence
  if (want <= 0 || spec.population <= 0) return CLASS_SPLIT
  const room = 1 - INVESTOR_SHARE - MIN_SUBSISTENCE_SHARE
  const scale = Math.min(1, (room * spec.population) / (want - jobs.subsistence))
  const split = {} as Record<PopClass, number>
  for (const cls of POP_CLASSES) split[cls] = 0
  for (const cls of WORKING_CLASSES) split[cls] = (jobs[cls] * FRICTIONAL_SLACK * scale) / spec.population
  split.investor = INVESTOR_SHARE
  split.subsistence = Math.max(0, 1 - WORKING_CLASSES.reduce((n, c) => n + split[c], 0) - INVESTOR_SHARE)
  return split
}

// The starting economy in balance: each producing building's level is set so
// its NATION makes about BALANCE_HEADROOM more of each good than it uses — its
// people's needs (at a middling standard of living), the state's purchases,
// and other buildings' inputs and upkeep — keeping every building on the roster
// (a good nobody uses keeps one level). Per nation, because a nation's worlds
// ship to each other: balanced world by world, Mars was sized for its own mills
// on top of Luna's mine that also feeds them, and its ore sat in glut. Solved by
// iterating, since inputs depend on levels. Without it the worlds produced 4–9×
// what their people could use: most output never sold, prices sank to their
// floors and wages, profits and the state's accounts all went with them.
const BALANCE_HEADROOM = 1.1
const BALANCE_SOL = 0.7
const MIN_ACTIVE = 0.3 // a mothballed plant keeps at least this much running…
const MOTHBALL_SLACK = 1.5 // …and this much more than the estimate says it needs
// Goods every chain runs on (and construction needs): their plants are never
// mothballed — trimmed to the estimate, a chain whose links all feed each
// other (steel ↔ machinery ↔ coal) ran dry once the AI started building.
const NEVER_MOTHBALLED: GoodId[] = ['electricity', 'steel', 'tools', 'machinery', 'coal', 'ironOre', 'concrete', 'lumber', 'glass', 'fuel']
function balancedNation(specs: WorldSpec[]): Map<string, BuildingSpec[]> {
  const adoption = seedAdoption()
  const household = {} as Record<GoodId, number>
  for (const g of GOOD_IDS) household[g] = 0
  let population = 0
  for (const spec of specs) {
    population += spec.population
    const species = SPECIES_TEMPLATES[spec.species]
    if (!species) continue
    for (const tier of NEED_TIERS) {
      const wf = tierWealthFactor(tier, BALANCE_SOL)
      for (const group of species.needs[tier]) {
        const total = group.goods.reduce((n, x) => n + x.weight, 0) || 1
        for (const x of group.goods) household[x.good] += ((group.base * NEED_SCALE * wf * spec.population * x.weight) / total) * (adoption[x.good] ?? 1)
      }
    }
  }
  const all = specs.flatMap((spec) => spec.buildings.map((b) => ({ spec: spec.id, b })))
  let levels = all.map(({ b }) => b.level)
  // Share of each building's capacity in use: under 1 only for a level-1
  // producer the nation needs less than a whole level of (the rest mothballed).
  let active = all.map(() => 1)
  const methodOf = all.map(({ b }) => getMethod(b.recipe, b.method ?? RECIPES[b.recipe]?.methods[0]?.id ?? ''))
  for (let round = 0; round < 30; round++) {
    const demand = { ...household }
    const totalLevels = levels.reduce((n, l) => n + l, 0)
    const govBudget = ADMIN_PER_BUILDING_LEVEL * totalLevels + PUBLIC_SPENDING_PER_CAPITA * population
    for (const item of GOVERNMENT_BASKET) demand[item.good] += (govBudget * item.weight) / GOODS[item.good].basePrice
    const capacity = {} as Record<GoodId, number>
    for (const g of GOOD_IDS) capacity[g] = 0
    methodOf.forEach((m, i) => {
      if (!m) return
      const run = levels[i] * active[i]
      for (const inp of m.inputs) demand[inp.good] += inp.amount * run
      for (const u of CAPITAL_UPKEEP) demand[u.good] += u.amount * run
      for (const out of m.outputs) capacity[out.good] += out.amount * run
    })
    const nextActive = [...active]
    const next = levels.map((l, i) => {
      const m = methodOf[i]
      if (!m || m.outputs.length === 0) return l
      const ratio = Math.max(...m.outputs.map((o) => (capacity[o.good] > 0 ? (demand[o.good] * BALANCE_HEADROOM) / capacity[o.good] : 1)))
      const target = l * active[i] * ratio // levels' worth of this building the nation needs
      if (target >= 1 || m.outputs.some((o) => NEVER_MOTHBALLED.includes(o.good))) {
        nextActive[i] = 1
        return Math.max(1, Math.round(target))
      }
      nextActive[i] = Math.min(1, Math.max(MIN_ACTIVE, Math.round(target * MOTHBALL_SLACK * 20) / 20))
      return 1
    })
    // …but no world gets more jobs than its people can fill: its producers are
    // cut back to fit, and the nation's other worlds grow into the gap next
    // round. (Scaled nation-wide, Proxima b got 250 jobs for 150M people and
    // ran at a quarter.)
    for (const spec of specs) {
      const idx = all.map((x, i) => (x.spec === spec.id ? i : -1)).filter((i) => i >= 0)
      const jobsOf = (i: number) => (methodOf[i]?.jobs ?? []).reduce((n, j) => n + j.count * JOB_SCALE, 0) * next[i] * nextActive[i]
      const jobs = idx.reduce((n, i) => n + jobsOf(i), 0)
      const room = (spec.population * (1 - INVESTOR_SHARE)) / FRICTIONAL_SLACK
      if (jobs <= room) continue
      const fixed = idx.filter((i) => !methodOf[i] || methodOf[i]!.outputs.length === 0).reduce((n, i) => n + jobsOf(i), 0)
      const scale = Math.max(0, (room - fixed) / Math.max(1e-9, jobs - fixed))
      for (const i of idx) if (methodOf[i] && methodOf[i]!.outputs.length > 0) next[i] = Math.max(1, Math.floor(next[i] * scale))
    }
    const settled = next.every((l, i) => l === levels[i]) && nextActive.every((a, i) => a === active[i])
    levels = next
    active = nextActive
    if (settled) break
  }
  const out = new Map<string, BuildingSpec[]>()
  all.forEach(({ spec, b }, i) => {
    if (!out.has(spec)) out.set(spec, [])
    out.get(spec)!.push({ ...b, level: levels[i], ...(active[i] < 1 ? { idle: Math.round((1 - active[i]) * 100) / 100 } : {}) })
  })
  return out
}
function balancedSpecs(specs: WorldSpec[]): Map<string, BuildingSpec[]> {
  const out = new Map<string, BuildingSpec[]>()
  for (const owner of new Set(specs.map((s) => s.ownerId))) for (const [id, b] of balancedNation(specs.filter((s) => s.ownerId === owner))) out.set(id, b)
  return out
}

function buildWorld(rawSpec: WorldSpec, calibration?: WorldCalibration): World {
  const spec = { ...rawSpec, buildings: BALANCED_BUILDINGS.get(rawSpec.id) ?? rawSpec.buildings }
  const pops: Pop[] = []
  const split = classSplitFor(spec)
  for (const cls of POP_CLASSES) {
    const classPop = spec.population * split[cls]
    if (classPop <= 0) continue
    for (const r of spec.religions) {
      const size = classPop * r.share
      if (size <= 0) continue
      pops.push(makePop(spec.id, cls, spec.species, spec.culture, r.religion, size))
    }
  }
  // Seeded buildings open at the run their staff can support (the scarcest of
  // their job classes, by qualified workers per job) — not flat out: on an
  // understaffed colony they used to start at full run and sink toward a
  // quarter over the first year, reading as a slump.
  const qualified = {} as Record<PopClass, number>
  const jobs = {} as Record<PopClass, number>
  for (const cls of POP_CLASSES) {
    qualified[cls] = 0
    jobs[cls] = 0
  }
  for (const p of pops) qualified[p.class] += p.populationSize * qualificationFraction(p.class, p.educationLevel)
  for (const b of spec.buildings) for (const j of getMethod(b.recipe, b.method ?? RECIPES[b.recipe]?.methods[0]?.id ?? '')?.jobs ?? []) jobs[j.class] += j.count * b.level * (1 - (b.idle ?? 0)) * JOB_SCALE
  const staffed = (cls: PopClass) => (jobs[cls] > 0 ? Math.min(1, qualified[cls] / jobs[cls]) : 1)
  const buildings = spec.buildings.map((b) => {
    const built = { ...makeBuilding(spec.id, b.recipe, b.level, b.owner, b.method), ...(b.idle ? { idle: b.idle } : {}) }
    const method = getMethod(built.recipeId, built.methodId)
    const throughput = Math.min(1 - (b.idle ?? 0), ...(method?.jobs ?? []).map((j) => staffed(j.class)))
    const inventory = Object.fromEntries(Object.entries(built.inventory).map(([g, n]) => [g, (n ?? 0) * throughput]))
    return { ...built, throughput, inventory }
  })
  return {
    id: spec.id,
    name: spec.id,
    ownerId: spec.ownerId,
    cultureId: spec.culture,
    populationCapacity: spec.capacity,
    // District slots scale with population, sized to hold the seed with headroom
    // — then rounded up to whole district levels (economy/districts.ts), and the
    // world's land comes from the body's size (never less than it starts with).
    // (Never less than its seeded buildings take — the seed adds spaceports
    // and whole supply chains.)
    ...seedDistricts(spec.id, {
      core: Math.max(12, Math.round(spec.population / 400), usedBy(spec, 'core')),
      urban: Math.max(10, Math.round(spec.population / 250), usedBy(spec, 'urban')),
      industrial: Math.max(16, Math.round(spec.population / 72), usedBy(spec, 'industrial')),
      resource: Math.max(12, Math.round(spec.population / 130), usedBy(spec, 'resource')),
      // A capital starts with one military level: its starting fortress and battery.
      military: NATIONS.some((c) => c.capitalBodyName === spec.id) ? 1 : 0,
    }),
    pops,
    buildings,
    constructionQueue: [],
    market: seedMarket(calibration?.prices),
    labor: calibration?.wages ? { wages: { ...seedLabor(spec, split).wages, ...calibration.wages } } : seedLabor(spec, split),
    importStock: {},
    resourceDeposits: seedDeposits(buildings),
    adoption: seedAdoption(),
  }
}

// Building levels a spec's buildings take in one district.
function usedBy(spec: WorldSpec, d: DistrictType): number {
  return spec.buildings.reduce((n, b) => n + (districtOfRecipe(b.recipe) === d ? b.level : 0), 0)
}

function seedDistricts(bodyName: string, capacity: Record<DistrictType, number>): Pick<World, 'districtCapacity' | 'districts' | 'land'> {
  const districts = {} as Record<DistrictType, number>
  const districtCapacity = {} as Record<DistrictType, number>
  for (const d of DISTRICT_TYPES) {
    districts[d] = Math.ceil((capacity[d] ?? 0) / SLOTS_PER_DISTRICT_LEVEL)
    districtCapacity[d] = districts[d] * SLOTS_PER_DISTRICT_LEVEL
  }
  const total = DISTRICT_TYPES.reduce((n, d) => n + districts[d], 0)
  return { districts, districtCapacity, land: Math.max(landForBody(bodyName), total) }
}

const WORLD_SPECS: WorldSpec[] = [
  // Imperial State of Mars — the showcase world with the full chain.
  {
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
      // Agriculture — the Martian Restoration Administration (state corp). Grain
      // (staple), hydroponics (high-yield grain for a marginal world), livestock
      // + fishery (protein). Provisioned with headroom so food doesn't bind early.
      { recipe: 'wheatFarm', level: 4, owner: MRA },
      { recipe: 'riceFarm', level: 2, owner: MRA },
      { recipe: 'hydroponicsFarm', level: 2, owner: MRA },
      { recipe: 'livestockRanch', level: 3, owner: MRA },
      { recipe: 'fishery', level: 2, owner: MRA },
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
      { recipe: 'foodProcessor', level: 4, owner: MRA },
      { recipe: 'meatPacking', level: 3, owner: MRA },
      { recipe: 'consumerGoodsFactory', level: 3, owner: 'worker' },
      { recipe: 'furnitureFactory', level: 2, owner: 'worker' },
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
  },
  {
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
      { recipe: 'livestockRanch', level: 1 },
      { recipe: 'meatPacking', level: 1 },
      { recipe: 'fishery', level: 2 },
      { recipe: 'steelMill', level: 1 },
      { recipe: 'toolWorkshop', level: 1 },
      { recipe: 'machineryFactory', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 1 },
      { recipe: 'clinic', level: 1 },
      { recipe: 'roadNetwork', level: 1 },
    ],
  },
  // Republic of Venus.
  {
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
      { recipe: 'livestockRanch', level: 1 },
      { recipe: 'meatPacking', level: 1 },
      { recipe: 'fishery', level: 2 },
      { recipe: 'steelMill', level: 3 },
      { recipe: 'toolWorkshop', level: 2 },
      { recipe: 'machineryFactory', level: 2 },
      { recipe: 'chemicalPlant', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 2 },
      { recipe: 'furnitureFactory', level: 1 },
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
  },
  // Orion Republic.
  {
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
      { recipe: 'livestockRanch', level: 1 },
      { recipe: 'meatPacking', level: 1 },
      { recipe: 'fishery', level: 2 },
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
  },
  {
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
      { recipe: 'livestockRanch', level: 1 },
      { recipe: 'meatPacking', level: 1 },
      { recipe: 'fishery', level: 2 },
      { recipe: 'steelMill', level: 1 },
      { recipe: 'toolWorkshop', level: 1 },
      { recipe: 'machineryFactory', level: 1 },
      { recipe: 'consumerGoodsFactory', level: 1 },
      { recipe: 'clinic', level: 1 },
      { recipe: 'roadNetwork', level: 1 },
    ],
  },
  // Kingdom of Lalande — the Tidalians.
  {
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
      { recipe: 'livestockRanch', level: 1 },
      { recipe: 'meatPacking', level: 1 },
      { recipe: 'fishery', level: 2 },
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
  },
]
// --- Spaceports, seaports and whole supply chains, before the balancer ---

// Every inhabited world runs SPACEPORTS_PER_BILLION spaceports per billion
// people (at least one), alternately the state's and its nation's private
// operator's; each is a key node on the ground map (scene/spaceportSites.ts).
// A world with sea gets a seaport too.
const SPACEPORTS_PER_BILLION = 2
const SEA_SHARE_FOR_SEAPORT = 0.05
function withTransport(spec: WorldSpec): WorldSpec {
  const buildings = [...spec.buildings]
  const operator = OPERATOR_OF[spec.ownerId]
  const want = Math.max(1, Math.round((SPACEPORTS_PER_BILLION * spec.population) / 1000))
  let have = buildings.filter((b) => b.recipe === 'spaceport').length
  while (have < want) {
    buildings.push({ recipe: 'spaceport', level: 1, owner: have % 2 === 1 && operator ? operator : 'state' })
    have++
  }
  if (!buildings.some((b) => b.recipe === 'seaport') && seaShareOf(spec.id) > SEA_SHARE_FOR_SEAPORT) buildings.push({ recipe: 'seaport', level: 1, owner: operator ?? 'state' })
  return { ...spec, buildings }
}
function seaShareOf(bodyName: string): number {
  if (!bodyGroundInfo(bodyName)) return 0
  const surface = surfaceOf(bodyName, 'world')
  let sea = 0
  for (let i = 0; i < surface.terrain.length; i++) if (TERRAIN_IDS[surface.terrain[i]] === 'ocean') sea++
  return sea / Math.max(1, surface.terrain.length)
}

// Every good a nation's seeded buildings consume, its equipment wears out, its
// state buys, its construction uses or its people need every day is made
// somewhere in the nation: a missing producer is added (on its capital). Every
// input is strictly needed, so one missing good stopped whole chains (a
// chemical plant with no sulfur makes nothing, and no dyes, fertilizer or
// explosives follow); Venus lived on shortages of fuel, lumber and paper.
// Mothballing (the balancer) keeps the added plants from glutting.
const CONSTRUCTION_GOODS: GoodId[] = ['concrete', 'steel', 'lumber', 'tools', 'glass']
function withSupplyChains(specs: WorldSpec[]): WorldSpec[] {
  const out = specs.map((s) => ({ ...s, buildings: [...s.buildings] }))
  for (const nation of NATIONS) {
    const mine = out.filter((s) => s.ownerId === nation.id)
    const capital = mine.find((s) => s.id === nation.capitalBodyName) ?? mine[0]
    if (!capital) continue
    const everyday = new Set<GoodId>()
    for (const s of mine) {
      const species = SPECIES_TEMPLATES[s.species]
      if (!species) continue
      for (const tier of ['basic', 'everyday', 'healthcare'] as const) for (const group of species.needs[tier]) for (const x of group.goods) if (!isEmergentGood(x.good)) everyday.add(x.good)
    }
    for (let round = 0; round < 12; round++) {
      const made = new Set<GoodId>()
      const needed = new Set<GoodId>([...everyday, ...CONSTRUCTION_GOODS, ...CAPITAL_UPKEEP.map((u) => u.good), ...GOVERNMENT_BASKET.map((g) => g.good)])
      for (const s of mine) {
        for (const b of s.buildings) {
          const m = getMethod(b.recipe, b.method ?? RECIPES[b.recipe]?.methods[0]?.id ?? '')
          for (const o of m?.outputs ?? []) made.add(o.good)
          for (const i of m?.inputs ?? []) needed.add(i.good)
        }
      }
      const missing = [...needed].filter((g) => !made.has(g))
      if (missing.length === 0) break
      for (const g of missing) {
        const recipe = producerOf(g, made)
        if (recipe) capital.buildings.push({ recipe, level: 1, owner: PRIVATE_LED.has(nation.id) ? OPERATOR_OF[nation.id] : 'state' })
      }
    }
  }
  return out
}
// The recipe to make a good with: of those whose first method makes it, the
// one needing the fewest goods the nation doesn't make yet.
function producerOf(good: GoodId, made: Set<GoodId>): string | null {
  let best: string | null = null
  let bestMissing = Infinity
  for (const r of Object.values(RECIPES)) {
    const m = r.methods[0]
    if (!m?.outputs.some((o) => o.good === good)) continue
    const missing = m.inputs.filter((i) => !made.has(i.good)).length
    if (missing < bestMissing) {
      best = r.id
      bestMissing = missing
    }
  }
  return best
}

const SEEDED_SPECS = withSupplyChains(WORLD_SPECS.map(withTransport))
const BALANCED_BUILDINGS = balancedSpecs(SEEDED_SPECS)
// The worlds as specified, their building levels from the balancer, opening at
// the prices and wages the calibration found their markets settle at.
const WORLDS: World[] = WORLD_SPECS.map((spec) => buildWorld(spec, SEED_CALIBRATION[spec.id]))

// Seed a central bank for a country. Each of the four powers runs a distinct
// monetary institution so the models read differently from the start — a
// government-directed development bank, an independent price-stability bank, a
// federal reserve system, etc. `governorTermLength` follows the appointment law.
type SeedCentralBank = Omit<CentralBank, 'countryId' | 'name' | 'governorTermStart' | 'governorTermLength' | 'fxReserves' | 'govSecurities' | 'currencyInCirculation' | 'loansToBanks'> &
  Partial<Pick<CentralBank, 'fxReserves' | 'govSecurities' | 'currencyInCirculation' | 'loansToBanks'>>
function seedCentralBank(countryId: string, name: string, cb: SeedCentralBank): CentralBank {
  return {
    countryId,
    name,
    governorTermStart: 0,
    governorTermLength: governorAppointmentDef(cb.appointment).termTicks,
    // Balance-sheet defaults (Stage 2) — seeded so the CB sheet balances at the
    // start; per-country overrides (e.g. a fixed-rate regime holds more FX
    // reserves) are passed in explicitly.
    fxReserves: 20000,
    govSecurities: 15000,
    currencyInCirculation: 30000,
    loansToBanks: 0,
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
    publicServices: { healthcare: 1, dental: 0.5, education: 0.8 },
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
    currency: { name: 'Imperial Standard Credit', code: 'ISC', rate: 1.0, target: 1.0 },
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
    publicServices: { healthcare: 0.5, dental: 0, education: 0.3 },
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
    currency: { name: 'Venusian National Credit', code: 'VNC', rate: 1.15, target: 1.15 },
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
    publicServices: { healthcare: 0, dental: 0, education: 0 },
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
    currency: { name: 'Orion Republic Dollar', code: 'ORD', rate: 0.95, target: 0.95 },
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
    publicServices: { healthcare: 0.8, dental: 0.3, education: 0.6 },
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
    currency: { name: 'Lalande Royal Dinar', code: 'LRD', rate: 0.70, target: 0.70 },
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
      // A fixed exchange rate must be defended with reserves — Lalande holds more.
      fxReserves: 45000,
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
  // The founders of the nations' spaceport & shipping operators.
  ...[
    { id: 'char-rin-takamori', name: 'Rin Takamori', age: 51, corporationId: 'tenku-koro', cultureId: 'martian', religionId: 'martian-buddhist', speciesTemplateId: 'baseline-organic', traits: ['Ambitious', 'Diligent'], log: ['Founder of Tenkū Kōro, which runs half of Mars’s spaceports.'] },
    { id: 'char-theodora-anthemis', name: 'Theodora Anthemis', age: 47, corporationId: 'kypris-astroporia', cultureId: 'venusian', religionId: 'axiomatic', speciesTemplateId: 'baseline-organic', traits: ['Shrewd', 'Gregarious'], log: ['Founder of Kypris Astroporia, the Republic’s spaceport and shipping line.'] },
    { id: 'char-solenne-hart', name: 'Solenne Hart', age: 44, corporationId: 'arcadian-starlines', cultureId: 'arcadian', religionId: 'arcadian-idyll', speciesTemplateId: 'baseline-organic', traits: ['Reformer', 'Ambitious'], log: ['Founder of Arcadian Starlines.'] },
    { id: 'char-augustin-delorme', name: 'Augustin Delorme', age: 58, corporationId: 'compagnie-stellaire', cultureId: 'tidalian', religionId: 'non-affiliated', speciesTemplateId: 'tidalian', traits: ['Cautious', 'Shrewd'], log: ['Founder of the Compagnie Stellaire de Bellerive.'] },
  ].map(
    (c): Character => ({ ...c, role: 'corp-leader', wealth: 600, skills: { administration: 6, finance: 7, diplomacy: 5 } }),
  ),
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
  // The nations' private spaceport & shipping operators (OPERATOR_OF): their
  // founder holds a block, the rest floats.
  ...[
    { id: 'tenku-koro', name: 'Tenkū Kōro 天空航路', countryId: 'imperial-state-of-mars', leaderId: 'char-rin-takamori' },
    { id: 'kypris-astroporia', name: 'Kypris Astroporia', countryId: 'republic-of-venus', leaderId: 'char-theodora-anthemis' },
    { id: 'arcadian-starlines', name: 'Arcadian Starlines', countryId: 'orion-republic', leaderId: 'char-solenne-hart' },
    { id: 'compagnie-stellaire', name: 'Compagnie Stellaire de Bellerive', countryId: 'kingdom-of-lalande', leaderId: 'char-augustin-delorme' },
  ].map(
    (c): Corporation => ({
      ...c,
      kind: 'private',
      cash: 10000,
      totalShares: 1000,
      shares: [
        { holder: { kind: 'character', id: c.leaderId }, shares: 400 },
        { holder: { kind: 'public' }, shares: 600 },
      ],
      lastProfit: 0,
      sector: 'Transport',
    }),
  ),
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

// Every nation starts able to run its state: enough government offices on its
// capital that bureaucracy made covers bureaucracy used (state buildings, state
// companies' buildings, decrees) with ADMIN_HEADROOM to spare. Without it the
// stock drained within months and every state-run building fell to the
// shortage malus at once.
const ADMIN_HEADROOM = 1.5
const ADMIN_EXPECTED_RUN = 0.9 // offices rarely run fully staffed
function withAdministration(worlds: World[]): World[] {
  const stateCorps = new Set(CORPORATIONS.filter((c) => c.kind === 'state').map((c) => c.id))
  return worlds.map((w) => {
    const nation = NATIONS.find((n) => n.capitalBodyName === w.name)
    const country = COUNTRIES.find((c) => c.id === w.ownerId)
    if (!nation || !country || nation.id !== w.ownerId) return w
    let used = country.decrees.length * BUREAUCRACY_PER_DECREE
    let made = 0
    for (const x of worlds) {
      if (x.ownerId !== w.ownerId) continue
      for (const b of x.buildings) {
        if (b.owner.kind === 'state') used += BUREAUCRACY_PER_STATE_BUILDING_LEVEL * b.level
        else if (b.owner.kind === 'corporation' && stateCorps.has(b.owner.corporationId)) used += BUREAUCRACY_PER_STATECORP_BUILDING_LEVEL * b.level
        // At the run each office opens at (its staff), not a hoped-for one.
        made += (BUREAUCRACY_OUTPUT[b.recipeId] ?? 0) * b.level * Math.min(b.throughput, ADMIN_EXPECTED_RUN)
      }
    }
    const short = used * ADMIN_HEADROOM - made
    if (short <= 0) return w
    const add = Math.ceil(short / (BUREAUCRACY_OUTPUT.governmentOffice * ADMIN_EXPECTED_RUN))
    const office = w.buildings.findIndex((b) => b.recipeId === 'governmentOffice' && b.owner.kind === 'state')
    const buildings = office >= 0 ? w.buildings.map((b, i) => (i === office ? { ...b, level: b.level + add } : b)) : [...w.buildings, makeBuilding(w.id, 'governmentOffice', add, 'state')]
    // Staff them: the new jobs' classes grow out of the subsistence sector.
    const grow = {} as Record<PopClass, number>
    for (const cls of POP_CLASSES) grow[cls] = 0
    for (const j of getMethod('governmentOffice', undefined)?.jobs ?? []) grow[j.class] += j.count * add * JOB_SCALE * FRICTIONAL_SLACK
    const sizeOf = (cls: PopClass) => w.pops.filter((p) => p.class === cls).reduce((n, p) => n + p.populationSize, 0)
    const moved = POP_CLASSES.reduce((n, c) => n + (sizeOf(c) > 0 ? grow[c] : 0), 0)
    const subsistence = sizeOf('subsistence')
    const take = subsistence > 0 ? Math.min(1, moved / subsistence) : 0
    const pops = w.pops.map((p) => {
      if (p.class === 'subsistence') return { ...p, populationSize: p.populationSize * (1 - take) }
      const size = sizeOf(p.class)
      return size > 0 && grow[p.class] > 0 ? { ...p, populationSize: p.populationSize * (1 + (grow[p.class] * Math.min(1, subsistence / Math.max(1e-9, moved))) / size) } : p
    })
    // Room for them in the core district (whole levels; land grows if it must).
    const coreUsed = buildings.reduce((n, b) => n + (districtOfRecipe(b.recipeId) === 'core' ? b.level : 0), 0)
    const coreLevels = Math.max(w.districts?.core ?? 0, Math.ceil(coreUsed / SLOTS_PER_DISTRICT_LEVEL))
    const districts = { ...(w.districts ?? ({} as Record<DistrictType, number>)), core: coreLevels }
    const total = DISTRICT_TYPES.reduce((n, d) => n + (districts[d] ?? 0), 0)
    return { ...w, pops, buildings, districts, districtCapacity: { ...w.districtCapacity, core: coreLevels * SLOTS_PER_DISTRICT_LEVEL }, land: Math.max(w.land ?? 0, total) }
  })
}
const ADMINISTERED_WORLDS = withAdministration(WORLDS)

function withFinancialDistricts(worlds: World[]): World[] {
  return worlds.map((w) => {
    const fdBuilding = FD.buildingByWorld.get(w.id)
    const buildings = fdBuilding ? [...w.buildings, fdBuilding] : [...w.buildings]
    return { ...w, pops: [...w.pops], buildings, importStock: {}, resourceDeposits: { ...w.resourceDeposits } }
  })
}

export function seedWorlds(): World[] {
  return withFinancialDistricts(ADMINISTERED_WORLDS)
}

// The starting worlds under a given calibration of their prices and wages
// ({} = none: base prices, wages by the bargaining rule) — for
// scripts/economy/calibrate.ts.
export function seedWorldsWith(calibration: SeedCalibration): World[] {
  return withFinancialDistricts(withAdministration(WORLD_SPECS.map((spec) => buildWorld(spec, calibration[spec.id]))))
}
export function seedCountries(): Country[] {
  return seedCountriesWith(COUNTRY_CALIBRATION)
}
// The nations under a given calibration of their starting tax rates (the rate
// that opens their budget near balance) — for scripts/economy/calibrate.ts.
export function seedCountriesWith(calibration: Record<string, CountryCalibration>): Country[] {
  return COUNTRIES.map((c) => ({ ...c, ...(calibration[c.id]?.taxRate !== undefined ? { taxRate: calibration[c.id].taxRate! } : {}) }))
}

// Commercial banks (Stage 2). Each bank starts near a balanced sheet: reserves
// 15% + loans 80% + securities 15% of its deposit base, so capital ≈ 10% of
// deposits (≈12.5% of loans — comfortably above the 8% target) and reserves sit
// above any seeded reserve requirement, leaving a little room to lend. Larger
// economies carry more/bigger banks.
function makeBank(id: string, name: string, countryId: string, deposits: number, riskAppetite: number): Bank {
  return {
    id,
    name,
    countryId,
    reserves: Math.round(deposits * 0.15),
    loans: Math.round(deposits * 0.8),
    securities: Math.round(deposits * 0.15),
    deposits,
    cbBorrowings: 0,
    riskAppetite,
    lastProfit: 0,
  }
}

const BANKS: Bank[] = [
  makeBank('bank-mars-1', 'First Bank of Mars', 'imperial-state-of-mars', 70000, 0.55),
  makeBank('bank-mars-2', 'Tharsis Mercantile', 'imperial-state-of-mars', 50000, 0.6),
  makeBank('bank-venus-1', 'Aphrodite Savings', 'republic-of-venus', 52000, 0.5),
  makeBank('bank-venus-2', 'Cytherean Trust', 'republic-of-venus', 40000, 0.55),
  makeBank('bank-orion-1', 'Arcadia Commercial Bank', 'orion-republic', 42000, 0.6),
  makeBank('bank-lalande-1', 'Lalande People’s Bank', 'kingdom-of-lalande', 48000, 0.7),
]

export function seedBanks(): Bank[] {
  return BANKS.map((b) => ({ ...b }))
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
