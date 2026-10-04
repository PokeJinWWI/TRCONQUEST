// Verification of trade between nations: Complex mode (economy/internationalTrade.ts)
// and the payments for every shipment — money conserved across currencies, no
// trade at war, the freight cap, trade only when it pays, sellers paid by owner —
// and Simple mode's order matching (economy-abstract/tradeMatching.ts).
// Run:  npx tsx tests/internationalTrade.test.ts

import { sellFromWorld, tradeBetweenNations, TRANSPORT_LOSS, type TradeInput } from '../src/economy/internationalTrade'
import { tickEconomy } from '../src/economy/economyTick'
import { seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import { convertBetween } from '../src/economy/fx'
import type { World } from '../src/economy/economyTypes'
import { matchTrade, RESERVE_MONTHS, type TradeNation } from '../src/economy-abstract/tradeMatching'
import { emptyStockpile } from '../src/economy-abstract/abstractEconomy'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'
const countries = seedCountries()

// Mars holds 1,000 unsold steel, cheap; Venus is short 300 and pays dear.
function market(marsPrice: number, venusPrice: number): World[] {
  return seedWorlds().map((w) => {
    if (w.id === 'Mars') {
      const [first, ...rest] = w.buildings
      return { ...w, market: { prices: { ...w.market.prices, steel: marsPrice } }, buildings: [{ ...first, inventory: { steel: 1000 } }, ...rest.map((b) => ({ ...b, inventory: {} }))] }
    }
    if (w.id === 'Venus') return { ...w, market: { prices: { ...w.market.prices, steel: venusPrice } }, buildings: w.buildings.map((b) => ({ ...b, inventory: {} })), importStock: {} }
    return { ...w, buildings: w.buildings.map((b) => ({ ...b, inventory: {} })) }
  })
}
const input = (worlds: World[], over: Partial<TradeInput> = {}): TradeInput => ({
  worlds,
  countries,
  shortfall: (i, g) => (worlds[i].id === 'Venus' && g === 'steel' ? 300 : 0),
  capacityLeft: new Map(countries.map((c) => [c.id, 100000])),
  atWar: () => false,
  convert: (amount, from, to) => convertBetween(amount, from, to, countries),
  ...over,
})
const venusOf = (ws: World[]) => ws.find((w) => w.id === 'Venus')!
const marsSteel = (ws: World[]) => ws.find((w) => w.id === 'Mars')!.buildings.reduce((n, b) => n + (b.inventory.steel ?? 0), 0)

console.log('=== 1. A shortfall is filled from a cheaper nation, and paid for ===')
{
  const worlds = market(5, 20)
  const { worlds: after, ledger } = tradeBetweenNations(input(worlds))
  const arrived = venusOf(after).importStock.steel ?? 0
  check('what arrives covers the shortfall', Math.abs(arrived - 300) < 1e-6, arrived.toFixed(1))
  const shipped = 1000 - marsSteel(after)
  check('what left Mars is what arrived plus the transit loss', Math.abs(shipped * (1 - TRANSPORT_LOSS) - arrived) < 1e-6, `${shipped.toFixed(1)} shipped`)
  const paid = -(ledger.treasury.get(VENUS) ?? 0)
  const received = [...ledger.corporations.values()].reduce((a, b) => a + b, 0) + (ledger.treasury.get(MARS) ?? 0) + [...ledger.worldPops.values()].reduce((a, b) => a + b, 0)
  check('Mars is paid its own price for every unit shipped', Math.abs(received - shipped * 5) < 1e-6, `${received.toFixed(1)}`)
  check('money is conserved: what Venus paid is what Mars got, through the exchange rate', Math.abs(paid - convertBetween(received, MARS, VENUS, countries)) < 1e-6, `paid ${paid.toFixed(1)} ${VENUS} = ${received.toFixed(1)} ${MARS}`)
  check('the ledger records the import', (ledger.volume.get(VENUS) ?? 0) > 0 && (ledger.value.get(VENUS) ?? 0) === paid)
}

console.log('\n=== 2. When there is no trade ===')
{
  const worlds = market(5, 20)
  const war = tradeBetweenNations(input(worlds, { atWar: (a, b) => (a === VENUS && b === MARS) || (a === MARS && b === VENUS) }))
  check('nations at war do not trade', (venusOf(war.worlds).importStock.steel ?? 0) === 0 && marsSteel(war.worlds) === 1000)
  const dear = tradeBetweenNations(input(market(20, 18)))
  check('no trade when the landed cost is above the buyer’s price (it wouldn’t pay)', (venusOf(dear.worlds).importStock.steel ?? 0) === 0)
  const capped = tradeBetweenNations(input(market(5, 20), { capacityLeft: new Map([[VENUS, 50]]) }))
  check('the buyer’s spare freight caps the volume', 1000 - marsSteel(capped.worlds) <= 50 + 1e-6, `${(1000 - marsSteel(capped.worlds)).toFixed(1)} shipped`)
}

console.log('\n=== 3. Sellers are paid by who owns the building ===')
{
  const w = seedWorlds().find((x) => x.id === 'Mars')!
  const [a, b, c] = w.buildings
  const three = { ...w, buildings: [{ ...a, owner: { kind: 'state' as const }, inventory: { steel: 100 } }, { ...b, owner: { kind: 'corporation' as const, corporationId: 'redmines' }, inventory: { steel: 100 } }, { ...c, owner: { kind: 'worker' as const }, inventory: { steel: 200 } }] }
  const { world, credits } = sellFromWorld(three, 'steel', 200, 2)
  check('half the stock is taken, evenly from each holder', world.buildings.every((x, i) => Math.abs((x.inventory.steel ?? 0) - [50, 50, 100][i]) < 1e-9))
  check('the state, the company and the co-op are each paid for their share', credits.state === 100 && credits.corporations.get('redmines') === 100 && credits.workers === 200)
}

console.log('\n=== 4. In the tick ===')
{
  // Six months, so prices have drifted apart (at the seed they're all at base
  // and nothing pays for the transit loss).
  const run = (atWar: (a: string, b: string) => boolean) => {
    let st = { countries, worlds: seedWorlds(), corporations: seedCorporations() }
    let imported = 0
    for (let t = 1; t <= 6; t++) {
      const r = tickEconomy(st.countries, st.worlds, st.corporations, { tick: t, atWar })
      st = r
      imported += Object.values(r.reports.countries).reduce((n, f) => n + (f.importValue ?? 0), 0)
    }
    return imported
  }
  const peace = run(() => false)
  check('nations at peace trade with each other', peace > 0, peace.toFixed(0))
  check('and with everyone at war, nobody imports', run(() => true) === 0)
}

console.log('\n=== 5. Simple mode: orders fill from real partners ===')
{
  const nation = (id: string, over: Partial<TradeNation> = {}): TradeNation => ({ id, orders: {}, stock: emptyStockpile(), monthlyUse: {}, cash: 1e9, unitCost: () => 1, ...over })
  const peace = () => false
  const a = matchTrade([nation('A', { orders: { alloys: 100 } }), nation('B', { orders: { alloys: -60 }, stock: { ...emptyStockpile(), alloys: 500 } })], peace)
  check('an import fills from a partner’s export order, and no further', a.A.alloys === 60 && a.B.alloys === -60, `A +${a.A.alloys} B ${a.B.alloys}`)
  const b = matchTrade([nation('A', { orders: { food: -50 }, stock: { ...emptyStockpile(), food: 500 } }), nation('B')], peace)
  check('an export nobody is importing goes unfilled', (b.A.food ?? 0) === 0)
  const c = matchTrade([nation('A', { orders: { minerals: 1000 } }), nation('B', { stock: { ...emptyStockpile(), minerals: 700 }, monthlyUse: { minerals: 100 } })], peace)
  check(`a partner with no order sells only what it holds beyond ${RESERVE_MONTHS} months of its own use`, Math.abs((c.A.minerals ?? 0) - 100) < 1e-9 && Math.abs((c.B.minerals ?? 0) + 100) < 1e-9, `${c.A.minerals}`)
  const d = matchTrade([nation('A', { orders: { alloys: 100 } }), nation('B', { orders: { alloys: -100 }, stock: { ...emptyStockpile(), alloys: 500 } })], () => true)
  check('nations at war don’t trade', (d.A.alloys ?? 0) === 0 && (d.B.alloys ?? 0) === 0)
  const e = matchTrade([nation('A', { orders: { alloys: 100 }, cash: 30, unitCost: () => 2 }), nation('B', { orders: { alloys: -100 }, stock: { ...emptyStockpile(), alloys: 500 } })], peace)
  check('an importer buys only what its treasury pays for', Math.abs((e.A.alloys ?? 0) - 15) < 1e-9 && Math.abs((e.B.alloys ?? 0) + 15) < 1e-9, `${e.A.alloys}`)
  const f = matchTrade([nation('A', { orders: { alloys: 90 } }), nation('B', { orders: { alloys: -60 }, stock: { ...emptyStockpile(), alloys: 500 } }), nation('C', { orders: { alloys: -30 }, stock: { ...emptyStockpile(), alloys: 500 } })], peace)
  check('what is bought is exactly what the partners sold', Math.abs((f.A.alloys ?? 0) + (f.B.alloys ?? 0) + (f.C.alloys ?? 0)) < 1e-9 && f.A.alloys === 90)
}

console.log('\n=== 6. Complex mode: trade policy shapes trade and treasury ===')
{
  // A tariff just big enough to push the landed cost above the buyer's price
  // kills the trade; a smaller one still trades but feeds the buyer's treasury.
  const worlds = market(5, 20)
  const noTariff = tradeBetweenNations(input(worlds))
  const baseVol = noTariff.ledger.volume.get(VENUS) ?? 0

  const blocked = tradeBetweenNations(input(market(5, 20), { tariffRate: () => 5 }))
  check('a prohibitive tariff blocks the trade', (blocked.ledger.volume.get(VENUS) ?? 0) === 0)

  const tariffed = tradeBetweenNations(input(market(5, 20), { tariffRate: () => 0.5 }))
  const base = -(noTariff.ledger.treasury.get(VENUS) ?? 0)
  const withTariff = tariffed.ledger.treasury.get(VENUS) ?? 0
  check('a modest tariff still trades', (tariffed.ledger.volume.get(VENUS) ?? 0) > 0)
  check('tariff revenue offsets some of the buyer treasury outflow', withTariff > -base, `${withTariff.toFixed(0)} vs ${(-base).toFixed(0)}`)

  const shared = tradeBetweenNations(input(market(5, 20), { tariffRate: () => 5, sharedMarket: () => true }))
  check('a shared market waives the tariff', Math.abs((shared.ledger.volume.get(VENUS) ?? 0) - baseVol) < 1e-6)

  const embargoed = tradeBetweenNations(input(market(5, 20), { embargoed: () => true }))
  check('an embargo blocks trade outright', (embargoed.ledger.volume.get(VENUS) ?? 0) === 0)

  // At a price where the good is just too dear to cross, an export subvention
  // (paid by the seller's treasury) makes it competitive.
  const noSub = tradeBetweenNations(input(market(21, 20)))
  const expSub = tradeBetweenNations(input(market(21, 20), { exportSubvention: () => 0.3 }))
  check('without a subvention the dear good does not cross', (noSub.ledger.volume.get(VENUS) ?? 0) === 0)
  check('an export subvention makes a near-uncompetitive good trade', (expSub.ledger.volume.get(VENUS) ?? 0) > 0)
  // The subvention is a cost to the seller: at a price that trades either way,
  // the seller's treasury ends up poorer with the subvention than without.
  const sellerNoSub = tradeBetweenNations(input(market(5, 20))).ledger.treasury.get(MARS) ?? 0
  const sellerWithSub = tradeBetweenNations(input(market(5, 20), { exportSubvention: () => 0.3 })).ledger.treasury.get(MARS) ?? 0
  check('an export subvention costs the seller’s treasury', sellerWithSub < sellerNoSub, `${sellerWithSub.toFixed(0)} < ${sellerNoSub.toFixed(0)}`)
}

console.log('\n=== 7. Simple mode: trade policy shapes trade and treasury ===')
{
  const nation = (id: string, over: Partial<TradeNation> = {}): TradeNation => ({ id, orders: {}, stock: emptyStockpile(), monthlyUse: {}, cash: 1e9, unitCost: () => 1, ...over })
  const peace = () => false
  const emb = matchTrade([nation('A', { orders: { alloys: 100 } }), nation('B', { orders: { alloys: -100 }, stock: { ...emptyStockpile(), alloys: 500 } })], peace, { embargoed: () => true })
  check('an embargo blocks trade', (emb.A.alloys ?? 0) === 0)

  const fiscal = new Map<string, number>()
  const tar = matchTrade([nation('A', { orders: { alloys: 100 }, cash: 120, unitCost: () => 1 }), nation('B', { orders: { alloys: -100 }, stock: { ...emptyStockpile(), alloys: 500 } })], peace, { tariffRate: () => 0.2, fiscal })
  // Buyer can afford 120 / (1*1.2) = 100 units; tariff revenue = 100 * 1 * 0.2 = 20.
  check('a tariff raises the effective import cost', Math.abs((tar.A.alloys ?? 0) - 100) < 1e-9, `${tar.A.alloys}`)
  check('tariff revenue is booked to the buyer', Math.abs((fiscal.get('A') ?? 0) - 20) < 1e-6, `${fiscal.get('A')}`)

  const shareFiscal = new Map<string, number>()
  matchTrade([nation('A', { orders: { alloys: 100 } }), nation('B', { orders: { alloys: -100 }, stock: { ...emptyStockpile(), alloys: 500 } })], peace, { tariffRate: () => 0.2, sharedMarket: () => true, fiscal: shareFiscal })
  check('a shared market collects no tariff', (shareFiscal.get('A') ?? 0) === 0)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
