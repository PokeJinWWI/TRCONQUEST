// Promotion and demotion between professions (pure): a pop's class is not fixed for ever. Each month a small share of a class moves up
// a rung when the rung above has unfilled jobs and the pop is schooled enough for them, and a share of a class that cannot find work
// moves down. People are conserved (they leave one pop and join another through popMerge.mergeInto); the investor and political classes
// are not part of the ladder. Run at the end of a world's tick (economyTick.tickWorld) on the labour report it just made.
import type { Pop } from './economyTypes'
import { mergeInto } from './popMerge'
import { CLASS_QUALIFICATION, type PopClass } from './recipes'

export const MOBILITY_LADDER: PopClass[] = ['subsistence', 'labor', 'technical', 'professional']
// The share of a class that changes profession in a month.
export const MOBILITY_RATE = 0.002
// A pop is ready for a rung when its literacy reaches this share of what the rung's jobs ask.
export const PROMOTION_LITERACY = 0.8
// Jobs may stand unfilled by this much before people are promoted into them.
export const UNFILLED_TOLERANCE = 1.02
// A class that has less than this share of its people in work sends some down.
export const DEMOTION_EMPLOYMENT = 0.85

export interface ClassLabour {
  workers: number
  qualified: number
  jobs: number
  employmentRate: number
}

export interface MobilityResult {
  pops: Pop[]
  // People that moved, millions, 'from>to'.
  moved: Record<string, number>
}

export function stepMobility(pops: readonly Pop[], labor: Partial<Record<PopClass, ClassLabour>>, worldId: string): MobilityResult {
  let next: Pop[] = pops.map((p) => ({ ...p }))
  const moved: Record<string, number> = {}
  const move = (from: PopClass, to: PopClass, ready: (p: Pop) => boolean) => {
    for (const p of next.filter((x) => x.class === from && x.populationSize > 0 && ready(x))) {
      const amount = p.populationSize * MOBILITY_RATE
      if (amount <= 0) continue
      const wealth = p.populationSize > 0 ? p.wealth * (amount / p.populationSize) : 0
      const idx = next.findIndex((x) => x.id === p.id)
      next[idx] = { ...next[idx], populationSize: next[idx].populationSize - amount, wealth: next[idx].wealth - wealth }
      next = mergeInto(next, { ...p, class: to }, amount, wealth, worldId)
      moved[`${from}>${to}`] = (moved[`${from}>${to}`] ?? 0) + amount
    }
  }
  for (let r = 0; r < MOBILITY_LADDER.length - 1; r++) {
    const lo = MOBILITY_LADDER[r]
    const up = MOBILITY_LADDER[r + 1]
    const L = labor[lo]
    const U = labor[up]
    if (!L || !U) continue
    // Up: the rung above has jobs nobody qualified is filling, and this class has people to spare who are schooled for it.
    const loSurplus = lo === 'subsistence' || L.employmentRate < 0.97
    if (U.jobs > U.qualified * UNFILLED_TOLERANCE && loSurplus) move(lo, up, (p) => p.educationLevel >= PROMOTION_LITERACY * CLASS_QUALIFICATION[up])
    // Down: the class has people who cannot find work in it.
    else if (U.workers > 0 && U.employmentRate < DEMOTION_EMPLOYMENT) move(up, lo, () => true)
  }
  // Pops emptied by a move stay (the next tick prunes nothing); a tiny remainder is not worth a row.
  next = next.filter((p) => p.populationSize > 1e-9)
  return { pops: next, moved }
}
