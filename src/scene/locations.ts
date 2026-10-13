// Development locations: the places on a body where people live, resources lie and
// buildings can stand. Pure and deterministic: a body's sites come from its own
// seeded stream and its terrain, never from game state, so they are the same in
// Simple and Complex mode, on every load, and whoever owns the body. What changes
// at run time (who has established a site, what is left in it) is
// state/locationStore.ts.
//
// Kinds (a site has one; `tags` add detail):
//   settlement      somewhere to live: fixed ones are the capital and cities the ground map
//                   already has (same node as its KeySlot), the rest are suitable ground
//   industrial      flat, solid ground for factories
//   resource        a natural deposit (a depletable good, or hyperium / exotic matter)
//   infrastructure  a spaceport site (the ground map's own spaceports where it has them)
//   strategic       high ground and coasts: military value, little else
// Not every body gets every kind: a gas giant has aerostat sites only, a lava world
// no settlements, a belt only resource sites (`beltLocations`).
//
// Ids are `"<body>#<kind>-<n>"`, `n` counting that kind's sites in generation order.
// Nothing about a site depends on the order bodies are generated in.
import {
  AGRICULTURAL_PER_DISTRICT,
  AGRICULTURAL_SUITABILITY,
  EXTRA_SETTLEMENTS_PER_DISTRICT,
  MAX_SETTLEMENT_SITES,
  WATER_PROXIMITY_CELLS,
  ANCHOR_MIN_SEPARATION_CELLS,
  ANCHOR_SNAP_CELLS,
  BELT_RESOURCES,
  BELT_SITES,
  CLASS_PROFILE,
  INDUSTRIAL_PER_DISTRICT,
  INDUSTRIAL_SUITABILITY,
  MAX_SITES_PER_KIND,
  RESOURCES_PER_DISTRICT,
  SETTLEMENTS_PER_DISTRICT,
  SETTLEMENT_SUITABILITY,
  SITE_CAPACITY_RANGE,
  SITE_MIN_SEPARATION_CELLS,
  STRATEGIC_PER_DISTRICT,
  TERRAIN_RESOURCES,
  LOCATION_KINDS,
  type LocationKind,
  type LocationTag,
  type SiteGood,
} from '../data/locationData'
import { COUNTRIES } from '../data/countryData'
import { depositTables } from '../data/deposits'
import { GALAXY_SEED, seededStream } from '../data/galaxyGen'
import { KEY_MIN_SEPARATION_CELLS, TERRAIN, type TerrainId } from '../data/groundData'
import type { MaterialId } from '../data/materials'
import { ASTEROID_BELTS_BY_STAR } from '../data/asteroidBeltData'
import { estimateSize } from './bodyStats'
import { surfaceOf, bodyGroundInfoAny, terrainAt, type BodySurface, type SettlementTier } from './planetTerrain'
import { seedBodyOwners } from './territory'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'
import { NO_ZONE_CAPS, customSitesOf, zoneCapacitiesOf } from './customSites'
import { keyNamesOf, settlementNamePool } from './keyNames'
import { regionAt } from './bodyTopography'
import { EARTH_ANCHORS } from '../data/earthEconomicGeography'
import { fromLonLat } from './mapProjection'

export interface DevLocation {
  id: string
  bodyName: string
  kind: LocationKind
  tags: LocationTag[]
  // Fine-grid node on the body's ground map; null for a belt (no ground).
  node: number | null
  terrain: TerrainId | null
  // How good the ground is for this kind of use, 0..1.
  suitability: number
  // How much it can hold, in district-level equivalents (the unit `land` is counted in).
  capacity: number
  // Resource sites: what lies there. A natural good, or a material whose amount is
  // the body's deposit (state/depositStore); `weight` is the site's share of the
  // body's richness (0..1) for the goods. The quantity lives with the economy
  // (World.resourceDeposits), never here.
  good?: SiteGood
  material?: MaterialId
  weight?: number
  // A name the ground map already gives it (a capital, a city, a spaceport).
  name?: string
  // Present on sites that are the ground map's own key slots.
  fixed?: boolean
}

// ---- helpers ------------------------------------------------------------------

export const rngFor = (key: string): (() => number) => {
  const rng = seededStream(GALAXY_SEED, key)
  // The first draws of similar names correlate (system names share a prefix).
  rng()
  rng()
  return rng
}

