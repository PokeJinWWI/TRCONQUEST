// Trade policy: tariffs and subventions, per nation, per good. Good ids are
// whatever the active economy mode uses (Complex mode's good ids or Simple
// mode's) — this layer doesn't care which. See state/tradePolicyStore.ts for
// the live state and inSharedMarket (orgs/subjects bypass tariffs).

export interface TradePolicy {
  // Ad-valorem import tax, 0..1, applied to the landed cost of a good bought
  // from a foreign seller not in a shared market with this nation.
  tariffs: Record<string, number>
  // Subsidy rate, 0..1 of unit cost, paid by the IMPORTING nation's treasury
  // to encourage bringing in a good it's short of.
  importSubventions: Record<string, number>
  // Subsidy rate, 0..1 of unit price, paid by the EXPORTING nation's treasury
  // to make its goods more competitive abroad.
  exportSubventions: Record<string, number>
}

export function defaultTradePolicy(): TradePolicy {
  return { tariffs: {}, importSubventions: {}, exportSubventions: {} }
}

export const TARIFF_MAX = 1
export const SUBVENTION_MAX = 1
