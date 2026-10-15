// Placement, store side: asks "where may this builder put this building?" and records
// the answer. Both economies' build queues call `planPlacement` before they accept an
// order and `recordPlacement` when they do (state/abstractEconomyStore.queueBuilding,
// state/economyStore.queueConstruction), so the player, the AI and the tests share one path.
//
// It is the place where the two answers meet, and they stay apart in the result: the
// builder's RIGHT to build there (scene/sovereignty: jurisdiction) and whether the building
// PHYSICALLY fits (scene/placement: site kind, deposit, room).
import { levelAtSite } from '../economy/buildingSites'
import { isAutoBuilt, isRural } from '../economy/recipes'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useLocationStore } from '../state/locationStore'
import { usePlacementStore } from '../state/placementStore'
import { economyModel } from '../state/playerStore'
import { useTerritoryStore } from '../state/territoryStore'
import { accessOnBody } from './infrastructureOrders'
import { locationsOf, type DevLocation } from './locations'
import { STANDALONE_BUILDINGS, physicalFit, pickSite, siteKindOf, siteKindsFor, slotsUsedBy, type BuildingRef } from './placement'
import { decideConstructionNow } from './sovereignty'
import { INDUSTRY_SHARE_OF_SETTLEMENT, districtOfBuilding, isPlacedDistrict, siteKindsOfDistrict, slotsPerLevel } from './districtSites'
import { ensureSeeded } from './seedPlacementOrders'
import { queuedLevels, worldLevels } from './worldDistricts'
import { recordTerritorialIncident } from './territorialIncidents'

export const refOf = (id: string): BuildingRef => ({ mode: economyModel() === 'abstract' ? 'simple' : 'complex', id })

// How many of a building exist or are on order on a body, in the running economy.
export function liveCount(ref: BuildingRef, bodyName: string): number {
  if (ref.mode === 'simple') {
    const owner = useTerritoryStore.getState().bodyOwner[bodyName]
    const built = useAbstractEconomyStore.getState().worlds[bodyName]?.buildings[ref.id as never] ?? 0
    const queued = owner ? (useAbstractEconomyStore.getState().byCountry[owner]?.queue ?? []).filter((o) => o.bodyName === bodyName && o.building === ref.id).length : 0
    return (built as number) + queued
  }
  const world = worldByName(useEconomyStore.getState().worlds, bodyName)
  if (!world) return 0
  const built = world.buildings.filter((b) => b.recipeId === ref.id).reduce((n, b) => n + b.level, 0)
  return built + world.constructionQueue.filter((o) => o.recipeId === ref.id && !o.district).length
}

const sitesOfBody = (bodyName: string): string[] => Object.keys(usePlacementStore.getState().placed).filter((id) => id.startsWith(`${bodyName}#`))

// Trims the ledger of a body back to what exists or is on order (a cancelled order, a
// demolished building): the most recently placed sites give up theirs first.
export function reconcileBody(bodyName: string): void {
  reconcileLevels(bodyName)
  if (refOf('').mode === 'complex') {
    reconcileComplexBuildings(bodyName)
    return
  }
  const store = usePlacementStore.getState()
  const ids = new Set<string>()
  for (const site of sitesOfBody(bodyName)) for (const id of Object.keys(store.placed[site])) ids.add(id)
  for (const id of ids) {
    const ref = refOf(id)
    let extra = sitesOfBody(bodyName).reduce((n, site) => n + (usePlacementStore.getState().placed[site]?.[id] ?? 0), 0) - liveCount(ref, bodyName)
    for (const site of [...sitesOfBody(bodyName)].reverse()) {
      if (extra <= 0) break
      const here = usePlacementStore.getState().placed[site]?.[id] ?? 0
      const cut = Math.min(here, extra)
      if (cut > 0) usePlacementStore.getState().unplace(site, id, cut)
      extra -= cut
    }
  }
}

