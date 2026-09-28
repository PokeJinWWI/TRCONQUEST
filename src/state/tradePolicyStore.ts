import { create } from 'zustand'
import { defaultTradePolicy, type TradePolicy } from '../data/tradePolicyData'
import { pairKey } from '../data/diplomacyData'
import { useSubjectStore, subjectionOf } from './subjectStore'
import { useInternationalOrgStore, shareOrgPillar } from './internationalOrgStore'
import { hasTradeAgreement } from './treatyStore'

// Live trade policy per nation, plus blanket embargoes between pairs of
// nations. Session-only, like every other store here. Not wired into any
// tick yet — see internationalTrade.ts / tradeMatching.ts for where this
// gets applied.

interface TradePolicyState {
  policies: Record<string, TradePolicy>
  embargoes: Record<string, boolean> // pairKey(a,b) -> true when either side has embargoed the other
  setTariff: (countryId: string, goodId: string, rate: number) => void
  setImportSubvention: (countryId: string, goodId: string, rate: number) => void
  setExportSubvention: (countryId: string, goodId: string, rate: number) => void
  declareEmbargo: (a: string, b: string) => void
  liftEmbargo: (a: string, b: string) => void
  reset: () => void
}

const DEFAULT_POLICY: TradePolicy = defaultTradePolicy()

export function tradePolicyOf(policies: Record<string, TradePolicy>, countryId: string): TradePolicy {
  return policies[countryId] ?? DEFAULT_POLICY
}

export const useTradePolicyStore = create<TradePolicyState>((set) => ({
  policies: {},
  embargoes: {},

  setTariff: (countryId, goodId, rate) =>
    set((s) => {
      const policy = tradePolicyOf(s.policies, countryId)
      return { policies: { ...s.policies, [countryId]: { ...policy, tariffs: { ...policy.tariffs, [goodId]: rate } } } }
    }),

  setImportSubvention: (countryId, goodId, rate) =>
    set((s) => {
      const policy = tradePolicyOf(s.policies, countryId)
      return { policies: { ...s.policies, [countryId]: { ...policy, importSubventions: { ...policy.importSubventions, [goodId]: rate } } } }
    }),

  setExportSubvention: (countryId, goodId, rate) =>
    set((s) => {
      const policy = tradePolicyOf(s.policies, countryId)
      return { policies: { ...s.policies, [countryId]: { ...policy, exportSubventions: { ...policy.exportSubventions, [goodId]: rate } } } }
    }),

  declareEmbargo: (a, b) => set((s) => ({ embargoes: { ...s.embargoes, [pairKey(a, b)]: true } })),
  liftEmbargo: (a, b) => set((s) => ({ embargoes: { ...s.embargoes, [pairKey(a, b)]: false } })),

  reset: () => set({ policies: {}, embargoes: {} }),
}))

export function isEmbargoed(embargoes: Record<string, boolean>, a: string, b: string): boolean {
  return embargoes[pairKey(a, b)] === true
}

// Whether `a` and `b` trade with each other tariff-free: they share an
// organization with the economic-market pillar, have a bilateral trade
// agreement, or one is a subject of the other without a separate market of
// its own.
export function inSharedMarket(a: string, b: string): boolean {
  if (shareOrgPillar(useInternationalOrgStore.getState().orgs, a, b, 'economic-market')) return true
  if (hasTradeAgreement(a, b)) return true
  const subjections = useSubjectStore.getState().subjections
  const asSubject = subjectionOf(subjections, a)
  if (asSubject?.suzerainId === b && !asSubject.separateMarket) return true
  const bsSubject = subjectionOf(subjections, b)
  if (bsSubject?.suzerainId === a && !bsSubject.separateMarket) return true
  return false
}
