// Scratch helper: five years of the economy with overrides on one nation's country record, printing that nation's yearly figures.
//   npx tsx scripts/economy/tuneNation.ts republic-of-jinshan '{"welfarePerCapita":0.6}' [nationToReport]
import { measureStability } from './stability'
import { COUNTRIES } from '../../src/data/countryData'
import { uncontactedPairs } from '../../src/scene/contact'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../../src/economy/economySeed'

const id = process.argv[2]
const patch = JSON.parse(process.argv[3] ?? '{}')
const report = process.argv[4] ?? id
const countries = seedCountries().map((c) => (c.id === id ? { ...c, ...patch } : c))
const v = measureStability({ countries, worlds: seedWorlds(), corporations: seedCorporations(), banks: seedBanks() }, { humanCountryIds: [], uncontactedPairs: uncontactedPairs(COUNTRIES.map((c) => c.id), new Set()), portTradeCountries: COUNTRIES.map((c) => c.id) })
const f = (x: number) => `${(x * 100).toFixed(1)}%`
console.log(report, 'with', id, JSON.stringify(patch))
console.log(' failing:', JSON.stringify(v.failing[report] ?? []))
const ys = v.years[report]
console.log(' real', ys.map((y) => y.real.toFixed(0)).join(' '), '| nominal', ys.map((y) => y.nominal.toFixed(0)).join(' '))
console.log(' balance/nominal', ys.map((y) => f(y.balance / y.nominal)).join(' '), '| employed', ys.map((y) => f(y.employed / y.workers)).join(' '))