// Complex: a building knows its own site (economy/buildingSites), so the ledger entry at a site is what stands there (the
// Buildings tagged with it) plus what is on order there, plus the units of an UNPLACED building that the ledger has claimed (a
// start or an old save not yet split). Anything above that is a ghost (a level the AI downsized, a cancelled order) and goes, at
// exactly the site it is on.
function reconcileComplexBuildings(bodyName: string): void {
  const world = worldByName(useEconomyStore.getState().worlds, bodyName)
  const sites = sitesOfBody(bodyName)
  const store = usePlacementStore.getState()
  const ids = new Set<string>()
  for (const site of sites) for (const id of Object.keys(store.placed[site] ?? {})) ids.add(id)
  for (const id of ids) {
    const unplaced = world ? world.buildings.filter((b) => b.recipeId === id && !b.siteId).reduce((n, b) => n + b.level, 0) : 0
    const queuedAt = (site: string) => (world ? world.constructionQueue.filter((o) => o.recipeId === id && !o.district && o.siteId === site).length : 0)
    const builtAt = (site: string) => (world ? levelAtSite(world.buildings, id, site) : 0)
    const excess = new Map<string, number>()
    let claimed = 0
    for (const site of sites) {
      const have = usePlacementStore.getState().placed[site]?.[id] ?? 0
      const over = have - builtAt(site) - queuedAt(site)
      if (over > 0) {
        excess.set(site, over)
        claimed += over
      }
    }
    let ghosts = claimed - unplaced
    // Orders placed by the AI's own queue before the world was seen carry no siteId: they are the queued units nobody tagged.
    if (ghosts > 0 && world) ghosts -= world.constructionQueue.filter((o) => o.recipeId === id && !o.district && !o.siteId).length
    for (const site of [...excess.keys()].reverse()) {
      if (ghosts <= 0) break
      const cut = Math.min(excess.get(site)!, ghosts)
      usePlacementStore.getState().unplace(site, id, cut)
      ghosts -= cut
    }
  }
}

// Slots a district's buildings use at a site, read straight from the ledger (no reconciling: it is called while reconciling).
function rawDistrictUsed(siteId: string, district: string, mode: 'simple' | 'complex'): number {
  return Object.entries(usePlacementStore.getState().placed[siteId] ?? {}).filter(([id]) => districtOfBuilding({ mode, id }) === district).reduce((n, [id, count]) => n + count * slotsUsedBy({ mode, id }), 0)
}

// The same for district levels: no body keeps more levels on its sites than its world has (plus the ones on order).
function reconcileLevels(bodyName: string): void {
  const store = usePlacementStore.getState()
  const sites = Object.keys(store.levels).filter((id) => id.startsWith(`${bodyName}#`))
  if (sites.length === 0) return
  const mode = refOf('').mode
  const have = worldLevels(bodyName, mode)
  const queued = queuedLevels(bodyName, mode)
  const districts = new Set<string>()
  for (const site of sites) for (const d of Object.keys(store.levels[site])) districts.add(d)
  for (const d of districts) {
    if (!isPlacedDistrict(d)) continue
    let extra = [...sites].reduce((n, site) => n + (usePlacementStore.getState().levels[site]?.[d] ?? 0), 0) - ((have[d] ?? 0) + (queued[d] ?? 0))
    // A level lost (a deconstructed one, a cancelled order) comes off the site with the most room to spare, never one that is full.
    const spare = (site: string) => (usePlacementStore.getState().levels[site]?.[d] ?? 0) * slotsPerLevel(mode) - rawDistrictUsed(site, d, mode)
    for (const site of [...sites].sort((a, b) => spare(a) - spare(b) || (a < b ? -1 : 1)).reverse()) {
      if (extra <= 0) break
      const here = usePlacementStore.getState().levels[site]?.[d] ?? 0
      const cut = Math.min(here, extra)
      if (cut > 0) usePlacementStore.getState().removeLevel(site, d, cut)
      extra -= cut
    }
  }
}

// What stands on a site, trimmed to what exists.
export function placedOn(siteId: string): Record<string, number> {
  reconcileBody(siteId.slice(0, siteId.lastIndexOf('#')))
  return { ...(usePlacementStore.getState().placed[siteId] ?? {}) }
}

