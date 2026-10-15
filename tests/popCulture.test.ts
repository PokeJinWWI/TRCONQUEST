// Culture and religion acceptance, assimilation and conversion (economy/acceptance.ts), and birth and mortality (economy/popRules.ts).
//
// Run:  npx tsx tests/popCulture.test.ts
import { ACCEPTANCE_STATUSES, ASSIMILATION_RATE, CITIZENSHIP_SCORE, STATUS_CLOUT, STATUS_WAGE, acceptanceOf, assimilationRate, conversionRate, nationCultureOf, skilledAccess, statusOfScore, stepAssimilation } from '../src/economy/acceptance'
import type { Pop } from '../src/economy/economyTypes'
import { GROWTH_MIDPOINT, GROWTH_RATE, birthMortality } from '../src/economy/popRules'
import { tickEconomy } from '../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps
const pop = (id: string, culture: string, religion: string, size: number, over: Partial<Pop> = {}): Pop => ({
  id, class: 'labor', speciesTemplateId: 'baseline-organic', cultureId: culture, religionId: religion, populationSize: size, wealth: size * 4, educationLevel: 0.3, standardOfLiving: 0.5,
  needsSatisfaction: { basic: 1, everyday: 1, healthcare: 1, comfort: 1, luxury: 1 }, ...over,
})
const total = (ps: Pop[]) => ps.reduce((n, p) => n + p.populationSize, 0)

console.log('\n=== 1. Statuses ===')
{
  check('scores fall in the five statuses', statusOfScore(100) === 'full' && statusOfScore(80) === 'full' && statusOfScore(79) === 'second-class' && statusOfScore(60) === 'second-class' && statusOfScore(59) === 'open-prejudice' && statusOfScore(40) === 'open-prejudice' && statusOfScore(39) === 'cultural-erasure' && statusOfScore(20) === 'cultural-erasure' && statusOfScore(19) === 'violent-hostility' && statusOfScore(0) === 'violent-hostility')
  check('worse treatment means less clout, lower pay and fewer skilled jobs', ACCEPTANCE_STATUSES.every((s, i) => i === 0 || (STATUS_CLOUT[s] > STATUS_CLOUT[ACCEPTANCE_STATUSES[i - 1]] && STATUS_WAGE[s] > STATUS_WAGE[ACCEPTANCE_STATUSES[i - 1]] && skilledAccess(s, 'technical') > skilledAccess(ACCEPTANCE_STATUSES[i - 1], 'technical'))))
  check('manual jobs are open to everyone', ACCEPTANCE_STATUSES.every((s) => skilledAccess(s, 'labor') === 1 && skilledAccess(s, 'subsistence') === 1))
}

console.log('\n=== 2. A nation\'s own culture ===')
{
  const pops = [pop('a', 'martian', 'buddhist', 700), pop('b', 'venusian', 'axiomatic', 250), pop('c', 'tidalian', 'buddhist', 50)]
  const n = nationCultureOf(pops)
  check('the biggest culture is primary and is the one people assimilate into; a fifth of the people makes another primary too', n.primary.join() === 'martian,venusian' && n.assimilatesInto === 'martian')
  check('the biggest faith is the state religion', n.stateReligion === 'buddhist')
  check('nobody: no culture', nationCultureOf([]).primary.length === 0)
  check('primary cultures are fully accepted; others by cultural policy', acceptanceOf('martian', n, undefined) === 'full' && acceptanceOf('tidalian', n, undefined) === statusOfScore(CITIZENSHIP_SCORE.standard) && acceptanceOf('tidalian', n, { citizenship: 'multicultural' }) === 'full' && acceptanceOf('tidalian', n, { citizenship: 'assimilationist' }) === 'cultural-erasure')
}

console.log('\n=== 3. Assimilation and conversion ===')
{
  const pops = [pop('a', 'martian', 'buddhist', 900), pop('c', 'tidalian', 'axiomatic', 100)]
  const n = nationCultureOf(pops)
  const r = stepAssimilation(pops, n, undefined, 'W')
  check('a minority drifts into the nation\'s culture and faith', r.assimilated > 0 && r.converted > 0 && near(r.assimilated, 100 * assimilationRate(acceptanceOf('tidalian', n, undefined), undefined, 0)))
  check('people are conserved', near(total(r.pops), 1000))
  check('they keep the faith they have while taking the culture (and the culture while taking the faith)', r.pops.some((p) => p.cultureId === 'martian' && p.religionId === 'axiomatic' && p.populationSize > 0) && r.pops.some((p) => p.cultureId === 'tidalian' && p.religionId === 'buddhist' && p.populationSize > 0))
  const multi = stepAssimilation(pops, n, { citizenship: 'multicultural' }, 'W')
  check('under multiculturalism nobody assimilates', multi.assimilated === 0)
  const hard = stepAssimilation(pops, n, { citizenship: 'assimilationist' }, 'W')
  check('under assimilation they do, and faster', hard.assimilated > r.assimilated)
  check('religious schools speed conversion, radicals slow it', conversionRate({ education: 'religious' }, 0) > conversionRate(undefined, 0) && conversionRate(undefined, 0.5) < conversionRate(undefined, 0) && assimilationRate('second-class', undefined, 1) === 0 && ASSIMILATION_RATE > 0)
  check('a nation of one culture and faith changes nothing', (() => { const same = [pop('a', 'martian', 'buddhist', 500)]; const out = stepAssimilation(same, nationCultureOf(same), undefined, 'W'); return out.assimilated === 0 && out.converted === 0 && out.pops.length === 1 })())
}

console.log('\n=== 4. Birth and mortality ===')
{
  check('net growth is exactly what the single growth term always was', [0, 0.2, 0.35, 0.5, 0.8, 1].every((sol) => [0, 0.4, 1].every((h) => near(birthMortality(sol, h).net, GROWTH_RATE * (sol - GROWTH_MIDPOINT) * 2 * (sol >= GROWTH_MIDPOINT ? h : 1)))))
  check('births minus deaths is the net, and neither is negative', [0, 0.3, 0.7, 1].every((sol) => { const b = birthMortality(sol, 1); return near(b.birth - b.mortality, b.net) && b.birth >= 0 && b.mortality >= 0 }))
  check('mortality falls steeply with living standards, faster than births', birthMortality(0.1, 1).mortality > birthMortality(0.9, 1).mortality * 5 && (birthMortality(0.1, 1).mortality - birthMortality(0.9, 1).mortality) > (birthMortality(0.1, 1).birth - birthMortality(0.9, 1).birth))
  check('a full world makes only as many births as deaths', near(birthMortality(0.8, 0).birth, birthMortality(0.8, 0).mortality))
}

console.log('\n=== 5. In the economy ===')
{
  let countries = seedCountries()
  let worlds = seedWorlds()
  let corporations = seedCorporations()
  let banks = seedBanks()
  const people0 = worlds.reduce((n, w) => n + total(w.pops), 0)
  for (let m = 1; m <= 36; m++) ({ countries, worlds, corporations, banks } = tickEconomy(countries, worlds, corporations, { enableAI: true, tick: m, humanCountryIds: [] }, banks))
  check('three years on every pop is still a real pop and nobody has been lost to assimilation', worlds.every((w) => w.pops.every((p) => p.populationSize > 0 && Number.isFinite(p.wealth))) && worlds.reduce((n, w) => n + total(w.pops), 0) > people0 * 0.9)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll culture checks passed')
process.exit(failures ? 1 : 0)
