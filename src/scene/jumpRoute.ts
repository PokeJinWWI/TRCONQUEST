// A route of hyperdrive jumps that loses the fewest ships. Pure: it knows only
// ids and the loss chance of a jump between two of them, so the same function
// plans between the stars of one neighbourhood and between clusters (two
// different graphs, never mixed: the caller gives one or the other).
//  - The total loss of a route is 1 - the product of each jump's survival, so
//    two safer jumps beat one dangerous one.
//  - A route made only of safe jumps (each at or under `safeLoss`) always wins
//    over one with an unsafe jump in it, whatever the totals.
//  - A jump over `maxLoss` is never taken. `maxLoss` at or under `safeLoss`
//    means "safe jumps only".

export interface JumpRouteInput {
  from: string
  to: string
  // Every id a route may stop at (from and to included or not, either way).
  nodes: readonly string[]
  // The chance a ship is lost jumping from a to b (0..1), or null for "no such jump".
  lossOf: (a: string, b: string) => number | null
  maxJumps: number
  safeLoss: number
  maxLoss: number
}

export type JumpRoute =
  | {
      ok: true
      // The stops in order, the destination last (so one entry = a direct jump).
      hops: string[]
      totalLoss: number
      // Whether any jump of it is over `safeLoss`.
      unsafe: boolean
    }
  | {
      ok: false
      // The direct jump's loss (null if there is none), to say why in plain words.
      directLoss: number | null
      // The per-jump limit the route had to keep to.
      limit: number
    }

const EPS = 1e-12

interface Reached {
  cost: number
  path: string[]
}

// The cheapest path of at most `maxJumps` jumps using only jumps up to `limit`.
// Cost is -ln(survival), which adds up along a route. Ties: fewer jumps, then ids.
function cheapest(input: JumpRouteInput, ids: readonly string[], loss: (a: string, b: string) => number | null, limit: number): Reached | null {
  let frontier = new Map<string, Reached>([[input.from, { cost: 0, path: [] }]])
  let best: Reached | null = null
  for (let jump = 1; jump <= input.maxJumps && frontier.size > 0; jump++) {
    const next = new Map<string, Reached>()
    for (const a of ids) {
      const at = frontier.get(a)
      if (!at) continue
      for (const b of ids) {
        if (b === a || b === input.from) continue
        const p = loss(a, b)
        if (p === null || p > limit) continue
        const cost = at.cost + (p >= 1 ? Infinity : -Math.log(1 - p))
        if (!Number.isFinite(cost)) continue
        const cur = next.get(b)
        if (!cur || cost < cur.cost - EPS) next.set(b, { cost, path: [...at.path, b] })
      }
    }
    const arrived = next.get(input.to)
    if (arrived && (!best || arrived.cost < best.cost - EPS)) best = arrived
    next.delete(input.to)
    frontier = next
  }
  return best
}

export function planJumpRoute(input: JumpRouteInput): JumpRoute {
  const ids = [...new Set([input.from, input.to, ...input.nodes])].sort()
  const cache = new Map<string, number | null>()
  const loss = (a: string, b: string): number | null => {
    const key = `${a}>${b}`
    if (!cache.has(key)) cache.set(key, input.lossOf(a, b))
    return cache.get(key) ?? null
  }
  const limit = Math.max(input.safeLoss, input.maxLoss)
  const found = cheapest(input, ids, loss, input.safeLoss) ?? (limit > input.safeLoss ? cheapest(input, ids, loss, limit) : null)
  if (!found) return { ok: false, directLoss: loss(input.from, input.to), limit }
  let previous = input.from
  let unsafe = false
  for (const hop of found.path) {
    if ((loss(previous, hop) ?? 0) > input.safeLoss) unsafe = true
    previous = hop
  }
  return { ok: true, hops: found.path, totalLoss: 1 - Math.exp(-found.cost), unsafe }
}
