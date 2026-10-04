// Hyperlanes as plain data: a lane is a pair of ids (two stars inside a
// neighbourhood, two clusters between them) with no direction, and a nation's
// lanes are a list of lane keys. Pure: state/hyperlaneStore.ts holds one list per
// nation and uses these.

// Sorting the pair before joining makes the key independent of which end was
// the origin of any particular jump.
export function laneKey(a: string, b: string): string {
  return [a, b].sort().join('::')
}

// Splits a lane key back into its two ids, for drawing a line between them.
export function laneEndpoints(key: string): [string, string] {
  const [a, b] = key.split('::')
  return [a, b]
}

export function hasLane(lanes: readonly string[], a: string, b: string): boolean {
  return lanes.includes(laneKey(a, b))
}

// The same list when the lane is already on it.
export function withLane(lanes: readonly string[], a: string, b: string): readonly string[] {
  const key = laneKey(a, b)
  return lanes.includes(key) ? lanes : [...lanes, key]
}

// Two nations' lanes as one set: `a`'s in their order, then whatever `b` adds.
// Nothing in the game calls this yet: lanes are never shared. It is the hook
// for a future treaty or espionage rule.
export function mergeLanes(a: readonly string[], b: readonly string[]): string[] {
  const out = [...new Set(a)]
  const seen = new Set(out)
  for (const key of b) {
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}
