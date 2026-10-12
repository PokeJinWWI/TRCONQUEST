// What taking a level or a building down costs, pure. The scale: a farm is the cheapest thing to remove, a factory park is heavy,
// clearing a mine grows with the depth it was worked to, and a city is heaviest and displaces its people. The orders layer
// (scene/demolitionOrders.ts) charges it through the same dual payment as every other state project.
import { BUILDING_DEMOLITION_SHARE, DEMOLITION_PER_MILLION_PEOPLE, DISPLACED_SHARE, LEVEL_DEMOLITION, MINING_DEPTH_STEP, type DemolitionDistrict } from '../data/demolitionData'
import type { GoodCost, ResourceCost } from '../data/shipyardData'

export interface DemolitionQuote {
  goods: GoodCost
  resources: ResourceCost
  // People who would have to leave the world (millions), for an urban or core level.
  displacedMillions: number
}

export interface DemolitionContext {
  district: string
  what: 'level' | 'building'
  // Levels of this district developed at the site (a deeper mine costs more to clear).
  levelsHere: number
  // Millions of people living in the settlement the level belongs to.
  populationMillions?: number
}

export const demolitionDistrict = (district: string): DemolitionDistrict => (district in LEVEL_DEMOLITION ? (district as DemolitionDistrict) : 'industrial')

function scaled(goods: GoodCost, factor: number): GoodCost {
  return Object.fromEntries(Object.entries(goods).map(([k, v]) => [k, Math.round((v ?? 0) * factor * 100) / 100])) as GoodCost
}
function scaledResources(r: ResourceCost, factor: number): ResourceCost {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round((v ?? 0) * factor * 100) / 100])) as ResourceCost
}
function added<T extends Record<string, number | undefined>>(a: T, b: T): T {
  const out: Record<string, number | undefined> = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + (v ?? 0)
  return out as T
}

export function demolitionQuote(ctx: DemolitionContext): DemolitionQuote {
  const d = demolitionDistrict(ctx.district)
  const rate = LEVEL_DEMOLITION[d]
  const share = ctx.what === 'building' ? BUILDING_DEMOLITION_SHARE : 1
  // Clearing a mine: more of the site worked, more to put right.
  const depth = d === 'mining' ? 1 + MINING_DEPTH_STEP * Math.max(0, ctx.levelsHere - 1) : 1
  let goods = scaled(rate.goods, share * depth)
  let resources = scaledResources(rate.resources, share * depth)
  let displacedMillions = 0
  if (ctx.what === 'level' && (d === 'urban' || d === 'core')) {
    const people = ctx.populationMillions ?? 0
    // One level of the settlement's `levelsHere` houses its share of the people.
    const levelPeople = people / Math.max(1, ctx.levelsHere)
    displacedMillions = levelPeople * DISPLACED_SHARE
    goods = added(goods, scaled(DEMOLITION_PER_MILLION_PEOPLE.goods, levelPeople))
    resources = added(resources, scaledResources(DEMOLITION_PER_MILLION_PEOPLE.resources, levelPeople))
  }
  return { goods, resources, displacedMillions }
}

// A single number to compare removals by (tests, the hover tip's "heavy / light"): the total material count.
export function demolitionWeight(q: DemolitionQuote): number {
  return Object.values(q.resources).reduce((n, v) => n + (v ?? 0), 0)
}
