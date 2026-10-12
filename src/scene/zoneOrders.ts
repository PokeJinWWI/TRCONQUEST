// Zones, store side: what the zones on a body are now, whether a redrawing is allowed (the ground, the land-use law, the cost of
// whatever it would force down), and applying it. A redrawn zone changes the capacity of its site (state/zoneStore pushes it to
// scene/locations), and capacity the district no longer has is taken down, with the costs and the unrest of any other demolition.
import { useGameTimeStore } from '../state/gameTimeStore'
import { siteOwner } from '../state/locationStore'
import { usePlacementStore } from '../state/placementStore'
import { landUsePolicyOf, useZoneStore } from '../state/zoneStore'
import { PERMIT_DAYS } from '../data/zoningData'
import { demolitionQuote, type DemolitionQuote } from './demolition'
import { demolishBuilding, demolishLevel } from './demolitionOrders'
import { shortOf, paysFromEconomy } from './economyPayment'
import { districtOfBuilding, slotsPerLevel } from './districtSites'
import { footprintsOf } from './footprintState'
import { groundSurface, settlementTierOf } from './groundLogic'
import { locationById, locationsOf, type DevLocation } from './locations'
import { placedOn, refOf } from './placementOrders'
import { surfaceOf, type BodySurface } from './planetTerrain'
import { useTerritoryStore } from '../state/territoryStore'
import { urbanNow } from './urbanState'
import { hasZone, isBuildable, judgeZoneEdit, ruralCells, zoneOf, type ZoneEdit, type ZoneSite } from './zoning'

// The ground of a body with no districts drawn on it: what zones are laid over.
export function zoneBase(bodyName: string): BodySurface | null {
  const owners = useTerritoryStore.getState().bodyOwner
  return groundSurface(bodyName, owners) ? surfaceOf(bodyName, settlementTierOf(bodyName, owners)) : null
}

const zoneSite = (s: DevLocation): ZoneSite | null => (s.node !== null && hasZone(s.kind) ? { id: s.id, kind: s.kind, node: s.node, capacity: s.capacity } : null)

// Sites that hold a zone: the ones somebody has established (an open site holds no ground yet).
function zonedSites(bodyName: string): ZoneSite[] {
  return locationsOf(bodyName)
    .filter((s) => siteOwner(s.id))
    .map(zoneSite)
    .filter((s): s is ZoneSite => !!s)
}

// Every zone on the body, by site id: the redrawn ones and the defaults (a site never redrawn has the capacity it was generated with).
export function bodyZones(bodyName: string): Record<string, number[]> {
  const base = zoneBase(bodyName)
  if (!base) return {}
  const edited = useZoneStore.getState().zones
  // What a district already covers is always inside its zone: a city that has grown past its default zone (its people spread it) keeps
  // that ground when the zone is first drawn, so redrawing a zone never shrinks or grows the built-up area by itself.
  const covered = new Map(footprintsOf(bodyName, base).map((f) => [f.siteId, f.cells]))
  const out: Record<string, number[]> = {}
  for (const s of zonedSites(bodyName)) {
    if (edited[s.id]) out[s.id] = [...edited[s.id]]
    else out[s.id] = [...new Set([...zoneOf(base, s, undefined), ...(covered.get(s.id) ?? [])])].sort((a, b) => a - b)
  }
  return out
}

// The rural district of a body: buildable ground in no zone.
export function ruralDistrict(bodyName: string): number[] {
  const base = zoneBase(bodyName)
  return base ? ruralCells(base, Object.values(bodyZones(bodyName))) : []
}

// ---- judging a redrawing -------------------------------------------------------------------------

export interface ZonePlan {
  ok: true
  siteId: string
  bodyName: string
  // The zone after the edit (without the rural cells a permit still has to approve).
  cells: number[]
  // Rural cells the edit adds, and what the law does with them.
  ruralAdded: number
  law: 'none' | 'free' | 'permit'
  capacityBefore: number
  capacityAfter: number
  // What the smaller capacity forces down: [district, levels] and [building, count] with the total quote.
  levelsDown: { district: string; n: number }[]
  buildingsDown: { id: string; district: string; n: number }[]
  quote: DemolitionQuote
  // Cells of the district's footprint that fall outside the new zone.
  displacedMillions: number
}
export type ZoneJudgement = ZonePlan | { ok: false; reason: string }

