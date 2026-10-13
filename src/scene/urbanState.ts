// Settlements of a body in the live game: gathers the inputs of scene/urban.urbanProfile from the stores, and
// founds a new settlement (a second place to live on a body, under the same rules as any construction).
import { useGameTimeStore } from '../state/gameTimeStore'
import { useLocationStore, siteOwner } from '../state/locationStore'
import { usePlacementStore } from '../state/placementStore'
import { isAbstractEconomy } from '../state/playerStore'
import { accessOnBody } from './infrastructureOrders'
import { baseCapacity, locationsOf } from './locations'
import { reconcileBody } from './placementOrders'
import { syncCivicHalls } from './seedPlacementOrders'
import { siteKindOf } from './placement'
import { defaultGeo, decideConstructionNow, strengthenBySettlementNow } from './sovereignty'
import { maturityOf } from './urbanMaturity'
import { urbanProfile, type UrbanSettlement } from './urban'
import { bodyPopulation } from './urbanPopulation'

export { bodyPopulation }

// The settlements of a body held by `nationId`, as they stand.
export function urbanNow(bodyName: string, nationId: string): UrbanSettlement[] {
  reconcileBody(bodyName)
  const sites = locationsOf(bodyName).filter((s) => s.node !== null)
  const settlements = sites.filter((s) => s.kind === 'settlement' && siteOwner(s.id) === nationId).map((s) => ({ id: s.id, node: s.node!, capacity: s.capacity, shareCapacity: baseCapacity(s), suitability: s.suitability, capital: s.tags.includes('capital'), maturity: maturityOf(useLocationStore.getState().established[s.id], useGameTimeStore.getState().simDays) }))
  const placed = usePlacementStore.getState().placed
  const placements = sites.flatMap((s) =>
    Object.entries(placed[s.id] ?? {}).map(([id, count]) => ({ siteId: s.id, node: s.node!, kind: siteKindOf({ mode: isAbstractEconomy() ? 'simple' : 'complex', id }), count })),
  )
  // The body's people are shared among every nation's settlements by the room each holds: a nation counts only its own share.
  const allRoom = sites.filter((s) => s.kind === 'settlement' && siteOwner(s.id)).reduce((n, s) => n + baseCapacity(s), 0)
  const ownRoom = settlements.reduce((n, s) => n + (s.shareCapacity ?? s.capacity), 0)
  const population = allRoom > 0 ? (bodyPopulation(bodyName) * ownRoom) / allRoom : 0
  return urbanProfile({ bodyName, population, settlements, placements, access: accessOnBody(bodyName, nationId), cellsBetween: defaultGeo.cellsBetween })
}

// Founds a settlement on an open settlement site: needs the right to build there, files the settlement claim
// and makes the site the nation's. Its people come from the body's population as its share grows (urbanNow);
// nothing is moved by hand and no city is declared.
export function foundSettlement(nationId: string, siteId: string): { ok: true } | { ok: false; reason: string } {
  const d = decideConstructionNow(nationId, { kind: 'location', id: siteId }, 'settlement')
  if (!d.allowed) return { ok: false, reason: d.reason }
  const site = locationsOf(siteId.slice(0, siteId.lastIndexOf('#'))).find((s) => s.id === siteId)
  if (!site) return { ok: false, reason: 'No such site' }
  if (siteOwner(siteId) === nationId) return { ok: false, reason: 'You already hold this settlement' }
  const now = useGameTimeStore.getState().simDays
  if (!useLocationStore.getState().establish(siteId, nationId, now)) return { ok: false, reason: 'Someone else holds this site' }
  strengthenBySettlementNow(nationId, siteId, now)
  syncCivicHalls(site.bodyName)
  return { ok: true }
}