let startingOwners: Record<string, string> | null = null
// Inhabited from the start: the authored owners of the bodies (a nation's capital is richer).
function tierOf(bodyName: string): SettlementTier {
  if (COUNTRIES.some((c) => c.capitalBodyName === bodyName)) return 'capital'
  startingOwners ??= seedBodyOwners()
  return startingOwners[bodyName] ? 'world' : 'wild'
}

function weighted<T extends string>(rng: () => number, table: Partial<Record<T, number>>): T | null {
  const entries = Object.entries(table) as [T, number][]
  const total = entries.reduce((n, [, w]) => n + w, 0)
  if (total <= 0) return null
  let roll = rng() * total
  for (const [key, w] of entries) {
    roll -= w
    if (roll < 0) return key
  }
  return entries[entries.length - 1][0]
}

const capacityOf = (suitability: number): number => Math.round(1 + SITE_CAPACITY_RANGE * suitability)

// ---- the generator ------------------------------------------------------------

function generate(bodyName: string): DevLocation[] {
  const info = bodyGroundInfoAny(bodyName)
  if (!info) return []
  const wild = surfaceOf(bodyName, 'wild')
  const mesh = surfaceMesh()
  const n = mesh.count.fine
  const profile = CLASS_PROFILE[info.planetClass]
  const districts = estimateSize(info.radiusKm).districts
  const minSep = Math.max(SITE_MIN_SEPARATION_CELLS, KEY_MIN_SEPARATION_CELLS - 1) * mesh.fineSpacingRad

  const terrainOf = (node: number): TerrainId => terrainAt(wild, node)
  const isGround = (node: number) => wild.landComponent[node] >= 0 && TERRAIN[terrainOf(node)].passable === 'all'
  // Earth's sea stands 70 m up (the map's coast mask keeps low inland basins as land): what it builds on must be above that sea.
  const dry = (node: number) => bodyName !== 'Earth' || !wild.reliefM || wild.reliefM[node] > 0
  const land: number[] = []
  for (let i = 0; i < n; i++) if (isGround(i) && dry(i)) land.push(i)
  const coastal = (node: number) => mesh.neighbors.fine[node].some((j) => wild.landComponent[j] < 0 && terrainOf(j) === 'ocean')

  const taken: number[] = []
  // Earth's hand-placed sites sit closer together than a random draw would allow (a fine cell is ~4 degrees there).
  const sep = bodyName === 'Earth' ? ANCHOR_MIN_SEPARATION_CELLS * mesh.fineSpacingRad : minSep
  const free = (node: number) => taken.every((t) => arc(nodePoint(node), nodePoint(t)) >= sep)

  // Draws up to `count` sites: a random ground node is accepted with its weight as
  // the probability and if it keeps its distance from every site already placed.
  const sample = (rng: () => number, count: number, weight: (node: number) => number): number[] => {
    const out: number[] = []
    if (land.length === 0) return out
    for (let attempt = 0; attempt < 400 && out.length < count; attempt++) {
      const node = land[Math.floor(rng() * land.length)]
      if (rng() >= weight(node) || !free(node)) continue
      taken.push(node)
      out.push(node)
    }
    return out
  }

  const sites: DevLocation[] = []
  const counters = new Map<LocationKind, number>()
  const add = (kind: LocationKind, node: number | null, suitability: number, capacity: number, extra: Partial<DevLocation> & { tags?: LocationTag[] } = {}) => {
    const index = counters.get(kind) ?? 0
    counters.set(kind, index + 1)
    const { tags = [], ...rest } = extra
    const terrain = node === null ? null : terrainOf(node)
    const all: LocationTag[] = [...tags]
    if (node !== null && coastal(node) && !all.includes('coastal')) all.push('coastal')
    if (terrain === 'aerostat' && !all.includes('aerostat')) all.push('aerostat')
    sites.push({ id: `${bodyName}#${kind}-${index}`, bodyName, kind, tags: all, node, terrain, suitability: Math.round(suitability * 100) / 100, capacity, ...rest })
  }

  // Snaps each anchor to the nearest free ground node (within a few cells: a spot the sea took is skipped) and adds it, in file order.
  const placeAnchors = () => {
    const reach = ANCHOR_SNAP_CELLS * mesh.fineSpacingRad
    const apartSame = ANCHOR_MIN_SEPARATION_CELLS * mesh.fineSpacingRad
    const apartOther = 0.9 * mesh.fineSpacingRad
    for (const a of EARTH_ANCHORS) {
      const at = fromLonLat((a.at[0] * Math.PI) / 180, (a.at[1] * Math.PI) / 180)
      let best = -1
      let bestD = Infinity
      for (const node of land) {
        const d = arc(nodePoint(node), at)
        if (d < bestD && d <= reach && sites.every((t) => t.node === null || arc(nodePoint(node), nodePoint(t.node)) >= (t.kind === a.kind ? apartSame : apartOther))) {
          best = node
          bestD = d
        }
      }
      if (best < 0) continue
      taken.push(best)
      if (a.kind === 'resource') add('resource', best, a.weight ?? 0.7, Math.round(1 + 2 * (a.weight ?? 0.7)), { good: a.good, weight: a.weight ?? 0.7, name: a.name })
      else {
        const suit = a.kind === 'settlement' ? Math.min(1, SETTLEMENT_SUITABILITY[terrainOf(best)] + (coastal(best) ? 0.1 : 0)) : a.kind === 'industrial' ? INDUSTRIAL_SUITABILITY[terrainOf(best)] : AGRICULTURAL_SUITABILITY[terrainOf(best)]
        add(a.kind, best, Math.max(0.3, suit), capacityOf(Math.max(0.3, suit)), { name: a.name })
      }
    }
  }

  // 1. The ground map's own cities and spaceports on an inhabited body.
  const tier = tierOf(bodyName)
  let fixedSpaceport = false
  if (tier !== 'wild') {
    const tiered: BodySurface = surfaceOf(bodyName, tier)
    for (const slot of tiered.keySlots) {
      if (slot.kind === 'capital') add('settlement', slot.node, 1, 4, { tags: ['capital'], fixed: true, name: slot.name })
      else if (slot.kind === 'city') add('settlement', slot.node, 0.9, 3, { tags: ['city'], fixed: true, name: slot.name })
      else if (slot.kind === 'spaceport') {
        add('infrastructure', slot.node, 0.8, 1, { tags: ['spaceport'], fixed: true, name: slot.name })
        fixedSpaceport = true
      } else continue
      taken.push(slot.node)
    }
  }

  // 2. Hyperium and exotic matter: where a body holds a deposit, a site for it.
  const materials = depositTables()
  const matRng = rngFor(`loc-mat:${bodyName}`)
  for (const [material, tag] of [['hyperium', 'hyperium'], ['exoticMatter', 'exotic-matter']] as const) {
    if (!(bodyName in materials[material])) continue
    const node = sample(matRng, 1, (nd) => (['rock', 'mountains', 'plateau'].includes(terrainOf(nd)) ? 0.9 : 0.35))[0]
    if (node !== undefined) add('resource', node, 1, 2, { tags: [tag], material, weight: 1 })
  }

  // Earth is hand-placed (data/earthEconomicGeography.ts): its settlements, farmland, mines and industry stand where the setting
  // puts them, not at random. Every other body is drawn from its own stream.
  const anchored = bodyName === 'Earth'
  if (anchored) placeAnchors()

  // 3. Settlements.
  const rng = rngFor(`loc:${bodyName}`)
  const wantSettlements = Math.min(MAX_SITES_PER_KIND, Math.round((1 + districts * SETTLEMENTS_PER_DISTRICT) * profile.settlement)) - sites.filter((s) => s.kind === 'settlement').length
  if (profile.settlement > 0 && !anchored) {
    for (const node of sample(rng, Math.max(0, wantSettlements), (nd) => SETTLEMENT_SUITABILITY[terrainOf(nd)] + (coastal(nd) ? 0.1 : 0))) {
      const suit = Math.min(1, SETTLEMENT_SUITABILITY[terrainOf(node)] + (coastal(node) ? 0.1 : 0))
      add('settlement', node, suit, capacityOf(suit))
    }
  }

  // 4. Industry.
  if (profile.industrial > 0 && !anchored) {
    const want = Math.min(MAX_SITES_PER_KIND, Math.round(districts * INDUSTRIAL_PER_DISTRICT * profile.industrial))
    for (const node of sample(rng, want, (nd) => INDUSTRIAL_SUITABILITY[terrainOf(nd)])) {
      const suit = INDUSTRIAL_SUITABILITY[terrainOf(node)]
      add('industrial', node, suit, capacityOf(suit))
    }
  }

  // 5. Natural resources, by what the ground is made of.
  if (profile.resource > 0 && !anchored) {
    const want = Math.min(MAX_SITES_PER_KIND, Math.max(1, Math.round(districts * RESOURCES_PER_DISTRICT * profile.resource)))
    for (const node of sample(rng, want, (nd) => (TERRAIN_RESOURCES[terrainOf(nd)] ? 0.9 : 0))) {
      const good = weighted(rng, TERRAIN_RESOURCES[terrainOf(node)]!)
      if (!good) continue
      const weight = Math.round((0.3 + 0.7 * rng()) * 100) / 100
      add('resource', node, weight, Math.round(1 + 2 * weight), { good, weight })
    }
  }

  // 6. A spaceport site where the ground map has none, beside the first settlement.
  const hasSettlement = sites.some((s) => s.kind === 'settlement')
  if (hasSettlement && !fixedSpaceport) {
    const home = sites.find((s) => s.kind === 'settlement')!.node!
    const near = (nd: number) => arc(nodePoint(nd), nodePoint(home)) < 12 * mesh.fineSpacingRad
    const node = sample(rng, 1, (nd) => (near(nd) ? INDUSTRIAL_SUITABILITY[terrainOf(nd)] : 0))[0]
    if (node !== undefined) add('infrastructure', node, INDUSTRIAL_SUITABILITY[terrainOf(node)], 1, { tags: ['spaceport'] })
  }

  // 7. High ground and coasts.
  if (profile.strategic > 0) {
    const want = Math.min(MAX_SITES_PER_KIND, Math.max(1, Math.round(districts * STRATEGIC_PER_DISTRICT * profile.strategic)))
    const high = (nd: number) => (terrainOf(nd) === 'mountains' ? 0.9 : terrainOf(nd) === 'plateau' ? 0.6 : coastal(nd) ? 0.3 : 0.05)
    for (const node of sample(rng, want, high)) {
      const t = terrainOf(node)
      add('strategic', node, high(node), 1, { tags: t === 'mountains' || t === 'plateau' ? ['high-ground'] : [] })
    }
  }
  // 8. Farmland. Last, from a stream of its own, so none of the ids above depends on it.
  if (profile.agricultural > 0 && !anchored) {
    const agriRng = rngFor(`loc-agri:${bodyName}`)
    const want = Math.min(MAX_SITES_PER_KIND, Math.max(1, Math.round(districts * AGRICULTURAL_PER_DISTRICT * profile.agricultural)))
    for (const node of sample(agriRng, want, (nd) => AGRICULTURAL_SUITABILITY[terrainOf(nd)])) {
      const suit = AGRICULTURAL_SUITABILITY[terrainOf(node)]
      add('agricultural', node, suit, capacityOf(suit))
    }
  }
  // 9. More places to live. Last, from a stream of its own, so no id above moved.
  if (profile.settlement > 0 && !anchored) {
    const target = Math.min(MAX_SETTLEMENT_SITES, Math.round((1 + districts * (SETTLEMENTS_PER_DISTRICT + EXTRA_SETTLEMENTS_PER_DISTRICT)) * profile.settlement))
    const extra = target - sites.filter((s) => s.kind === 'settlement').length
    if (extra > 0) {
      const nearWater = nodesNearWater(mesh.neighbors.fine, n, coastal, isGround, WATER_PROXIMITY_CELLS)
      const settleRng = rngFor(`loc-settle:${bodyName}`)
      for (const node of sample(settleRng, extra, (nd) => (SETTLEMENT_SUITABILITY[terrainOf(nd)] + (coastal(nd) ? 0.1 : 0)) * (nearWater === null || nearWater.has(nd) ? 1 : 0.5))) {
        const suit = Math.min(1, SETTLEMENT_SUITABILITY[terrainOf(node)] + (coastal(node) ? 0.1 : 0))
        add('settlement', node, suit, capacityOf(suit))
      }
    }
  }
  nameSites(bodyName, sites, tier !== 'wild' ? surfaceOf(bodyName, tier) : null)
  return sites
}

