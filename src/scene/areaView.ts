// A world by AREA (docs/territorial-design.md section 12): the by-area counterpart of the master building list. Each settlement and
// site of the body as a card with its developed districts, its buildings, its civic buildings, what is on order there, and what can
// be built or developed at it. Plain data (no React) so every line is testable.
import { getCountry } from '../data/countryData'
import { SIMPLE_BUILDING_DEFS, SIMPLE_DISTRICT_DEFS, SIMPLE_DISTRICTS, type SimpleBuildingId, type SimpleDistrictId } from '../data/simplisticEconomyData'
import { DISTRICT_LABELS, DISTRICT_TYPES, RECIPES } from '../economy/recipes'
import { buildingTechBlock } from '../state/abstractEconomyStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useCivicStore } from '../state/civicStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { siteOwner } from '../state/locationStore'
import { usePlacementStore } from '../state/placementStore'
import { economyModel } from '../state/playerStore'
import { useTechStore } from '../state/techStore'
import { useTerritoryStore } from '../state/territoryStore'
import type { CivicBuilding } from './civic'
import { districtOfBuilding, isPlacedDistrict, siteKindsOfDistrict, slotsPerLevel, type EconomyMode } from './districtSites'
import { accessOnBody, capturedBy } from './infrastructureOrders'
import { locationsOf, type DevLocation } from './locations'
import { developedSlotsAt, districtUsedAt, ensureSeededFor, levelRoomAt } from './placementOrders'
import { siteLabel } from './siteChoices'
import { worldBuildings } from './worldDistricts'

export interface AreaDistrict {
  district: string
  label: string
  levels: number
  slots: number
  used: number
}

export interface AreaBuilding {
  id: string
  name: string
  count: number
}

export interface AreaSite {
  siteId: string
  label: string
  kind: DevLocation['kind']
  terrain: string | null
  holds: string | null
  suitability: number
  owner: string | null
  mine: boolean
  access: number | null
  captured: boolean
  // Levels the site can still take.
  levelRoom: number
  districts: AreaDistrict[]
  buildings: AreaBuilding[]
  civic: CivicBuilding[]
  onOrder: { name: string; what: 'building' | 'level' }[]
  // Districts that can be developed here.
  canDevelop: { district: string; label: string }[]
  // Buildings that can be built here, per district developed at the site.
  canBuild: { id: string; name: string; district: string; blocked: string | null }[]
}

export interface AreaView {
  bodyName: string
  sections: { kind: DevLocation['kind']; title: string; sites: AreaSite[] }[]
  // Buildings the world has that no site holds (built before sites, or that found none).
  unplaced: AreaBuilding[]
}

const TITLES: Partial<Record<DevLocation['kind'], string>> = { settlement: 'Settlements', industrial: 'Industrial sites', resource: 'Mining and resource sites', agricultural: 'Farmland', infrastructure: 'Ports and transport', strategic: 'Strategic sites' }
const nameOf = (id: string | null) => (id ? (getCountry(id)?.name ?? id) : null)

const mode = (): EconomyMode => (economyModel() === 'abstract' ? 'simple' : 'complex')
const buildingName = (m: EconomyMode, id: string): string => (m === 'simple' ? (SIMPLE_BUILDING_DEFS[id as SimpleBuildingId]?.name ?? id) : (RECIPES[id]?.label ?? id))
export const districtLabel = (m: EconomyMode, d: string): string => (m === 'simple' ? (SIMPLE_DISTRICT_DEFS[d as SimpleDistrictId]?.name.replace(/ District$/, '') ?? d) : (DISTRICT_LABELS[d as keyof typeof DISTRICT_LABELS] ?? d))
export const districtsOfMode = (m: EconomyMode): string[] => (m === 'simple' ? [...SIMPLE_DISTRICTS] : [...DISTRICT_TYPES]).filter(isPlacedDistrict)

// Buildings a nation could build in a district right now (tech-gated ones listed with their block).
export function buildableIn(m: EconomyMode, district: string, nationId: string): { id: string; name: string; blocked: string | null }[] {
  if (m === 'simple') {
    return (SIMPLE_DISTRICT_DEFS[district as SimpleDistrictId]?.buildings ?? []).map((b) => ({ id: b, name: SIMPLE_BUILDING_DEFS[b].name, blocked: buildingTechBlock(nationId, b) }))
  }
  const researched = useTechStore.getState().stateFor(nationId).researched
  return Object.values(RECIPES)
    .filter((r) => r.id !== 'corporateHq' && districtOfBuilding({ mode: 'complex', id: r.id }) === district)
    .map((r) => ({ id: r.id, name: r.label, blocked: r.requiresTech && !researched.has(r.requiresTech) ? `needs ${r.requiresTech}` : null }))
}

