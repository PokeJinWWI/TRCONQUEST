// The goods of the economy (design doc v2 Section 4), expanded from the four
// starter goods into real production chains with **electricity as a first-class
// universal input**. New goods are pure data — the tick loop is generic over
// GOOD_IDS, so adding one here is content, not code.
//
// Chains (roughly):
//   power:      coal/oil/nothing(solar)/rare metals → ELECTRICITY (feeds almost everything)
//   extraction: iron ore, coal, oil, rare metals, timber, phosphate, + farm crops
//   processing: ore+coal → steel; oil → fuel & chemicals; chemicals+phosphate → fertilizer;
//               chemicals → explosives; rare metals+chemicals → semiconductors; timber → lumber
//   manufacture: steel → machinery; semiconductors+steel → electronics; crops → food;
//                steel+lumber → consumer goods; electronics+consumer goods → luxuries
//   care:       chemicals → medicine
export type GoodId =
  // Power
  | 'electricity'
  // WATER — a universal utility like electricity: pops drink it and farms,
  // chemicals and power cooling draw on it. Collected as surface water (treatment
  // plants), pumped from the ground, or desalinated from the sea.
  | 'water'
  // Raw extraction
  | 'ironOre'
  | 'coal'
  | 'oil'
  | 'rareMetals'
  // Non-ferrous metals — mined, then mixed into ALLOYS (below). Kept few on
  // purpose: base metals (copper, nickel) and light metals (aluminium, titanium,
  // lithium) come from two co-product mines, not one each.
  | 'copper'
  | 'aluminium'
  | 'nickel'
  | 'titanium'
  | 'lithium'
  | 'timber'
  | 'phosphate'
  | 'sulfur'
  | 'hardwood'
  // Farm crops (raw agricultural). GRAINS is the universal staple crop — the
  // output of wheat/rice/maize farms, greenhouses and hydroponic farms alike.
  | 'grains'
  | 'livestock'
  | 'sugar'
  | 'coffee'
  | 'tea'
  // Proteins — meat (livestock → meat) and fish (fisheries). Pops demand both
  // and substitute one for the other.
  | 'meat'
  | 'fish'
  // Intermediate / industrial
  | 'steel'
  // ALLOYS — the mix of non-ferrous metals that aerospace, ships and vehicles
  // are built from. ROCKET FUEL — refined propellant that launches burn.
  | 'alloys'
  | 'rocketFuel'
  // Strategic war materials for FTL warships, synthesised only with late tech
  // (exotic-matter-containment / hyperium-synthesis): EXOTIC MATTER powers warp
  // drives, HYPERIUM powers hyperdrives. The military shipyard draws these from
  // the nation's economy in Complex mode. Not consumed by any economy recipe, so
  // never auto-seeded — a nation builds the plants once it wants an FTL navy.
  | 'exoticMatter'
  | 'hyperium'
  | 'concrete'
  | 'lumber'
  | 'fuel'
  | 'chemicals'
  | 'fertilizer'
  | 'explosives'
  | 'semiconductors'
  | 'dyes'
  | 'glass'
  | 'paper'
  // Tools & machinery, by grade (chain: steel → tools → machinery → heavy).
  // TOOLS are cheap and near-universal (mechanized extractors, farms, light
  // factories, construction). MACHINERY is general industrial plant (steel,
  // chemicals, mills). HEAVY MACHINERY drives deep extraction, the heaviest
  // industry and major construction. ELECTRICAL MACHINERY (motors, generators,
  // drives) is a separate domain feeding power and advanced manufacturing.
  | 'tools'
  | 'machinery'
  | 'heavyMachinery'
  | 'electricalMachinery'
  // Precision machinery — high-tolerance instruments and machine tools for
  // advanced manufacturing (semiconductors, aircraft, electronics, medical).
  | 'precisionMachinery'
  | 'electronics'
  // Engines & vehicles. Engines drive heavy machinery and every vehicle;
  // automobiles are a consumer good; locomotives and aircraft are capital goods
  // that transport infrastructure (railways, spaceports) is built from.
  | 'engines'
  | 'automobiles'
  | 'locomotives'
  | 'aircraft'
  // Capital/logistics craft — oceanic and orbital, plus the sub-orbital rocket
  // rung feeding spaceport-tier logistics. Big-ticket capital goods, priced far
  // above the vehicle tier above.
  | 'oceanGoingShips'
  | 'spaceships'
  | 'rockets'
  // Consumer / end goods. GROCERIES are processed foods bought at the grocery
  // store (grains + proteins → groceries) — the everyday processed-food staple.
  | 'groceries'
  | 'consumerGoods'
  // Furniture — a household durable (lumber/hardwood/glass → furniture). A
  // premium substitute for plain consumer goods in the pop household need.
  | 'furniture'
  | 'textiles'
  | 'luxuryGoods'
  // A "culture" consumer good — produced by an Art Studio, bought like any
  // other luxury.
  | 'art'
  // Services — produced locally, consumed by pops; healthcare can be publicly
  // funded (see the healthcare law). Services are the soft economy: care,
  // schooling, shops, and now online/digital services from data centers.
  | 'healthcare'
  // Dental care — a distinct health service the state can publicly fund
  // separately from general healthcare (produced alongside it at clinics).
  | 'dental'
  | 'education'
  | 'retail'
  | 'onlineServices'
  // Transportation — the freight/haulage good (locomotives, trucks, haulers).
  // Consumed by buildings and pops; the transport buildings (road/rail/port)
  // that produce it also raise the world's INFRASTRUCTURE capacity, which gates
  // MARKET ACCESS (see economy/transport.ts). The good and the capacity are
  // distinct (Vic3-style): this is the good, infrastructure is the capacity.
  | 'transportation'

