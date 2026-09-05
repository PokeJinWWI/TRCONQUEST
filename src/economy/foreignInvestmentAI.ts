// Foreign-investment AI — spreads cross-border capital so the foreign-investment
// system is alive without the player driving every stake. On a slow, staggered
// cadence, a non-player STATE with a healthy treasury takes a small equity stake
// in the most profitable FOREIGN private company whose host is open to foreign
// capital, and a cash-rich private COMPANY does likewise from its own cash. Their
// dividends then repatriate (handled by distributeDividends). Pure/headless.

import type { Corporation, Country, World } from './economyTypes'
import { convertBetween } from './fx'

const FI_REVIEW_PERIOD = 12 // yearly, staggered per investor
const STATE_TREASURY_BUFFER = 60000 // a state invests abroad only when this flush
const CORP_CASH_BUFFER = 40000 // a company invests abroad only when this flush
const STAKE_BLOCK = 80 // shares taken per investment

function phase(id: string, period: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % period
}

function floatOf(corp: Corporation): number {
  return corp.shares.find((s) => s.holder.kind === 'public')?.shares ?? 0
}

// The most attractive foreign private company to invest in from `homeCountryId`:
// profitable, floated, and in a host that is open to foreign capital.
function bestForeignTarget(homeCountryId: string, corporations: Corporation[], countries: Country[]): Corporation | null {
  let best: Corporation | null = null
  for (const t of corporations) {
    if (t.countryId === homeCountryId) continue // foreign only
    if (t.kind !== 'private') continue
    if (t.lastProfit <= 0) continue
    if (floatOf(t) <= 0) continue
    const host = countries.find((c) => c.id === t.countryId)
    if (!host || host.foreignInvestmentPolicy === 'closed') continue
    if (!best || t.lastProfit > best.lastProfit) best = t
  }
  return best
}

export function runForeignInvestmentAI(
  countries: Country[],
  corporations: Corporation[],
  _worlds: World[],
  tick: number,
  humanCountryIds: readonly string[],
  sharePrice: (corp: Corporation) => number,
): { countries: Country[]; corporations: Corporation[] } {
  const humans = new Set(humanCountryIds)
  const nextCountries = countries.map((c) => ({ ...c }))
  let nextCorps = corporations.map((c) => ({ ...c }))

  // Add a foreign stake `holder` → `target` for `shares`, from the float.
  const takeStake = (targetId: string, shares: number, tag: (c: Corporation) => Corporation['shares'][number]) => {
    nextCorps = nextCorps.map((c) => {
      if (c.id !== targetId) return c
      const held = c.shares
      const publicShares = held.find((s) => s.holder.kind === 'public')?.shares ?? 0
      const take = Math.min(shares, publicShares)
      if (take <= 0) return c
      const rebuilt = held.filter((s) => s.holder.kind !== 'public')
      const stake = tag(c)
      // Merge into an existing identical holder if present.
      const existing = rebuilt.find((s) => sameHolder(s.holder, stake.holder))
      if (existing) existing.shares += take
      else rebuilt.push({ holder: stake.holder, shares: take })
      if (publicShares - take > 0) rebuilt.push({ holder: { kind: 'public' }, shares: publicShares - take })
      return { ...c, shares: rebuilt }
    })
  }

  // A host under the 'approval' law that has NOT auto-approved, and is run by a
  // human, screens incoming foreign investment: the offer is queued for the
  // player rather than executed. (AI hosts, or open/auto-approve ones, just
  // let it through.)
  const needsApproval = (hostId: string) => {
    const host = nextCountries.find((c) => c.id === hostId)
    return !!host && humans.has(hostId) && host.foreignInvestmentPolicy === 'approval' && !host.foreignInvestmentAutoApprove
  }
  const queueOffer = (target: Corporation, investorKind: 'state' | 'corporation', investorId: string, investorName: string) => {
    const host = nextCountries.find((c) => c.id === target.countryId)
    if (!host) return
    offerCounter += 1
    const offer = { id: `fi-${tick}-${offerCounter}`, investorKind, investorId, investorName, targetCorpId: target.id, shares: STAKE_BLOCK }
    // Don't re-queue an identical pending offer.
    if (host.pendingForeignInvestment.some((o) => o.investorId === investorId && o.targetCorpId === target.id)) return
    host.pendingForeignInvestment = [...host.pendingForeignInvestment, offer].slice(-8)
  }

  // --- State foreign investment ---
  for (const country of nextCountries) {
    if (humans.has(country.id)) continue
    if (tick % FI_REVIEW_PERIOD !== phase(country.id, FI_REVIEW_PERIOD)) continue
    if (country.treasury < STATE_TREASURY_BUFFER) continue
    const target = bestForeignTarget(country.id, nextCorps, nextCountries)
    if (!target) continue
    // Cost is set in the host company's currency; convert to the investor's.
    const cost = convertBetween(STAKE_BLOCK * sharePrice(target), target.countryId, country.id, nextCountries)
    if (cost > country.treasury) continue
    if (needsApproval(target.countryId)) {
      queueOffer(target, 'state', country.id, country.id)
      continue
    }
    country.treasury -= cost
    takeStake(target.id, STAKE_BLOCK, () => ({ holder: { kind: 'state', countryId: country.id }, shares: 0 }))
  }

  // --- Company foreign investment (private firms deploy spare cash abroad) ---
  for (const corp of nextCorps) {
    if (corp.kind !== 'private') continue
    if (tick % FI_REVIEW_PERIOD !== phase(corp.id, FI_REVIEW_PERIOD)) continue
    if (corp.cash < CORP_CASH_BUFFER) continue
    const target = bestForeignTarget(corp.countryId, nextCorps, nextCountries)
    if (!target || target.id === corp.id) continue
    // Cost is set in the host company's currency; convert to the firm's own.
    const cost = convertBetween(STAKE_BLOCK * sharePrice(target), target.countryId, corp.countryId, nextCountries)
    if (cost > corp.cash) continue
    if (needsApproval(target.countryId)) {
      queueOffer(target, 'corporation', corp.id, corp.name)
      continue
    }
    corp.cash -= cost
    takeStake(target.id, STAKE_BLOCK, () => ({ holder: { kind: 'corporation', id: corp.id }, shares: 0 }))
  }

  return { countries: nextCountries, corporations: nextCorps }
}

let offerCounter = 0

function sameHolder(a: Corporation['shares'][number]['holder'], b: Corporation['shares'][number]['holder']): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'state' && b.kind === 'state') return a.countryId === b.countryId
  if ((a.kind === 'financial' || a.kind === 'corporation' || a.kind === 'character') && 'id' in b) return a.id === (b as { id: string }).id
  return true
}
