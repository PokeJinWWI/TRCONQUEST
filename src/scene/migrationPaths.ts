// The lanes people may migrate along because of treaties (data/treatyData `migration` article): derived from the treaties in force, so
// cancelling a treaty closes the lane while the people who already moved stay. Pure.
import { migrationLane } from '../economy/migration'
import type { Treaty } from '../data/treatyData'

export interface TreatyLanes {
  lanes: string[]
  // Monthly cap (millions) per lane where a treaty sets one (the smallest if several do).
  quota: Record<string, number>
}

export function treatyLanes(treaties: readonly Treaty[]): TreatyLanes {
  const lanes = new Set<string>()
  const quota: Record<string, number> = {}
  for (const t of treaties) {
    for (const a of t.articles) {
      if (a.kind !== 'migration') continue
      const directions = a.mutual ? [migrationLane(a.sourceId, a.targetId), migrationLane(a.targetId, a.sourceId)] : [migrationLane(a.sourceId, a.targetId)]
      for (const lane of directions) {
        lanes.add(lane)
        if (a.quota !== undefined && a.quota > 0) quota[lane] = Math.min(quota[lane] ?? Infinity, a.quota)
      }
    }
  }
  return { lanes: [...lanes].sort(), quota }
}