export const GOOD_IDS: GoodId[] = [
  'electricity',
  'water',
  'ironOre',
  'coal',
  'oil',
  'rareMetals',
  'copper',
  'aluminium',
  'nickel',
  'titanium',
  'lithium',
  'timber',
  'phosphate',
  'sulfur',
  'hardwood',
  'grains',
  'livestock',
  'sugar',
  'coffee',
  'tea',
  'meat',
  'fish',
  'steel',
  'alloys',
  'rocketFuel',
  'exoticMatter',
  'hyperium',
  'concrete',
  'lumber',
  'fuel',
  'chemicals',
  'fertilizer',
  'explosives',
  'semiconductors',
  'dyes',
  'glass',
  'paper',
  'tools',
  'machinery',
  'heavyMachinery',
  'electricalMachinery',
  'precisionMachinery',
  'electronics',
  'engines',
  'automobiles',
  'locomotives',
  'aircraft',
  'oceanGoingShips',
  'spaceships',
  'rockets',
  'groceries',
  'consumerGoods',
  'furniture',
  'textiles',
  'luxuryGoods',
  'art',
  'healthcare',
  'dental',
  'education',
  'retail',
  'onlineServices',
  'transportation',
]

export type GoodCategory = 'power' | 'raw' | 'agricultural' | 'intermediate' | 'consumer' | 'service'

export interface GoodDef {
  id: GoodId
  label: string
  category: GoodCategory
  // The price the market gravitates toward at rough supply/demand balance.
  basePrice: number
}