// The land nodes within `radius` cells of the sea, or null when the body has none (every land node counts then).
function nodesNearWater(neighbors: readonly ArrayLike<number>[], count: number, coastal: (node: number) => boolean, isGround: (node: number) => boolean, radius: number): Set<number> | null {
  let frontier: number[] = []
  for (let i = 0; i < count; i++) if (isGround(i) && coastal(i)) frontier.push(i)
  if (frontier.length === 0) return null
  const seen = new Set<number>(frontier)
  for (let r = 0; r < radius; r++) {
    const next: number[] = []
    for (const a of frontier) for (let k = 0; k < neighbors[a].length; k++) { const b = neighbors[a][k]; if (!seen.has(b)) { seen.add(b); next.push(b) } }
    frontier = next
  }
  return seen
}

// ---- names ----------------------------------------------------------------------

const ROMAN_SUFFIX = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X']
const SYLLABLES = ['ka', 'ro', 'ven', 'tal', 'mi', 'sor', 'an', 'del', 'ith', 'ur', 'ba', 'lo', 'ne', 'ky', 'ar', 'is', 'om', 'ta', 'ri', 'sen']

const GOOD_PLACE: Record<SiteGood, string> = {
  ironOre: 'Iron Mines', coal: 'Coal Mines', oil: 'Oil Fields', rareMetals: 'Rare Metal Mines', sulfur: 'Sulfur Works',
  hardwood: 'Hardwood Forest', timber: 'Timber Forest', phosphate: 'Phosphate Mines',
}

