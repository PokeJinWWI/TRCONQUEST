// Starting hyperium: scarce, and only near Sol. Within HYPERIUM_NEAR_SOL_KLY of
// the Sun there is a modest stock (the Sol neighbourhood and the clusters round
// it); everywhere else there is almost none: a few seeded clusters hold a tiny
// amount, way less than the Sol neighbourhood. So far empires can build no
// hyperdrive hull at all (they fly warp), and Sol and its neighbours field few
// ships. No mining or production beyond the nations' flat income.
import { NEIGHBORHOODS } from './neighborhoodData'
import { seededStream } from './galaxyGen'

export const HYPERIUM_NEAR_SOL = 10
export const HYPERIUM_NEAR_SOL_KLY = 3
export const HYPERIUM_ANOMALY_CLUSTER_COUNT = 2
export const HYPERIUM_ANOMALY_AMOUNT = 1
export const HYPERIUM_SEED_KEY = 'hyperium-anomalies'
const SOL_ID = 'solar-neighborhood'

export function distanceFromSolKly(clusterId: string): number {
  const sol = NEIGHBORHOODS.find((n) => n.id === SOL_ID)
  const n = NEIGHBORHOODS.find((x) => x.id === clusterId)
  if (!sol || !n) return Infinity
  return Math.hypot(n.position[0] - sol.position[0], n.position[1] - sol.position[1], n.position[2] - sol.position[2])
}

// Which of `candidates` hold the tiny anomalous deposits: HYPERIUM_ANOMALY_CLUSTER_COUNT
// of them (none near Sol, where there is hyperium anyway). Every cluster draws its
// own rank from its own stream and the lowest win, so the pick does not depend on
// the order or the rest of the list: a candidate coming or going only matters if
// it is one of the winners.
export function hyperiumAnomalyClusters(candidates: readonly string[], seed: number): Set<string> {
  const far = [...new Set(candidates)].filter((id) => distanceFromSolKly(id) > HYPERIUM_NEAR_SOL_KLY)
  const rank = new Map(far.map((id) => [id, seededStream(seed, `${HYPERIUM_SEED_KEY}:${id}`)()]))
  far.sort((x, y) => rank.get(x)! - rank.get(y)! || x.localeCompare(y))
  return new Set(far.slice(0, HYPERIUM_ANOMALY_CLUSTER_COUNT))
}

// Starting hyperium of a neighbourhood: the modest stock near Sol, the tiny
// deposit if it is one of the `anomalies`, else nothing.
export function hyperiumInCluster(clusterId: string, anomalies: ReadonlySet<string>): number {
  if (distanceFromSolKly(clusterId) <= HYPERIUM_NEAR_SOL_KLY) return HYPERIUM_NEAR_SOL
  return anomalies.has(clusterId) ? HYPERIUM_ANOMALY_AMOUNT : 0
}
