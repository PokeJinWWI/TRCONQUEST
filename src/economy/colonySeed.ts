// The Complex-mode economy of a colony founded in a running game: one new World for the
// nation, sized from the settlers who came, its buildings from what the body's ground holds
// (the same kit the generated empires' colonies run: empireSeed.kitFor), its people of the
// capital's own culture, species and faiths. Pure; the store adds the result
// (economyStore.addWorld). Simple mode's analogue is abstractEconomyStore.addColonyWorld.
import { habitabilityOfClass } from './habitability'
import { landForBody } from '../scene/bodyLand'
import { bodyGroundInfoAny } from '../scene/planetTerrain'
import { COLONY_KIT_POPULATION, MICRO_COLONY_LAND } from '../data/colonyData'
import type { World } from './economyTypes'
import { kitFor } from './empireSeed'
import { seedStandaloneWorld, type WorldSpec } from './economySeed'
import type { ReligionMix } from './demographics'
import type { SettlerMix } from './settlerPicker'

// The people's make-up copied from an existing world: its culture, species and the share of each faith.
function demographicsOf(home: World): { culture: string; species: string; religions: ReligionMix } {
  const total = home.pops.reduce((n, p) => n + p.populationSize, 0) || 1
  const shares = new Map<string, number>()
  for (const p of home.pops) shares.set(p.religionId, (shares.get(p.religionId) ?? 0) + p.populationSize / total)
  const religions: ReligionMix = [...shares].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([religion, share]) => ({ religion, share }))
  return { culture: home.cultureId, species: home.pops[0]?.speciesTemplateId ?? 'baseline-organic', religions }
}

// `settlers` is in millions of people. `home` is the nation's capital world (whose people they are).
export function seedColonyWorld(args: { bodyName: string; ownerId: string; settlers: number; home: World; landLimit?: number; mix?: SettlerMix }): World | null {
  const info = bodyGroundInfoAny(args.bodyName)
  if (!info || args.settlers <= 0) return null
  const cap = args.landLimit ?? MICRO_COLONY_LAND
  const spec: WorldSpec = {
    id: args.bodyName,
    ownerId: args.ownerId,
    ...demographicsOf(args.home),
    population: args.settlers,
    capacity: Math.max(args.settlers * 5, 100),
    // Sized as for a colony of COLONY_KIT_POPULATION: a few million settlers could not staff a single level of anything by the
    // job budget, so the colony would start with nothing to run; the plants run at what the people there can staff.
    buildings: kitFor(info.planetClass, Math.max(args.settlers, COLONY_KIT_POPULATION), false),
    habitability: habitabilityOfClass(info.planetClass),
    ...(args.mix && Object.keys(args.mix).length > 0 ? { classMix: args.mix } : {}),
  }
  return seedStandaloneWorld([{ id: args.ownerId, capitalBodyName: args.home.id, privateLed: false }], spec, { landOf: (b) => Math.min(landForBody(b), cap) })
}