function sumQuotes(list: DemolitionQuote[]): DemolitionQuote {
  const total: DemolitionQuote = { goods: {}, resources: {}, displacedMillions: 0 }
  for (const q of list) {
    for (const [k, v] of Object.entries(q.goods)) (total.goods as Record<string, number>)[k] = ((total.goods as Record<string, number>)[k] ?? 0) + (v ?? 0)
    for (const [k, v] of Object.entries(q.resources)) (total.resources as Record<string, number>)[k] = ((total.resources as Record<string, number>)[k] ?? 0) + (v ?? 0)
    total.displacedMillions += q.displacedMillions
  }
  return total
}

// Judges redrawing the zone of `siteId` for `builderId`. Nothing is changed.
export function planZoneEdit(builderId: string, siteId: string, edit: ZoneEdit): ZoneJudgement {
  const site = locationById(siteId)
  if (!site) return { ok: false, reason: 'No such site.' }
  const zs = zoneSite(site)
  if (!zs) return { ok: false, reason: 'This kind of site covers no ground of its own.' }
  if (siteOwner(siteId) !== builderId) return { ok: false, reason: 'You can only redraw the zone of a district you hold.' }
  const base = zoneBase(site.bodyName)
  if (!base) return { ok: false, reason: 'No ground here.' }
  const zones = bodyZones(site.bodyName)
  const current = zones[siteId] ?? zoneOf(base, zs, undefined)
  const others = new Set<number>()
  for (const [id, cells] of Object.entries(zones)) if (id !== siteId) for (const c of cells) others.add(c)
  // Nature reserves are kept wild: no zone grows into them.
  for (const c of useZoneStore.getState().reserves[site.bodyName] ?? []) others.add(c)
  // A node that holds another site is never part of this zone.
  for (const s of locationsOf(site.bodyName)) if (s.id !== siteId && s.node !== null) others.add(s.node)
  const rural = new Set(ruralDistrict(site.bodyName))
  const judged = judgeZoneEdit(base, zs, current, edit, others, rural)
  if (!judged.ok) return judged
  const law = judged.ruralAdded === 0 ? 'none' : landUsePolicyOf(builderId)
  if (law === 'restricted') return { ok: false, reason: 'The land-use law forbids expanding into rural land. Redraw among the ground the district already holds, or change the law.' }

  // What the smaller capacity forces down, level by level, cheapest sensible order: the district with the most levels first.
  const levelsHere = { ...(usePlacementStore.getState().levels[siteId] ?? {}) }
  const buildingsHere = { ...placedOn(siteId) }
  const mode = refOf('').mode
  let total = Object.values(levelsHere).reduce((n, v) => n + v, 0)
  const levelsDown: Record<string, number> = {}
  const buildingsDown: Record<string, { district: string; n: number }> = {}
  const quotes: DemolitionQuote[] = []
  const people = site.kind === 'settlement' ? (urbanNow(site.bodyName, builderId).find((s) => s.id === siteId)?.population ?? 0) : 0
  let guard = 200
  while (total > judged.capacityAfter && guard-- > 0) {
    const district = Object.entries(levelsHere).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!district) break
    // Buildings of that district beyond what the remaining levels hold go first.
    const capAfterLevel = (levelsHere[district] - 1) * slotsPerLevel(mode)
    for (;;) {
      const inDistrict = Object.entries(buildingsHere).filter(([id, n]) => n > 0 && districtOfBuilding(refOf(id)) === district)
      const used = inDistrict.reduce((n, [, c]) => n + c, 0)
      if (used <= capAfterLevel || inDistrict.length === 0) break
      const [id] = inDistrict[0]
      buildingsHere[id]--
      buildingsDown[id] = { district, n: (buildingsDown[id]?.n ?? 0) + 1 }
      quotes.push(demolitionQuote({ district, what: 'building', levelsHere: levelsHere[district] }))
    }
    quotes.push(demolitionQuote({ district, what: 'level', levelsHere: levelsHere[district], populationMillions: people }))
    levelsHere[district]--
    levelsDown[district] = (levelsDown[district] ?? 0) + 1
    total--
  }
  const quote = sumQuotes(quotes)
  if (quotes.length > 0) {
    const short = shortOf(builderId, quote.goods, quote.resources)
    if (short.length > 0) return { ok: false, reason: `Shrinking it would take down ${quotes.length} things and you are short of ${short.join(', ')}${paysFromEconomy(builderId) ? ' in the capital stockpile' : ''}.` }
  }
  return {
    ok: true,
    siteId,
    bodyName: site.bodyName,
    cells: judged.cells,
    ruralAdded: judged.ruralAdded,
    law: law === 'free' || law === 'permit' ? law : 'none',
    // What the site really holds now (not what its zone's length would give: a city's covered ground can sit past its default zone).
    capacityBefore: site.capacity,
    // An edit that does not take ground away never lowers what the site holds.
    capacityAfter: judged.cells.length >= current.length ? Math.max(judged.capacityAfter, site.capacity) : judged.capacityAfter,
    levelsDown: Object.entries(levelsDown).map(([district, n]) => ({ district, n })),
    buildingsDown: Object.entries(buildingsDown).map(([id, v]) => ({ id, district: v.district, n: v.n })),
    quote,
    displacedMillions: quote.displacedMillions,
  }
}

