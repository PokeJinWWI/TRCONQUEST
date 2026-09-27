// Foreign buildings — the pure rules (both economy modes). A holding belongs to
// its OWNER and stands in the host world's Urban district. Tuning:
// data/holdingsData.ts; store I/O: state/holdingsStore.ts.
import {
  AI_HOLDING_INTERVAL_MONTHS,
  BRANCH_PROFIT_SHARE,
  BRANCH_TAX_SHARE,
  EMBASSY_OPINION_CAP,
  EMBASSY_OPINION_PER_MONTH,
  HOLDING_DEFS,
  type HoldingKind,
} from '../data/holdingsData'
import type { AtWarFn } from '../state/diplomacyStore'
import type { OwnerMap } from './territory'

export interface Holding {
  id: string
  kind: HoldingKind
  ownerId: string
  bodyName: string // the host world
  openedSimDays: number
}

// What the rules need to know about the world around them.
export interface HoldingContext {
  owners: OwnerMap
  capitalOf: (countryId: string) => string | undefined
  atWar: AtWarFn
  freeUrbanSlots: (bodyName: string) => number
  treasuryOf: (countryId: string) => number
  gdpYearOf: (countryId: string) => number // the nation's annual GDP
  worldGdpYearOf: (bodyName: string) => number // one world's annual GDP
  opinionOf: (from: string, to: string) => number // `from`'s opinion of `to`
}

export type HoldingCheck = { ok: true; cost: number } | { ok: false; reason: string }

export function setupCost(kind: HoldingKind, ownerId: string, ctx: HoldingContext): number {
  return HOLDING_DEFS[kind].setupGdpShare * ctx.gdpYearOf(ownerId)
}

export function canOpen(kind: HoldingKind, ownerId: string, bodyName: string, holdings: Holding[], ctx: HoldingContext): HoldingCheck {
  const host = ctx.owners[bodyName]
  if (!host) return { ok: false, reason: 'Nobody owns this world' }
  if (host === ownerId) return { ok: false, reason: 'That is your own world' }
  if (ctx.atWar(ownerId, host)) return { ok: false, reason: 'You are at war with them' }
  if (HOLDING_DEFS[kind].where === 'capital' && ctx.capitalOf(host) !== bodyName) return { ok: false, reason: 'Embassies go on the capital' }
  if (kind === 'embassy' && holdings.some((h) => h.kind === 'embassy' && h.ownerId === ownerId && ctx.owners[h.bodyName] === host)) return { ok: false, reason: 'You already have an embassy with them' }
  if (kind === 'branchOffice' && holdings.some((h) => h.kind === 'branchOffice' && h.ownerId === ownerId && h.bodyName === bodyName)) return { ok: false, reason: 'You already have a branch office here' }
  if (ctx.freeUrbanSlots(bodyName) <= 0) return { ok: false, reason: 'No free slot in their Urban district' }
  const cost = setupCost(kind, ownerId, ctx)
  if (ctx.treasuryOf(ownerId) < cost) return { ok: false, reason: 'Not enough money in the treasury' }
  return { ok: true, cost }
}

// One month of holdings: branch-office profit (owner) and tax (host), and the
// host's warming opinion of nations with an embassy there.
export function monthlyFlows(holdings: Holding[], ctx: HoldingContext): { treasury: Record<string, number>; opinion: { from: string; to: string; delta: number }[] } {
  const treasury: Record<string, number> = {}
  const opinion: { from: string; to: string; delta: number }[] = []
  for (const h of holdings) {
    const host = ctx.owners[h.bodyName]
    if (!host) continue
    if (h.kind === 'branchOffice') {
      const gdp = ctx.worldGdpYearOf(h.bodyName) / 12
      treasury[h.ownerId] = (treasury[h.ownerId] ?? 0) + gdp * BRANCH_PROFIT_SHARE
      treasury[host] = (treasury[host] ?? 0) + gdp * BRANCH_TAX_SHARE
    } else {
      const current = ctx.opinionOf(host, h.ownerId)
      if (current < EMBASSY_OPINION_CAP) opinion.push({ from: host, to: h.ownerId, delta: Math.min(EMBASSY_OPINION_PER_MONTH, EMBASSY_OPINION_CAP - current) })
    }
  }
  return { treasury, opinion }
}

// Holdings whose owner is now at war with the host (or whose world changed
// hands to the owner itself) — seized/closed.
export function seized(holdings: Holding[], owners: OwnerMap, atWar: AtWarFn): Holding[] {
  return holdings.filter((h) => {
    const host = owners[h.bodyName]
    return !host || host === h.ownerId || atWar(h.ownerId, host)
  })
}

// What an AI nation would open next, if anything: an embassy with each nation
// it's at peace with, then a branch office on the richest foreign world at
// peace. At most one per AI_HOLDING_INTERVAL_MONTHS (the caller spaces calls).
export function aiNextHolding(countryId: string, nations: string[], holdings: Holding[], ctx: HoldingContext): { kind: HoldingKind; bodyName: string } | null {
  for (const other of nations) {
    if (other === countryId) continue
    const capital = ctx.capitalOf(other)
    if (capital && canOpen('embassy', countryId, capital, holdings, ctx).ok) return { kind: 'embassy', bodyName: capital }
  }
  const worlds = Object.keys(ctx.owners)
    .filter((b) => ctx.owners[b] !== countryId)
    .sort((a, b) => ctx.worldGdpYearOf(b) - ctx.worldGdpYearOf(a) || a.localeCompare(b))
  for (const b of worlds) {
    if (ctx.worldGdpYearOf(b) <= 0) break
    if (canOpen('branchOffice', countryId, b, holdings, ctx).ok) return { kind: 'branchOffice', bodyName: b }
  }
  return null
}

export { AI_HOLDING_INTERVAL_MONTHS }
