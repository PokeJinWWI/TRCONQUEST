// Standard of living per nation over five years (population-weighted), with the tier satisfactions behind it and the stability
// figures that matter (real output, employment). Used to compare scoring changes: run before and after, report both.
// Run:  npx tsx scripts/economy/solReport.ts
import { tickEconomy } from '../../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../../src/economy/economySeed'
import { NEED_TIERS } from '../../src/economy/species'
import type { World } from '../../src/economy/economyTypes'

let countries = seedCountries()
let worlds = seedWorlds()
let corporations = seedCorporations()
let banks = seedBanks()
const ids = countries.map((c) => c.id)

function report(worldsNow: World[], label: string) {
  const rows = ids.map((id) => {
    const pops = worldsNow.filter((w) => w.ownerId === id).flatMap((w) => w.pops)
    const total = pops.reduce((n, p) => n + p.populationSize, 0) || 1
    const sol = pops.reduce((n, p) => n + p.standardOfLiving * p.populationSize, 0) / total
    const tiers = NEED_TIERS.map((t) => (pops.reduce((n, p) => n + p.needsSatisfaction[t] * p.populationSize, 0) / total).toFixed(2)).join('/')
    return `${id.slice(0, 12).padEnd(12)} SoL ${sol.toFixed(3)}  tiers(basic/everyday/health/comfort/lux) ${tiers}  pop ${Math.round(total)}`
  })
  console.log(`\n-- ${label}\n${rows.join('\n')}`)
}

report(worlds, 'start')
for (let month = 1; month <= 60; month++) {
  const res = tickEconomy(countries, worlds, corporations, { humanCountryIds: [], tick: month, enableAI: true }, banks)
  countries = res.countries
  worlds = res.worlds
  corporations = res.corporations
  banks = res.banks ?? banks
  if (month === 12 || month === 36 || month === 60) report(worlds, `month ${month}`)
}
process.exit(0)
