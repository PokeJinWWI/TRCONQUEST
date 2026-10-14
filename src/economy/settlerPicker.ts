// Who leaves when a Colony Ship is loaded: real pops taken from a chosen world, drawn across the professions with the
// emphasis on the working and poorer classes (the investors and the political class mostly stay home). Pure; the store
// applies the result (economyStore.takeSettlers, Simple mode's adjustPopulation takes a plain number).
import { POP_CLASSES, type PopClass } from './recipes'

// How willing each class is to go, per head. Investors and politicians are rarely among the first settlers.
export const SETTLER_CLASS_WEIGHT: Record<PopClass, number> = {
  subsistence: 1,
  labor: 1.2,
  technical: 1,
  professional: 0.8,
  investor: 0.05,
  political: 0.05,
}

export interface SettlerPop {
  id: string
  class: PopClass
  populationSize: number
}

export type SettlerMix = Partial<Record<PopClass, number>>

// Millions taken from each pop (by id), never more than it holds and never leaving the world under `floor` in all.
// `rng` jitters each class's pull so no two ships carry the same mix. The result sums to the amount taken.
export function pickSettlers(pops: readonly SettlerPop[], millions: number, floor: number, rng: () => number): { byPop: Record<string, number>; taken: number } {
  const total = pops.reduce((n, p) => n + p.populationSize, 0)
  const want = Math.max(0, Math.min(millions, total - floor))
  const byPop: Record<string, number> = {}
  if (want <= 0) return { byPop, taken: 0 }
  // A pop's pull = its size x its class's weight x a random 0.5-1.5 per class, so the draw is spread over the professions.
  const jitter: Record<string, number> = {}
  for (const c of POP_CLASSES) jitter[c] = 0.5 + rng()
  const pull = (p: SettlerPop) => p.populationSize * SETTLER_CLASS_WEIGHT[p.class] * jitter[p.class]
  let left = want
  // Proportional rounds: a pop that would give more than it has gives all of it and the rest is shared again.
  for (let round = 0; round < 8 && left > 1e-9; round++) {
    const open = pops.filter((p) => p.populationSize - (byPop[p.id] ?? 0) > 1e-12)
    const sum = open.reduce((n, p) => n + pull(p) * (1 - (byPop[p.id] ?? 0) / p.populationSize), 0)
    if (sum <= 0) break
    let given = 0
    for (const p of open) {
      const room = p.populationSize - (byPop[p.id] ?? 0)
      const share = Math.min(room, (left * pull(p) * (room / p.populationSize)) / sum)
      byPop[p.id] = (byPop[p.id] ?? 0) + share
      given += share
    }
    left -= given
  }
  return { byPop, taken: want - Math.max(0, left) }
}

// The class mix of a draw, in millions per class.
export function mixOf(pops: readonly SettlerPop[], byPop: Record<string, number>): SettlerMix {
  const mix: SettlerMix = {}
  for (const p of pops) {
    const n = byPop[p.id] ?? 0
    if (n > 0) mix[p.class] = (mix[p.class] ?? 0) + n
  }
  return mix
}
