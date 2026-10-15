// Where a new game's starting districts and buildings stand (docs/territorial-design.md section 12). Every starting
// district level and building of a world is assigned to the sites of its body, so the economy and the geography are one
// thing from the first day. `assignSeed` is pure and deterministic; `seedBodyPlacement` applies it to the stores.
//
// The starting economy was calibrated as it is, so nothing here changes a number in it: the assignment only records where
// levels and buildings are, and the sites it uses are marked `connected` (their freight is taken to reach the hubs).
import { siteKindsOfDistrict, districtOfBuilding, isPlacedDistrict, slotsPerLevel, type EconomyMode } from './districtSites'
import { STANDALONE_BUILDINGS, extractsFrom, siteKindOf, siteKindsFor, slotsUsedBy } from './placement'
import type { DevLocation } from './locations'
import type { LocationKind } from '../data/locationData'

export interface SeedInput {
  mode: EconomyMode
  sites: readonly DevLocation[]
  // Whether a site may be given levels and buildings (settlements and ports: only the nation's own; others: any open ground).
  eligible: (site: DevLocation) => boolean
  // The world's developed levels per district.
  districts: Record<string, number>
  buildings: { id: string; count: number }[]
}

export interface SeedResult {
  levels: Record<string, Record<string, number>>
  placed: Record<string, Record<string, number>>
  // Buildings that found no developed slot on any site (left unplaced, as before).
  unplaced: Record<string, number>
  // Levels beyond what the sites' capacity holds (a starting world may be larger than its sites were generated for).
  overflowLevels: number
}

const bySuitability = (a: DevLocation, b: DevLocation) => b.suitability - a.suitability || (a.id < b.id ? -1 : 1)

export function assignSeed(input: SeedInput): SeedResult {
  const { mode, sites, eligible } = input
  const per = slotsPerLevel(mode)
  const levels: SeedResult['levels'] = {}
  const placed: SeedResult['placed'] = {}
  const unplaced: Record<string, number> = {}
  let overflowLevels = 0
  const siteLevelTotal = (id: string) => Object.values(levels[id] ?? {}).reduce((n, v) => n + v, 0)
  const addLevel = (id: string, d: string, n: number) => {
    levels[id] = { ...(levels[id] ?? {}), [d]: (levels[id]?.[d] ?? 0) + n }
  }

  const buildings = [...input.buildings].filter((b) => b.count > 0 && !STANDALONE_BUILDINGS.has(b.id)).sort((a, b) => (districtOfBuilding({ mode, id: a.id }) + a.id < districtOfBuilding({ mode, id: b.id }) + b.id ? -1 : 1))
  const districts = Object.keys(input.districts).filter(isPlacedDistrict).sort()

  // 1. Levels: each district's levels go to the kinds of site its buildings stand on (in proportion to the slots they need), then fill
  //    each kind's sites best first up to their capacity.
  for (const d of districts) {
    const total = input.districts[d] ?? 0
    if (total <= 0) continue
    const kinds = siteKindsOfDistrict(mode, d)
    if (kinds.length === 0) continue
    const need = new Map<LocationKind, number>()
    for (const b of buildings) if (districtOfBuilding({ mode, id: b.id }) === d) need.set(siteKindOf({ mode, id: b.id }), (need.get(siteKindOf({ mode, id: b.id })) ?? 0) + b.count * slotsUsedBy({ mode, id: b.id }))
    const want = new Map<LocationKind, number>()
    let wanted = 0
    for (const k of kinds) {
      const n = Math.ceil((need.get(k) ?? 0) / per)
      want.set(k, n)
      wanted += n
    }
    // Scale down if the buildings need more levels than the district has; the rest goes to the first kind.
    if (wanted > total) {
      let left = total
      for (const k of kinds) {
        const share = Math.min(left, Math.max(want.get(k)! > 0 ? 1 : 0, Math.floor((want.get(k)! * total) / wanted)))
        want.set(k, share)
        left -= share
      }
      want.set(kinds[0], (want.get(kinds[0]) ?? 0) + left)
    } else want.set(kinds[0], (want.get(kinds[0]) ?? 0) + (total - wanted))
    for (const k of kinds) {
      let remaining = want.get(k) ?? 0
      // A hyperium or exotic-matter deposit is drawn by extraction technology, not by district buildings: no levels there.
      const cands = sites.filter((s) => s.kind === k && eligible(s) && !s.material).sort(bySuitability)
      if (cands.length === 0) continue
      // Extractors first: a deposit gets the levels its own extractors need (iron mines stand where there is iron).
      if (k === 'resource') {
        const claimed = new Set<string>()
        for (const s of cands) {
          if (remaining <= 0 || !s.good) continue
          let slots = 0
          for (const b of buildings) {
            const ref = { mode, id: b.id }
            const ex = extractsFrom(ref)
            if (districtOfBuilding(ref) !== d || !ex || ex === 'any' || !ex.includes(s.good) || claimed.has(b.id)) continue
            claimed.add(b.id)
            slots += b.count * slotsUsedBy(ref)
          }
          const take = Math.min(remaining, Math.ceil(slots / per), Math.max(0, s.capacity - siteLevelTotal(s.id)))
          if (take > 0) {
            addLevel(s.id, d, take)
            remaining -= take
          }
        }
      }
      for (const s of cands) {
        if (remaining <= 0) break
        const take = Math.min(remaining, Math.max(0, s.capacity - siteLevelTotal(s.id)))
        if (take > 0) {
          addLevel(s.id, d, take)
          remaining -= take
        }
      }
      if (remaining > 0) {
        addLevel(cands[0].id, d, remaining)
        overflowLevels += remaining
      }
    }
  }

  // 2. Buildings: unit by unit onto a site of the right kind with a developed free slot (a deposit match first for an extractor).
  const used = new Map<string, number>()
  const key = (id: string, d: string) => `${id}|${d}`
  for (const b of buildings) {
    const ref = { mode, id: b.id }
    const d = districtOfBuilding(ref)
    const kinds = siteKindsFor(ref)
    const slots = slotsUsedBy(ref)
    const extracts = extractsFrom(ref)
    const cands = sites
      .filter((s) => kinds.includes(s.kind) && (slots === 0 || (levels[s.id]?.[d] ?? 0) > 0) && eligible(s) && !s.material)
      .sort((a, c) => {
        // The building's own kind of site first (a port on port ground), then a deposit match for an extractor, then the better ground.
        const ka = kinds.indexOf(a.kind)
        const kc = kinds.indexOf(c.kind)
        const ma = extracts && extracts !== 'any' && a.good && extracts.includes(a.good) ? 0 : 1
        const mc = extracts && extracts !== 'any' && c.good && extracts.includes(c.good) ? 0 : 1
        return ka - kc || ma - mc || bySuitability(a, c)
      })
    for (let i = 0; i < b.count; i++) {
      const site = cands.find((s) => slots === 0 || (levels[s.id]?.[d] ?? 0) * per - (used.get(key(s.id, d)) ?? 0) >= slots)
      if (!site) {
        unplaced[b.id] = (unplaced[b.id] ?? 0) + 1
        continue
      }
      used.set(key(site.id, d), (used.get(key(site.id, d)) ?? 0) + slots)
      placed[site.id] = { ...(placed[site.id] ?? {}), [b.id]: (placed[site.id]?.[b.id] ?? 0) + 1 }
    }
  }
  return { levels, placed, unplaced, overflowLevels }
}
