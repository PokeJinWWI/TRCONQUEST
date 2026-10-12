// The midgame metric (pure): who has met whom, which met pairs have a standing
// tie, and the share of nations that count toward "midgame". Used by measure.ts.
//
// Rules (user, 2026-10-10):
//  - A KNOWS B once a ship of A has been in a system where B has a ship, a Starbase
//    or a world. A pair has MET when each knows the other. Nations sharing a home
//    cluster at the start (the five human nations) start met.
//  - ACTIVE DIPLOMACY: a met pair with any standing tie (war, treaty in force,
//    shared organization, subject relation, embargo).
//  - A nation COUNTS when it has met at least one nation from outside its own
//    cluster AND has active diplomacy with at least one met nation.

export const pairOf = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

// One day's presence in one system: whose ships are there, and who else is there
// at all (ships, Starbases, worlds).
export interface SystemPresence {
  shipOwners: Iterable<string>
  present: Iterable<string>
}

// Adds what today's presence teaches to `knows` ("a>b" = a knows b). Returns it.
export function learnFromPresence(knows: Set<string>, systems: Iterable<SystemPresence>): Set<string> {
  for (const sys of systems) {
    const present = [...new Set(sys.present)]
    for (const a of new Set(sys.shipOwners)) {
      for (const b of present) if (a !== b) knows.add(`${a}>${b}`)
    }
  }
  return knows
}

export function startingKnowledge(nations: string[], clusterOf: (id: string) => string, homeCluster: string): Set<string> {
  const knows = new Set<string>()
  const home = nations.filter((n) => clusterOf(n) === homeCluster)
  for (const a of home) for (const b of home) if (a !== b) knows.add(`${a}>${b}`)
  return knows
}

export function metPairs(nations: string[], knows: Set<string>): Set<string> {
  const met = new Set<string>()
  for (let i = 0; i < nations.length; i++) {
    for (let j = i + 1; j < nations.length; j++) {
      const a = nations[i]
      const b = nations[j]
      if (knows.has(`${a}>${b}`) && knows.has(`${b}>${a}`)) met.add(pairOf(a, b))
    }
  }
  return met
}

export interface MidgameCount {
  nations: number
  // Pairs where each knows the other, and pairs where only one side does.
  metPairs: number
  oneSidedPairs: number
  // Met pairs with a standing tie.
  activePairs: number
  // Nations that have met someone from another cluster.
  withOutsideContact: number
  // Nations with active diplomacy with a met nation.
  withActiveTie: number
  // Nations with both: the midgame count, and its share of all nations.
  counted: number
  share: number
}

export function midgameCount(nations: string[], clusterOf: (id: string) => string, knows: Set<string>, tiedPairs: Set<string>): MidgameCount {
  const met = metPairs(nations, knows)
  let oneSided = 0
  for (let i = 0; i < nations.length; i++) {
    for (let j = i + 1; j < nations.length; j++) {
      const ab = knows.has(`${nations[i]}>${nations[j]}`)
      const ba = knows.has(`${nations[j]}>${nations[i]}`)
      if (ab !== ba) oneSided++
    }
  }
  const active = [...met].filter((p) => tiedPairs.has(p))
  const outside = new Set<string>()
  const tied = new Set<string>()
  for (const p of met) {
    const [a, b] = p.split('|')
    if (clusterOf(a) !== clusterOf(b)) {
      outside.add(a)
      outside.add(b)
    }
  }
  for (const p of active) for (const id of p.split('|')) tied.add(id)
  const counted = nations.filter((n) => outside.has(n) && tied.has(n)).length
  return {
    nations: nations.length,
    metPairs: met.size,
    oneSidedPairs: oneSided,
    activePairs: active.length,
    withOutsideContact: outside.size,
    withActiveTie: tied.size,
    counted,
    share: nations.length > 0 ? counted / nations.length : 0,
  }
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
