// Auto-explore for Turing Scouts, the pure part: which place the scout jumps to next. Stores
// and the jump itself are scene/automation.ts. Scouts only EXPLORE (being in a system or beside a
// cluster is the whole job: they never survey), and the choice reads only what the player knows
// of the map: where places are, and which of them this nation's own ships have already been to
// (never what is at them: bodies, owners, fleets).
//  - Interstellar: the nearest star of the Solar Neighbourhood not yet explored.
//  - Intercluster: the nearest cluster not yet visited.
//  - Both: the neighbourhood's stars first, then the nearest unvisited cluster (the stars are
//    light-years apart and clusters thousands, so nearest-first would never mix them).
// A place a scout has been to is never picked again, and the places other scouts are at or
// headed for are skipped, so several scouts split the work instead of crowding one target.

export type ExploreScope = 'interstellar' | 'intercluster' | 'both'
export const EXPLORE_SCOPES: readonly ExploreScope[] = ['interstellar', 'intercluster', 'both']
export const EXPLORE_SCOPE_LABELS: Record<ExploreScope, string> = { interstellar: 'Interstellar', intercluster: 'Intercluster', both: 'Both' }
export const EXPLORE_SCOPE_TIPS: Record<ExploreScope, string> = {
  interstellar: 'Explore the stars of the Solar Neighbourhood, nearest first',
  intercluster: 'Explore other clusters, nearest first',
  both: 'Explore the neighbourhood\'s stars first, then hop to the nearest unvisited cluster',
}
export const DEFAULT_EXPLORE_SCOPE: ExploreScope = 'interstellar'
// How long a scout with nothing left to explore waits before looking again (sim-days).
export const EXPLORE_RECHECK_DAYS = 30

export type ExploreTarget = { kind: 'star'; id: string } | { kind: 'cluster'; id: string }
export const exploreKey = (t: ExploreTarget): string => `${t.kind}:${t.id}`

interface Place {
  id: string
  position: readonly [number, number, number]
}

export interface ExploreInput {
  scope: ExploreScope
  // Where the scout is: a star of the neighbourhood (null in open space), and the cluster it
  // rests beside (null inside the Solar Neighbourhood, where it is "at" a star).
  hereStarId: string | null
  hereClusterId: string | null
  // Candidate places (the neighbourhood's charted stars; every cluster).
  stars: readonly Place[]
  clusters: readonly Place[]
  isStarExplored: (starId: string) => boolean
  isClusterVisited: (clusterId: string) => boolean
  // exploreKey()s other scouts are at or headed for.
  claimed: ReadonlySet<string>
}

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function nearest(from: readonly number[] | null, places: readonly Place[], kind: ExploreTarget['kind'], ok: (p: Place) => boolean, claimed: ReadonlySet<string>): ExploreTarget | null {
  const options = places.filter((p) => ok(p) && !claimed.has(exploreKey({ kind, id: p.id })))
  if (options.length === 0) return null
  options.sort((a, b) => (from ? dist(from, a.position) - dist(from, b.position) : 0) || a.id.localeCompare(b.id))
  return { kind, id: options[0].id }
}

export function pickExploreTarget(input: ExploreInput): ExploreTarget | null {
  const { scope, hereStarId, hereClusterId, stars, clusters, claimed } = input
  // Inside the neighbourhood the scout flies among its stars; beside a foreign cluster its stars
  // cannot be flown to yet, so only clusters are on offer.
  if (scope !== 'intercluster' && hereClusterId === null && hereStarId !== null) {
    const here = stars.find((s) => s.id === hereStarId)?.position ?? null
    const star = nearest(here, stars, 'star', (s) => s.id !== hereStarId && !input.isStarExplored(s.id), claimed)
    if (star) return star
  }
  if (scope === 'interstellar') return null
  const hereCluster = clusters.find((c) => c.id === (hereClusterId ?? SOL_CLUSTER))?.position ?? null
  return nearest(hereCluster, clusters, 'cluster', (c) => c.id !== hereClusterId && !input.isClusterVisited(c.id), claimed)
}

// The Solar Neighbourhood's cluster id (kept here as a literal so this module stays data-free;
// tests pin it to data/galaxyGen.SOLAR_NEIGHBORHOOD_ID).
export const SOL_CLUSTER = 'solar-neighborhood'

// The places other scouts on Auto-explore occupy or are heading for, from where each rests
// and any jump it has waiting.
export function claimedTargets(others: readonly { restingStarId: string | null; restingClusterId: string | null; pendingStarId: string | null; pendingClusterId: string | null }[]): Set<string> {
  const out = new Set<string>()
  for (const o of others) {
    if (o.restingStarId) out.add(exploreKey({ kind: 'star', id: o.restingStarId }))
    if (o.restingClusterId) out.add(exploreKey({ kind: 'cluster', id: o.restingClusterId }))
    if (o.pendingStarId) out.add(exploreKey({ kind: 'star', id: o.pendingStarId }))
    if (o.pendingClusterId) out.add(exploreKey({ kind: 'cluster', id: o.pendingClusterId }))
  }
  return out
}

// The plain-language status line. `kind` says what the scout is doing now.
export type ExploreStatus =
  | { kind: 'jumped'; name: string }
  | { kind: 'cooldown'; days: number }
  | { kind: 'nothing'; scope: ExploreScope }
  | { kind: 'drive'; chosen: string }
  | { kind: 'between' }
  | { kind: 'refused'; reason: string }

export function exploreStatusText(status: ExploreStatus): string {
  switch (status.kind) {
    case 'jumped':
      return `Auto-explore: reached ${status.name}; the next jump goes to the nearest place not yet explored`
    case 'cooldown':
      return `Auto-explore: waiting for the hyperdrive (${Math.ceil(status.days)} day${Math.ceil(status.days) === 1 ? '' : 's'})`
    case 'nothing':
      return `Auto-explore: nothing left to explore (${EXPLORE_SCOPE_LABELS[status.scope]}); it looks again every ${EXPLORE_RECHECK_DAYS} days`
    case 'drive':
      return `Auto-explore needs the Hyperdrive: this ship is set to ${status.chosen}. Pick Hyperdrive in the ship panel`
    case 'between':
      return 'Auto-explore: the ship is between clusters; order it to a cluster first'
    case 'refused':
      return `Auto-explore: ${status.reason}`
  }
}
