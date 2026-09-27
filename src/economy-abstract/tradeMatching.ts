// Simple mode's trade between nations: standing trade orders fill from real
// partners, not a market that conjures goods (pure; state/abstractEconomyStore
// runs it once per advance, before the nations tick).
//
//   An import order draws on the nations at peace with the importer, pro rata
//   to what each can spare: its own export order for the good (as far as its
//   stock covers), or — if it isn't importing the good itself — its stock
//   beyond RESERVE_MONTHS of its own use.
//   An export order sells only as far as someone is importing the good.
//
// The result is each nation's FILLED orders for the tick (+ bought, − sold),
// which its tick prices and pays through the currencies as before
// (abstractEconomy: GOOD_VALUE through the exchange rate). A nation sold from
// without an export order is paid the same way.

import { SIMPLE_GOODS, type SimpleGood } from '../data/simplisticEconomyData'
import type { Stockpile, TradeOrders } from './abstractEconomy'

export const RESERVE_MONTHS = 6 // stock a nation keeps back before selling spare goods abroad

export interface TradeNation {
  id: string
  orders: TradeOrders
  stock: Stockpile
  monthlyUse: Partial<Record<SimpleGood, number>> // used by industry + consumed by people, last month
  // Produced less used and consumed, last month: an exporter only offers what
  // its stock will still cover once this month's net use comes out of it.
  monthlyNet?: Partial<Record<SimpleGood, number>>
  cash: number // what its treasury can spend on imports
  unitCost: (good: SimpleGood) => number // what one unit costs it to import (its tick's price)
}

export function matchTrade(nations: TradeNation[], atWar: (a: string, b: string) => boolean): Record<string, TradeOrders> {
  const filled: Record<string, TradeOrders> = Object.fromEntries(nations.map((n) => [n.id, {}]))
  const cash = new Map(nations.map((n) => [n.id, Math.max(0, n.cash)]))
  for (const g of SIMPLE_GOODS) {
    // What each nation can spare of this good.
    const spare = new Map<string, number>()
    for (const n of nations) {
      const q = n.orders[g] ?? 0
      const stock = Math.max(0, n.stock[g] ?? 0)
      if (q < 0) spare.set(n.id, Math.min(-q, Math.max(0, stock + Math.min(0, n.monthlyNet?.[g] ?? 0))))
      else if (q === 0) spare.set(n.id, Math.max(0, stock - RESERVE_MONTHS * (n.monthlyUse[g] ?? Infinity)))
    }
    for (const buyer of nations) {
      const want = buyer.orders[g] ?? 0
      if (want <= 0) continue
      const sellers = nations.filter((s) => s.id !== buyer.id && (spare.get(s.id) ?? 0) > 1e-9 && !atWar(buyer.id, s.id))
      const offered = sellers.reduce((n, s) => n + spare.get(s.id)!, 0)
      if (offered <= 1e-9) continue
      // As far as its treasury pays for (goods in the order its tick buys them).
      const unit = buyer.unitCost(g)
      const take = Math.min(want, offered, unit > 0 ? cash.get(buyer.id)! / unit : want)
      if (take <= 1e-9) continue
      cash.set(buyer.id, cash.get(buyer.id)! - take * unit)
      for (const s of sellers) {
        const amount = (take * spare.get(s.id)!) / offered
        spare.set(s.id, spare.get(s.id)! - amount)
        filled[s.id][g] = (filled[s.id][g] ?? 0) - amount
      }
      filled[buyer.id][g] = (filled[buyer.id][g] ?? 0) + take
    }
  }
  return filled
}
