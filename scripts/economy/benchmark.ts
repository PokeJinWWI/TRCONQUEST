// How long one economy month takes, for the four nations alone and with the 20
// generated empires: the headless half of the budget in the worker plan.
//   npx tsx scripts/economy/benchmark.ts [months]
//
// Reports per month (warm: the first 6 are JIT/GC warm-up and skipped) the
// median, mean, p95 and max milliseconds of runEconomySteps (the work a Web
// Worker does), and what posting a request and its answer between threads costs
// the MAIN thread, measured as structuredClone of the input and of the output
// (the browser's postMessage clones the same way, on the posting side).
import { performance } from 'node:perf_hooks'
import { galaxyEmpires } from '../../src/data/generatedEmpires'
import { seedEmpireEconomies } from '../../src/economy/empireSeed'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../../src/economy/economySeed'
import { runEconomySteps, type EconomyStepInput } from '../../src/economy/economyStep'
import { EmpireSim } from '../../src/economy/empireSim'

const MONTHS = Number(process.argv[2] ?? 48)
const WARM = 6

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))]
  return { median: at(0.5), mean: s.reduce((a, b) => a + b, 0) / s.length, p95: at(0.95), max: s[s.length - 1] }
}
const f = (n: number) => n.toFixed(1).padStart(7)

function bench(label: string, withEmpires: boolean) {
  const emp = withEmpires ? seedEmpireEconomies(galaxyEmpires()) : null
  let state = {
    countries: [...seedCountries(), ...(emp?.countries ?? [])],
    worlds: [...seedWorlds(), ...(emp?.worlds ?? [])],
    corporations: [...seedCorporations(), ...(emp?.corporations ?? [])],
    banks: [...seedBanks(), ...(emp?.banks ?? [])],
  }
  const compute: number[] = []
  const cloneIn: number[] = []
  const cloneOut: number[] = []
  for (let m = 0; m < MONTHS; m++) {
    const input: EconomyStepInput = { ...state, startTick: m, steps: 1, humanCountryIds: [], warPairs: [], tradeGroups: emp?.tradeGroups }
    let t0 = performance.now()
    structuredClone(input)
    cloneIn.push(performance.now() - t0)
    t0 = performance.now()
    const out = runEconomySteps(input)
    compute.push(performance.now() - t0)
    t0 = performance.now()
    structuredClone(out)
    cloneOut.push(performance.now() - t0)
    state = { countries: out.countries, worlds: out.worlds, corporations: out.corporations, banks: out.banks }
  }
  const c = stats(compute.slice(WARM))
  const buildings = state.worlds.reduce((n, w) => n + w.buildings.length, 0)
  const kb = Math.round(JSON.stringify(state).length / 1024)
  console.log(`${label.padEnd(15)} ${String(state.countries.length).padStart(2)} nations ${String(state.worlds.length).padStart(3)} worlds ${String(buildings).padStart(5)} buildings ${String(kb).padStart(5)} KB | compute ms/month: median${f(c.median)} mean${f(c.mean)} p95${f(c.p95)} max${f(c.max)} | structuredClone in${f(stats(cloneIn.slice(WARM)).median)} out${f(stats(cloneOut.slice(WARM)).median)} (median ms)`)
  return c
}

// The resident design: the empires never cross the thread boundary, so the only
// thing posted is the four nations' state; the empires cost the worker compute.
function benchResident() {
  const sim = new EmpireSim()
  sim.start()
  const compute: number[] = []
  const summaryBytes: number[] = []
  for (let m = 0; m < MONTHS; m++) {
    const t0 = performance.now()
    const update = sim.advance(1)!
    compute.push(performance.now() - t0)
    summaryBytes.push(JSON.stringify(update).length)
  }
  const c = stats(compute.slice(WARM))
  console.log(`${'20 empires alone'.padEnd(15)} resident in the worker | compute ms/month: median${f(c.median)} mean${f(c.mean)} p95${f(c.p95)} max${f(c.max)} | posts back ${Math.round(stats(summaryBytes).median / 1024)} KB of summaries a month`)
}

console.log(`${MONTHS} months each, country AI on, no human player\n`)
bench('4 nations', false)
bench('4 nations', false)
bench('4 + 20 empires', true)
bench('4 + 20 empires', true)
benchResident()
benchResident()
