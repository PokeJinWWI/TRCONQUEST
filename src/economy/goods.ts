// Milestone 1 goods — a deliberately small set that still forms a real
// interdependent economy: extraction feeds industry feeds healthcare, plus a
// standalone food chain, so pops have a multi-tier needs basket and buildings
// have real input dependencies on each other (see recipes.ts). New goods are
// added here as data, not code — the tick loop (economyTick.ts) is generic
// over GOOD_IDS.
export type GoodId = 'food' | 'minerals' | 'consumerGoods' | 'medicine'

export const GOOD_IDS: GoodId[] = ['food', 'minerals', 'consumerGoods', 'medicine']

export interface GoodDef {
  id: GoodId
  label: string
  // Broad grouping, matches the design doc's goods taxonomy (Section 15) —
  // display/flavor only for now, no mechanics hang off it yet.
  category: 'food' | 'raw' | 'consumer' | 'healthcare'
  // The price the market gravitates toward at rough supply/demand balance —
  // the anchor the per-tick adjustment (see economyTick.adjustPrice) nudges
  // around, and the base the price ceiling is a multiple of.
  basePrice: number
}

export const GOODS: Record<GoodId, GoodDef> = {
  food: { id: 'food', label: 'Food', category: 'food', basePrice: 2 },
  minerals: { id: 'minerals', label: 'Minerals', category: 'raw', basePrice: 3 },
  consumerGoods: { id: 'consumerGoods', label: 'Consumer Goods', category: 'consumer', basePrice: 6 },
  medicine: { id: 'medicine', label: 'Medicine', category: 'healthcare', basePrice: 10 },
}

// A price never goes to zero (a good stays worth *something* even in glut, and
// zero would break the "how much can I afford" division in pop buying) and
// never runs away to infinity in a persistent shortage (a mineral the whole
// economy has stopped producing shouldn't cost a billion) — bounded to a
// multiple of each good's own base price.
export const PRICE_FLOOR = 0.1
export const PRICE_CEILING_MULTIPLE = 12

export function priceCeiling(good: GoodId): number {
  return GOODS[good].basePrice * PRICE_CEILING_MULTIPLE
}
