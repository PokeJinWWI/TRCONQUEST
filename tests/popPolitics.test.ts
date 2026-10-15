// Wealth levels, expected standard of living, political strength and mood (economy/popPolitics.ts), and their place in the Complex tick.
//
// Run:  npx tsx tests/popPolitics.test.ts
import { tickEconomy } from '../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import { interestGroupStrengths } from '../src/economy/politics'
import { MOOD_DEADBAND, LOYALTY_STEP, expectedSoL, loyalistShare, loyaltyOf, politicalStrength, radicalShare, simpleLoyalists, simpleRadicals, stepLoyalty, turmoilOf, wealthLevel } from '../src/economy/popPolitics'
import { distressOf } from '../src/economy/migration'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

console.log('\n=== 1. Wealth and expectations ===')
{
  check('wealth levels start at 1 and rise with wealth per person', wealthLevel(0, 100) === 1 && wealthLevel(400, 100) > wealthLevel(100, 100) && wealthLevel(1e9, 1) === 30)
  check('a pop with no people has the lowest level', wealthLevel(500, 0) === 1)
  check('expected standard of living rises with literacy, 0.5 at 0.5', near(expectedSoL(0.5), 0.5) && expectedSoL(0.9) > expectedSoL(0.2))
}

console.log('\n=== 2. Political strength ===')
{
  const base = { class: 'labor' as const, populationSize: 100, wealth: 400 }
  check('strength grows with people, class and wealth', politicalStrength({ ...base, populationSize: 200, wealth: 800 }) > politicalStrength(base) && politicalStrength({ ...base, class: 'investor' }) > politicalStrength(base) && politicalStrength({ ...base, wealth: 4000 }) > politicalStrength(base))
  check('dependents are politically unaligned: a bigger workforce share means more strength', politicalStrength({ ...base, workforceShare: 0.6 }) > politicalStrength({ ...base, workforceShare: 0.3 }))
  check('a pop with less acceptance counts for less', politicalStrength(base, 0.5) < politicalStrength(base))
  const worlds = seedWorlds()
  const groups = interestGroupStrengths(worlds.find((w) => w.id === 'Mars')!)
  check('the four interest groups still share the whole of a planet\'s strength', groups.length === 4 && near(groups.reduce((n, g) => n + g.share, 0), 1, 1e-9))
}

console.log('\n=== 3. Loyalists, neutrals, radicals ===')
{
  check('inside the dead band a pop does not change its mind', stepLoyalty(0, 0.5, 0.5) === 0 && stepLoyalty(0.3, 0.5 + MOOD_DEADBAND * 0.9, 0.5) === 0.3)
  check('below what it expects, a pop moves toward radicals one step at a time', near(stepLoyalty(0, 0.1, 0.5), -LOYALTY_STEP) && stepLoyalty(0, 0.1, 0.5) > -1)
  check('above what it expects, toward loyalists', stepLoyalty(0, 0.95, 0.5) > 0)
  let l = 0
  for (let i = 0; i < 100; i++) l = stepLoyalty(l, 0, 0.5)
  check('it never leaves -1..1', l === -1)
  check('a pop is never both radical and loyalist, and changes sign through neutral', radicalShare({ loyalty: -0.4 }) === 0.4 && loyalistShare({ loyalty: -0.4 }) === 0 && loyalistShare({ loyalty: 0.3 }) === 0.3 && radicalShare({ loyalty: 0.3 }) === 0 && loyaltyOf({}) === 0)
  check('grievances anger a pop that would otherwise be content', stepLoyalty(0, 0.5, 0.5, 0.3) < 0)
  check('turmoil is the people-weighted radical share', near(turmoilOf([{ populationSize: 100, loyalty: -1 }, { populationSize: 100, loyalty: 1 }]), 0.5) && turmoilOf([]) === 0)
  check('Simple: a stratum\'s mood is read off its happiness', simpleRadicals(0.1) > simpleRadicals(0.3) && simpleRadicals(0.5) === 0 && simpleLoyalists(0.9) > simpleLoyalists(0.7) && simpleLoyalists(0.5) === 0)
}

console.log('\n=== 4. In the economy ===')
{
  let countries = seedCountries()
  let worlds = seedWorlds()
  let corporations = seedCorporations()
  let banks = seedBanks()
  const calm = worlds.map((w) => turmoilOf(w.pops))
  check('a new world starts calm: nobody is a radical', calm.every((t) => t === 0))
  for (let m = 1; m <= 36; m++) ({ countries, worlds, corporations, banks } = tickEconomy(countries, worlds, corporations, { enableAI: true, tick: m, humanCountryIds: [] }, banks))
  const loyalties = worlds.flatMap((w) => w.pops.map((p) => loyaltyOf(p)))
  check('three years on every mood is a number in range', loyalties.every((x) => Number.isFinite(x) && x >= -1 && x <= 1))
  check('some pops have formed a mood (SoL moved away from what they expect)', loyalties.some((x) => x !== 0))
  const w = worlds[0]
  const angry = { ...w, pops: w.pops.map((p) => ({ ...p, loyalty: -1 })) }
  check('radicals make a world less safe to live in (more distress)', distressOf(angry, 0) > distressOf({ ...w, pops: w.pops.map((p) => ({ ...p, loyalty: 0 })) }, 0))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll pop politics checks passed')
process.exit(failures ? 1 : 0)