function coinedName(rng: () => number): string {
  const parts = 2 + Math.floor(rng() * 2)
  let out = ''
  for (let i = 0; i < parts; i++) out += SYLLABLES[Math.floor(rng() * SYLLABLES.length)]
  return out[0].toUpperCase() + out.slice(1)
}

// Gives every site a name at generation time (ids are untouched). Settlements: the ground map's own names for fixed ones, then
// the founding nation's list, then coined names; everything else is named for the region or the nearest settlement it lies by.
function nameSites(bodyName: string, sites: DevLocation[], tiered: BodySurface | null): void {
  const used = new Set<string>()
  const unique = (base: string): string => {
    for (let n = 0; ; n++) {
      const candidate = n < ROMAN_SUFFIX.length ? base + ROMAN_SUFFIX[n] : `${base} ${n + 1}`
      if (!used.has(candidate)) {
        used.add(candidate)
        return candidate
      }
    }
  }
  const keyNames = tiered ? keyNamesOf(tiered) : null
  // Fixed sites keep the key node's name; claim them first so no free settlement repeats one.
  const fixedName = new Map<string, string>()
  for (const s of sites) {
    if (!s.fixed || s.node === null) continue
    const k = keyNames?.get(s.node)
    const base = s.name ?? k?.name ?? k?.label
    if (base) fixedName.set(s.id, unique(base))
  }
  const { pool, start } = settlementNamePool(bodyName)
  const rng = rngFor(`locname:${bodyName}`)
  let next = 0
  const freeSettlementName = (): string => {
    while (next < pool.length) {
      const c = pool[(start + next++) % pool.length]
      if (!used.has(c.name)) return unique(c.name)
    }
    return unique(coinedName(rng))
  }
  const settlements: DevLocation[] = []
  for (const s of sites) {
    if (s.kind !== 'settlement') continue
    const fixed = fixedName.get(s.id)
    s.name = fixed ?? (s.name ? unique(s.name) : freeSettlementName())
    settlements.push(s)
  }
  const nearest = (node: number): string | null => {
    let best: DevLocation | null = null
    let bestD = Infinity
    for (const t of settlements) {
      if (t.node === null) continue
      const d = arc(nodePoint(node), nodePoint(t.node))
      if (d < bestD) { best = t; bestD = d }
    }
    return best?.name ?? null
  }
  for (const s of sites) {
    if (s.kind === 'settlement') continue
    if (fixedName.has(s.id)) { s.name = fixedName.get(s.id); continue }
    if (s.name) { s.name = unique(s.name); continue }
    const place = (s.node !== null ? regionAt(bodyName, s.node) ?? nearest(s.node) : null) ?? bodyName
    switch (s.kind) {
      case 'resource':
        s.name = unique(`${place} ${s.material === 'hyperium' ? 'Hyperium Deposit' : s.material === 'exoticMatter' ? 'Exotic Matter Deposit' : s.good ? GOOD_PLACE[s.good] : 'Deposit'}`)
        break
      case 'industrial': s.name = unique(`${place} Industrial Zone`); break
      case 'agricultural': s.name = unique(`${place} Farmlands`); break
      case 'infrastructure': s.name = unique(`${place} Spaceport`); break
      case 'strategic': s.name = unique(s.tags.includes('high-ground') ? `${place} Heights` : `${place} Watch`); break
    }
  }
}