export const GOODS: Record<GoodId, GoodDef> = {
  electricity: { id: 'electricity', label: 'Electricity', category: 'power', basePrice: 4 },
  water: { id: 'water', label: 'Water', category: 'raw', basePrice: 2 },
  ironOre: { id: 'ironOre', label: 'Iron Ore', category: 'raw', basePrice: 3 },
  coal: { id: 'coal', label: 'Coal', category: 'raw', basePrice: 2 },
  oil: { id: 'oil', label: 'Oil', category: 'raw', basePrice: 5 },
  rareMetals: { id: 'rareMetals', label: 'Rare Metals', category: 'raw', basePrice: 16 },
  copper: { id: 'copper', label: 'Copper', category: 'raw', basePrice: 7 },
  aluminium: { id: 'aluminium', label: 'Aluminium', category: 'raw', basePrice: 6 },
  nickel: { id: 'nickel', label: 'Nickel', category: 'raw', basePrice: 9 },
  titanium: { id: 'titanium', label: 'Titanium', category: 'raw', basePrice: 15 },
  lithium: { id: 'lithium', label: 'Lithium', category: 'raw', basePrice: 13 },
  timber: { id: 'timber', label: 'Timber', category: 'raw', basePrice: 3 },
  phosphate: { id: 'phosphate', label: 'Phosphate', category: 'raw', basePrice: 4 },
  sulfur: { id: 'sulfur', label: 'Sulfur', category: 'raw', basePrice: 4 },
  hardwood: { id: 'hardwood', label: 'Hardwood', category: 'raw', basePrice: 5 },
  grains: { id: 'grains', label: 'Grains', category: 'agricultural', basePrice: 2 },
  livestock: { id: 'livestock', label: 'Livestock', category: 'agricultural', basePrice: 6 },
  sugar: { id: 'sugar', label: 'Sugar', category: 'agricultural', basePrice: 3 },
  coffee: { id: 'coffee', label: 'Coffee', category: 'agricultural', basePrice: 8 },
  tea: { id: 'tea', label: 'Tea', category: 'agricultural', basePrice: 7 },
  meat: { id: 'meat', label: 'Meat', category: 'agricultural', basePrice: 7 },
  fish: { id: 'fish', label: 'Fish', category: 'agricultural', basePrice: 6 },
  steel: { id: 'steel', label: 'Steel', category: 'intermediate', basePrice: 8 },
  alloys: { id: 'alloys', label: 'Alloys', category: 'intermediate', basePrice: 20 },
  rocketFuel: { id: 'rocketFuel', label: 'Rocket Fuel', category: 'intermediate', basePrice: 15 },
  exoticMatter: { id: 'exoticMatter', label: 'Exotic Matter', category: 'intermediate', basePrice: 70 },
  hyperium: { id: 'hyperium', label: 'Hyperium', category: 'intermediate', basePrice: 130 },
  concrete: { id: 'concrete', label: 'Concrete', category: 'intermediate', basePrice: 3 },
  lumber: { id: 'lumber', label: 'Lumber', category: 'intermediate', basePrice: 5 },
  fuel: { id: 'fuel', label: 'Fuel', category: 'intermediate', basePrice: 8 },
  chemicals: { id: 'chemicals', label: 'Chemicals', category: 'intermediate', basePrice: 7 },
  fertilizer: { id: 'fertilizer', label: 'Fertilizer', category: 'intermediate', basePrice: 6 },
  explosives: { id: 'explosives', label: 'Explosives', category: 'intermediate', basePrice: 10 },
  semiconductors: { id: 'semiconductors', label: 'Semiconductors', category: 'intermediate', basePrice: 22 },
  dyes: { id: 'dyes', label: 'Dyes', category: 'intermediate', basePrice: 12 },
  glass: { id: 'glass', label: 'Glass', category: 'intermediate', basePrice: 10 },
  paper: { id: 'paper', label: 'Paper', category: 'intermediate', basePrice: 9 },
  tools: { id: 'tools', label: 'Tools', category: 'intermediate', basePrice: 9 },
  machinery: { id: 'machinery', label: 'Machinery', category: 'intermediate', basePrice: 15 },
  heavyMachinery: { id: 'heavyMachinery', label: 'Heavy Machinery', category: 'intermediate', basePrice: 26 },
  electricalMachinery: { id: 'electricalMachinery', label: 'Electrical Machinery', category: 'intermediate', basePrice: 20 },
  precisionMachinery: { id: 'precisionMachinery', label: 'Precision Machinery', category: 'intermediate', basePrice: 34 },
  electronics: { id: 'electronics', label: 'Electronics', category: 'intermediate', basePrice: 18 },
  engines: { id: 'engines', label: 'Engines', category: 'intermediate', basePrice: 20 },
  automobiles: { id: 'automobiles', label: 'Automobiles', category: 'consumer', basePrice: 32 },
  locomotives: { id: 'locomotives', label: 'Locomotives', category: 'intermediate', basePrice: 70 },
  aircraft: { id: 'aircraft', label: 'Aircraft', category: 'consumer', basePrice: 110 },
  oceanGoingShips: { id: 'oceanGoingShips', label: 'Ocean-Going Ships', category: 'intermediate', basePrice: 160 },
  spaceships: { id: 'spaceships', label: 'Spaceships', category: 'intermediate', basePrice: 450 },
  rockets: { id: 'rockets', label: 'Rockets', category: 'intermediate', basePrice: 200 },
  groceries: { id: 'groceries', label: 'Groceries', category: 'consumer', basePrice: 4 },
  consumerGoods: { id: 'consumerGoods', label: 'Consumer Goods', category: 'consumer', basePrice: 6 },
  furniture: { id: 'furniture', label: 'Furniture', category: 'consumer', basePrice: 14 },
  textiles: { id: 'textiles', label: 'Textiles', category: 'consumer', basePrice: 5 },
  luxuryGoods: { id: 'luxuryGoods', label: 'Luxury Goods', category: 'consumer', basePrice: 26 },
  art: { id: 'art', label: 'Art', category: 'consumer', basePrice: 22 },
  healthcare: { id: 'healthcare', label: 'Healthcare', category: 'service', basePrice: 12 },
  dental: { id: 'dental', label: 'Dental Care', category: 'service', basePrice: 10 },
  education: { id: 'education', label: 'Education', category: 'service', basePrice: 11 },
  retail: { id: 'retail', label: 'Retail', category: 'service', basePrice: 7 },
  onlineServices: { id: 'onlineServices', label: 'Online Services', category: 'service', basePrice: 9 },
  transportation: { id: 'transportation', label: 'Transportation', category: 'service', basePrice: 8 },
}

// A price never goes to zero (a good stays worth *something* even in glut, and
// zero would break the "how much can I afford" division in pop buying) and
// never runs away to infinity in a persistent shortage — bounded to a multiple
// of each good's own base price.
export const PRICE_FLOOR = 0.1
export const PRICE_CEILING_MULTIPLE = 12
// The floor is RELATIVE to each good's base price, symmetric with the ceiling:
// in a glut a good sinks toward this fraction of base value but no further. An
// absolute floor let over-supplied RAW materials (mines, farms) crash to a few
// percent of value — far below extraction cost — so their producers could never
// break even. Keeping a relative floor means primary-sector producers stay
// viable even when they've flooded the market. (PRICE_FLOOR remains an absolute
// backstop so nothing ever reaches zero and breaks the "what can I afford"
// division in pop buying.)
export const PRICE_FLOOR_FRACTION = 0.4

export function priceCeiling(good: GoodId): number {
  return GOODS[good].basePrice * PRICE_CEILING_MULTIPLE
}

export function priceFloor(good: GoodId): number {
  return Math.max(PRICE_FLOOR, GOODS[good].basePrice * PRICE_FLOOR_FRACTION)
}
