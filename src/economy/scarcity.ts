// Whether a good is scarce enough to build more of it — the one test the
// country and company AIs use before adding capacity (pure).
//
// Priced at or above its base on one of the worlds, AND its producers there
// hold little unsold stock (under UNSOLD_MONTHS of their output). Price alone
// lags: prices move a few percent a month, so a good stayed "dear" for months
// after it was already in glut and the AIs kept building into it (Lalande's
// consumer goods at 5× what sold, Mars's clinics, meat and mines).

import { GOODS, type GoodId } from './goods'
import { getMethod, RECIPES } from './recipes'
import type { World } from './economyTypes'

const UNSOLD_MONTHS = 0.5

export function goodIsScarce(good: GoodId, worlds: World[]): boolean {
  if (!worlds.some((w) => (w.market.prices[good] ?? 0) >= GOODS[good].basePrice)) return false
  let unsold = 0
  let monthly = 0
  for (const w of worlds) {
    for (const b of w.buildings) {
      const out = getMethod(b.recipeId, b.methodId)?.outputs.find((o) => o.good === good)
      if (!out) continue
      unsold += b.inventory[good] ?? 0
      monthly += out.amount * b.level * b.throughput
    }
  }
  return unsold <= UNSOLD_MONTHS * monthly
}

// Whether every input a recipe's (first) method needs is made on one of these
// worlds — else a new plant just stands idle. (Venus's AI built three levels
// of car plants, because cars were its dearest good, with no engines or
// electronics made anywhere in the nation: they ran at 4%.)
export function inputsAvailable(recipeId: string, worlds: World[]): boolean {
  const method = RECIPES[recipeId]?.methods[0]
  if (!method) return false
  return method.inputs.every((i) => worlds.some((w) => w.buildings.some((b) => getMethod(b.recipeId, b.methodId)?.outputs.some((o) => o.good === i.good))))
}

// The good a recipe is built for (its first output), if it makes one.
export function recipeGood(recipeId: string): GoodId | undefined {
  return RECIPES[recipeId]?.methods[0]?.outputs[0]?.good
}
