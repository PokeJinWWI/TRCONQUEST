// Pops: workforce and dependents, social strata (economy/popRules.ts), in the Complex tick and the shared rules. The defaults are
// NEUTRAL: a pop at the reference share, under the default laws, behaves exactly as it did before the split existed.
//
// Run:  npx tsx tests/popRules.test.ts
import { tickEconomy } from '../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import { REFERENCE_LITERACY, educationAccess, literacyResearchFactor, nationLiteracyTarget, schoolCoverage } from '../src/economy/popRules'
import { CLASSES_OF_STRATUM, DEFAULT_POP_LAWS, DEPENDENT_NEED_FACTOR, REFERENCE_WORKFORCE_SHARE, STRATUM_OF, dependentsOf, driftWorkforceShare, idealWorkforceShare, labourFactor, needsFactor, workforceOf, workforceShareOf } from '../src/economy/popRules'
import { POP_CLASSES } from '../src/economy/recipes'
import { emptyStockpile, tickAbstractEconomy, worldWorkforce, type AbstractEconomyState, type Stockpile, type WorldState } from '../src/economy-abstract/abstractEconomy'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps

console.log('\n=== 1. The rules ===')
{
  check('every class belongs to exactly one stratum, lowest first', POP_CLASSES.every((c) => CLASSES_OF_STRATUM[STRATUM_OF[c]].includes(c)) && CLASSES_OF_STRATUM.lower.concat(CLASSES_OF_STRATUM.middle, CLASSES_OF_STRATUM.upper).length === POP_CLASSES.length)
  check('the default laws leave the reference share in every stratum', (['lower', 'middle', 'upper'] as const).every((s) => near(idealWorkforceShare(DEFAULT_POP_LAWS, s), REFERENCE_WORKFORCE_SHARE)))
  check('no laws at all is the same as the defaults', near(idealWorkforceShare(undefined, 'lower'), REFERENCE_WORKFORCE_SHARE))
  check('equal rights raise the workforce, traditional roles lower it', idealWorkforceShare({ womenRights: 'equal' }, 'middle') > REFERENCE_WORKFORCE_SHARE && idealWorkforceShare({ womenRights: 'traditional' }, 'middle') < REFERENCE_WORKFORCE_SHARE)
  check('child labour moves the lower strata most, and the upper not at all', idealWorkforceShare({ childLabour: 'allowed' }, 'lower') - REFERENCE_WORKFORCE_SHARE > idealWorkforceShare({ childLabour: 'allowed' }, 'middle') - REFERENCE_WORKFORCE_SHARE && near(idealWorkforceShare({ childLabour: 'allowed' }, 'upper'), REFERENCE_WORKFORCE_SHARE))
  check('equal rights and allowed child labour together stay inside the cap', idealWorkforceShare({ womenRights: 'equal', childLabour: 'allowed', retirement: 'late' }, 'lower') <= 0.7)
  check('the reference pop supplies exactly its size and needs exactly its size', near(labourFactor(REFERENCE_WORKFORCE_SHARE), 1) && near(needsFactor(REFERENCE_WORKFORCE_SHARE), 1))
  check('a bigger workforce supplies more labour and needs more (dependents need half)', labourFactor(0.55) > 1 && needsFactor(0.55) > 1 && needsFactor(0.55) < labourFactor(0.55))
  check('all dependents would need half what all workers do', near(needsFactor(0) / needsFactor(1), DEPENDENT_NEED_FACTOR))
  const pop = { populationSize: 100, workforceShare: 0.5 }
  check('workforce + dependents is the whole pop', near(workforceOf(pop) + dependentsOf(pop), 100) && near(workforceOf({ populationSize: 100 }), 100 * REFERENCE_WORKFORCE_SHARE) && workforceShareOf({}) === REFERENCE_WORKFORCE_SHARE)
  let share = 0.42
  for (let i = 0; i < 400; i++) share = driftWorkforceShare(share, 0.5)
  check('the share drifts to the ideal and stops there', near(share, 0.5), `${share}`)
  check('it moves a little each month, never all at once', near(driftWorkforceShare(0.42, 0.54), 0.42 + Math.max(0.12 * 0.06, 0.0015)) && driftWorkforceShare(0.42, 0.54) < 0.54)
}

