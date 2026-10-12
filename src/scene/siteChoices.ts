// The "where?" of building (docs/territorial-design.md section 12): every site of a body that a building, or a district level, could go on,
// judged for the player, best first. Pure view model over the placement rules (scene/placementOrders.judgeSite*): the law's answer and
// the ground's are separate, and each site says what it offers (ground, access, room).
import { getCountry } from '../data/countryData'
import { siteOwner } from '../state/locationStore'
import { useCivicStore } from '../state/civicStore'
import { accessOnBody } from './infrastructureOrders'
import { locationsOf, type DevLocation } from './locations'
import { districtOfBuilding, siteKindsOfDistrict, slotsPerLevel } from './districtSites'
import { siteKindsFor, type BuildingRef } from './placement'
import { developedSlotsAt, districtUsedAt, ensureSeededFor, judgeSiteForBuilding, judgeSiteForLevel, levelRoomAt, refOf } from './placementOrders'

export interface SiteChoice {
  siteId: string
  label: string
  kind: string
  terrain: string | null
  suitability: number
  // The share of its output that reaches a hub, for the builder (1 = fully connected).
  access: number
  // What is free there: "3 slots free" for a building, "room for 2 levels" for a district level.
  room: string
  owner: string | null
  allowed: boolean
  legal: string
  physical: string | null
  why: string
  best: boolean
}

const nameOf = (id: string | undefined | null): string | null => (id ? (getCountry(id)?.name ?? id) : null)

// A name for a site a player can recognize: the civic place for a settlement, else its kind, number and ground.
export function siteLabel(site: DevLocation): string {
  const civic = useCivicStore.getState().civic[site.bodyName]?.find((c) => c.siteId === site.id)
  const n = Number(site.id.slice(site.id.lastIndexOf('-') + 1)) + 1
  const kind = site.kind[0].toUpperCase() + site.kind.slice(1)
  const place = civic ? civic.place.replace(/\s*\(.*\)$/, '') : null
  const what = site.material ?? site.good
  return `${place ?? `${kind} ${n}`}${what ? ` · ${what}` : ''}${site.terrain && !place ? ` · ${site.terrain}` : ''}`
}

function rank(choices: SiteChoice[]): SiteChoice[] {
  const sorted = [...choices].sort((a, b) => Number(b.allowed) - Number(a.allowed) || b.suitability * b.access - a.suitability * a.access || (a.siteId < b.siteId ? -1 : 1))
  const best = sorted.find((c) => c.allowed)
  return sorted.map((c) => ({ ...c, best: c === best }))
}

export function siteChoicesForBuilding(builderId: string, bodyName: string, ref: BuildingRef): SiteChoice[] {
  ensureSeededFor(bodyName)
  const kinds = siteKindsFor(ref)
  const reach = accessOnBody(bodyName, builderId)
  const district = districtOfBuilding(ref)
  return rank(
    locationsOf(bodyName)
      .filter((s) => kinds.includes(s.kind))
      .map((s) => {
        const j = judgeSiteForBuilding(builderId, bodyName, ref, s)
        const free = Math.max(0, developedSlotsAt(s.id, district) - districtUsedAt(s.id, district))
        return { siteId: s.id, label: siteLabel(s), kind: s.kind, terrain: s.terrain, suitability: s.suitability, access: reach[s.id] ?? 1, room: `${free} slot${free === 1 ? '' : 's'} free`, owner: nameOf(siteOwner(s.id)), allowed: j.allowed, legal: j.legal, physical: j.physical, why: j.why, best: false }
      }),
  )
}

export function siteChoicesForLevel(builderId: string, bodyName: string, district: string): SiteChoice[] {
  ensureSeededFor(bodyName)
  const kinds = siteKindsOfDistrict(refOf('').mode, district)
  const reach = accessOnBody(bodyName, builderId)
  return rank(
    locationsOf(bodyName)
      .filter((s) => kinds.includes(s.kind))
      .map((s) => {
        const j = judgeSiteForLevel(builderId, bodyName, district, s)
        const room = levelRoomAt(s)
        return { siteId: s.id, label: siteLabel(s), kind: s.kind, terrain: s.terrain, suitability: s.suitability, access: reach[s.id] ?? 1, room: `room for ${room} level${room === 1 ? '' : 's'} (${slotsPerLevel(refOf('').mode)} slots each)`, owner: nameOf(siteOwner(s.id)), allowed: j.allowed, legal: j.legal, physical: j.physical, why: j.why, best: false }
      }),
  )
}
