// Special Economic Zones: Complex mode (a per-world tax cut + open to foreign
// capital whatever the nation's policy) and Simple mode (a per-nation trade-
// capacity boost). See economy/economyTypes.ts (World.specialEconomicZone),
// economy/economyTick.ts, economy/corporationAI.ts and
// economy-abstract/abstractEconomy.ts.
//
// Run:  npx tsx tests/sez.test.ts

import { tickEconomy } from '../src/economy/economyTick'
import { SEZ_DEFAULT_TAX_DISCOUNT } from '../src/economy/economyTypes'
import { seedCountries, seedCorporations, seedWorlds } from '../src/economy/economySeed'
import { runCorporationAI } from '../src/economy/corporationAI'
import { abstractReport, SEZ_TRADE_BONUS, type AbstractEconomyState, emptyStockpile } from '../src/economy-abstract/abstractEconomy'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('=== 1. Complex: an SEZ cuts the zone world\'s tax take ===')
{
  // Run a few months with Mars's capital world as an SEZ vs. not; the zone's
  // own tax revenue should be lower.
  const marsWorld = seedWorlds().find((w) => w.id === 'Mars')!
  const taxOf = (sez: boolean) => {
    let st = { countries: seedCountries(), worlds: seedWorlds().map((w) => (w.id === 'Mars' && sez ? { ...w, specialEconomicZone: { active: true, taxDiscount: SEZ_DEFAULT_TAX_DISCOUNT } } : w)), corporations: seedCorporations() }
    let marsTax = 0
    for (let t = 1; t <= 4; t++) {
      const r = tickEconomy(st.countries, st.worlds, st.corporations, { tick: t })
      st = r
      // Mars world's contribution shows in Mars nation's revenue; compare the
      // whole nation's tax since Mars's world dominates its own nation.
      marsTax += r.reports.countries['imperial-state-of-mars']?.revenue ?? 0
    }
    return marsTax
  }
  const plain = taxOf(false)
  const zoned = taxOf(true)
  check('Mars owns its capital world', !!marsWorld)
  check('the SEZ lowers government revenue from that nation', zoned < plain, `${zoned.toFixed(0)} < ${plain.toFixed(0)}`)
}

console.log('\n=== 2. Complex: an SEZ opens a world to foreign capital in a closed nation ===')
{
  // A Venus company, Mars closed to foreign investment, but a Mars world flagged
  // as an SEZ. The company may build there despite the closed national policy.
  const worlds = seedWorlds()
  const marsIdx = worlds.findIndex((w) => w.id === 'Mars')
  // No open hosts at all (empty set = everyone closed to foreigners).
  const corp = seedCorporations().find((c) => c.countryId === 'republic-of-venus')
  check('there is a Venus company to test with', !!corp)
  if (corp) {
    const flush = { ...corp, cash: 5_000_000 }
    const closed = runCorporationAI(flush, worlds, 6, Infinity, new Set())
    const builtAbroadClosed = closed.worlds[marsIdx].constructionQueue.length - worlds[marsIdx].constructionQueue.length

    const sezWorlds = worlds.map((w, i) => (i === marsIdx ? { ...w, specialEconomicZone: { active: true, taxDiscount: 0.5 } } : w))
    const open = runCorporationAI(flush, sezWorlds, 6, Infinity, new Set())
    const builtAbroadSez = open.worlds[marsIdx].constructionQueue.length - sezWorlds[marsIdx].constructionQueue.length
    check('with every nation closed, no foreign build lands on Mars', builtAbroadClosed === 0, `${builtAbroadClosed}`)
    check('flagging the Mars world an SEZ lets the foreign company build there', builtAbroadSez >= builtAbroadClosed)
  }
}

console.log('\n=== 3. Simple: an SEZ lifts a nation\'s trade capacity ===')
{
  const base: AbstractEconomyState = {
    countryId: 'republic-of-venus', population: 1000, gdp: 0, realGdp: 0, priceLevel: 1, inflation: 0, stability: 0.8,
    treasury: 0, reserves: 0, debt: 0, taxRate: 0.2, economyType: 'market', moneyCreation: 0, warTaxes: false, welfare: 0.3,
    queue: [], nextOrderId: 1, currency: { rate: 1, regime: 'float', peggedTo: null }, trade: {},
  }
  // A populous world with staffed spaceports and a full stock (so the spaceports
  // actually run) gives a non-zero base trade capacity to compare against.
  const worlds = [{ bodyName: 'Venus', population: 3000, buildings: { spaceport: 6, farm: 6, powerPlant: 6, mine: 6 } } as never] as never
  const stock = emptyStockpile()
  for (const k of Object.keys(stock)) (stock as Record<string, number>)[k] = 100000
  const plain = abstractReport(base, worlds, stock)
  const zoned = abstractReport({ ...base, specialEconomicZone: true }, worlds, stock)
  check('the base world has trade capacity to compare', plain.tradeCapacity > 0, `${plain.tradeCapacity.toFixed(0)}`)
  check('the SEZ raises trade capacity', zoned.tradeCapacity > plain.tradeCapacity, `${zoned.tradeCapacity.toFixed(0)} > ${plain.tradeCapacity.toFixed(0)}`)
  check('by the stated bonus', Math.abs(zoned.tradeCapacity - plain.tradeCapacity * (1 + SEZ_TRADE_BONUS)) < 1e-6)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
