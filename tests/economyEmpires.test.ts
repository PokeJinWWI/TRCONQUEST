// The 20 generated empires inside the real Complex economy (src/economy/
// empireSeed.ts): their seed, that adding them leaves the four nations alone,
// and that they hold together for five years under the same checks the four
// nations are held to (tests/complexStability.test.ts).
//
// Run:  npx tsx tests/economyEmpires.test.ts

import { createHash } from 'node:crypto'
import { galaxyEmpires } from '../src/data/generatedEmpires'
import { seedEmpireEconomies, worldPlanetsOf, MAX_WORLDS_PER_EMPIRE } from '../src/economy/empireSeed'
import { seedBanks, seedCharacters, seedCorporations, seedCountries, seedFamilies, seedWorlds } from '../src/economy/economySeed'
import { runEconomySteps } from '../src/economy/economyStep'
import { EmpireSim } from '../src/economy/empireSim'
import { measureStability } from '../scripts/economy/stability'

// The floor on empires inside the nations' own bounds (see section 3).
const MIN_EMPIRES_WITHIN_BOUNDS = 10

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const NATIONS = ['imperial-state-of-mars', 'republic-of-venus', 'orion-republic', 'kingdom-of-lalande']
const empires = galaxyEmpires()
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)

console.log('\n=== 1. The four nations\' seed is unchanged by the refactor ===')
{
  // Recorded before economySeed.ts was made reusable for the empires.
  check('worlds', hash(seedWorlds()) === '17805bcb404ac006')
  check('countries', hash(seedCountries()) === 'f4c2d9b06e3db593')
  check('corporations', hash(seedCorporations()) === 'c16e6cd60e1ec651')
  check('banks', hash(seedBanks()) === '7bccfcac62561d47')
  check('characters', hash(seedCharacters()) === '1a93eb568a378a30')
  check('families', hash(seedFamilies()) === '6c211d4cc3df1023')
}

console.log('\n=== 2. The empires\' seed ===')
const emp = seedEmpireEconomies(empires)
{
  check('deterministic (same empires, same economies)', hash(seedEmpireEconomies(empires)) === hash(emp))
  check('and does not depend on what was seeded before', (seedWorlds(), hash(seedEmpireEconomies(empires)) === hash(emp)))
  check('every one of the 20 has an economy', emp.countries.length === 20 && Object.keys(emp.worldIdsByEmpire).length === 20)
  check(`each runs 1-${MAX_WORLDS_PER_EMPIRE} worlds, the best first`, empires.every((e) => { const n = emp.worldIdsByEmpire[e.id]?.length ?? 0; return n >= 1 && n <= MAX_WORLDS_PER_EMPIRE && emp.worldIdsByEmpire[e.id][0] === worldPlanetsOf(e)[0].name }), `${emp.worlds.length} worlds`)
  const ids = new Set([...seedWorlds(), ...emp.worlds].map((w) => w.id))
  check('world ids are unique across all 24 nations', ids.size === seedWorlds().length + emp.worlds.length)
  check('every world is owned by its empire, on a planet it owns', emp.worlds.every((w) => empires.some((e) => e.id === w.ownerId && e.ownedStarIds.some((s) => worldPlanetsOf(e).some((p) => p.name === w.id)))))
  const buildingIds = [...seedWorlds(), ...emp.worlds].flatMap((w) => w.buildings.map((b) => b.id))
  check('building ids are unique', new Set(buildingIds).size === buildingIds.length)
  check('worlds have people, jobs, markets and a calibrated start', emp.worlds.every((w) => w.pops.length > 0 && w.buildings.length >= 3 && Object.keys(w.market.prices).length > 40 && w.land! > 0))
  check('each empire has a country, a bank and an operator company', emp.countries.every((c) => emp.banks.some((b) => b.countryId === c.id) && emp.corporations.some((k) => k.countryId === c.id)))
  check('countries are complete (fields a nation has)', emp.countries.every((c) => Object.keys(c).length >= Object.keys(seedCountries()[0]).length - 1 && c.centralBank?.countryId === c.id && c.centralBank?.name.startsWith(empires.find((e) => e.id === c.id)!.name)))
  check('influence sets the treasury', (() => { const hi = empires.reduce((a, b) => (b.influence > a.influence ? b : a)); const lo = empires.reduce((a, b) => (b.influence < a.influence ? b : a)); return emp.countries.find((c) => c.id === hi.id)!.treasury > emp.countries.find((c) => c.id === lo.id)!.treasury })())
  check('the empires reach only their own neighbourhood', empires.every((e) => emp.tradeGroups[e.id] === e.clusterId))
}

// --- Five years, all 24 nations, AI on --------------------------------------
const verdict = measureStability(
  { countries: [...seedCountries(), ...emp.countries], worlds: [...seedWorlds(), ...emp.worlds], corporations: [...seedCorporations(), ...emp.corporations], banks: [...seedBanks(), ...emp.banks] },
  { humanCountryIds: [], warPairs: [], tradeGroups: emp.tradeGroups },
)
const empireIds = empires.map((e) => e.id)

console.log('\n=== 3. Five years, 24 nations, AI on ===')
check('nothing ever goes NaN or infinite', verdict.nonFinite === 0)
check('the four nations still hold (same bounds as complexStability)', NATIONS.every((id) => !verdict.failing[id]), NATIONS.filter((id) => verdict.failing[id]).map((id) => `${id}: ${verdict.failing[id].map((f) => f.kind + ' ' + f.detail).join('; ')}`).join(' | '))

