// Applies scene/seedPlacement.assignSeed to a body of the running game: assigns the world's starting district levels and
// buildings to its sites, makes those sites the owner's (marked connected), and records the body as seeded.
import { seedPorts } from './portStructures'
import { useGameTimeStore } from '../state/gameTimeStore'
import { siteOwner, useLocationStore } from '../state/locationStore'
import { usePlacementStore } from '../state/placementStore'
import { economyModel } from '../state/playerStore'
import { useTerritoryStore } from '../state/territoryStore'
import { groundKeySurface } from '../state/defenseStore'
import { useCivicStore } from '../state/civicStore'
import { civicOf } from './civic'
import { locationsOf } from './locations'
import { assignSeed, type SeedResult } from './seedPlacement'
import { hasWorld, worldBuildings, worldLevels } from './worldDistricts'

const modeNow = () => (economyModel() === 'abstract' ? ('simple' as const) : ('complex' as const))

// The civic buildings of a body, written once (scene/civic.ts).
export function seedCivic(bodyName: string): void {
  if (useCivicStore.getState().civic[bodyName]) return
  const surface = groundKeySurface(bodyName)
  if (!surface) return
  useCivicStore.getState().setBody(bodyName, civicOf(surface, locationsOf(bodyName)))
}

// Seeds one body (idempotent). Returns what was left over, or null if there was nothing to seed.
export function seedBodyPlacement(bodyName: string): SeedResult | null {
  const store = usePlacementStore.getState()
  if (store.seeded[bodyName]) return null
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  const mode = modeNow()
  if (!owner || !hasWorld(bodyName, mode)) return null
  const sites = locationsOf(bodyName)
  if (sites.length === 0) return null
  seedCivic(bodyName)
  const result = assignSeed({
    mode,
    sites,
    // A settlement or port must already be the nation's (the capital and cities, its spaceports); open ground may be taken.
    eligible: (s) => (s.kind === 'settlement' || s.kind === 'infrastructure' ? siteOwner(s.id) === owner : !siteOwner(s.id) || siteOwner(s.id) === owner),
    districts: worldLevels(bodyName, mode),
    buildings: worldBuildings(bodyName, mode),
  })
  const now = useGameTimeStore.getState().simDays
  for (const siteId of new Set([...Object.keys(result.levels), ...Object.keys(result.placed)])) {
    useLocationStore.getState().establish(siteId, owner, now, { connected: true })
    for (const [d, n] of Object.entries(result.levels[siteId] ?? {})) usePlacementStore.getState().addLevel(siteId, d, n)
    for (const [id, n] of Object.entries(result.placed[siteId] ?? {})) usePlacementStore.getState().place(siteId, id, n)
  }
  usePlacementStore.getState().markSeeded(bodyName)
  // The world's auto-placed spaceports become structures at the nodes they already had (so they can be named and moved from here on).
  seedPorts(bodyName)
  return result
}

// In a real game (a new game sets autoSeed), a world's starting buildings are placed the first time anything needs to know where
// they are. A bare test, and a body with no economy, stays as it was.
export function ensureSeeded(bodyName: string): void {
  const s = usePlacementStore.getState()
  if (s.autoSeed && !s.seeded[bodyName]) seedBodyPlacement(bodyName)
}
