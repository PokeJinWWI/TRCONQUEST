// What a new colony starts running in Simple mode: the same idea as Complex mode's kit (economy/empireSeed.kitFor): what the ground
// holds first, then power and food, as far as a handful of settlers can staff, so a colony is never an empty shell in either mode.
// Pure. Complex's kit scales with the settlers; at colony size (a few million) that is one level of each, which is what this is.
import type { PlanetClass } from '../scene/planetData'
import { DISTRICT_OF_BUILDING, SLOTS_PER_DISTRICT, type SimpleBuildingId, type SimpleDistrictId } from '../data/simplisticEconomyData'

// Worlds whose seas and soil feed people; everywhere else grows food under glass (Complex: wheat farms vs hydroponics).
const FARMLAND: ReadonlySet<PlanetClass> = new Set<PlanetClass>(['continental', 'ocean', 'hycean'])
// Classes with nothing to dig (Complex gives them no extraction list).
const NOTHING_TO_DIG: ReadonlySet<PlanetClass> = new Set<PlanetClass>(['lava', 'gas-giant', 'ice-giant'])

export interface ColonyKit {
  buildings: Partial<Record<SimpleBuildingId, number>>
  districts: Partial<Record<SimpleDistrictId, number>>
}

export function simpleColonyKit(planetClass: PlanetClass): ColonyKit {
  const buildings: Partial<Record<SimpleBuildingId, number>> = { powerPlant: 1, [FARMLAND.has(planetClass) ? 'farm' : 'hydroponicsBay']: 1 }
  if (!NOTHING_TO_DIG.has(planetClass)) buildings.mine = 1
  const districts: Partial<Record<SimpleDistrictId, number>> = {}
  for (const [id, n] of Object.entries(buildings) as [SimpleBuildingId, number][]) {
    const d = DISTRICT_OF_BUILDING[id]
    districts[d] = Math.max(districts[d] ?? 0, Math.ceil(n / SLOTS_PER_DISTRICT))
  }
  return { buildings, districts }
}
