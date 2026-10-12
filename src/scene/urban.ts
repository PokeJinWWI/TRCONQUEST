// Settlements as they develop, pure (docs/territorial-design.md M10). Nothing here is stored: what a
// settlement is follows from three things the game already tracks, so a "city" is never a label that was
// handed out:
//   POPULATION  the world's people, shared among its settlements by how much room each has, how good
//               the ground is, and how much work stands within reach of it
//   JOBS        the buildings placed on the sites around it (scene/placement)
//   ACCESS      how much of the freight from its surroundings reaches a hub (scene/infrastructureNet)
// Its tier needs a population, room (capacity) and access together; a town with no road to anywhere stays
// a town. A colony need never become a city: a mining outpost with a few buildings stays an outpost.
import { CATCHMENT_CELLS, JOB_PULL, POP_PER_CAPACITY, SPECIALIZATION_MIN_SLOTS, SPECIALIZATION_SHARE, TIERS, TIER_RULES, type Specialization, type SettlementTier } from '../data/urbanData'
import type { LocationKind } from '../data/locationData'

export interface UrbanInput {
  bodyName: string
  // The world's population, millions.
  population: number
  // Established settlement sites.
  settlements: { id: string; node: number; capacity: number; suitability: number; capital: boolean; shareCapacity?: number }[]
  // Buildings placed on the body's sites: where, what kind of site, how many.
  placements: { siteId: string; node: number; kind: LocationKind; good?: string; count: number }[]
  // Each site's transport access (scene/infrastructureNet.siteAccess).
  access: Record<string, number>
  cellsBetween: (a: number, b: number) => number
}

export interface UrbanSettlement {
  id: string
  population: number
  share: number
  tier: SettlementTier
  specializations: Specialization[]
  jobs: number
  access: number
  // What would take it to the next tier, or null if it cannot grow further here.
  next: { tier: SettlementTier; needs: string[] } | null
  overcrowded: boolean
  catchment: string[]
}

const FIELD_OF_KIND: Partial<Record<LocationKind, Specialization>> = { agricultural: 'agriculture', resource: 'mining', industrial: 'industry', infrastructure: 'port', settlement: 'services' }

export function urbanProfile(input: UrbanInput): UrbanSettlement[] {
  const { settlements, placements, access, cellsBetween } = input
  if (settlements.length === 0) return []
  // Work belongs to the nearest settlement within reach.
  const owner = new Map<string, string>()
  for (const p of placements) {
    let best: { id: string; d: number } | null = null
    for (const s of settlements) {
      const d = s.node === p.node ? 0 : cellsBetween(s.node, p.node)
      if (d <= CATCHMENT_CELLS && (!best || d < best.d || (d === best.d && s.id < best.id))) best = { id: s.id, d }
    }
    if (best) owner.set(p.siteId, best.id)
  }
  const jobsOf = new Map<string, number>()
  const byField = new Map<string, Map<Specialization, number>>()
  const catchment = new Map<string, Set<string>>()
  for (const p of placements) {
    const who = owner.get(p.siteId)
    if (!who) continue
    jobsOf.set(who, (jobsOf.get(who) ?? 0) + p.count)
    const field = FIELD_OF_KIND[p.kind]
    if (field) {
      const row = byField.get(who) ?? new Map<Specialization, number>()
      row.set(field, (row.get(field) ?? 0) + p.count)
      byField.set(who, row)
    }
    catchment.set(who, (catchment.get(who) ?? new Set<string>()).add(p.siteId))
  }
  const weight = (s: UrbanInput['settlements'][number]) => (s.shareCapacity ?? s.capacity) * s.suitability + JOB_PULL * (jobsOf.get(s.id) ?? 0)
  const total = settlements.reduce((n, s) => n + weight(s), 0) || 1
  return settlements.map((s) => {
    const share = weight(s) / total
    const population = input.population * share
    const acc = access[s.id] ?? 1
    // The best tier whose population, room and access are ALL met.
    let tier: SettlementTier = 'outpost'
    for (const t of TIERS) {
      const r = TIER_RULES[t]
      if (population >= r.minPopulation && s.capacity >= r.minCapacity && acc >= r.minAccess) tier = t
    }
    const jobs = jobsOf.get(s.id) ?? 0
    const fields = byField.get(s.id) ?? new Map<Specialization, number>()
    const specializations: Specialization[] = []
    if (s.capital) specializations.push('capital')
    for (const [field, slots] of [...fields].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) if (slots >= SPECIALIZATION_MIN_SLOTS && jobs > 0 && slots / jobs >= SPECIALIZATION_SHARE) specializations.push(field)
    const nextTier = TIERS[TIERS.indexOf(tier) + 1]
    let next: UrbanSettlement['next'] = null
    if (nextTier) {
      const r = TIER_RULES[nextTier]
      const needs: string[] = []
      if (population < r.minPopulation) needs.push(`${Math.ceil(r.minPopulation - population)}M more people (more work and room draw them)`)
      if (s.capacity < r.minCapacity) needs.push(`a site with capacity ${r.minCapacity} (this one holds ${s.capacity})`)
      if (acc < r.minAccess) needs.push(`transport access ${Math.round(r.minAccess * 100)}% (it has ${Math.round(acc * 100)}%)`)
      next = { tier: nextTier, needs }
    }
    return { id: s.id, population, share, tier, specializations, jobs, access: acc, next, overcrowded: population > s.capacity * POP_PER_CAPACITY, catchment: [...(catchment.get(s.id) ?? [])].sort() }
  })
}
