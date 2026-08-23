import { create } from 'zustand'

// A hyperlane has no direction — sorting the pair before joining makes the
// key independent of which star was the origin vs. destination for any
// particular jump.
function laneKey(a: string, b: string): string {
  return [a, b].sort().join('::')
}

// Splits a lane key back into its two star ids, for rendering a line between
// them (see InterstellarScene) — order is whatever laneKey's sort produced,
// which is fine since a hyperlane itself has no direction.
export function laneEndpoints(key: string): [string, string] {
  const [a, b] = key.split('::')
  return [a, b]
}

interface HyperlaneState {
  // Canonical "a::b" keys rather than a Set, so the store stays a plain
  // array InterstellarScene can map over directly to render lines.
  lanes: string[]
  hasHyperlane: (a: string, b: string) => boolean
  // Called only once a hyperdrive jump between these two stars has actually
  // succeeded (see shipPhysics.planMove/hyperdriveLossChance) — a lane
  // represents a charted, safer route, not just an attempted one. A no-op if
  // the lane already exists.
  addHyperlane: (a: string, b: string) => void
}

export const useHyperlaneStore = create<HyperlaneState>((set, get) => ({
  lanes: [],
  hasHyperlane: (a, b) => get().lanes.includes(laneKey(a, b)),
  addHyperlane: (a, b) => {
    const key = laneKey(a, b)
    if (get().lanes.includes(key)) return
    set((s) => ({ lanes: [...s.lanes, key] }))
  },
}))
