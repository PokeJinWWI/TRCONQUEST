// The economy's advance as a pure function and a request to a worker
// (src/economy/economyStep.ts, src/state/economyEngine.ts, economyStore.advance):
// determinism, the store matching the pure function, one request in flight at a
// time with months queued behind it, a player's edit made mid-flight surviving
// the result, a reset dropping a late answer, and a failed worker falling back.
//
// Run:  npx tsx tests/economyEngine.test.ts

import { runEconomySteps, type EconomyStepInput, type EconomyStepOutput } from '../src/economy/economyStep'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import { cancelEconomyFlight, economyBusy, useEconomyStore } from '../src/state/economyStore'
import { requestEmpireSnapshot, setEconomyRunner } from '../src/state/economyEngine'
import { usePlayerStore } from '../src/state/playerStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const st = () => useEconomyStore.getState()
const tickOf = () => st().tick

function fresh() {
  cancelEconomyFlight()
  setEconomyRunner(null)
  useDiplomacyStore.getState().reset()
  usePlayerStore.setState({ selectedCountryId: null })
  useEconomyStore.setState({ countries: seedCountries(), worlds: seedWorlds(), corporations: seedCorporations(), banks: seedBanks(), tick: 0, history: {}, centralBankEvents: [], worldReports: {}, countryReports: {}, moneyReports: {}, empireSummaries: {}, empireHistory: {}, empireTick: 0 })
}
const input = (steps: number, startTick = 0): EconomyStepInput => ({ countries: seedCountries(), worlds: seedWorlds(), corporations: seedCorporations(), banks: seedBanks(), startTick, steps, humanCountryIds: [], warPairs: [] })

console.log('\n=== 1. The step is a pure function ===')
{
  const a = runEconomySteps(input(3))
  const b = runEconomySteps(input(3))
  check('the same input gives the same output, twice', same(a, b))
  check('its input is not modified', (() => { const i = input(1); const copy = JSON.stringify(i); runEconomySteps(i); return JSON.stringify(i) === copy })())
  const chained = (() => {
    let state = input(1)
    let out: EconomyStepOutput = runEconomySteps(state)
    for (let t = 1; t < 3; t++) {
      state = { ...state, countries: out.countries, worlds: out.worlds, corporations: out.corporations, banks: out.banks, startTick: t }
      out = runEconomySteps(state)
    }
    return out
  })()
  check('three months at once = one month three times (so queued months can be batched)', same(a.countries, chained.countries) && same(a.worlds, chained.worlds) && same(a.banks, chained.banks) && a.tick === chained.tick)
  check('it reports the steps: a sample per month per nation', Object.values(a.samples).every((s) => s.length === 3) && Object.keys(a.samples).length === 5)
  const noTrade = runEconomySteps({ ...input(2), tradeGroups: { 'imperial-state-of-mars': 'elsewhere' } })
  check('reach groups change what trade can happen (Mars cut off from the rest)', !same(noTrade.worlds, runEconomySteps(input(2)).worlds))
}

console.log('\n=== 2. The store, with no worker: the same function inline ===')
{
  fresh()
  const direct = runEconomySteps({ ...input(2), startTick: 0 })
  st().advance(2)
  check('advance(2) lands at once with no worker', tickOf() === 2 && !economyBusy())
  check('...exactly what the pure function gives', same(st().countries, direct.countries) && same(st().worlds, direct.worlds) && same(st().banks, direct.banks))
  check('...with reports and history per nation', Object.keys(st().history).length === 5 && Object.values(st().history).every((h) => h.length === 2))
  st().advance(0)
  check('advance(0) does nothing', tickOf() === 2)
  fresh()
  st().advance(1000)
  check('a big catch-up is bounded', tickOf() === 40)
}

console.log('\n=== 3. A request in flight ===')
{
  fresh()
  const requests: { input: EconomyStepInput; answer: (out?: EconomyStepOutput) => void; fail: () => void }[] = []
  setEconomyRunner((i) => new Promise((resolve, reject) => requests.push({ input: i, answer: (out) => resolve(out ?? runEconomySteps(i)), fail: () => reject(new Error('worker died')) })))
  const tax0 = st().countries.find((c) => c.id === 'republic-of-venus')!.taxRate

  st().advance(1)
  check('a month goes out and the store is busy', requests.length === 1 && economyBusy() && tickOf() === 0)
  st().advance(2)
  check('months that come due meanwhile queue, not a second request', requests.length === 1)
  check('the request carries the state, the human player and the wars', requests[0].input.startTick === 0 && requests[0].input.steps === 1 && requests[0].input.countries.length === 5)

  // A player edit while it runs: lands at once...
  st().setTaxRate('republic-of-venus', 0.33)
  check('an edit made meanwhile shows at once', st().countries.find((c) => c.id === 'republic-of-venus')!.taxRate === 0.33)
  requests[0].answer()
  await Promise.resolve()
  await Promise.resolve()
  check('...and survives the result landing (it is replayed on it)', st().countries.find((c) => c.id === 'republic-of-venus')!.taxRate === 0.33 && tax0 !== 0.33)
  check('the month landed', tickOf() === 1)
  check('the queued months then go out as one request', requests.length === 2 && requests[1].input.steps === 2 && requests[1].input.startTick === 1 && economyBusy())
  check('the next request started from the edited state', requests[1].input.countries.find((c) => c.id === 'republic-of-venus')!.taxRate === 0.33)
  requests[1].answer()
  await Promise.resolve()
  await Promise.resolve()
  check('all three months in, nothing in flight', tickOf() === 3 && !economyBusy() && requests.length === 2)
  check('and the edit still stands', st().countries.find((c) => c.id === 'republic-of-venus')!.taxRate === 0.33)
  check('history has a sample per month', Object.values(st().history).every((h) => h.length === 3))
}