export function usedSlots(siteId: string): number {
  return Object.entries(placedOn(siteId)).reduce((n, [id, count]) => n + count * slotsUsedBy(refOf(id)), 0)
}

// Developed slots of a district at a site, and the slots its buildings use there.
export function developedSlotsAt(siteId: string, district: string): number {
  return (usePlacementStore.getState().levels[siteId]?.[district] ?? 0) * slotsPerLevel(refOf('').mode)
}
export function districtUsedAt(siteId: string, district: string): number {
  return Object.entries(placedOn(siteId)).filter(([id]) => districtOfBuilding(refOf(id)) === district).reduce((n, [id, count]) => n + count * slotsUsedBy(refOf(id)), 0)
}
const bodySeeded = (bodyName: string): boolean => !!usePlacementStore.getState().seeded[bodyName]

export type PlacementPlan = { ok: true; site?: DevLocation } | { ok: false; reason: string }

// One site judged for one building, the law's answer and the ground's kept apart (what the "where?" chooser shows).
export interface SiteJudgement {
  allowed: boolean
  legal: string
  // The ground's objection, or null when the building fits.
  physical: string | null
  // One sentence for the player.
  why: string
}

export function judgeSiteForBuilding(builderId: string, bodyName: string, ref: BuildingRef, site: DevLocation): SiteJudgement {
  const strict = bodySeeded(bodyName)
  const district = districtOfBuilding(ref)
  const decision = decideConstructionNow(builderId, { kind: 'location', id: site.id }, siteKindsFor(ref).includes(site.kind) ? site.kind : siteKindOf(ref))
  const legalOk = ['authorized', 'treaty', 'limited-right', 'contested'].includes(decision.legal)
  if (!legalOk) return { allowed: false, legal: decision.legal, physical: null, why: decision.reason }
  if (!decision.physical.ok) return { allowed: false, legal: decision.legal, physical: decision.physical.reason, why: `Cannot build there: ${decision.physical.reason}` }
  const fit = strict && slotsUsedBy(ref) > 0 ? physicalFit(site, ref, districtUsedAt(site.id, district), developedSlotsAt(site.id, district)) : physicalFit(site, ref, usedSlots(site.id))
  return fit.ok ? { allowed: true, legal: decision.legal, physical: null, why: decision.reason } : { allowed: false, legal: decision.legal, physical: fit.reason, why: `Cannot build there: ${fit.reason}` }
}

// The same for developing a district level at a site.
export function judgeSiteForLevel(builderId: string, bodyName: string, district: string, site: DevLocation): SiteJudgement {
  const kinds = siteKindsOfDistrict(refOf('').mode, district)
  if (!kinds.includes(site.kind)) return { allowed: false, legal: 'n/a', physical: `a ${district} district is developed on ${kinds.join(' or ')} sites`, why: `A ${district} district is developed on ${kinds.join(' or ')} sites, not ${site.kind} sites` }
  const d = decideConstructionNow(builderId, { kind: 'location', id: site.id }, site.kind)
  if (!d.allowed) return { allowed: false, legal: d.legal, physical: d.physical.ok ? null : d.physical.reason, why: d.reason }
  if (site.kind === 'settlement' && (district === 'industrial' || district === 'generator')) {
    const industrial = usePlacementStore.getState().levels[site.id]?.[district] ?? 0
    const share = Math.max(1, Math.floor(site.capacity * INDUSTRY_SHARE_OF_SETTLEMENT))
    if (industrial >= share) return { allowed: false, legal: d.legal, physical: 'a settlement gives only a third of its room to industry', why: `This settlement already gives all the room it can spare (${share} level${share === 1 ? '' : 's'}) to industry` }
  }
  if (levelRoomAt(site) <= 0) return { allowed: false, legal: d.legal, physical: 'no room for another district level', why: 'This site has no room for another district level' }
  void bodyName
  return { allowed: true, legal: d.legal, physical: null, why: d.reason }
}