export function areaView(bodyName: string, playerId: string | null): AreaView {
  ensureSeededFor(bodyName)
  const m = mode()
  const ledger = usePlacementStore.getState()
  const civicList = useCivicStore.getState().civic[bodyName] ?? []
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  const accessFor = new Map<string, Record<string, number>>()
  const access = (nation: string) => {
    if (!accessFor.has(nation)) accessFor.set(nation, accessOnBody(bodyName, nation))
    return accessFor.get(nation)!
  }
  // What is on order, by site.
  const orders: { siteId: string; name: string; what: 'building' | 'level' }[] = []
  if (m === 'simple') {
    for (const o of (owner ? useAbstractEconomyStore.getState().byCountry[owner]?.queue : undefined) ?? []) {
      if (o.bodyName === bodyName && o.siteId) orders.push({ siteId: o.siteId, name: o.building ? buildingName(m, o.building) : `${districtLabel(m, o.district!)} level`, what: o.building ? 'building' : 'level' })
    }
  } else {
    for (const o of worldByName(useEconomyStore.getState().worlds, bodyName)?.constructionQueue ?? []) {
      if (o.siteId) orders.push({ siteId: o.siteId, name: o.district ? `${districtLabel(m, o.district)} level` : buildingName(m, o.recipeId), what: o.district ? 'level' : 'building' })
    }
  }
  const sites = locationsOf(bodyName).filter((s) => s.kind !== 'strategic' && !s.material)
  const districts = districtsOfMode(m)
  const out: AreaSite[] = sites.map((s) => {
    const holder = siteOwner(s.id)
    const mine = !!playerId && holder === playerId
    const levelsHere = ledger.levels[s.id] ?? {}
    const placedHere = ledger.placed[s.id] ?? {}
    return {
      siteId: s.id,
      label: siteLabel(s),
      kind: s.kind,
      terrain: s.terrain,
      holds: s.good ?? null,
      suitability: s.suitability,
      owner: nameOf(holder ?? null),
      mine,
      access: holder ? (access(holder)[s.id] ?? 1) : null,
      captured: !!holder && s.node !== null && capturedBy(bodyName, s.node, holder),
      levelRoom: levelRoomAt(s),
      districts: Object.entries(levelsHere).map(([district, levels]) => ({ district, label: districtLabel(m, district), levels, slots: developedSlotsAt(s.id, district), used: districtUsedAt(s.id, district) })).sort((a, b) => (a.district < b.district ? -1 : 1)),
      buildings: Object.entries(placedHere).map(([id, count]) => ({ id, name: buildingName(m, id), count })).sort((a, b) => (a.name < b.name ? -1 : 1)),
      civic: civicList.filter((c) => c.siteId === s.id),
      onOrder: orders.filter((o) => o.siteId === s.id).map(({ name, what }) => ({ name, what })),
      canDevelop: districts.filter((d) => siteKindsOfDistrict(m, d).includes(s.kind)).map((d) => ({ district: d, label: districtLabel(m, d) })),
      canBuild: mine && playerId ? districts.filter((d) => (levelsHere[d] ?? 0) > 0).flatMap((d) => buildableIn(m, d, playerId).map((b) => ({ ...b, district: d }))) : [],
    }
  })
  const kinds: DevLocation['kind'][] = ['settlement', 'industrial', 'resource', 'agricultural', 'infrastructure']
  const sections = kinds
    .map((kind) => ({ kind, title: TITLES[kind] ?? kind, sites: out.filter((s) => s.kind === kind).sort((a, b) => Number(!!b.owner) - Number(!!a.owner) || b.suitability - a.suitability || (a.siteId < b.siteId ? -1 : 1)) }))
    .filter((sec) => sec.sites.length > 0)
  const placedByBuilding: Record<string, number> = {}
  for (const [id, row] of Object.entries(ledger.placed)) if (id.startsWith(`${bodyName}#`)) for (const [b, n] of Object.entries(row)) placedByBuilding[b] = (placedByBuilding[b] ?? 0) + n
  const unplaced = worldBuildings(bodyName, m)
    .map((b) => ({ id: b.id, name: buildingName(m, b.id), count: b.count - (placedByBuilding[b.id] ?? 0) }))
    .filter((b) => b.count > 0)
  void slotsPerLevel
  return { bodyName, sections, unplaced }
}
