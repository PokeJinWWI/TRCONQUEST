// Scratch helper: month-by-month look at one nation's world — throughput of its plants, its bureaucracy and treasury.
//   npx tsx scripts/economy/diagNation.ts republic-of-jinshan Jinshan
import { tickEconomy } from '../../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../../src/economy/economySeed'
const id = process.argv[2]
const world = process.argv[3]
let countries = seedCountries()
let worlds = seedWorlds()
let corporations = seedCorporations()
let banks = seedBanks()
for (let t = 1; t <= 60; t++) {
  const r = tickEconomy(countries, worlds, corporations, { enableAI: true, tick: t, humanCountryIds: [] }, banks)
  ;({ countries, worlds, corporations, banks } = r)
  if (t % 6 !== 0) continue
  const c = countries.find((x) => x.id === id)!
  const w = worlds.find((x) => x.name === world)!
  const low = w.buildings.filter((b) => b.throughput < 0.5).map((b) => `${b.recipeId}${b.level}:${b.throughput.toFixed(2)}`)
  const pop = w.pops.reduce((n, p) => n + p.populationSize, 0)
  console.log(`m${t} pop ${pop.toFixed(0)} treasury ${c.treasury.toFixed(0)} bureau ${c.bureaucracy.toFixed(0)} price ${c.priceIndex.toFixed(2)} bldgs ${w.buildings.length} low: ${low.join(' ')}`)
}