// No empire blows up: whatever else drifts, real output at the end is not a
// fraction of the start, the people are still there and the treasury is finite.
const final = (id: string) => verdict.years[id][verdict.years[id].length - 1]
const first = (id: string) => verdict.years[id][0]
check('no empire\'s economy collapses over five years (real output at the end >= 50% of year 1)', empireIds.every((id) => final(id).real >= 0.5 * first(id).real), empireIds.filter((id) => final(id).real < 0.5 * first(id).real).join(', '))
check('every empire keeps most of its workers in jobs (>= 50% in year 5)', empireIds.every((id) => final(id).employed / Math.max(1, final(id).workers) >= 0.5), empireIds.filter((id) => final(id).employed / Math.max(1, final(id).workers) < 0.5).join(', '))

// How many hold to the four nations' own bounds: reported, with a floor, because
// 20 procedurally seeded economies are not hand-tuned the way the four are.
const within = empireIds.filter((id) => !verdict.failing[id])
const byKind = (kind: string) => empireIds.filter((id) => verdict.failing[id]?.some((f) => f.kind === kind)).length
console.log(`  INFO  ${within.length} of 20 empires stay inside every one of the four nations' bounds; outside: collapse ${byKind('collapse')}, budget ${byKind('budget')}, prices ${byKind('prices')}, jobs ${byKind('jobs')}`)
check(`at least ${MIN_EMPIRES_WITHIN_BOUNDS} of the 20 empires stay inside every bound`, within.length >= MIN_EMPIRES_WITHIN_BOUNDS, `${within.length}`)

console.log('\n=== 4. The empires leave the four nations alone, and the run is deterministic ===')
{
  const nationsOnly = { countries: seedCountries(), worlds: seedWorlds(), corporations: seedCorporations(), banks: seedBanks() }
  const all = { countries: [...seedCountries(), ...emp.countries], worlds: [...seedWorlds(), ...emp.worlds], corporations: [...seedCorporations(), ...emp.corporations], banks: [...seedBanks(), ...emp.banks] }
  const extra = { humanCountryIds: [], warPairs: [] }
  const alone = runEconomySteps({ ...nationsOnly, startTick: 0, steps: 12, ...extra })
  const together = runEconomySteps({ ...all, startTick: 0, steps: 12, ...extra, tradeGroups: emp.tradeGroups })
  const ofNations = <T extends { id: string }>(xs: T[]) => xs.filter((x) => NATIONS.includes(x.id))
  check('twelve months: the four nations are identical with or without the 20 empires', hash(ofNations(together.countries)) === hash(alone.countries) && hash(together.worlds.filter((w) => NATIONS.includes(w.ownerId))) === hash(alone.worlds) && hash(together.banks.filter((b) => NATIONS.includes(b.countryId))) === hash(alone.banks))
  const unreachable = runEconomySteps({ ...all, startTick: 0, steps: 12, ...extra })
  check('(without the reach groups they would not be: the empires would trade with Mars)', hash(ofNations(unreachable.countries)) !== hash(alone.countries))
  // The other direction: the empires don't depend on the four nations either, so
  // they can run as their own simulation (economy/empireSim.ts) with nothing lost.
  const empiresAlone = runEconomySteps({ countries: emp.countries, worlds: emp.worlds, corporations: emp.corporations, banks: emp.banks, startTick: 0, steps: 12, ...extra, tradeGroups: emp.tradeGroups })
  check('twelve months: the empires are identical with or without the four nations (so they can be their own simulation)', hash(together.countries.filter((c) => !NATIONS.includes(c.id))) === hash(empiresAlone.countries) && hash(together.worlds.filter((w) => !NATIONS.includes(w.ownerId))) === hash(empiresAlone.worlds) && hash(together.corporations.filter((c) => !NATIONS.includes(c.countryId))) === hash(empiresAlone.corporations) && hash(together.banks.filter((b) => !NATIONS.includes(b.countryId))) === hash(empiresAlone.banks))
  const sim = new EmpireSim()
  sim.start()
  sim.advance(5)
  const update = sim.advance(7)!
  check('the resident simulation (5 months, then 7) lands exactly where 12 months at once do', hash(sim.snapshot('empire-3')) === hash({ country: empiresAlone.countries.find((c) => c.id === 'empire-3'), worlds: empiresAlone.worlds.filter((w) => w.ownerId === 'empire-3'), corporations: empiresAlone.corporations.filter((c) => c.countryId === 'empire-3'), banks: empiresAlone.banks.filter((b) => b.countryId === 'empire-3') }) && update.tick === 12)
  check('...with a summary and a fiscal sample for every empire', Object.keys(update.summaries).length === 20 && Object.values(update.samples).every((x) => x.length === 7) && Object.values(update.summaries).every((x) => x.population > 0 && Number.isFinite(x.gdp) && x.worlds >= 1))
  check('an empire without an economy has no snapshot', sim.snapshot('nobody') === null)
  check('all 24 run deterministically', hash(runEconomySteps({ ...all, startTick: 0, steps: 6, ...extra, tradeGroups: emp.tradeGroups })) === hash(runEconomySteps({ ...all, startTick: 0, steps: 6, ...extra, tradeGroups: emp.tradeGroups })))
  const empireWorlds = together.worlds.filter((w) => !NATIONS.includes(w.ownerId))
  check('every empire world produces and sells', empireWorlds.every((w) => Object.values(together.worldReports[w.id].goods).some((g) => g.transacted > 0)))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
