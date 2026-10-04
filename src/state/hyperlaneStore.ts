import { create } from 'zustand'
import { hasLane, mergeLanes, withLane } from '../scene/hyperlanes'

export { laneEndpoints } from '../scene/hyperlanes'

const NO_LANES: string[] = []

interface HyperlaneState {
  // Each nation's own charted lanes, as canonical "a::b" keys (scene/hyperlanes.ts).
  // A lane belongs to the nation whose ship charted it: nobody else's jumps are
  // safer for it and nobody else sees it on the map (lanes are never shared).
  lanes: Record<string, string[]>
  hasHyperlane: (nationId: string, a: string, b: string) => boolean
  // Called only once a hyperdrive jump between these two has actually
  // succeeded (see shipPhysics.planMove/hyperdriveLossChance) — a lane
  // represents a charted, safer route, not just an attempted one. A no-op if
  // the nation already has the lane.
  addHyperlane: (nationId: string, a: string, b: string) => void
  // The same array until the nation charts another lane (safe as a selector).
  lanesOf: (nationId: string | null | undefined) => string[]
  // Every nation's lanes as one list: Observer mode only.
  allLanes: () => string[]
}

export const useHyperlaneStore = create<HyperlaneState>((set, get) => ({
  lanes: {},
  hasHyperlane: (nationId, a, b) => hasLane(get().lanes[nationId] ?? NO_LANES, a, b),
  addHyperlane: (nationId, a, b) => {
    const mine = get().lanes[nationId] ?? NO_LANES
    const next = withLane(mine, a, b)
    if (next === mine) return
    set((s) => ({ lanes: { ...s.lanes, [nationId]: next as string[] } }))
  },
  lanesOf: (nationId) => (nationId ? get().lanes[nationId] ?? NO_LANES : NO_LANES),
  allLanes: () => allLanesOf(get().lanes),
}))

export function allLanesOf(lanes: Record<string, string[]>): string[] {
  return Object.keys(lanes)
    .sort()
    .reduce<string[]>((all, id) => mergeLanes(all, lanes[id]), [])
}
