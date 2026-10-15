// A few headline numbers about a nation's people, for the history charts (pure; sampled each month in both economies).
import type { Pop } from './economyTypes'
import { turmoilOf } from './popPolitics'
import { STRATUM_OF, workforceOf } from './popRules'

export interface PopStats {
  // Share of people who can read and write.
  literacy: number
  // Share of people who are radicals.
  turmoil: number
  // Share of people in the workforce.
  workforceShare: number
  // Share of all wealth held by the upper stratum.
  upperWealthShare: number
}

export function popStats(pops: readonly Pop[]): PopStats {
  const total = pops.reduce((n, p) => n + p.populationSize, 0)
  const wealth = pops.reduce((n, p) => n + p.wealth, 0)
  if (total <= 0) return { literacy: 0, turmoil: 0, workforceShare: 0, upperWealthShare: 0 }
  return {
    literacy: pops.reduce((n, p) => n + p.educationLevel * p.populationSize, 0) / total,
    turmoil: turmoilOf(pops),
    workforceShare: pops.reduce((n, p) => n + workforceOf(p), 0) / total,
    upperWealthShare: wealth > 0 ? pops.filter((p) => STRATUM_OF[p.class] === 'upper').reduce((n, p) => n + p.wealth, 0) / wealth : 0,
  }
}