// ---- public API ---------------------------------------------------------------

const cache = new Map<string, readonly DevLocation[]>()
// Generated + founded, kept while the founded list is the same array (the store replaces it on every change).
const merged = new Map<string, { custom: readonly DevLocation[]; caps: Readonly<Record<string, number>>; sites: readonly DevLocation[] }>()

export function clearLocationCache(): void {
  cache.clear()
  merged.clear()
}

// The sites the generator finds on a body: deterministic, never changed by play. Ids `<body>#<kind>-<n>`, n from 0.
export function generatedLocationsOf(bodyName: string): readonly DevLocation[] {
  const hit = cache.get(bodyName)
  if (hit) return hit
  const sites = Object.freeze(generate(bodyName))
  cache.set(bodyName, sites)
  return sites
}

// Every development location of a planet, dwarf planet or moon (any cluster): the generated ones in order of generation, then
// the ones founded during play (ids numbered from FIRST_CUSTOM_INDEX, scene/siteFounding.ts). [] for a name that has no
// ground (a belt: `beltLocations`).
export function locationsOf(bodyName: string): readonly DevLocation[] {
  const generated = generatedLocationsOf(bodyName)
  const founded = customSitesOf(bodyName)
  const caps = zoneCapacitiesOf(bodyName)
  if (founded.length === 0 && caps === NO_ZONE_CAPS) return generated
  const hit = merged.get(bodyName)
  if (hit && hit.custom === founded && hit.caps === caps) return hit.sites
  // A redrawn zone changes how much its site can hold: the capacity every other rule reads follows it.
  const sites = Object.freeze([...generated, ...founded].map((s) => (caps[s.id] !== undefined && caps[s.id] !== s.capacity ? { ...s, capacity: caps[s.id] } : s)))
  merged.set(bodyName, { custom: founded, caps, sites })
  return sites
}

