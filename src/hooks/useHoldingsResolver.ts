import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useHoldingsStore } from '../state/holdingsStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { usePlayerStore, isSandbox } from '../state/playerStore'
import { adjustTreasury, holdingContext } from '../state/nationEconomy'
import { AI_HOLDING_INTERVAL_MONTHS, aiNextHolding, monthlyFlows, seized } from '../scene/holdings'
import { HOLDING_DEFS } from '../data/holdingsData'
import { COUNTRIES } from '../data/countryData'
import { ownerDisplay } from '../data/countryRoster'

// Foreign buildings, monthly (scene/holdings.ts): branch offices pay their
// owners and hosts, embassies warm the host's opinion, holdings between nations
// at war are seized, and AI nations open new ones every so often.
const DAYS_PER_MONTH = 30

export function resolveHoldings(fromSimDays: number, toSimDays: number): void {
  const months = Math.floor(toSimDays / DAYS_PER_MONTH) - Math.floor(fromSimDays / DAYS_PER_MONTH)
  if (months <= 0 || isSandbox()) return
  const store = useHoldingsStore.getState()
  const diplomacy = useDiplomacyStore.getState()
  const ctx = holdingContext()

  // War seizes them.
  const lost = seized(store.holdings, ctx.owners, ctx.atWar)
  if (lost.length > 0) {
    store.setHoldings(store.holdings.filter((h) => !lost.includes(h)))
    for (const h of lost) {
      const host = ctx.owners[h.bodyName]
      diplomacy.pushEvent('holding', [h.ownerId, ...(host ? [host] : [])], `${ownerDisplay(h.ownerId).name}'s ${HOLDING_DEFS[h.kind].name} on ${h.bodyName} was ${h.kind === 'branchOffice' ? 'seized' : 'closed'}`, toSimDays)
    }
  }

  const flows = monthlyFlows(useHoldingsStore.getState().holdings, ctx)
  for (const [id, amount] of Object.entries(flows.treasury)) adjustTreasury(id, amount * months)
  for (const o of flows.opinion) diplomacy.adjustOpinion(o.from, o.to, o.delta * months)

  // AI nations open one at a time, every few months (staggered by nation).
  const player = usePlayerStore.getState().selectedCountryId
  const month = Math.floor(toSimDays / DAYS_PER_MONTH)
  COUNTRIES.forEach((c, i) => {
    if (c.id === player || (month + i) % AI_HOLDING_INTERVAL_MONTHS !== 0) return
    const next = aiNextHolding(c.id, COUNTRIES.map((x) => x.id), useHoldingsStore.getState().holdings, holdingContext())
    if (next) useHoldingsStore.getState().open(c.id, next.bodyName, next.kind, toSimDays)
  })
}

export function useHoldingsResolver() {
  useEffect(() => {
    let last = useGameTimeStore.getState().simDays
    return useGameTimeStore.subscribe((state) => {
      if (state.simDays < last) {
        last = state.simDays
        return
      }
      if (Math.floor(state.simDays / DAYS_PER_MONTH) === Math.floor(last / DAYS_PER_MONTH)) return
      resolveHoldings(last, state.simDays)
      last = state.simDays
    })
  }, [])
}
