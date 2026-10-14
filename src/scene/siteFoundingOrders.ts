// Founding a district at a chosen place, store side: the ground rules (scene/siteFounding) and the builder's right to build there
// (scene/jurisdiction, asked about the candidate site as if it already existed), then the site is recorded in the location store
// and established for the founder. Founding is free by itself: the district's normal cost is paid when its first level is ordered.
import { usePlacementStore } from '../state/placementStore'
import { useLocationStore } from '../state/locationStore'
import type { LocationKind } from '../data/locationData'
import { decideConstruction, type LegalOutcome } from './jurisdiction'
import { locationsOf, type DevLocation } from './locations'
import { defaultGeo, jurisdictionState } from './sovereignty'
import { isFounded, planFounding } from './siteFounding'

export interface FoundingJudgement {
  allowed: boolean
  // One sentence for the player.
  why: string
  legal: LegalOutcome | 'n/a'
  // The site it would be, when the ground allows it.
  site?: DevLocation
}

export function judgeFounding(builderId: string, bodyName: string, kind: LocationKind, node: number): FoundingJudgement {
  const plan = planFounding(bodyName, kind, node, locationsOf(bodyName), builderId)
  if (!plan.ok) return { allowed: false, why: `Cannot found a district there: ${plan.reason}`, legal: 'n/a' }
  const site = plan.site
  const state = { ...jurisdictionState(), geo: { ...defaultGeo, siteOf: (id: string) => (id === site.id ? { bodyName, node } : defaultGeo.siteOf(id)) } }
  const decision = decideConstruction({ builderId, scope: { kind: 'location', id: site.id }, asset: kind, physical: { ok: true } }, state)
  return decision.allowed ? { allowed: true, why: decision.reason, legal: decision.legal, site } : { allowed: false, why: decision.reason, legal: decision.legal, site }
}

export type FoundResult = { ok: true; site: DevLocation } | { ok: false; reason: string }

export function foundSite(builderId: string, bodyName: string, kind: LocationKind, node: number, simDays: number): FoundResult {
  const judged = judgeFounding(builderId, bodyName, kind, node)
  if (!judged.allowed || !judged.site) return { ok: false, reason: judged.why }
  const store = useLocationStore.getState()
  store.addCustom(judged.site)
  store.establish(judged.site.id, builderId, simDays)
  return { ok: true, site: judged.site }
}

// Gives a founded site up. Only an empty one: nothing placed on it and no level developed (taking those down is demolition,
// with its costs).
export function removeFoundedSite(siteId: string): { ok: true } | { ok: false; reason: string } {
  if (!isFounded(siteId)) return { ok: false, reason: 'Only a district you founded can be given up' }
  const p = usePlacementStore.getState()
  if (Object.keys(p.placed[siteId] ?? {}).length > 0 || Object.keys(p.levels[siteId] ?? {}).length > 0) return { ok: false, reason: 'Something still stands there: take it down first' }
  useLocationStore.getState().removeCustom(siteId)
  return { ok: true }
}
