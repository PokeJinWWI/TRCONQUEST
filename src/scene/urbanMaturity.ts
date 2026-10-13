// How full a settlement is: the display layer of internal migration (people moving between the settlements of one world). A settlement a
// game opened with is full; one founded in play fills over SETTLEMENT_FILL_DAYS as people drift toward it, so the new town grows into
// its share instead of appearing with a city's worth of people. No state of its own: it follows from when the site was established.
import { SETTLEMENT_FILL_DAYS } from '../economy/migrationRules'
import type { EstablishedSite } from '../state/locationStore'

export const MIN_MATURITY = 0.05

export function maturityOf(site: EstablishedSite | undefined, simDays: number): number {
  if (!site || site.connected) return 1
  const age = Math.max(0, simDays - site.since)
  return Math.max(MIN_MATURITY, Math.min(1, age / SETTLEMENT_FILL_DAYS))
}
