// Supply for the ground war, from the same freight network the economy uses (docs/territorial-design.md M14). A unit
// resting near a site that is joined to its nation's hubs recovers at the full rate; near a site cut off from them by
// distance, water, a captured route or an enemy's occupation, at the share of its output that gets out (scene/
// infrastructureNet.siteAccess). There is no second supply system: a war that cuts a railway cuts the freight and
// the supply with it.
import { accessOnBody } from './infrastructureOrders'
import { locationsOf } from './locations'
import { arc, nodePoint } from './surfaceMesh'

// A supply function for one resolve step: the access map of each (nation, body) is read once.
export function makeSupplyFn(): (countryId: string, bodyName: string, node: number) => number {
  const cache = new Map<string, { sites: { id: string; node: number }[]; access: Record<string, number> }>()
  return (countryId, bodyName, node) => {
    const key = `${countryId}|${bodyName}`
    let entry = cache.get(key)
    if (!entry) {
      entry = { sites: locationsOf(bodyName).filter((s) => s.node !== null).map((s) => ({ id: s.id, node: s.node! })), access: accessOnBody(bodyName, countryId) }
      cache.set(key, entry)
    }
    if (entry.sites.length === 0) return 1
    const here = nodePoint(node)
    let best = entry.sites[0]
    let bestD = Infinity
    for (const s of entry.sites) {
      const d = arc(here, nodePoint(s.node))
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return entry.access[best.id] ?? 1
  }
}
