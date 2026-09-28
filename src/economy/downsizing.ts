// How an owner cuts back a chronic loss-maker (pure) — the one rule for the
// company AI (corporationAI) and the state (countryAI).
//
// Only a building that MAKES something can be cut: a headquarters or an office
// always "loses money" (it has no sales) and closing it did nothing but harm.
// Spaceports and seaports are never cut (they're a world's key nodes and its
// freight). Above level 1 it loses a level; at level 1 it isn't closed but
// mothballed a little further (Building.idle, reopened when its good turns
// scarce) — closing a world's last plant for a good broke every chain after
// it for good (Mars's only sulfur mine, Luna's whole food chain).

import { RECIPES } from './recipes'
import type { Building } from './economyTypes'

const NEVER_CUT = new Set(['spaceport', 'seaport'])
const MOTHBALL_STEP = 0.3
export const MAX_IDLE = 0.7

export function mayDownsize(b: Building): boolean {
  if (NEVER_CUT.has(b.recipeId)) return false
  const outputs = RECIPES[b.recipeId]?.methods[0]?.outputs ?? []
  if (outputs.length === 0) return false
  return b.level > 1 || (b.idle ?? 0) < MAX_IDLE
}

export function downsized(b: Building): Building {
  if (b.level > 1) return { ...b, level: b.level - 1, unprofitableStreak: 0 }
  const idle = Math.min(MAX_IDLE, (b.idle ?? 0) + MOTHBALL_STEP)
  return { ...b, idle, throughput: Math.min(b.throughput, 1 - idle), unprofitableStreak: 0 }
}
