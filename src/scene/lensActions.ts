// The build lens, store side: what the pointer would do with the tool in hand at a node of the ground map, and doing it. One
// entry for hovering (a preview that says why not), a left click (place, found, redraw, lay), and a right click (cancel an order,
// or take it down with its cost). The rules are all elsewhere: placement (scene/placementOrders), founding (scene/siteFounding*),
// demolition (scene/demolition*), zones (scene/zoneOrders), routes (scene/infrastructureOrders), defence (state/defenseStore).
import { DEFENSE_DEFS } from '../data/defenseData'
import { ROUTE_SPECS } from '../data/infrastructureData'
import type { LocationKind } from '../data/locationData'
import { MAX_BRUSH_CELLS } from '../data/zoningData'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useConfirmStore } from '../state/confirmStore'
import { groundKeySurface, useDefenseStore } from '../state/defenseStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useLensStore, type LensHover, type LensTool } from '../state/lensStore'
import { siteOwner } from '../state/locationStore'
import { isAbstractEconomy, usePlayerStore } from '../state/playerStore'
import { useTerritoryStore } from '../state/territoryStore'
import type { DemolitionQuote } from './demolition'
import { demolishBuilding, demolishLevel, planDemolishBuilding, planDemolishLevel } from './demolitionOrders'
import { judgeInstallationNode } from './defenseLogic'
import { siteKindsOfDistrict } from './districtSites'
import { footprintsOf } from './footprintState'
import { buildRoute, planRoute } from './infrastructureOrders'
import { orderBuildingAt, orderLevelAt } from './lensOrders'
import { resolveTarget, type LensSiteCells, type LensTarget } from './lensTarget'
import { locationById, locationsOf } from './locations'
import { judgePortNode, placePort } from './portStructures'
import { isRural } from '../economy/recipes'
import { isSeaNode, judgeRural, placeRural } from './ruralOrders'
import { judgeSiteForBuilding, judgeSiteForLevel, refOf } from './placementOrders'
import { siteKindOf } from './placement'
import { FOUNDABLE_KINDS } from './siteFounding'
import { foundSite, judgeFounding, removeFoundedSite } from './siteFoundingOrders'
import { applyZoneEdit, bodyZones, paintReserve, planZoneEdit, ruralDistrict, zoneBase } from './zoneOrders'
import { brushCells } from './zoning'

const playerId = (): string | null => usePlayerStore.getState().selectedCountryId

// Every site of the body with the cells it covers and may grow into (what the pointer is resolved against).
export function lensSites(bodyName: string): LensSiteCells[] {
  const base = zoneBase(bodyName)
  if (!base) return []
  const footprints = new Map(footprintsOf(bodyName, base).map((f) => [f.siteId, f.cells]))
  const zones = bodyZones(bodyName)
  return locationsOf(bodyName)
    .filter((s) => s.node !== null)
    .map((s) => ({ siteId: s.id, footprint: footprints.get(s.id) ?? [], zone: zones[s.id] ?? [], node: s.node }))
}

export const targetAt = (bodyName: string, node: number): LensTarget | null => resolveTarget(lensSites(bodyName), node)

const cellsOfSite = (sites: readonly LensSiteCells[], siteId: string): number[] => {
  const s = sites.find((x) => x.siteId === siteId)
  return s ? [...new Set([...s.footprint, ...(s.node !== null ? [s.node] : []), ...s.zone])] : []
}

