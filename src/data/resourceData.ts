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
  // What this resource is and what it's used for — shown in the click-to-open
  // info panel (see ResourceBar.tsx). Real, load-bearing lore/design text
  // even though the numbers behind it (see resourceStore) are still zero —
  // same "the description is real, the data catches up later" pattern as
  // this project's other not-yet-wired systems.
  description: string
}

export const RESOURCE_TYPES: ResourceType[] = [
  {
    id: 'energy',
    name: 'Energy',
    short: 'NRG',
    description: 'Powers ship systems, orbital infrastructure, and most other production. The most universally consumed resource.',
  },
  {
    id: 'minerals',
    name: 'Minerals',
    short: 'MIN',
    description: 'Raw material extracted from planets and asteroids — the basic input for construction, industry, and alloy production.',
  },
  {
    id: 'food',
    name: 'Food',
    short: 'FOOD',
    description: "Feeds a population. A sustained shortage starves colonies; a surplus supports growth.",
  },
  {
    id: 'consumerGoods',
    name: 'Consumer Goods',
    short: 'GOODS',
    description: 'Manufactured products a population consumes to stay content — insufficient supply drags down happiness and stability.',
  },
  {
    id: 'alloys',
    name: 'Alloys',
    short: 'ALLOY',
    description: 'Refined from minerals — the structural material every ship hull and starbase is actually built from.',
  },
  {
    id: 'exoticMatter',
    name: 'Exotic Matter',
    short: 'EXOTIC',
    description: 'A rare form of matter with a higher mass-energy conversion rate than normal matter — fuels warp drives and their onboard systems.',
  },
  {
    id: 'hyperium',
    name: 'Hyperium',
    short: 'HYPER',
    description: "Extremely rare, yields effectively infinite energy, and can't be subdivided — fuels hyperdrives, making every hyperdrive-equipped hull valuable in its own right.",
  },
  {
    id: 'other',
    name: 'Other',
    short: 'MISC',
    description: 'Miscellaneous stockpile not yet broken into its own category.',
  },
]
