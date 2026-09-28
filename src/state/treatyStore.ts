import { create } from 'zustand'
import { pairKey } from '../data/diplomacyData'
import { isBinding, type ArticleKind, type Treaty, type TreatyArticle, type TreatyDurationYears } from '../data/treatyData'

// Live treaties — session-only, like every other store here. Two nations can
// hold any number of separate treaties at once; each bundles whatever
// articles it was signed with. No proposal flow lives in the store itself
// (see scene/treaties.ts for the acceptance rule); this just holds whatever
// was signed and lets it be cancelled, in whole or article by article.

interface TreatyState {
  treaties: Treaty[]
  sign: (a: string, b: string, name: string, articles: TreatyArticle[], durationYears: TreatyDurationYears, signedSimDays: number) => string
  // Drops the whole treaty (every article in it).
  cancel: (treatyId: string) => void
  // Drops just one article; the treaty itself is dropped once it's empty.
  removeArticle: (treatyId: string, index: number) => void
  reset: () => void
}

let treatyCounter = 0

export const useTreatyStore = create<TreatyState>((set) => ({
  treaties: [],

  sign: (a, b, name, articles, durationYears, signedSimDays) => {
    treatyCounter += 1
    const id = `treaty-${treatyCounter}-${Math.round(signedSimDays)}`
    set((s) => ({ treaties: [...s.treaties, { id, name, a, b, articles, signedSimDays, durationYears }] }))
    return id
  },

  cancel: (treatyId) => set((s) => ({ treaties: s.treaties.filter((t) => t.id !== treatyId) })),

  removeArticle: (treatyId, index) =>
    set((s) => ({
      treaties: s.treaties
        .map((t) => (t.id === treatyId ? { ...t, articles: t.articles.filter((_, i) => i !== index) } : t))
        .filter((t) => t.articles.length > 0),
    })),

  reset: () => set({ treaties: [] }),
}))

export function treatiesBetween(treaties: Treaty[], a: string, b: string): Treaty[] {
  const key = pairKey(a, b)
  return treaties.filter((t) => pairKey(t.a, t.b) === key)
}

export function treatiesOf(treaties: Treaty[], countryId: string): Treaty[] {
  return treaties.filter((t) => t.a === countryId || t.b === countryId)
}

// Whether this treaty can still be cancelled for free right now (its binding
// period has run out) — see data/treatyData.isBinding.
export function isStillBinding(t: Treaty, simDays: number): boolean {
  return isBinding(t, simDays)
}

// Every article of `kind` currently in effect between `a` and `b`, whichever
// treaty (there may be several) carries it.
export function articlesBetween(treaties: Treaty[], a: string, b: string, kind?: ArticleKind): TreatyArticle[] {
  return treatiesBetween(treaties, a, b)
    .flatMap((t) => t.articles)
    .filter((art) => !kind || art.kind === kind)
}

export function hasArticle(treaties: Treaty[], a: string, b: string, kind: ArticleKind): boolean {
  return articlesBetween(treaties, a, b, kind).length > 0
}

// Whether `a` and `b` are bound by a non-aggression pact (blocks war — see
// scene/peace.ts's declareWarOn).
export function isNonAggression(a: string, b: string): boolean {
  return hasArticle(useTreatyStore.getState().treaties, a, b, 'non-aggression-pact')
}

// Whether `guarantorId` guarantees `guaranteedId`'s independence — a
// guarantor can't itself declare war on who it guarantees.
export function isGuarantorOf(guarantorId: string, guaranteedId: string): boolean {
  return useTreatyStore
    .getState()
    .treaties.some((t) => t.articles.some((art) => art.kind === 'guarantee-independence' && art.guarantorId === guarantorId && art.guaranteedId === guaranteedId))
}

export function isAllyOf(a: string, b: string): boolean {
  return hasArticle(useTreatyStore.getState().treaties, a, b, 'alliance') || hasArticle(useTreatyStore.getState().treaties, a, b, 'defensive-pact')
}

export function hasTradeAgreement(a: string, b: string): boolean {
  return hasArticle(useTreatyStore.getState().treaties, a, b, 'trade-agreement')
}

// The foreign nation currently operating bodyName's spaceport under a treaty
// port, if any — see state/nationEconomy.spaceportSitesOf, which shows this
// nation as the operator instead of the body's own owner.
export function treatyPortOperatorOf(bodyName: string): string | undefined {
  for (const t of useTreatyStore.getState().treaties) {
    const art = t.articles.find((a) => a.kind === 'treaty-port' && a.bodyName === bodyName)
    if (art && art.kind === 'treaty-port') return art.targetId
  }
  return undefined
}

// Whether targetId has investment rights in sourceId despite sourceId's own
// national foreign-investment policy — see scene/treaties's investment-rights
// article and wherever foreignInvestmentPolicy is checked.
export function hasInvestmentRights(sourceId: string, targetId: string): boolean {
  return useTreatyStore.getState().treaties.some((t) => t.articles.some((a) => a.kind === 'investment-rights' && a.sourceId === sourceId && a.targetId === targetId))
}

// Whether targetId's fleets have military access through sourceId's
// territory. Tracked and displayed; not yet consumed by any hostility or
// movement check.
export function hasMilitaryAccess(sourceId: string, targetId: string): boolean {
  return useTreatyStore.getState().treaties.some((t) => t.articles.some((a) => a.kind === 'military-access' && a.sourceId === sourceId && a.targetId === targetId))
}
