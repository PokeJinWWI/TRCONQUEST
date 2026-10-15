// Is every nation's economy ready to play at the start? Runs a nation's first two years (AI on, as in a real game) and reports, per good,
// how much is made against what the world's people and industry want, how much goes unsold, and where prices sit against their base;
// plus employment, budget and the standard of living. Overproduction shows as a supply/demand ratio far above 1 for months on end.
//
// Run:  npx tsx scripts/economy/startAudit.ts [--months 24] [--nation <id>] [--top 8] [--json]
import { tickEconomy } from '../../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../../src/economy/economySeed'
import { GOODS, GOOD_IDS, type GoodId } from '../../src/economy/goods'
import type { Country, World, WorldReport } from '../../src/economy/economyTypes'
import { getMethod } from '../../src/economy/recipes'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const MONTHS = Number(arg('months', '24'))
const TOP = Number(arg('top', '8'))
const ONLY = arg('nation', '')
const JSON_OUT = process.argv.includes('--json')

// A good is "overproduced" when, averaged over the second year, this much more is on offer than is wanted, and a real amount is made.
export const OVERSUPPLY_RATIO = 2
// Overproduction proper: a good whose buildings make this many times what is wanted, and whose stock keeps growing (months of its own output).
export const FLOW_OVERSUPPLY = 1.5
export const MIN_SHARE_OF_OUTPUT = 0.002

export interface GoodRow {
  good: GoodId
  // What buildings make a month against what is wanted a month (flows, not stock).
  producedOverDemand: number
  // How much the stock on hand grew over the second year, in months of this good's output.
  stockGrowthMonths: number
  supplyOverDemand: number
  unsoldShare: number
  priceOverBase: number
  // Share of the nation's output value this good is.
  outputShare: number
}
export interface NationAudit {
  id: string
  worlds: number
  over: GoodRow[]
  short: GoodRow[]
  employment: number
  balancePctGdp: number
  avgSoL: number
  worstWorldSupplyOverDemand: number
  // Value (at base prices) of what is made beyond what is wanted, as a share of everything made: the one-number size of overproduction.
  surplusValueShare: number
  // The goods making up most of it.
  biggestSurplus: { good: GoodId; share: number; madeOverWanted: number }[]
}

