// Scratch: every nation's stability verdict as the game runs it: Jinshan has not made contact with anyone.
import { measureStability } from './stability'
import { COUNTRIES } from '../../src/data/countryData'
import { uncontactedPairs } from '../../src/scene/contact'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../../src/economy/economySeed'
const ids = COUNTRIES.map((c) => c.id)
const v = measureStability({ countries: seedCountries(), worlds: seedWorlds(), corporations: seedCorporations(), banks: seedBanks() }, { humanCountryIds: [], uncontactedPairs: uncontactedPairs(ids, new Set()), portTradeCountries: ids })
console.log('failing, Jinshan uncontacted:', JSON.stringify(Object.fromEntries(Object.entries(v.failing).filter(([, f]) => f.length))))
const y = v.years['republic-of-jinshan']
console.log(' Jinshan real', y.map((a) => a.real.toFixed(0)).join(' '), '| employed', y.map((a) => (a.employed / a.workers * 100).toFixed(0) + '%').join(' '))
