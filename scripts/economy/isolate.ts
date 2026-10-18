// Scratch: Mars's five years with Jinshan trading normally vs cut off from every other nation.
import { measureStability } from './stability'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../../src/economy/economySeed'
const run = (isolate: boolean) => {
  const v = measureStability({ countries: seedCountries(), worlds: seedWorlds(), corporations: seedCorporations(), banks: seedBanks() }, { humanCountryIds: [], ...(isolate ? { tradeGroups: { 'republic-of-jinshan': 'apart' } } : {}) })
  const f = (x: number) => `${(x * 100).toFixed(1)}%`
  const ys = v.years['imperial-state-of-mars']
  return ys.map((y, i) => (i === 0 ? '' : f(y.real / ys[i - 1].real - 1))).join(' ')
}
console.log('Mars real output, year on year')
console.log(' Jinshan trading:   ', run(false))
console.log(' Jinshan cut off:   ', run(true))
