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
  // Raw extraction
  | 'ironOre'
  | 'coal'
  | 'oil'
  | 'rareMetals'
  | 'timber'
  | 'phosphate'
  | 'sulfur'
  | 'hardwood'
  // Farm crops (raw agricultural)
  | 'wheat'
  | 'rice'
  | 'livestock'
  | 'sugar'
  | 'coffee'
  | 'tea'
  // Meat — a farm-chain end-good (livestock → meat), alongside crops.
  | 'meat'
  // Intermediate / industrial
  | 'steel'
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
  // Consumer / end goods
  | 'food'
  | 'consumerGoods'
  | 'luxuryGoods'
  // A "culture" consumer good — produced by an Art Studio, bought like any
  // other luxury.
  | 'art'
  // Services — produced locally, consumed by pops; healthcare can be publicly
  // funded (see the healthcare law). Services are the soft economy: care,
  // schooling, shops, and now online/digital services from data centers.
  | 'healthcare'
  | 'education'
  | 'retail'
  | 'onlineServices'
  // Infrastructure — the transport/utility backbone. Consumed by buildings and
  // pops, and it raises the world's MARKET ACCESS: more infrastructure = more
  // freight capacity for inter-world trade (see logistics in economyTick).
  | 'infrastructure'

export const GOOD_IDS: GoodId[] = [
  'electricity',
  'ironOre',
  'coal',
  'oil',
  'rareMetals',
  'timber',
  'phosphate',
  'sulfur',
  'hardwood',
  'wheat',
  'rice',
  'livestock',
  'sugar',
  'coffee',
  'tea',
  'meat',
  'steel',
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
  'food',
  'consumerGoods',
  'luxuryGoods',
  'art',
  'healthcare',
  'education',
  'retail',
  'onlineServices',
  'infrastructure',
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
  ironOre: { id: 'ironOre', label: 'Iron Ore', category: 'raw', basePrice: 3 },
  coal: { id: 'coal', label: 'Coal', category: 'raw', basePrice: 2 },
  oil: { id: 'oil', label: 'Oil', category: 'raw', basePrice: 5 },
  rareMetals: { id: 'rareMetals', label: 'Rare Metals', category: 'raw', basePrice: 16 },
  timber: { id: 'timber', label: 'Timber', category: 'raw', basePrice: 3 },
  phosphate: { id: 'phosphate', label: 'Phosphate', category: 'raw', basePrice: 4 },
  sulfur: { id: 'sulfur', label: 'Sulfur', category: 'raw', basePrice: 4 },
  hardwood: { id: 'hardwood', label: 'Hardwood', category: 'raw', basePrice: 5 },
  wheat: { id: 'wheat', label: 'Wheat', category: 'agricultural', basePrice: 2 },
  rice: { id: 'rice', label: 'Rice', category: 'agricultural', basePrice: 2 },
  livestock: { id: 'livestock', label: 'Livestock', category: 'agricultural', basePrice: 6 },
  sugar: { id: 'sugar', label: 'Sugar', category: 'agricultural', basePrice: 3 },
  coffee: { id: 'coffee', label: 'Coffee', category: 'agricultural', basePrice: 8 },
  tea: { id: 'tea', label: 'Tea', category: 'agricultural', basePrice: 7 },
  meat: { id: 'meat', label: 'Meat', category: 'agricultural', basePrice: 7 },
  steel: { id: 'steel', label: 'Steel', category: 'intermediate', basePrice: 8 },
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
  food: { id: 'food', label: 'Food', category: 'consumer', basePrice: 3 },
  consumerGoods: { id: 'consumerGoods', label: 'Consumer Goods', category: 'consumer', basePrice: 6 },
  luxuryGoods: { id: 'luxuryGoods', label: 'Luxury Goods', category: 'consumer', basePrice: 26 },
  art: { id: 'art', label: 'Art', category: 'consumer', basePrice: 22 },
  healthcare: { id: 'healthcare', label: 'Healthcare', category: 'service', basePrice: 12 },
  education: { id: 'education', label: 'Education', category: 'service', basePrice: 11 },
  retail: { id: 'retail', label: 'Retail', category: 'service', basePrice: 7 },
  onlineServices: { id: 'onlineServices', label: 'Online Services', category: 'service', basePrice: 9 },
  infrastructure: { id: 'infrastructure', label: 'Infrastructure', category: 'service', basePrice: 8 },
}

// A price never goes to zero (a good stays worth *something* even in glut, and
// zero would break the "how much can I afford" division in pop buying) and
// never runs away to infinity in a persistent shortage — bounded to a multiple
// of each good's own base price.
export const PRICE_FLOOR = 0.1
export const PRICE_CEILING_MULTIPLE = 12

export function priceCeiling(good: GoodId): number {
  return GOODS[good].basePrice * PRICE_CEILING_MULTIPLE
}
