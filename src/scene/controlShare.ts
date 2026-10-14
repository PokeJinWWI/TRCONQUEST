// How much of a world each nation controls: a weighted blend of what it has there (people, established sites, ground forces, orbital
// force), each as its share of everything of that kind on the world. Pure. The Control tab shows the raw numbers beside the result,
// so the blend is never a mystery.
import { CONTROL_WEIGHTS } from '../data/territoryData'

export interface PresenceNumbers {
  id: string
  population: number
  sites: number
  ground: number
  orbit: number
}

// Fractions that add up to 1 across the nations given (all zero when none has anything).
export function controlShares(rows: readonly PresenceNumbers[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(rows.map((r) => [r.id, 0]))
  const kinds = Object.keys(CONTROL_WEIGHTS) as (keyof typeof CONTROL_WEIGHTS)[]
  const totals = Object.fromEntries(kinds.map((k) => [k, rows.reduce((n, r) => n + Math.max(0, r[k]), 0)])) as Record<keyof typeof CONTROL_WEIGHTS, number>
  const live = kinds.filter((k) => totals[k] > 0)
  const weight = live.reduce((n, k) => n + CONTROL_WEIGHTS[k], 0)
  if (weight <= 0) return out
  for (const r of rows) for (const k of live) out[r.id] += (CONTROL_WEIGHTS[k] / weight) * (Math.max(0, r[k]) / totals[k])
  return out
}