console.log('\n=== 2. In the Complex tick ===')
{
  const run = (mutate: (worlds: ReturnType<typeof seedWorlds>) => ReturnType<typeof seedWorlds>, countriesMutate = (c: ReturnType<typeof seedCountries>) => c) => {
    let countries = countriesMutate(seedCountries())
    let worlds = mutate(seedWorlds())
    let corporations = seedCorporations()
    let banks = seedBanks()
    let last = tickEconomy(countries, worlds, corporations, { enableAI: false, tick: 1, humanCountryIds: [] }, banks)
    ;({ countries, worlds, corporations, banks } = last)
    for (let m = 2; m <= 6; m++) {
      last = tickEconomy(countries, worlds, corporations, { enableAI: false, tick: m, humanCountryIds: [] }, banks)
      ;({ countries, worlds, corporations, banks } = last)
    }
    return { worlds, reports: last.reports }
  }
  const plain = run((w) => w)
  const explicit = run((w) => w.map((x) => ({ ...x, pops: x.pops.map((p) => ({ ...p, workforceShare: REFERENCE_WORKFORCE_SHARE })) })))
  const gdpOf = (r: typeof plain) => Object.fromEntries(Object.entries(r.reports.countries).map(([id, f]) => [id, f.gdp]))
  const a = gdpOf(plain)
  const b = gdpOf(explicit)
  check('a pop at the reference share is exactly a pop with no share set (6 months, every nation)', Object.keys(a).every((id) => near(a[id], b[id], Math.abs(a[id]) * 1e-9 + 1e-6)))
  check('and the default laws never write a share onto a pop', plain.worlds.every((w) => w.pops.every((p) => p.workforceShare === undefined)))
  const equal = run((w) => w, (c) => c.map((x) => ({ ...x, popLaws: { womenRights: 'equal' as const } })))
  const shares = equal.worlds.flatMap((w) => w.pops.map((p) => workforceShareOf(p)))
  check('equal rights: every pop\'s workforce share is rising toward the new ideal', shares.length > 0 && shares.every((s) => s > REFERENCE_WORKFORCE_SHARE && s < REFERENCE_WORKFORCE_SHARE + 0.12), `${Math.min(...shares).toFixed(3)}..${Math.max(...shares).toFixed(3)}`)
  const workersOf = (r: typeof plain) => Object.values(r.reports.worlds).reduce((n, w) => n + Object.values(w.labor).reduce((m, l) => m + l.workers, 0), 0)
  check('...so the labour force is larger than under the defaults', workersOf(equal as never) > workersOf(plain as never))
}

console.log('\n=== 3. In the Simple tick ===')
{
  const mkState = (over: Partial<AbstractEconomyState> = {}): AbstractEconomyState => ({
    countryId: 'x', population: 0, gdp: 6000, realGdp: 6000, priceLevel: 1, inflation: 0.02, stability: 0.6, treasury: 100, reserves: 40, debt: 1000, taxRate: 0.1,
    economyType: 'corporatist', moneyCreation: 0, warTaxes: false, welfare: 0.3, queue: [], nextOrderId: 1, currency: { code: 'X', name: 'X', rate: 1, baseRate: 1 }, trade: {}, ...over,
  })
  const HOME = { civilianFactory: 8, alloyFoundry: 3, consumerFactory: 3, electronicsPlant: 1, farm: 6, mine: 6, powerPlant: 6, physicsLab: 2, entertainmentCenter: 1 }
  const world = (over: Partial<WorldState> = {}): WorldState => ({ bodyName: 'Home', population: 3000, slots: 80, buildings: { ...HOME }, ...over })
  const stock = (): Stockpile => ({ ...emptyStockpile(), food: 200, minerals: 300, energy: 600, alloys: 400, electronics: 60, consumerGoods: 150, exoticMatter: 30, hyperium: 6 })
  const run = (s: AbstractEconomyState, w: WorldState[], months: number) => {
    let st = stock()
    for (let i = 0; i < months; i++) ({ state: s, worlds: w, stock: st } = tickAbstractEconomy(s, w, st))
    return { s, w }
  }
  const a = run(mkState(), [world()], 6)
  const b = run(mkState(), [world({ workforceShare: REFERENCE_WORKFORCE_SHARE })], 6)
  check('Simple: the reference share is exactly the unset share (6 months)', near(a.s.gdp, b.s.gdp, 1e-6) && near(a.s.stability, b.s.stability, 1e-9) && near(a.w[0].population, b.w[0].population, 1e-9))
  check('...and the default laws never write a share onto a world', a.w[0].workforceShare === undefined)
  check('a world with no share has the reference workforce', near(worldWorkforce(world()), 3000 * REFERENCE_WORKFORCE_SHARE))
  const eq = run(mkState({ popLaws: { womenRights: 'equal' } }), [world()], 12)
  check('equal rights: the workforce grows toward the new share', worldWorkforce(eq.w[0]) / eq.w[0].population > REFERENCE_WORKFORCE_SHARE, `${(worldWorkforce(eq.w[0]) / eq.w[0].population).toFixed(3)}`)
}