// Where `builderId` can put `ref` on `bodyName`: the site asked for, or the best one that
// both the law and the ground allow. A body with no sites at all (nothing generated) has no
// placement to make and the order goes ahead as it always did.
export function planPlacement(builderId: string, bodyName: string, ref: BuildingRef, siteId?: string): PlacementPlan {
  // A standalone building (a spaceport) stands on its own ground: no site is booked and no room is needed (scene/portList.ts lists them).
  if (STANDALONE_BUILDINGS.has(ref.id)) return { ok: true }
  return planSited(builderId, bodyName, ref, siteId)
}

function planSited(builderId: string, bodyName: string, ref: BuildingRef, siteId?: string): PlacementPlan {
  // A rural structure (a space-elevator anchor) stands on a node of its own: scene/ruralOrders places it, no site is booked.
  if (isRural(ref.id)) return { ok: true }
  const sites = locationsOf(bodyName)
  if (sites.length === 0) return { ok: true }
  ensureSeeded(bodyName)
  reconcileBody(bodyName)
  const asset = siteKindOf(ref)
  const check = (site: DevLocation): { ok: true } | { ok: false; reason: string } => {
    const j = judgeSiteForBuilding(builderId, bodyName, ref, site)
    return j.allowed ? { ok: true } : { ok: false, reason: j.why }
  }
  if (siteId) {
    const site = sites.find((s) => s.id === siteId)
    if (!site) return { ok: false, reason: `${siteId} is not a site on ${bodyName}` }
    const r = check(site)
    return r.ok ? { ok: true, site } : { ok: false, reason: r.reason }
  }
  // Best first: good ground that its freight can get out of (scene/infrastructureNet), so the player's default and the
  // AI's are never a factory at the end of nowhere when a connected site would do.
  const reach = accessOnBody(bodyName, builderId)
  const order = siteKindsFor(ref)
  const ranked = [...sites].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.suitability * (reach[b.id] ?? 1) - a.suitability * (reach[a.id] ?? 1) || b.suitability - a.suitability || a.id.localeCompare(b.id))
  let firstFailure: string | null = null
  for (const site of ranked) {
    if (!siteKindsFor(ref).includes(site.kind)) continue
    const r = check(site)
    if (r.ok) return { ok: true, site }
    firstFailure ??= r.reason
  }
  if (firstFailure) return { ok: false, reason: firstFailure }
  const picked = pickSite(sites, ref, usedSlots)
  return picked ? { ok: true, site: picked } : { ok: false, reason: `${bodyName} has no ${asset} site for this` }
}

// The order was accepted: the site is the builder's (if it was open ground) and the building is placed on it.
export function recordPlacement(plan: PlacementPlan, builderId: string, ref: BuildingRef): void {
  if (!plan.ok || !plan.site) return
  const now = useGameTimeStore.getState().simDays
  // Building where it is disputed is a diplomatic incident (scene/territorialIncidents.ts), judged before the site becomes the builder's.
  recordTerritorialIncident(builderId, { kind: 'location', id: plan.site.id }, siteKindOf(ref), now)
  useLocationStore.getState().establish(plan.site.id, builderId, now)
  usePlacementStore.getState().place(plan.site.id, ref.id)
}

