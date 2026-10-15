// The Society menu's view models (scene/societyView.ts), both economies.
//
// Run:  npx tsx tests/societyView.test.ts
import { seedWorlds } from '../src/economy/economySeed'
import { nationCultureOf } from '../src/economy/acceptance'
import { REFERENCE_WORKFORCE_SHARE } from '../src/economy/popRules'
import { cultureView, politicsView, popRows, religionView, societyViewComplex, societyViewSimple } from '../src/scene/societyView'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps

const worlds = seedWorlds()
const owner = worlds.find((w) => w.id === 'Mars')!.ownerId
const pops = worlds.filter((w) => w.ownerId === owner).flatMap((w) => w.pops)
const nation = nationCultureOf(pops)
const total = pops.reduce((n, p) => n + p.populationSize, 0)

console.log('\n=== 1. Complex: strata and classes ===')
{
  const v = societyViewComplex(pops, nation, undefined)
  check('the strata hold everyone', near(v.strata.reduce((n, s) => n + s.population, 0), total) && near(v.population, total))
  check('workforce plus dependents is the population, at the reference share by default', near(v.workforce + v.dependents, total) && near(v.workforce / total, REFERENCE_WORKFORCE_SHARE))
  check('shares of people, of wealth and of political strength each add up to one', near(v.strata.reduce((n, s) => n + s.share, 0), 1) && near(v.strata.reduce((n, s) => n + (s.wealthShare ?? 0), 0), 1) && near(v.strata.reduce((n, s) => n + (s.strengthShare ?? 0), 0), 1))
  check('a stratum lists its classes, and they add up to it', v.strata.every((s) => near(s.classes.reduce((n, c) => n + c.population, 0), s.population)))
  check('moods add up to everyone', v.strata.every((s) => near(s.mood.loyalists + s.mood.neutral + s.mood.radicals, 1)))
  check('the lower class is the biggest, the upper the richest per head', v.strata[0].stratum === 'lower' && v.strata[0].share > v.strata.at(-1)!.share)
  check('births and deaths are per thousand a year', (v.birthPerThousand ?? 0) > 0 && (v.deathPerThousand ?? 0) > 0 && (v.birthPerThousand ?? 0) < 100)
  const eq = societyViewComplex(pops.map((p) => ({ ...p, workforceShare: 0.55 })), nation, undefined)
  check('a bigger workforce share shows in the numbers', eq.workforce > v.workforce && near(eq.workforce + eq.dependents, total))
}

console.log('\n=== 2. Simple: what it knows ===')
{
  const v = societyViewSimple({ population: 6000, workforce: 2520, literacy: 0.6, strata: { workers: { population: 3500, happiness: 0.55 }, specialists: { population: 1500, happiness: 0.7 }, unemployed: { population: 1000, happiness: 0.2 } } })
  check('the same words: lower and middle class, workforce and dependents', v.mode === 'simple' && v.strata.map((s) => s.stratum).join() === 'lower,middle' && near(v.workforce + v.dependents, 6000))
  check('it invents nothing it does not model: no wealth, no classes, no upper class', v.strata.every((s) => s.wealth === null && s.classes.length === 0) && v.topWealthShare === null && v.birthPerThousand === null)
  check('the unemployed make the lower class angrier', v.strata[0].mood.radicals > 0 && v.strata[1].mood.loyalists > 0 && v.turmoil > 0)
}

console.log('\n=== 3. Pop table, politics, culture, religion ===')
{
  const rows = popRows(pops, nation, undefined, 'population')
  check('every pop is a row, biggest first', rows.length === pops.length && rows.every((r, i) => i === 0 || rows[i - 1].population >= r.population))
  check('it sorts by class and by literacy', popRows(pops, nation, undefined, 'class')[0].cls === 'subsistence' && popRows(pops, nation, undefined, 'literacy').every((r, i, a) => i === 0 || a[i - 1].literacy >= r.literacy))
  const groups = politicsView(pops, nation, undefined)
  check('the four groups share all the strength', groups.length === 4 && near(groups.reduce((n, g) => n + g.share, 0), 1))
  const cultures = cultureView(pops, nation, undefined)
  check('cultures and religions each add up to the people, and one is primary / the state faith', near(cultures.reduce((n, c) => n + c.share, 0), 1) && cultures.some((c) => c.primary) && near(religionView(pops, nation, undefined).reduce((n, r) => n + r.share, 0), 1) && religionView(pops, nation, undefined).some((r) => r.state))
  check('a primary culture does not assimilate; a minority does', cultures.filter((c) => c.primary).every((c) => c.assimilationPerYear === 0))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll society view checks passed')
process.exit(failures ? 1 : 0)
