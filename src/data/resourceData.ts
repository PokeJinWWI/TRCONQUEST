// Resource types the top HUD bar displays. No production/consumption system
// exists yet (see resourceStore) — this is the data layer for the readout
// itself, the same "reserve the spot with real empty state, not fake
// numbers" pattern Outliner already uses for Colonies/Starbases.
export type ResourceId = 'energy' | 'minerals' | 'food' | 'consumerGoods' | 'alloys' | 'exoticMatter' | 'hyperium' | 'other'

export interface ResourceType {
  id: ResourceId
  name: string
  // Short label for tight HUD space — falls back to `name` where there's
  // room (e.g. a tooltip).
  short: string
}

export const RESOURCE_TYPES: ResourceType[] = [
  { id: 'energy', name: 'Energy', short: 'NRG' },
  { id: 'minerals', name: 'Minerals', short: 'MIN' },
  { id: 'food', name: 'Food', short: 'FOOD' },
  { id: 'consumerGoods', name: 'Consumer Goods', short: 'GOODS' },
  { id: 'alloys', name: 'Alloys', short: 'ALLOY' },
  { id: 'exoticMatter', name: 'Exotic Matter', short: 'EXOTIC' },
  { id: 'hyperium', name: 'Hyperium', short: 'HYPER' },
  { id: 'other', name: 'Other', short: 'MISC' },
]