// The economies' own AIs (Complex: the state and the companies, inside the worker; Simple: the nation AI, which
// queues in pure code) order buildings without asking for a site. Each month the buildings they ordered get the
// best site the builder may use, where one fits; an order no site fits is left alone, as before (refusing it would be a
// second rule inside a balanced economy: docs/territorial-design.md M12). The player's orders never come here:
// they are placed when they are queued.
export function placeUnplacedOrders(): void {
  if (economyModel() === 'abstract') {
    const store = useAbstractEconomyStore.getState()
    for (const [nation, state] of Object.entries(store.byCountry)) {
      for (const order of state.queue) {
        if (order.siteId) continue
        if (order.district) {
          const level = planDistrictLevel(nation, order.bodyName, order.district)
          if (level.ok && level.site) {
            useAbstractEconomyStore.getState().setOrderSite(nation, order.id, level.site.id)
            recordLevel(level, nation, order.district)
          }
          continue
        }
        if (!order.building) continue
        const ref = { mode: 'simple' as const, id: order.building }
        const plan = planPlacement(nation, order.bodyName, ref)
        if (!plan.ok || !plan.site) continue
        useAbstractEconomyStore.getState().setOrderSite(nation, order.id, plan.site.id)
        recordPlacement(plan, nation, ref)
      }
    }
    return
  }
  for (const world of useEconomyStore.getState().worlds) {
    for (const order of world.constructionQueue) {
      if (order.siteId) continue
      if (order.district) {
        const level = planDistrictLevel(world.ownerId, world.id, order.district)
        if (level.ok && level.site) {
          useEconomyStore.getState().setOrderSite(world.id, order.id, level.site.id)
          recordLevel(level, world.ownerId, order.district)
        }
        continue
      }
      if (!order.recipeId || isAutoBuilt(order.recipeId)) continue
      const ref = { mode: 'complex' as const, id: order.recipeId }
      const plan = planPlacement(world.ownerId, world.id, ref)
      if (!plan.ok || !plan.site) continue
      useEconomyStore.getState().setOrderSite(world.id, order.id, plan.site.id)
      recordPlacement(plan, world.ownerId, ref)
    }
  }
}

// ---- district levels, developed AT a site ----------------------------------------------------------------

const levelsTotalAt = (siteId: string): number => Object.values(usePlacementStore.getState().levels[siteId] ?? {}).reduce((n, v) => n + v, 0)

// Levels a site can still be given: its capacity less what is developed (or on order) there.
export const levelRoomAt = (site: DevLocation): number => Math.max(0, site.capacity - levelsTotalAt(site.id))

// Where `builderId` can develop one more level of `district` on `bodyName`: the site asked for, or the best open one that the
// law and the ground allow (a site of a kind the district stands on, with capacity left). A body with no sites, or a district
// nobody places, goes ahead as it always did.
export function planDistrictLevel(builderId: string, bodyName: string, district: string, siteId?: string): PlacementPlan {
  const sites = locationsOf(bodyName)
  const kinds = siteKindsOfDistrict(refOf('').mode, district)
  if (sites.length === 0 || kinds.length === 0 || !isPlacedDistrict(district)) return { ok: true }
  ensureSeeded(bodyName)
  reconcileBody(bodyName)
  const check = (site: DevLocation): { ok: true } | { ok: false; reason: string } => {
    const j = judgeSiteForLevel(builderId, bodyName, district, site)
    return j.allowed ? { ok: true } : { ok: false, reason: j.why }
  }
  if (siteId) {
    const site = sites.find((s) => s.id === siteId)
    if (!site) return { ok: false, reason: `${siteId} is not a site on ${bodyName}` }
    const r = check(site)
    return r.ok ? { ok: true, site } : r
  }
  const reach = accessOnBody(bodyName, builderId)
  const ranked = sites.filter((s) => kinds.includes(s.kind)).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || b.suitability * (reach[b.id] ?? 1) - a.suitability * (reach[a.id] ?? 1) || (a.id < b.id ? -1 : 1))
  let why: string | null = null
  for (const site of ranked) {
    const r = check(site)
    if (r.ok) return { ok: true, site }
    why ??= r.reason
  }
  return { ok: false, reason: why ?? `${bodyName} has no ${kinds.join(' or ')} site for a ${district} district` }
}

// The level was ordered: the site is the builder's (if it was open ground) and the level is recorded on it.
export function recordLevel(plan: PlacementPlan, builderId: string, district: string): void {
  if (!plan.ok || !plan.site) return
  const now = useGameTimeStore.getState().simDays
  recordTerritorialIncident(builderId, { kind: 'location', id: plan.site.id }, plan.site.kind, now)
  useLocationStore.getState().establish(plan.site.id, builderId, now)
  usePlacementStore.getState().addLevel(plan.site.id, district)
}

// Seeds the body's starting placements if this is a real game and they are not yet (the views and choosers call this before reading).
export function ensureSeededFor(bodyName: string): void {
  ensureSeeded(bodyName)
  reconcileBody(bodyName)
}
