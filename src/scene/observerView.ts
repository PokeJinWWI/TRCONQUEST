// What Observer mode draws, as pure functions of static data: the generated
// empires' claims (per star and per neighbourhood), their markers and the charted
// hyperlanes as one segment buffer. Read-only: no store is written.
import { empireOwningStar, galaxyEmpires } from '../data/generatedEmpires'
import { starScenePosition, type StarData } from '../data/starData'
import type { SystemClaim } from './territory'

// Who owns each of these stars (an empire owns whole systems, so never contested).
export function empireClaimsByStar(stars: StarData[]): Map<string, SystemClaim> {
  const map = new Map<string, SystemClaim>()
  for (const star of stars) {
    const empire = empireOwningStar(star.id)
    if (empire) map.set(star.id, { kind: 'owned', countryId: empire.id })
  }
  return map
}

// A neighbourhood's claim: its empire(s), one or two.
export function empireClusterClaims(): Map<string, SystemClaim> {
  const byCluster = new Map<string, string[]>()
  for (const e of galaxyEmpires()) byCluster.set(e.clusterId, [...(byCluster.get(e.clusterId) ?? []), e.id])
  const claims = new Map<string, SystemClaim>()
  for (const [cluster, ids] of byCluster) claims.set(cluster, ids.length === 1 ? { kind: 'owned', countryId: ids[0] } : { kind: 'contested', countryIds: [...ids].sort() })
  return claims
}

// One marker per owned star, in its owner's colour: [x, y, z] and [r, g, b] triples.
export function empireMarkers(stars: StarData[]): { positions: Float32Array; colors: Float32Array } {
  const owned = stars.map((s) => ({ s, e: empireOwningStar(s.id) })).filter((x) => x.e)
  const positions = new Float32Array(owned.length * 3)
  const colors = new Float32Array(owned.length * 3)
  owned.forEach(({ s, e }, i) => {
    positions.set(starScenePosition(s), i * 3)
    const hex = parseInt(e!.color.slice(1), 16)
    colors.set([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255], i * 3)
  })
  return { positions, colors }
}

// Every lane whose two ends are among `stars`, as pairs of points for ONE
// LineSegments draw call.
export function laneSegments(lanes: string[], stars: StarData[]): Float32Array {
  const at = new Map(stars.map((s) => [s.id, starScenePosition(s)]))
  const out: number[] = []
  for (const key of lanes) {
    const [a, b] = key.split('::')
    const pa = at.get(a)
    const pb = at.get(b)
    if (pa && pb) out.push(...pa, ...pb)
  }
  return new Float32Array(out)
}
