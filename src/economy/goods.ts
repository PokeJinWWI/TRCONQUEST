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
  // Farm crops (raw agricultural)
  | 'wheat'
  | 'rice'
  | 'livestock'
  // Intermediate / industrial
  | 'steel'
  | 'lumber'
  | 'fuel'
  | 'chemicals'
  | 'fertilizer'
  | 'explosives'
  | 'semiconductors'
  | 'machinery'
  | 'electronics'
  // Consumer / end goods
  | 'food'
  | 'consumerGoods'
  | 'luxuryGoods'
  // Services — produced locally, consumed by pops; healthcare can be publicly
  // funded (see the healthcare law). Services are the soft economy: care,
  // schooling, shops.
  | 'healthcare'
  | 'education'
  | 'retail'

export const GOOD_IDS: GoodId[] = [
  'electricity',
  'ironOre',
  'coal',
  'oil',
  'rareMetals',
  'timber',
  'phosphate',
  'wheat',
  'rice',
  'livestock',
  'steel',
  'lumber',
  'fuel',
  'chemicals',
  'fertilizer',
  'explosives',
  'semiconductors',
  'machinery',
  'electronics',
  'food',
  'consumerGoods',
  'luxuryGoods',
  'healthcare',
  'education',
  'retail',
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
  wheat: { id: 'wheat', label: 'Wheat', category: 'agricultural', basePrice: 2 },
  rice: { id: 'rice', label: 'Rice', category: 'agricultural', basePrice: 2 },
  livestock: { id: 'livestock', label: 'Livestock', category: 'agricultural', basePrice: 6 },
  steel: { id: 'steel', label: 'Steel', category: 'intermediate', basePrice: 8 },
  lumber: { id: 'lumber', label: 'Lumber', category: 'intermediate', basePrice: 5 },
  fuel: { id: 'fuel', label: 'Fuel', category: 'intermediate', basePrice: 8 },
  chemicals: { id: 'chemicals', label: 'Chemicals', category: 'intermediate', basePrice: 7 },
  fertilizer: { id: 'fertilizer', label: 'Fertilizer', category: 'intermediate', basePrice: 6 },
  explosives: { id: 'explosives', label: 'Explosives', category: 'intermediate', basePrice: 10 },
  semiconductors: { id: 'semiconductors', label: 'Semiconductors', category: 'intermediate', basePrice: 22 },
  machinery: { id: 'machinery', label: 'Machinery', category: 'intermediate', basePrice: 14 },
  electronics: { id: 'electronics', label: 'Electronics', category: 'intermediate', basePrice: 18 },
  food: { id: 'food', label: 'Food', category: 'consumer', basePrice: 3 },
  consumerGoods: { id: 'consumerGoods', label: 'Consumer Goods', category: 'consumer', basePrice: 6 },
  luxuryGoods: { id: 'luxuryGoods', label: 'Luxury Goods', category: 'consumer', basePrice: 26 },
  healthcare: { id: 'healthcare', label: 'Healthcare', category: 'service', basePrice: 12 },
  education: { id: 'education', label: 'Education', category: 'service', basePrice: 11 },
  retail: { id: 'retail', label: 'Retail', category: 'service', basePrice: 7 },
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
