// Promotion and demotion between professions (economy/popMobility.ts) and the shared pop merge (economy/popMerge.ts).
//
// Run:  npx tsx tests/popMobility.test.ts
import { tickEconomy } from '../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import type { Pop } from '../src/economy/economyTypes'
import { mergeInto, popKeyOf } from '../src/economy/popMerge'
import { DEMOTION_EMPLOYMENT, MOBILITY_RATE, stepMobility, type ClassLabour } from '../src/economy/popMobility'
import type { PopClass } from '../src/economy/recipes'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps
const mkPop = (cls: PopClass, size: number, edu: number, over: Partial<Pop> = {}): Pop => ({
  id: `p-${cls}`, class: cls, speciesTemplateId: 'baseline-organic', cultureId: 'martian', religionId: 'martian-buddhist', populationSize: size, wealth: size * 4, educationLevel: edu, standardOfLiving: 0.5,
  needsSatisfaction: { basic: 1, everyday: 1, healthcare: 1, comfort: 1, luxury: 1 }, ...over,
})
const labour = (o: Partial<Record<PopClass, Partial<ClassLabour>>>): Partial<Record<PopClass, ClassLabour>> => {
  const out: Partial<Record<PopClass, ClassLabour>> = {}
  for (const c of ['subsistence', 'labor', 'technical', 'professional'] as PopClass[]) out[c] = { workers: 100, qualified: 100, jobs: 90, employmentRate: 1, ...(o[c] ?? {}) }
  return out
}
const total = (ps: Pop[]) => ps.reduce((n, p) => n + p.populationSize, 0)
const sizeOf = (ps: Pop[], cls: PopClass) => ps.filter((p) => p.class === cls).reduce((n, p) => n + p.populationSize, 0)

console.log('\n=== 1. The merge ===')
{
  const a = mkPop('labor', 100, 0.2)
  const b = mkPop('labor', 50, 0.5, { workforceShare: 0.5 })
  const merged = mergeInto([a], b, 50, 200, 'W')
  check('people of the same kind join the pop that is there, weighted', merged.length === 1 && near(merged[0].populationSize, 150) && near(merged[0].educationLevel, (100 * 0.2 + 50 * 0.5) / 150))
  check('a workforce share is averaged in, only when one side has one', near(merged[0].workforceShare ?? 0, (100 * 0.42 + 50 * 0.5) / 150) && mergeInto([a], mkPop('labor', 5, 0.2), 5, 0, 'W')[0].workforceShare === undefined)
  check('others found a new pop with a stable id', mergeInto([a], mkPop('technical', 10, 0.5), 10, 0, 'W').length === 2 && mergeInto([a], mkPop('technical', 10, 0.5), 10, 0, 'W')[1].id === `W:m:${popKeyOf(mkPop('technical', 1, 0))}`)
}

console.log('\n=== 2. Promotion ===')
{
  const pops = [mkPop('subsistence', 1000, 0.5), mkPop('labor', 500, 0.5), mkPop('technical', 100, 0.5)]
  const r = stepMobility(pops, labour({ technical: { jobs: 200, qualified: 100 }, labor: { employmentRate: 0.9 } }), 'W')
  check('unfilled technical jobs pull schooled labourers up one rung', (r.moved['labor>technical'] ?? 0) > 0 && near(r.moved['labor>technical'], 500 * MOBILITY_RATE))
  check('...and people are conserved', near(total(r.pops), total(pops)))
  const none = stepMobility(pops, labour({}), 'W')
  check('with every job filled nobody moves', Object.keys(none.moved).length === 0 && near(sizeOf(none.pops, 'technical'), 100))
  const unschooled = stepMobility([mkPop('subsistence', 1000, 0.01), mkPop('labor', 500, 0.05), mkPop('technical', 100, 0.5)], labour({ technical: { jobs: 200, qualified: 100 }, labor: { employmentRate: 0.9 } }), 'W')
  check('people without the schooling for the rung stay where they are', (unschooled.moved['labor>technical'] ?? 0) === 0)
  const noSpare = stepMobility(pops, labour({ technical: { jobs: 200, qualified: 100 }, labor: { employmentRate: 1 } }), 'W')
  check('a class with no one to spare sends no one up', (noSpare.moved['labor>technical'] ?? 0) === 0)
}

console.log('\n=== 3. Demotion ===')
{
  const pops = [mkPop('labor', 500, 0.5), mkPop('technical', 100, 0.5), mkPop('professional', 50, 0.9)]
  const r = stepMobility(pops, labour({ technical: { employmentRate: 0.5 } }), 'W')
  check('a class that cannot find work sends some down a rung', near(r.moved['technical>labor'] ?? 0, 100 * MOBILITY_RATE) && DEMOTION_EMPLOYMENT > 0.5)
  check('...conserving people and wealth', near(total(r.pops), 650) && near(r.pops.reduce((n, p) => n + p.wealth, 0), pops.reduce((n, p) => n + p.wealth, 0)))
  check('investors and the political class are not on the ladder', !Object.keys(stepMobility([mkPop('investor', 10, 0.9), mkPop('political', 10, 0.7)], labour({}), 'W').moved).length)
}

console.log('\n=== 4. Over time in the economy ===')
{
  let countries = seedCountries()
  let worlds = seedWorlds()
  let corporations = seedCorporations()
  let banks = seedBanks()
  const before = worlds.map((w) => ({ id: w.id, total: total(w.pops), shares: Object.fromEntries((['subsistence', 'labor', 'technical', 'professional', 'investor', 'political'] as PopClass[]).map((c) => [c, sizeOf(w.pops, c) / Math.max(1e-9, total(w.pops))])) }))
  for (let m = 1; m <= 36; m++) ({ countries, worlds, corporations, banks } = tickEconomy(countries, worlds, corporations, { enableAI: true, tick: m, humanCountryIds: [] }, banks))
  let worst = 0
  for (const b of before) {
    const w = worlds.find((x) => x.id === b.id)!
    for (const c of Object.keys(b.shares) as PopClass[]) worst = Math.max(worst, Math.abs(sizeOf(w.pops, c) / Math.max(1e-9, total(w.pops)) - b.shares[c]))
  }
  check('three years on, no class share has moved by more than 8 points', worst < 0.08, `${(worst * 100).toFixed(2)} points`)
  check('every pop still has people and a finite wealth', worlds.every((w) => w.pops.every((p) => p.populationSize > 0 && Number.isFinite(p.wealth))))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll pop mobility checks passed')
process.exit(failures ? 1 : 0)
