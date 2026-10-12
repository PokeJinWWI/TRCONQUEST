// Saves from before the Complex `resource` district was split into `mining` and `agricultural`: a world's resource levels (and the
// slots and orders that went with them) are divided between the two by what its buildings use, so nothing the world held is lost and
// every building still has a district to stand in. Idempotent: a world with no `resource` key is returned as it is.
import { SLOTS_PER_DISTRICT_LEVEL } from './districts'
import { districtOfRecipe } from './recipes'
import type { World } from './economyTypes'

type Loose = Record<string, number | undefined>

export function migrateWorldDistricts(world: World): World {
  const levels = world.districts as Loose | undefined
  const capacity = world.districtCapacity as Loose
  if (!(levels && 'resource' in levels) && !('resource' in capacity)) return world
  const old = levels?.resource ?? Math.ceil((capacity.resource ?? 0) / SLOTS_PER_DISTRICT_LEVEL)
  let mining = 0
  let agri = 0
  for (const b of world.buildings) {
    const d = districtOfRecipe(b.recipeId)
    if (d === 'mining') mining += b.level
    else if (d === 'agricultural') agri += b.level
  }
  const toMining = mining + agri === 0 ? old : Math.round((old * mining) / (mining + agri))
  const toAgri = old - toMining
  const withoutResource = (rec: Loose): Loose => {
    const { resource: _drop, ...rest } = rec
    void _drop
    return rest
  }
  return {
    ...world,
    districts: levels ? ({ ...withoutResource(levels), mining: (levels.mining ?? 0) + toMining, agricultural: (levels.agricultural ?? 0) + toAgri } as World['districts']) : world.districts,
    districtCapacity: { ...withoutResource(capacity), mining: (capacity.mining ?? 0) + toMining * SLOTS_PER_DISTRICT_LEVEL, agricultural: (capacity.agricultural ?? 0) + toAgri * SLOTS_PER_DISTRICT_LEVEL } as World['districtCapacity'],
    constructionQueue: world.constructionQueue.map((o) => ((o.district as string | undefined) === 'resource' ? { ...o, district: 'mining' as const } : o)),
  }
}