let requestCounter = 0

// Redraws the zone. `confirmed` must be true when the edit forces anything down (the UI shows the plan first). Under a permit law the
// rural cells wait for approval; the rest applies at once.
export function applyZoneEdit(builderId: string, siteId: string, edit: ZoneEdit, opts: { confirmed?: boolean } = {}): ZoneJudgement {
  const plan = planZoneEdit(builderId, siteId, edit)
  if (!plan.ok) return plan
  const forced = plan.levelsDown.length + plan.buildingsDown.length > 0
  if (forced && !opts.confirmed) return { ok: false, reason: 'This takes things down: confirm it first.' }
  const now = useGameTimeStore.getState().simDays
  const store = useZoneStore.getState()
  let cells = plan.cells
  if (plan.law === 'permit') {
    const rural = new Set(ruralDistrict(plan.bodyName))
    const wanted = cells.filter((c) => rural.has(c))
    cells = cells.filter((c) => !rural.has(c))
    store.addRequest({ id: `permit-${siteId}-${++requestCounter}`, nationId: builderId, siteId, cells: wanted, decideSimDays: now + PERMIT_DAYS })
  }
  // Take down what no longer fits first (it pays and may be refused by the economy), then record the new zone.
  for (const b of plan.buildingsDown) for (let i = 0; i < b.n; i++) {
    const r = demolishBuilding(builderId, siteId, b.id)
    if (!r.ok) return { ok: false, reason: r.reason }
  }
  for (const l of plan.levelsDown) for (let i = 0; i < l.n; i++) {
    const r = demolishLevel(builderId, siteId, l.district)
    if (!r.ok) return { ok: false, reason: r.reason }
  }
  store.setZone(siteId, cells)
  return plan
}

// Permits whose day has come: the rural cells are added if they are still free; the request is closed either way.
export function resolveZonePermits(simDays: number): void {
  const store = useZoneStore.getState()
  for (const req of store.requests) {
    if (req.decideSimDays > simDays) continue
    store.removeRequest(req.id)
    const site = locationById(req.siteId)
    if (!site || siteOwner(req.siteId) !== req.nationId) continue
    const zones = bodyZones(site.bodyName)
    const taken = new Set<number>()
    for (const [id, cells] of Object.entries(zones)) if (id !== req.siteId) for (const c of cells) taken.add(c)
    const base = zoneBase(site.bodyName)
    if (!base) continue
    const grant = req.cells.filter((c) => !taken.has(c) && isBuildable(base, c))
    if (grant.length === 0) continue
    const next = new Set([...(zones[req.siteId] ?? []), ...grant])
    useZoneStore.getState().setZone(req.siteId, [...next].sort((a, b) => a - b))
  }
}

// ---- nature reserves ---------------------------------------------------------------------------------

// Marks rural ground as a nature reserve (or lets it go): free, but only ground no district holds, and only on a world the nation governs.
export function paintReserve(builderId: string, bodyName: string, cells: readonly number[], on: boolean): { ok: true; changed: number } | { ok: false; reason: string } {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  if (bodyOwner[bodyName] !== builderId) return { ok: false, reason: `You do not govern ${bodyName}.` }
  if (bodyController[bodyName] && bodyController[bodyName] !== builderId) return { ok: false, reason: `${bodyName} is occupied.` }
  const store = useZoneStore.getState()
  const current = new Set(store.reserves[bodyName] ?? [])
  let changed = 0
  if (on) {
    const rural = new Set(ruralDistrict(bodyName))
    for (const c of cells) if (rural.has(c) && !current.has(c)) (current.add(c), changed++)
  } else {
    for (const c of cells) if (current.delete(c)) changed++
  }
  if (changed === 0) return { ok: false, reason: on ? 'Only untouched rural ground can be made a reserve.' : 'That ground is not a reserve.' }
  store.setReserve(bodyName, [...current].sort((a, b) => a - b))
  return { ok: true, changed }
}
