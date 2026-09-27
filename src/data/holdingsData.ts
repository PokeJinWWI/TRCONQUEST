// Foreign buildings (both economy modes): embassies and branch offices one
// nation opens on another's world. They sit in the host world's Urban district
// (taking a slot) and show in its Districts & Buildings grid. Rules:
// scene/holdings.ts; state: state/holdingsStore.ts. Money is scaled to GDP so
// it means the same in either economy mode.
export type HoldingKind = 'embassy' | 'branchOffice'
export const HOLDING_KINDS: HoldingKind[] = ['embassy', 'branchOffice']

export interface HoldingDef {
  name: string
  description: string
  setupGdpShare: number // setup cost, as a share of the OWNER's annual GDP
  where: 'capital' | 'any' // embassies only at the host nation's capital
}

export const HOLDING_DEFS: Record<HoldingKind, HoldingDef> = {
  embassy: {
    name: 'Embassy',
    description: 'A diplomatic mission at another nation’s capital. Their opinion of you rises every month it stays open. Closed if you go to war.',
    setupGdpShare: 0.0005,
    where: 'capital',
  },
  branchOffice: {
    name: 'Branch Office',
    description: 'Your companies set up shop on another nation’s world: it pays you a share of that world’s output every month, and pays the host a tax. Seized if you go to war.',
    setupGdpShare: 0.003,
    where: 'any',
  },
}

export const BRANCH_PROFIT_SHARE = 0.004 // owner's yearly income, as a share of the host world's annual GDP
export const BRANCH_TAX_SHARE = 0.0015 // host's yearly tax, as a share of the host world's annual GDP
export const EMBASSY_OPINION_PER_MONTH = 1 // host's opinion of the owner…
export const EMBASSY_OPINION_CAP = 40 // …until it reaches this
export const AI_HOLDING_INTERVAL_MONTHS = 6 // an AI nation opens at most one holding this often
