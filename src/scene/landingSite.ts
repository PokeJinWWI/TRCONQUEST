// Where a Colony Ship may land: the pure rules. A colony stands on a settlement SITE, so a landing either takes a free generated
// settlement site close by (the ground there was already the right sort) or founds a new one on the clicked ground, under the
// same ground rules as any district (scene/siteFounding.planFounding). The legal half and the writes are scene/colonies.ts.
import { locationsOf, type DevLocation } from './locations'
import { siteOwner } from '../state/locationStore'
import { SITE_MIN_SEPARATION_CELLS } from '../data/locationData'
import { KEY_MIN_SEPARATION_CELLS } from '../data/groundData'
import { planFounding } from './siteFounding'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'

// A free generated settlement site within this many cells of the click is taken instead of founding a new one beside it
// (it is the distance a new settlement would have to keep from it anyway).
export const LANDING_ADOPT_CELLS = Math.max(SITE_MIN_SEPARATION_CELLS, KEY_MIN_SEPARATION_CELLS - 1)

export type Landing =
  | { ok: true; node: number; adopt: DevLocation; found?: undefined }
  | { ok: true; node: number; found: DevLocation; adopt?: undefined }
  | { ok: false; reason: string }

export function planLanding(bodyName: string, node: number, owner: string, sites: readonly DevLocation[] = locationsOf(bodyName)): Landing {
  const mesh = surfaceMesh()
  if (!Number.isInteger(node) || node < 0 || node >= mesh.count.fine) return { ok: false, reason: 'That is not a place on the map' }
  const here = nodePoint(node)
  const reach = LANDING_ADOPT_CELLS * mesh.fineSpacingRad
  let best: DevLocation | null = null
  let bestD = Infinity
  for (const s of sites) {
    if (s.kind !== 'settlement' || s.node === null) continue
    const taken = siteOwner(s.id)
    if (taken && taken !== owner) continue
    const d = arc(here, nodePoint(s.node))
    if (d < reach && d < bestD) {
      best = s
      bestD = d
    }
  }
  if (best && best.node !== null) return { ok: true, node: best.node, adopt: best }
  const plan = planFounding(bodyName, 'settlement', node, sites, owner)
  if (!plan.ok) return { ok: false, reason: plan.reason[0].toUpperCase() + plan.reason.slice(1) }
  return { ok: true, node, found: plan.site }
}