console.log('\n=== 4. Literacy and education access ===')
{
  check('at the default laws and the starting schools, access is exactly the standard of living', near(educationAccess(0.5, 0, undefined), 0.5) && near(educationAccess(0.8, 0, DEFAULT_POP_LAWS), 0.8))
  check('schools beyond the start raise access; public schools and a child labour ban raise it more', educationAccess(0.5, 2, undefined) > 0.5 && educationAccess(0.5, 0, { education: 'public' }) > 0.5 && educationAccess(0.5, 0, { childLabour: 'banned' }) > 0.5 && educationAccess(0.5, 0, { childLabour: 'allowed' }) < 0.5)
  check('access stays between 0 and the cap', educationAccess(1, 50, { education: 'public' }) <= 0.98 && educationAccess(0, 0, { childLabour: 'allowed' }) >= 0)
  check('schooling is school and university levels per billion people', near(schoolCoverage([{ recipeId: 'school', level: 2 }, { recipeId: 'university', level: 1 }, { recipeId: 'ironMine', level: 9 }], 2000), 2), `${schoolCoverage([{ recipeId: 'school', level: 2 }, { recipeId: 'university', level: 1 }], 2000)}`)
  const lit = (laws: Record<string, unknown>, months: number, mutate: (w: ReturnType<typeof seedWorlds>) => ReturnType<typeof seedWorlds> = (w) => w) => {
    let countries = seedCountries().map((c) => ({ ...c, popLaws: laws as never }))
    let worlds = mutate(seedWorlds())
    let corporations = seedCorporations()
    let banks = seedBanks()
    for (let m = 1; m <= months; m++) ({ countries, worlds, corporations, banks } = tickEconomy(countries, worlds, corporations, { enableAI: false, tick: m, humanCountryIds: [] }, banks))
    const mars = worlds.find((w) => w.id === 'Mars')!
    return { mars, avg: mars.pops.reduce((n, p) => n + p.educationLevel * p.populationSize, 0) / mars.pops.reduce((n, p) => n + p.populationSize, 0) }
  }
  const base = lit({}, 24)
  const pub = lit({ education: 'public' }, 24)
  check('the first tick records the schooling a world started with', typeof base.mars.schoolBaseline === 'number')
  check('public schools raise literacy over two years', pub.avg > base.avg, `${base.avg.toFixed(4)} -> ${pub.avg.toFixed(4)}`)
  const built = lit({}, 24, (w) => w.map((x) => (x.id === 'Mars' ? { ...x, schoolBaseline: 0 } : x)))
  check('a world with more schooling than it started with gains literacy', built.avg > base.avg, `${base.avg.toFixed(4)} -> ${built.avg.toFixed(4)}`)
  check('Simple: the reference literacy changes nothing; laws move the target and research', literacyResearchFactor(undefined) === 1 && nationLiteracyTarget({ education: 'public' }) > REFERENCE_LITERACY && literacyResearchFactor(0.7) > 1 && literacyResearchFactor(0.5) < 1)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll pop rule checks passed')
process.exit(failures ? 1 : 0)
