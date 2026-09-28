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
//
// Everything traded goes through spaceports: each nation can move at most its
// tradeCapacity (TSC of goods at GOOD_VALUE a month, bought and sold together;
// abstractReport.tradeCapacity). A nation without one trades nothing; absent
// = unlimited (direct test literals).

import { GOOD_VALUE, SIMPLE_GOODS, type SimpleGood } from '../data/simplisticEconomyData'
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
  tradeCapacity?: number // TSC of goods its spaceports can move a month (absent = unlimited)
}

export function matchTrade(nations: TradeNation[], atWar: (a: string, b: string) => boolean): Record<string, TradeOrders> {
  const filled: Record<string, TradeOrders> = Object.fromEntries(nations.map((n) => [n.id, {}]))
  const cash = new Map(nations.map((n) => [n.id, Math.max(0, n.cash)]))
  const capacity = new Map(nations.map((n) => [n.id, Math.max(0, n.tradeCapacity ?? Infinity)]))
  for (const g of SIMPLE_GOODS) {
    // What each nation can spare of this good.
    const spare = new Map<string, number>()
    for (const n of nations) {
      const q = n.orders[g] ?? 0
      const stock = Math.max(0, n.stock[g] ?? 0)
      if (q < 0) spare.set(n.id, Math.min(-q, Math.max(0, stock + Math.min(0, n.monthlyNet?.[g] ?? 0))))
      else if (q === 0) spare.set(n.id, Math.max(0, stock - RESERVE_MONTHS * (n.monthlyUse[g] ?? Infinity)))
    }
    const value = GOOD_VALUE[g]
    // What a nation's spaceports still have room for, in units of this good.
    const room = (id: string) => capacity.get(id)! / value
    for (const buyer of nations) {
      const want = buyer.orders[g] ?? 0
      if (want <= 0) continue
      // Each seller offers what it can spare and still ship.
      const offers = new Map<string, number>()
      for (const s of nations) {
        if (s.id === buyer.id || atWar(buyer.id, s.id)) continue
        const o = Math.min(spare.get(s.id) ?? 0, room(s.id))
        if (o > 1e-9) offers.set(s.id, o)
      }
      const offered = [...offers.values()].reduce((n, o) => n + o, 0)
      if (offered <= 1e-9) continue
      // As far as its treasury pays for (goods in the order its tick buys them)
      // and its spaceports can land.
      const unit = buyer.unitCost(g)
      const take = Math.min(want, offered, room(buyer.id), unit > 0 ? cash.get(buyer.id)! / unit : want)
      if (take <= 1e-9) continue
      cash.set(buyer.id, cash.get(buyer.id)! - take * unit)
      capacity.set(buyer.id, capacity.get(buyer.id)! - take * value)
      for (const [id, o] of offers) {
        const amount = (take * o) / offered
        spare.set(id, spare.get(id)! - amount)
        capacity.set(id, capacity.get(id)! - amount * value)
        filled[id][g] = (filled[id][g] ?? 0) - amount
      }
      filled[buyer.id][g] = (filled[buyer.id][g] ?? 0) + take
    }
  }
  return filled
}