const costText = (q: DemolitionQuote): string => {
  const bits = [...Object.entries(q.resources), ...Object.entries(q.goods)].filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${Math.ceil(v ?? 0)} ${k}`)
  return bits.join(', ') || 'nothing'
}

// Kinds a district's level is developed on, for founding a new one by clicking open ground.
function foundKindFor(district: string): LocationKind | null {
  const kind = siteKindsOfDistrict(refOf('').mode, district).find((k) => FOUNDABLE_KINDS.includes(k))
  return kind ?? null
}

// ---- hovering -------------------------------------------------------------------------------------

export function lensHover(bodyName: string, node: number, tool: LensTool): LensHover {
  const me = playerId()
  const nothing = (text: string): LensHover => ({ node, cells: [node], ok: false, text })
  if (!me) return nothing('No nation.')
  const sites = lensSites(bodyName)
  const target = resolveTarget(sites, node)
  const site = target ? locationById(target.siteId) : undefined
  const cellsOfTarget = site ? cellsOfSite(sites, site.id) : [node]

  switch (tool.kind) {
    case 'building': {
      if (isRural(tool.id)) {
        const j = judgeRural(bodyName, tool.id, node)
        return { node, cells: [node], ok: j.ok, text: j.ok ? `Build ${tool.name} here${isSeaNode(bodyName, node) ? ' (a platform at sea)' : ''}` : j.reason }
      }
      if (tool.id === 'spaceport') {
        const surface = groundKeySurface(bodyName)
        if (!surface) return nothing('No ground here.')
        const j = judgePortNode(surface, node)
        return { node, cells: [node], ok: j.ok, text: j.ok ? 'Found a spaceport here' : j.reason }
      }
      const ref = refOf(tool.id)
      if (site) {
        const j = judgeSiteForBuilding(me, bodyName, ref, site)
        return { node, cells: cellsOfTarget, ok: j.allowed, text: j.allowed ? `Build ${tool.name} at ${labelOf(site.id)}: ${j.why}` : j.why }
      }
      const kind = siteKindOf(ref)
      if (!FOUNDABLE_KINDS.includes(kind)) return nothing(`${tool.name} goes on a ${kind} site: click inside one.`)
      const f = judgeFounding(me, bodyName, kind, node)
      return { node, cells: [node], ok: f.allowed, text: f.allowed ? `Found a new ${kind} district here and build ${tool.name}` : f.why }
    }
    case 'level': {
      if (site) {
        const j = judgeSiteForLevel(me, bodyName, tool.district, site)
        return { node, cells: cellsOfTarget, ok: j.allowed, text: j.allowed ? `Develop a ${tool.name} level at ${labelOf(site.id)}` : j.why }
      }
      const kind = foundKindFor(tool.district)
      if (!kind) return nothing(`A ${tool.name} district is developed inside an existing site.`)
      const f = judgeFounding(me, bodyName, kind, node)
      return { node, cells: [node], ok: f.allowed, text: f.allowed ? `Found a new ${tool.name} district here` : f.why }
    }
    case 'defense': {
      const surface = groundKeySurface(bodyName)
      if (!surface) return nothing('No ground here.')
      const j = judgeInstallationNode(surface, useDefenseStore.getState().installations, node)
      return { node, cells: [node], ok: j.ok, text: j.ok ? `Build a ${DEFENSE_DEFS[tool.defense].name} here` : j.reason }
    }
    case 'zone': {
      const siteId = useLensStore.getState().zoneSiteId
      if (!siteId) return { node, cells: cellsOfTarget, ok: !!site, text: site ? `Redraw the zone of ${labelOf(site.id)}: click to pick it` : 'Click a district to redraw its zone' }
      const base = zoneBase(bodyName)
      if (!base) return nothing('No ground here.')
      const cells = brushCells(base, node, useLensStore.getState().brush)
      const plan = planZoneEdit(me, siteId, { add: cells, remove: [] })
      return plan.ok
        ? { node, cells, ok: true, text: `Zone grows: room for ${plan.capacityBefore} -> ${plan.capacityAfter} levels${plan.ruralAdded > 0 ? ` (${plan.ruralAdded} rural cells: ${plan.law === 'permit' ? 'needs a permit' : 'free'})` : ''}` }
        : { node, cells, ok: false, text: plan.reason }
    }
    case 'reserve': {
      const base = zoneBase(bodyName)
      const cells = base ? brushCells(base, node, useLensStore.getState().brush) : [node]
      const rural = new Set(ruralDistrict(bodyName))
      const free = cells.filter((c) => rural.has(c))
      return { node, cells: free.length > 0 ? free : cells, ok: free.length > 0, text: free.length > 0 ? `Keep ${free.length} cells wild: no district will grow over them` : 'Only untouched rural ground can be a reserve' }
    }
    case 'route': {
      if (!site) return nothing('Click a site to start or end the route.')
      const from = useLensStore.getState().routeFrom
      if (!from) return { node, cells: cellsOfTarget, ok: true, text: `Start a ${ROUTE_SPECS[tool.route].name.toLowerCase()} at ${labelOf(site.id)}` }
      const plan = planRoute(me, from, site.id, tool.route)
      return plan.ok
        ? { node, cells: cellsOfTarget, ok: true, text: `${ROUTE_SPECS[tool.route].name}: ${plan.cells} cells, ${plan.quote.days} days, costs ${costText({ goods: plan.quote.goods, resources: plan.quote.resources, displacedMillions: 0 })}` }
        : { node, cells: cellsOfTarget, ok: false, text: plan.reason }
    }
  }
}

function labelOf(siteId: string): string {
  const kind = siteId.slice(siteId.lastIndexOf('#') + 1)
  return kind
}

// ---- left click -------------------------------------------------------------------------------------

export function lensClick(bodyName: string, node: number, tool: LensTool): void {
  const me = playerId()
  const lens = useLensStore.getState()
  const done = (ok: boolean, text: string, cells: number[]) => {
    lens.say(text, ok)
    if (ok) lens.firePulse(cells, true)
    // What is under the pointer has changed (a district stands there now): preview it again.
    if (me) lens.setHover(lensHover(bodyName, node, tool))
  }
  if (!me) return done(false, 'No nation.', [])
  const sites = lensSites(bodyName)
  const target = resolveTarget(sites, node)
  const site = target ? locationById(target.siteId) : undefined
  const now = useGameTimeStore.getState().simDays

  switch (tool.kind) {
    case 'building': {
      if (isRural(tool.id)) {
        const r = placeRural(me, bodyName, tool.id, node)
        return done(r.ok, r.ok ? `${tool.name} ordered here.` : r.reason, [node])
      }
      if (tool.id === 'spaceport') {
        const r = placePort(me, bodyName, node)
        return done(r.ok, r.ok ? 'Spaceport ordered here.' : r.reason, [node])
      }
      const ref = refOf(tool.id)
      if (site) {
        const r = orderBuildingAt(me, bodyName, tool.id, site.id)
        return done(r.ok, r.ok ? `${tool.name} ordered.` : r.reason, cellsOfSite(lensSites(bodyName), site.id))
      }
      const kind = siteKindOf(ref)
      if (!FOUNDABLE_KINDS.includes(kind)) return done(false, `${tool.name} goes on a ${kind} site: click inside one.`, [])
      const found = foundSite(me, bodyName, kind, node, now)
      if (!found.ok) return done(false, found.reason, [])
      const r = orderBuildingAt(me, bodyName, tool.id, found.site.id)
      if (!r.ok) {
        removeFoundedSite(found.site.id)
        return done(false, r.reason, [])
      }
      return done(true, `New ${kind} district founded; ${tool.name} ordered.`, [node])
    }
    case 'level': {
      if (site) {
        const r = orderLevelAt(me, bodyName, tool.district, site.id)
        return done(r.ok, r.ok ? `${tool.name} level ordered.` : r.reason, cellsOfSite(lensSites(bodyName), site.id))
      }
      const kind = foundKindFor(tool.district)
      if (!kind) return done(false, `A ${tool.name} district is developed inside an existing site.`, [])
      const found = foundSite(me, bodyName, kind, node, now)
      if (!found.ok) return done(false, found.reason, [])
      const r = orderLevelAt(me, bodyName, tool.district, found.site.id)
      if (!r.ok) {
        removeFoundedSite(found.site.id)
        return done(false, r.reason, [])
      }
      return done(true, `New ${tool.name} district founded.`, [node])
    }
    case 'defense': {
      const r = useDefenseStore.getState().build(me, bodyName, tool.defense, now, { node })
      return done(r.ok, r.ok ? `${DEFENSE_DEFS[tool.defense].name} ordered.` : r.reason, [node])
    }
    case 'zone': {
      if (!lens.zoneSiteId) {
        if (!site || siteOwner(site.id) !== me) return done(false, 'Click one of your districts to redraw its zone.', [])
        lens.setZoneSite(site.id)
        return done(true, 'Now paint: left-click adds ground, right-click takes it away.', cellsOfSite(sites, site.id))
      }
      return zoneClick(bodyName, node, lens.zoneSiteId, true)
    }
    case 'reserve': {
      const base = zoneBase(bodyName)
      const r = paintReserve(me, bodyName, base ? brushCells(base, node, lens.brush) : [node], true)
      return done(r.ok, r.ok ? `${r.changed} cells kept wild.` : r.reason, [node])
    }
    case 'route': {
      if (!site) return done(false, 'Click a site to start or end the route.', [])
      if (!lens.routeFrom) {
        lens.setRouteFrom(site.id)
        return done(true, 'Now click the other end.', cellsOfSite(sites, site.id))
      }
      const from = lens.routeFrom
      lens.setRouteFrom(null)
      const r = buildRoute(me, from, site.id, tool.route)
      return done(r.ok, r.ok ? `${ROUTE_SPECS[tool.route].name} ordered.` : r.reason, [node])
    }
  }
}

function zoneClick(bodyName: string, node: number, siteId: string, add: boolean): void {
  const me = playerId()!
  const lens = useLensStore.getState()
  const base = zoneBase(bodyName)
  if (!base) return
  const cells = brushCells(base, node, Math.min(MAX_BRUSH_CELLS, lens.brush))
  const edit = add ? { add: cells, remove: [] } : { add: [], remove: cells }
  const plan = planZoneEdit(me, siteId, edit)
  if (!plan.ok) return lens.say(plan.reason, false)
  const forced = plan.levelsDown.length + plan.buildingsDown.length > 0
  const run = (confirmed: boolean) => {
    const r = applyZoneEdit(me, siteId, edit, { confirmed })
    lens.say(r.ok ? (r.law === 'permit' && r.ruralAdded > 0 ? 'Zone redrawn; the rural ground waits for a permit.' : 'Zone redrawn.') : r.reason, r.ok)
    if (r.ok) lens.firePulse(cells, true)
  }
  if (!forced) return run(false)
  useConfirmStore.getState().requestConfirm({
    title: 'Shrink this zone?',
    body: `The district would hold ${plan.capacityAfter} levels instead of ${plan.capacityBefore}.`,
    effects: [
      ...plan.levelsDown.map((l) => `${l.n} ${l.district} level${l.n === 1 ? '' : 's'} taken down`),
      ...plan.buildingsDown.map((b) => `${b.n} × ${b.id} demolished`),
      `Costs ${costText(plan.quote)}`,
      ...(plan.displacedMillions > 0 ? [`${plan.displacedMillions.toFixed(1)}M people displaced: unrest for a while`] : []),
    ],
    confirmLabel: 'Shrink it',
    onConfirm: () => run(true),
  })
}

// ---- right click --------------------------------------------------------------------------------------

interface QueuedAt {
  id: number | string
  building?: string
  district?: string
}

function queuedAt(bodyName: string, siteId: string): QueuedAt[] {
  if (isAbstractEconomy()) {
    const owner = useTerritoryStore.getState().bodyOwner[bodyName]
    return (owner ? (useAbstractEconomyStore.getState().byCountry[owner]?.queue ?? []) : []).filter((o) => o.bodyName === bodyName && o.siteId === siteId).map((o) => ({ id: o.id, building: o.building, district: o.district }))
  }
  return (worldByName(useEconomyStore.getState().worlds, bodyName)?.constructionQueue ?? []).filter((o) => o.siteId === siteId).map((o) => ({ id: o.id, building: o.recipeId || undefined, district: o.district }))
}

function cancelQueued(me: string, bodyName: string, o: QueuedAt): void {
  if (isAbstractEconomy()) useAbstractEconomyStore.getState().cancelOrder(me, o.id as number)
  else {
    const world = worldByName(useEconomyStore.getState().worlds, bodyName)
    if (world) useEconomyStore.getState().cancelConstruction(world.id, o.id as string)
  }
}

export function lensRightClick(bodyName: string, node: number, tool: LensTool): void {
  const me = playerId()
  const lens = useLensStore.getState()
  const done = (ok: boolean, text: string, cells: number[]) => {
    lens.say(text, ok)
    if (ok) lens.firePulse(cells, true)
    if (me) lens.setHover(lensHover(bodyName, node, tool))
  }
  if (!me) return done(false, 'No nation.', [])
  const sites = lensSites(bodyName)
  const target = resolveTarget(sites, node)
  const site = target ? locationById(target.siteId) : undefined

  if (tool.kind === 'route') {
    lens.setRouteFrom(null)
    return done(true, 'Route cancelled.', [])
  }
  if (tool.kind === 'zone') {
    if (!lens.zoneSiteId) return done(false, 'Pick a district first.', [])
    return zoneClick(bodyName, node, lens.zoneSiteId, false)
  }
  if (tool.kind === 'reserve') {
    const base = zoneBase(bodyName)
    const r = paintReserve(me, bodyName, base ? brushCells(base, node, lens.brush) : [node], false)
    return done(r.ok, r.ok ? `${r.changed} cells released.` : r.reason, [node])
  }
  if (tool.kind === 'defense') return done(false, 'Installations are taken down from the ground panel.', [])
  if (!site) return done(false, 'Nothing built there.', [])
  const cells = cellsOfSite(sites, site.id)

  if (tool.kind === 'building') {
    if (tool.id === 'spaceport') return done(false, 'Spaceports are taken down from the economy panel.', [])
    const queued = queuedAt(bodyName, site.id).filter((o) => o.building === tool.id).pop()
    if (queued) {
      cancelQueued(me, bodyName, queued)
      return done(true, `${tool.name} order cancelled (refunded).`, cells)
    }
    const plan = planDemolishBuilding(me, site.id, tool.id)
    if (!plan.ok) return done(false, plan.reason, [])
    return confirmDemolition(`Demolish a ${tool.name}?`, plan.quote, () => {
      const r = demolishBuilding(me, site.id, tool.id)
      done(r.ok, r.ok ? `${tool.name} demolished.` : r.reason, cells)
    })
  }
  // A district level.
  const queued = queuedAt(bodyName, site.id).filter((o) => o.district === tool.district).pop()
  if (queued) {
    cancelQueued(me, bodyName, queued)
    return done(true, `${tool.name} level cancelled (refunded).`, cells)
  }
  const plan = planDemolishLevel(me, site.id, tool.district)
  if (!plan.ok) return done(false, plan.reason, [])
  confirmDemolition(`Demolish a ${tool.name} level?`, plan.quote, () => {
    const r = demolishLevel(me, site.id, tool.district)
    done(r.ok, r.ok ? `${tool.name} level demolished.` : r.reason, cells)
  })
}

function confirmDemolition(title: string, quote: DemolitionQuote, onConfirm: () => void): void {
  useConfirmStore.getState().requestConfirm({
    title,
    effects: [`Costs ${costText(quote)}`, 'No salvage: taking something down is paid work.', ...(quote.displacedMillions > 0 ? [`${quote.displacedMillions.toFixed(1)}M people displaced: unrest for a while`] : [])],
    confirmLabel: 'Demolish',
    onConfirm,
  })
}

