// Trade between nations (Complex mode), and the payments for every shipment.
// Pure: economyTick runs it after every nation's own tick.
//
// A good moves from a world with unsold stock to a world of ANOTHER nation that
// is short of it, when the two are at peace and the landed cost — the seller's
// price, converted through both currencies (fx.ts), grossed up for what is lost
// in transit — is below the buyer's price (plain arbitrage). Volume is capped by
// the buyer's freight capacity left after its own domestic shipping. The money
// is real: the importing nation's treasury (its merchants) pays the seller's
// building owners in the seller's currency, and recovers it when the goods
// sell in its market next tick (economyTick's import sales).

import { GOOD_IDS, type GoodId } from './goods'
import type { Country, World } from './economyTypes'

export const TRANSPORT_LOSS = 0.12 // share of a shipment lost in transit

// Who a sale out of a world's stock pays, in the seller's currency.
export interface SaleCredits {
  state: number // state-owned buildings → the treasury
  corporations: Map<string, number> // corporation-owned → that company
  workers: number // co-ops → the world's pops
}

// Take `amount` of a good out of a world's building inventories (in proportion
// to what each holds) at `price`, crediting each building's owner.
export function sellFromWorld(world: World, good: GoodId, amount: number, price: number): { world: World; credits: SaleCredits } {
  const credits: SaleCredits = { state: 0, corporations: new Map(), workers: 0 }
  const total = world.buildings.reduce((s, b) => s + (b.inventory[good] ?? 0), 0)
  if (total <= 0 || amount <= 0) return { world, credits }
  const frac = Math.min(1, amount / total)
  const buildings = world.buildings.map((b) => {
    const have = b.inventory[good] ?? 0
    if (have <= 0) return b
    const value = have * frac * price
    if (b.owner.kind === 'state') credits.state += value
    else if (b.owner.kind === 'corporation') credits.corporations.set(b.owner.corporationId, (credits.corporations.get(b.owner.corporationId) ?? 0) + value)
    else credits.workers += value
    return { ...b, inventory: { ...b.inventory, [good]: have * (1 - frac) } }
  })
  return { world: { ...world, buildings }, credits }
}

export interface TradeLedger {
  treasury: Map<string, number> // country → change (importers pay, state sellers are paid)
  corporations: Map<string, number> // company → export revenue
  worldPops: Map<string, number> // world → co-op export revenue for its pops
  volume: Map<string, number> // importing country → units bought abroad
  value: Map<string, number> // importing country → what it paid, in its currency
}

export function emptyLedger(): TradeLedger {
  return { treasury: new Map(), corporations: new Map(), worldPops: new Map(), volume: new Map(), value: new Map() }
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)

// Book a sale's credits (in the seller's currency) to the ledger.
export function bookCredits(ledger: TradeLedger, sellerCountry: string, worldId: string, credits: SaleCredits): void {
  if (credits.state) add(ledger.treasury, sellerCountry, credits.state)
  for (const [id, v] of credits.corporations) add(ledger.corporations, id, v)
  if (credits.workers) add(ledger.worldPops, worldId, credits.workers)
}

export interface TradeInput {
  worlds: World[]
  countries: Country[]
  // What a world will lack of a good next month, after domestic shipping.
  shortfall: (worldIndex: number, good: GoodId) => number
  // What a world keeps of its stock for its own use (not for sale abroad).
  keep?: (worldIndex: number, good: GoodId) => number
  // Freight capacity each nation has left this tick.
  capacityLeft: Map<string, number>
  atWar: (a: string, b: string) => boolean
  // Whether two nations may trade at all (reach, not politics: empires in far
  // clusters never meet Mars's market). Absent = any two may.
  canTrade?: (a: string, b: string) => boolean
  // Money of `from` country's currency in `to`'s (fx.convertBetween).
  convert: (amount: number, from: string, to: string) => number
}

export function tradeBetweenNations(input: TradeInput): { worlds: World[]; ledger: TradeLedger } {
  const worlds = [...input.worlds]
  const ledger = emptyLedger()
  const capacity = new Map(input.capacityLeft)
  const stockOf = (i: number, g: GoodId) => worlds[i].buildings.reduce((s, b) => s + (b.inventory[g] ?? 0), 0)
  for (const g of GOOD_IDS) {
    const buyers = worlds.map((_, i) => i).filter((i) => input.shortfall(i, g) > 1e-6)
    if (buyers.length === 0) continue
    const left = worlds.map((_, i) => Math.max(0, stockOf(i, g) - (input.keep?.(i, g) ?? 0)))
    for (const b of buyers) {
      const buyer = worlds[b].ownerId
      let want = Math.min(input.shortfall(b, g), capacity.get(buyer) ?? 0)
      if (want <= 1e-6) continue
      const buyPrice = worlds[b].market.prices[g]
      // Sellers abroad, at peace, whose landed cost undercuts the buyer's price.
      const sellers = worlds
        .map((w, i) => ({ i, landed: input.convert(w.market.prices[g], w.ownerId, buyer) / (1 - TRANSPORT_LOSS) }))
        .filter(({ i, landed }) => worlds[i].ownerId !== buyer && left[i] > 1e-6 && !input.atWar(buyer, worlds[i].ownerId) && (input.canTrade?.(buyer, worlds[i].ownerId) ?? true) && landed < buyPrice)
      const offered = sellers.reduce((s, x) => s + left[x.i], 0)
      if (offered <= 1e-6) continue
      // Ship enough that what ARRIVES covers the shortfall, as far as stock allows.
      const ship = Math.min(want / (1 - TRANSPORT_LOSS), offered, capacity.get(buyer) ?? 0)
      for (const s of sellers) {
        const amount = ship * (left[s.i] / offered)
        if (amount <= 1e-9) continue
        const seller = worlds[s.i]
        const price = seller.market.prices[g]
        const sold = sellFromWorld(seller, g, amount, price)
        worlds[s.i] = sold.world
        left[s.i] -= amount
        bookCredits(ledger, seller.ownerId, seller.id, sold.credits)
        const paid = input.convert(amount * price, seller.ownerId, buyer)
        add(ledger.treasury, buyer, -paid)
        add(ledger.value, buyer, paid)
        add(ledger.volume, buyer, amount)
        const w = worlds[b]
        worlds[b] = { ...w, importStock: { ...w.importStock, [g]: (w.importStock[g] ?? 0) + amount * (1 - TRANSPORT_LOSS) } }
      }
      capacity.set(buyer, (capacity.get(buyer) ?? 0) - ship)
      want -= ship * (1 - TRANSPORT_LOSS)
    }
  }
  return { worlds, ledger }
}