// The capacity a site was generated or founded with, whatever its zone holds now. Who lives where is shared out by this, so redrawing
// a zone (more or less ground to grow into) never moves people or makes a city appear larger by itself.
export function baseCapacity(site: DevLocation): number {
  return generatedLocationsOf(site.bodyName).find((s) => s.id === site.id)?.capacity ?? customSitesOf(site.bodyName).find((s) => s.id === site.id)?.capacity ?? site.capacity
}

// A belt's sites: resource only, no ground. By name (the caller knows it is a belt).
export function beltLocations(beltName: string): readonly DevLocation[] {
  const hit = cache.get(`belt:${beltName}`)
  if (hit) return hit
  const rng = rngFor(`beltloc:${beltName}`)
  const sites: DevLocation[] = []
  for (let i = 0; i < BELT_SITES; i++) {
    const good = weighted<SiteGood>(rng, BELT_RESOURCES)!
    const weight = Math.round((0.3 + 0.7 * rng()) * 100) / 100
    sites.push({ id: `${beltName}#resource-${i}`, bodyName: beltName, name: `${beltName} ${GOOD_PLACE[good].replace(/ (Forest)$/, ' Camp')} ${ROMAN_SUFFIX[i] || i + 1}`.replace('  ', ' ').trim(), kind: 'resource', tags: ['belt'], node: null, terrain: null, suitability: weight, capacity: Math.round(1 + 2 * weight), good, weight })
  }
  const frozen = Object.freeze(sites)
  cache.set(`belt:${beltName}`, frozen)
  return frozen
}

const authoredBelts = (): Set<string> => new Set(Object.values(ASTEROID_BELTS_BY_STAR).flat().map((b) => b.name))

// The body an id belongs to ('Mars#settlement-2' -> 'Mars').
export function bodyOfLocation(id: string): string {
  return id.slice(0, id.lastIndexOf('#'))
}

export function locationById(id: string): DevLocation | undefined {
  const body = bodyOfLocation(id)
  const sites = bodyGroundInfoAny(body) ? locationsOf(body) : authoredBelts().has(body) ? beltLocations(body) : []
  return sites.find((s) => s.id === id)
}

export function locationsOfKind(bodyName: string, kind: LocationKind): readonly DevLocation[] {
  return locationsOf(bodyName).filter((s) => s.kind === kind)
}

// What a body can hold, summed: sites and capacity per kind. Both economies size
// their land and slots from the same figures.
export function bodyDevelopment(bodyName: string): Record<LocationKind, { sites: number; capacity: number }> {
  const out = Object.fromEntries(LOCATION_KINDS.map((k) => [k, { sites: 0, capacity: 0 }])) as Record<LocationKind, { sites: number; capacity: number }>
  for (const s of locationsOf(bodyName)) {
    out[s.kind].sites++
    out[s.kind].capacity += s.capacity
  }
  return out
}