export function auditNations(months = MONTHS, start?: { countries: Country[]; worlds: World[] }): NationAudit[] {
  let countries = start?.countries ?? seedCountries()
  let worlds: World[] = start?.worlds ?? seedWorlds()
  let corporations = seedCorporations()
  let banks = seedBanks()
  const ids = countries.map((c) => c.id)
  type Acc = { supply: number; demand: number; transacted: number; price: number; n: number; produced: number; stockEnd: number; stockMid: number }
  const acc: Record<string, Partial<Record<GoodId, Acc>>> = Object.fromEntries(ids.map((id) => [id, {}]))
  const emp: Record<string, { employed: number; workers: number }> = Object.fromEntries(ids.map((id) => [id, { employed: 0, workers: 0 }]))
  const fiscal: Record<string, { balance: number; gdp: number }> = Object.fromEntries(ids.map((id) => [id, { balance: 0, gdp: 0 }]))
  const outputValue: Record<string, Partial<Record<GoodId, number>>> = Object.fromEntries(ids.map((id) => [id, {}]))
  const worldRatio: Record<string, number> = {}
  const half = Math.floor(months / 2)
  for (let m = 1; m <= months; m++) {
    const r = tickEconomy(countries, worlds, corporations, { enableAI: true, tick: m, humanCountryIds: [] }, banks)
    ;({ countries, worlds, corporations, banks } = r)
    if (m <= half) continue
    for (const w of worlds) {
      const rep: WorldReport | undefined = r.reports.worlds[w.id]
      if (!rep) continue
      const a = (acc[w.ownerId] ??= {})
      for (const g of GOOD_IDS) {
        const x = rep.goods[g]
        if (!x) continue
        const row = (a[g] ??= { supply: 0, demand: 0, transacted: 0, price: 0, n: 0, produced: 0, stockEnd: 0, stockMid: 0 })
        row.supply += x.supply
        row.demand += x.demand
        row.transacted += x.transacted
        row.price += x.price / GOODS[g].basePrice
        row.n++
      }
      for (const [cls, l] of Object.entries(rep.labor)) {
        if (cls === 'investor') continue
        const inWork = l.workers * l.employmentRate
        emp[w.ownerId].employed += inWork
        emp[w.ownerId].workers += cls === 'subsistence' ? inWork : l.workers
      }
      for (const b of w.buildings) {
        const method = getMethod(b.recipeId, b.methodId)
        if (!method) continue
        for (const o of method.outputs) {
          const row = (a[o.good] ??= { supply: 0, demand: 0, transacted: 0, price: 0, n: 0, produced: 0, stockEnd: 0, stockMid: 0 })
          row.produced += o.amount * b.level * b.throughput
        }
      }
      // Stock on hand at the end of every month; the first month of the second year is the "mid" reading.
      for (const g of GOOD_IDS) {
        const row = a[g]
        if (!row) continue
        const stock = w.buildings.reduce((n, b) => n + (b.inventory[g] ?? 0), 0) + (w.importStock[g] ?? 0)
        if (m === half + 1) row.stockMid += stock
        if (m === months) row.stockEnd += stock
      }
    }
    for (const id of ids) {
      const f = r.reports.countries[id]
      if (f) {
        fiscal[id].balance += f.balance
        fiscal[id].gdp += f.gdp
      }
    }
  }
  // Output value by good from the last tick's buildings (what each nation actually makes).
  void outputValue
  return ids
    .filter((id) => !ONLY || id === ONLY)
    .map((id): NationAudit => {
      const rows: GoodRow[] = []
      const totalValue = GOOD_IDS.reduce((n, g) => n + (acc[id][g]?.transacted ?? 0) * (acc[id][g] ? (acc[id][g]!.price / Math.max(1, acc[id][g]!.n)) * GOODS[g].basePrice : 0), 0)
      for (const g of GOOD_IDS) {
        const a = acc[id][g]
        if (!a || a.n === 0) continue
        const share = totalValue > 0 ? (a.transacted * (a.price / a.n) * GOODS[g].basePrice) / totalValue : 0
        rows.push({ good: g, producedOverDemand: a.demand > 1e-9 ? a.produced / a.demand : a.produced > 1e-9 ? Infinity : 1, stockGrowthMonths: a.produced > 1e-9 ? (a.stockEnd - a.stockMid) / (a.produced / Math.max(1, months - half)) : 0, supplyOverDemand: a.demand > 1e-9 ? a.supply / a.demand : a.supply > 1e-9 ? Infinity : 1, unsoldShare: a.supply > 1e-9 ? Math.max(0, (a.supply - a.transacted) / a.supply) : 0, priceOverBase: a.price / a.n, outputShare: share })
      }
      const significant = rows.filter((r) => r.outputShare >= MIN_SHARE_OF_OUTPUT || r.supplyOverDemand >= OVERSUPPLY_RATIO)
      const over = significant.filter((r) => r.producedOverDemand >= FLOW_OVERSUPPLY && r.stockGrowthMonths > 2).sort((a, b) => b.stockGrowthMonths - a.stockGrowthMonths)
      const short = significant.filter((r) => r.supplyOverDemand < 0.9 && r.priceOverBase > 1.3).sort((a, b) => b.priceOverBase - a.priceOverBase)
      let madeValue = 0
      let surplusValue = 0
      const surpluses: { good: GoodId; value: number; madeOverWanted: number }[] = []
      for (const g of GOOD_IDS) {
        const a = acc[id][g]
        if (!a || a.produced <= 1e-9) continue
        const value = a.produced * GOODS[g].basePrice
        const extra = Math.max(0, a.produced - a.demand) * GOODS[g].basePrice
        madeValue += value
        surplusValue += extra
        if (extra > 0) surpluses.push({ good: g, value: extra, madeOverWanted: a.demand > 1e-9 ? a.produced / a.demand : Infinity })
      }
      const e = emp[id]
      const sols = worlds.filter((w) => w.ownerId === id).flatMap((w) => w.pops)
      const popTotal = sols.reduce((n, p) => n + p.populationSize, 0)
      return {
        id,
        worlds: worlds.filter((w) => w.ownerId === id).length,
        over,
        short,
        employment: e.workers > 0 ? e.employed / e.workers : 1,
        balancePctGdp: fiscal[id].gdp > 0 ? fiscal[id].balance / fiscal[id].gdp : 0,
        avgSoL: popTotal > 0 ? sols.reduce((n, p) => n + p.standardOfLiving * p.populationSize, 0) / popTotal : 0,
        surplusValueShare: madeValue > 0 ? surplusValue / madeValue : 0,
        biggestSurplus: surpluses.sort((x, y) => y.value - x.value).slice(0, 6).map((x) => ({ good: x.good, share: surplusValue > 0 ? x.value / surplusValue : 0, madeOverWanted: x.madeOverWanted })),
        worstWorldSupplyOverDemand: Math.max(0, ...rows.filter((r) => Number.isFinite(r.supplyOverDemand)).map((r) => r.supplyOverDemand)),
      }
    })
}

if (process.argv[1]?.endsWith('startAudit.ts')) {
  const audits = auditNations()
  if (JSON_OUT) console.log(JSON.stringify(audits, null, 1))
  else {
    for (const a of audits) {
      console.log(`\n=== ${a.id} (${a.worlds} worlds) — employment ${(a.employment * 100).toFixed(1)}%, budget ${(a.balancePctGdp * 100).toFixed(1)}% of GDP, SoL ${(a.avgSoL * 100).toFixed(0)}%`)
      console.log(`  surplus: ${(a.surplusValueShare * 100).toFixed(0)}% of everything made is beyond what is wanted — mostly ${a.biggestSurplus.map((x) => `${x.good} ${(x.share * 100).toFixed(0)}%`).join(', ')}`)
      console.log(`  overproduced: ${a.over.length}`)
      for (const r of a.over.slice(0, TOP)) console.log(`    ${r.good.padEnd(20)} made/wanted ${Number.isFinite(r.producedOverDemand) ? r.producedOverDemand.toFixed(1) : 'inf'}  stock +${r.stockGrowthMonths.toFixed(1)} months of output in a year  price ${(r.priceOverBase * 100).toFixed(0)}% of base`)
      console.log(`  short: ${a.short.length}`)
      for (const r of a.short.slice(0, TOP)) console.log(`    ${r.good.padEnd(20)} supply/demand ${r.supplyOverDemand.toFixed(2)}  price ${(r.priceOverBase * 100).toFixed(0)}% of base`)
    }
  }
}