console.log('\n=== 4. Reset and failure ===')
{
  fresh()
  let late: (() => void) | null = null
  setEconomyRunner((i) => new Promise((resolve) => (late = () => resolve(runEconomySteps(i)))))
  st().advance(1)
  cancelEconomyFlight()
  useEconomyStore.setState({ tick: 0 })
  check('a reset clears the flight', !economyBusy())
  late!()
  await Promise.resolve()
  await Promise.resolve()
  check('the old game\'s late answer is dropped', tickOf() === 0)
  st().advance(1)
  check('and a new request is accepted', economyBusy())
  cancelEconomyFlight()

  fresh()
  setEconomyRunner(() => Promise.reject(new Error('worker died')))
  st().advance(1)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  check('a worker that fails: the same month runs inline instead', tickOf() === 1 && !economyBusy())
  check('...to the same result', same(st().countries, runEconomySteps({ ...input(1), startTick: 0 }).countries))
}
setEconomyRunner(null)

console.log('\n=== 5. The empires beside the four nations ===')
{
  fresh()
  st().advance(2)
  const nationsOnly = JSON.stringify([st().countries, st().worlds, st().banks])
  check('with the empires off the store has no empire numbers', Object.keys(st().empireSummaries).length === 0 && st().empireTick === 0)

  fresh()
  st().seedEmpires()
  st().seedEmpires()
  st().advance(1)
  const afterOne = st().empireSummaries
  st().advance(5)
  check('with the empires on, each month brings summaries for all 20', Object.keys(afterOne).length === 20 && st().empireTick === 6 && Object.keys(st().empireSummaries).length === 20)
  check('...and a fiscal history per empire', Object.values(st().empireHistory).every((h) => h.length === 6))
  check('...while the nations hold only their own four', st().countries.length === 4 && st().worlds.length === 6)
  const summary = st().empireSummaries['empire-3']
  check('a summary is headline numbers, not the economy', !!summary && summary.population > 0 && Object.keys(summary).length < 16 && JSON.stringify(summary).length < 600, `${JSON.stringify(summary).length} bytes`)
  check('the empires cost the nations nothing (same four nations as with the empires off)', (() => { fresh(); st().advance(2); return JSON.stringify([st().countries, st().worlds, st().banks]) === nationsOnly })())
  fresh()
  st().seedEmpires()
  st().advance(3)
  const snap = await requestEmpireSnapshot('empire-3')
  check('one empire can be looked at in full, on demand', !!snap && snap.country.id === 'empire-3' && snap.worlds.length >= 1 && snap.worlds.every((w) => w.ownerId === 'empire-3') && snap.banks.length === 1)
  check('...and an unknown one cannot', (await requestEmpireSnapshot('nobody')) === null)
  fresh()
  st().seedEmpires()
  st().advance(6)
  const chunked = JSON.stringify((await requestEmpireSnapshot('empire-7'))!.worlds)
  fresh()
  st().seedEmpires()
  for (let i = 0; i < 6; i++) st().advance(1)
  check('six months at once = six months one at a time', JSON.stringify((await requestEmpireSnapshot('empire-7'))!.worlds) === chunked)
  cancelEconomyFlight()
  useEconomyStore.setState({ empireSummaries: {}, empireHistory: {}, empireTick: 0 })
  st().advance(1)
  check('after a reset the empires no longer advance (until a game starts them again)', st().empireTick === 0 && Object.keys(st().empireSummaries).length === 0)
}

console.log('\n=== 6. Only Complex mode runs the empires ===')
{
  const { setUpNewGame } = await import('../src/scene/gameSetup')
  const { resetGame } = await import('../src/scene/gameReset')
  fresh()
  usePlayerStore.setState({ selectedCountryId: 'imperial-state-of-mars', economyModel: 'abstract' })
  setUpNewGame()
  st().advance(1)
  check('Simple mode: starting a game leaves the empires off', st().empireTick === 0 && Object.keys(st().empireSummaries).length === 0)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'imperial-state-of-mars', economyModel: 'complex' })
  setUpNewGame()
  st().advance(2)
  check('Complex mode: starting a game starts them', st().empireTick === 2 && Object.keys(st().empireSummaries).length === 20)
  resetGame()
  check('quitting to the menu clears them', st().empireTick === 0 && Object.keys(st().empireSummaries).length === 0 && Object.keys(st().empireHistory).length === 0)
  usePlayerStore.setState({ economyModel: 'abstract' })
  st().advance(1)
  check('...and they stay off until the next game asks', st().empireTick === 0)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
